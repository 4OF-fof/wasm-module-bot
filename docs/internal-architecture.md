# Patchouli 内部アーキテクチャ

Patchouli は、信頼しない Rust/WASM plugin を実行する Discord bot host です。

plugin は Discord、HTTP、filesystem、host state API を直接呼びません。plugin は
`BotEvent` を受け取り、実行したい処理を `ActionPlan` として返します。TypeScript
host は plugin manifest と capability を検査し、許可された effect だけを実行します。

## 実行フロー

```text
Discord event
  -> host が plugin trigger と照合する
  -> host が BotEvent JSON を WASM plugin に渡す
  -> plugin が ActionPlan JSON を返す
  -> host が ActionPlan の構造を検証する
  -> host が EffectRequest を PluginManifest.capabilities で認可する
  -> host が認可済み effect を実行する
  -> 必要に応じて host が effect.result event を plugin に戻す
```

host は bounded effect loop を実行します。最初の Discord event を queue に入れ、
plugin の plan が返した effect を実行します。effect の実行結果は `effect.result`
event になり、plugin manifest の `subscribes` に含まれる場合だけ同じ plugin に戻されます。
現在の loop 上限は、初期 event 1 件につき 5 step です。

## host が提供する機能

TypeScript host は外部副作用と実行環境をすべて所有します。

| 機能 | 内容 |
| --- | --- |
| Discord 接続 | `DISCORD_TOKEN` が設定されている場合に Discord bot として login する。 |
| dry-run 起動 | `DISCORD_TOKEN` が空の場合、Discord へ接続せず読み込んだ plugin と slash command を表示する。 |
| guild slash command 登録 | 有効な plugin の slash command と host command `/module` を `DISCORD_GUILD_ID` の guild command として登録する。global command は登録しない。 |
| Discord interaction 受付 | slash command interaction を trigger と照合し、該当 plugin に `discord.interaction.command` event を渡す。 |
| Discord message 受付 | bot 以外の message を trigger と照合し、該当 plugin に `discord.message` event を渡す。Message Content Intent が必要。 |
| `/module` command | plugin 一覧表示、詳細表示、有効化、無効化を Discord 上で行う。 |
| plugin discovery | `plugins/` 以下の `.wasm` を再帰的に探し、`deps` 配下の dependency artifact は除外する。 |
| manifest 読み取り | WASM の `manifest()` を呼び、plugin id、version、trigger、capability を取得する。 |
| plugin 有効状態の保存 | SQLite に plugin id ごとの有効/無効を保存する。 |
| WASM plan 実行 | WASM の `plan(ptr, len)` に `BotEvent` JSON を渡し、`ActionPlan` JSON を受け取る。 |
| API shape validation | manifest と action plan の JSON 構造を TypeScript 側で検証する。 |
| capability 認可 | effect 実行前に manifest の capability と照合する。 |
| effect 実行 | Discord reply、message send、HTTP fetch を host 側で実行する。 |
| effect result loop | effect 実行結果を `effect.result` event として plugin に戻す。 |
| graceful shutdown | `SIGINT` / `SIGTERM` で Discord client を破棄する。 |

## plugin の検出と有効化

host は起動時に `plugins/` 以下の `.wasm` を読み込み、各候補に `manifest()` を呼びます。
無効な WASM 候補は warning を出して skip します。

manifest id は一意である必要があります。同じ id を返す WASM が複数見つかった場合、
host は曖昧な plugin 選択を避けるため起動を停止します。

plugin の有効状態は plugin id 単位で SQLite に保存します。既定の保存先は
`host/data/patchouli.sqlite` です。`PATCHOULI_DATA_DIR` を設定すると、その directory に
`patchouli.sqlite` を作成します。

初回検出時の既定値は path で決まります。

| path | origin | 初期状態 |
| --- | --- | --- |
| `plugins/builtin/**` | `builtin` | 有効 |
| `plugins/extra/**` | `extra` | 無効 |
| その他の `plugins/**` | `unknown` | 無効 |

## WASM ABI

host は plugin module に次の export があることを期待します。

| export | signature | 用途 |
| --- | --- | --- |
| `memory` | WebAssembly memory | JSON payload をやり取りする共有 memory。 |
| `alloc(size)` | `usize -> *mut u8` | input/output buffer を確保する。 |
| `dealloc(ptr, len)` | `(*mut u8, usize) -> void` | plugin が確保した buffer を解放する。 |
| `manifest()` | `() -> u64` | `ManifestResult` JSON の pointer/length を packed value で返す。 |
| `plan(ptr, len)` | `(*const u8, usize) -> u64` | `BotEvent` JSON を読み、`PlanResult` JSON の pointer/length を packed value で返す。 |

packed return value は上位 32 bit が pointer、下位 32 bit が byte length です。host は
plugin memory から bytes を読み、UTF-8 JSON として decode し、読み終えた returned buffer を
`dealloc(ptr, len)` で解放します。

通常の plugin 開発者は ABI を直接実装しません。`patchouli-plugin-api` crate の
`export_plugin!` macro を使います。

## 信頼境界

manifest は宣言であり、plugin の挙動を証明するものではありません。host は effect 実行時に
毎回 capability を検査します。

| effect | 必要な capability | host 側の追加検査 |
| --- | --- | --- |
| `discord.interaction.reply` | `discord.interaction.reply` | effect の `interactionId` が現在の interaction id と一致すること。 |
| `message.send` | `message.send` | 実行 target が text channel であること。 |
| `http.fetch` | `http.get` | method が `GET` で、URL hostname が origin policy で許可されていること。 |

plugin は「外部副作用を直接実行する module」ではなく、「event と effect result から次の
effect plan を作る planner」として扱います。
