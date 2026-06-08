# Patchouli

Patchouli は、信頼しない Rust/WASM plugin を実行する Discord bot host です。plugin は Discord、HTTP、filesystem、state API を直接呼びません。代わりに effect plan を返し、TypeScript host が capability を検査したうえで effect を実行します。

## アーキテクチャ

```text
Discord event
  -> TypeScript host が外部入力を plugin trigger に対応づける
  -> Rust/WASM plugin が BotEvent を受け取る
  -> plugin が EffectRequest[] を返す
  -> host が PluginManifest の capabilities を検査する
  -> host が許可済み effect を実行する
  -> 必要に応じて host が effect.result event を plugin に返す
```

現在の host は次に対応しています。

- Discord slash command trigger
- Discord message trigger
- `discord.interaction.reply`
- `http.fetch`
- `discord.message.send`
- `agent`
- effect result loop

## Plugins

組み込み plugin は `plugins/builtin` にあります。

- `agent`: bot mention で LLM agent 会話を開始します。
- `session_control`: agent 用の session control tool を提供します。
- `discord_history`: agent 用の Discord history tool を提供します。

plugin manifest では、次の2つを分けています。

- `triggers`: `/joke` や `!joke` のような外部入力が、どの event を起動するか。
- `subscribes`: plugin が処理する event 名。trigger が起動する event は自動的に subscribe されるため、plugin 側では `effect.result` のような追加 event だけを書きます。

host は起動時に `plugins/` 以下の `.wasm` を監査し、各 WASM の manifest から plugin id を読み取ります。plugin の path は永続化せず、永続化層では plugin id ごとの enabled/disabled だけを管理します。

plugin の有効状態は SQLite に保存します。既定の保存先は `host/data/patchouli.sqlite` です。`PATCHOULI_DATA_DIR` を設定すると、別の data directory に `patchouli.sqlite` を作成します。

初回検出時の enabled policy は次の通りです。

- `plugins/builtin/**`: enabled。builtin plugin は無効化できません。
- `plugins/extra/**`: disabled
- その他の `plugins/**`: disabled

同じ manifest id の WASM が複数見つかった場合、host は曖昧な plugin 選択を避けるため起動を停止します。

## 開発

`host` で依存関係をインストールし、host package から build します。

```sh
cd host
pnpm install
pnpm run build
```

リポジトリルートから個別 plugin を build する場合:

```sh
cargo build --manifest-path plugins/builtin/agent/Cargo.toml --release --target wasm32-unknown-unknown
cargo build --manifest-path plugins/builtin/session_control/Cargo.toml --release --target wasm32-unknown-unknown
cargo build --manifest-path plugins/builtin/discord_history/Cargo.toml --release --target wasm32-unknown-unknown
cargo build --manifest-path plugins/extra/joke/Cargo.toml --release --target wasm32-unknown-unknown
```

リポジトリルートから TypeScript API 型を再生成する場合:

```sh
cargo run --manifest-path plugins/crates/patchouli-plugin-api/Cargo.toml --features ts-export --bin export_ts
```

host を起動します。

```sh
cd host
cp .env.example .env
pnpm start
```

実際に Discord bot として起動する場合は、`host/.env` に `DISCORD_TOKEN` と `DISCORD_GUILD_ID` を設定します。Patchouli は slash command を guild command としてのみ登録し、global command は登録しません。

```env
DISCORD_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-guild-id
PATCHOULI_DATA_DIR=
```

`DISCORD_TOKEN` が空の場合、host は dry-run mode で起動し、読み込んだ plugin を表示します。Discord で `!joke` を受け取るには、Discord Developer Portal で bot の Message Content Intent も有効にする必要があります。
