# Modulebot plugin 開発ガイド

この文書は新規 plugin 開発者向けの手順です。Rust で plugin を作り、
`wasm32-unknown-unknown` target 向けに build し、`modulebot-plugin-api` crate を使う前提です。

## 1. plugin crate を作る

first-party の任意 plugin は `plugins/extra/<name>`、組み込み plugin は
`plugins/builtin/<name>` に置きます。

plugin crate は `cdylib` として build します。

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
modulebot-plugin-api = { path = "../../crates/modulebot-plugin-api" }
```

`plugins/builtin` / `plugins/extra` 以外に置く場合は、相対 path を調整してください。

## 2. plugin を export する

`export_plugin!` macro で metadata、trigger、capability、handler を宣言します。

```rust
use modulebot_plugin_api::{
    export_plugin, BotEvent, Capability, EffectRequest, TriggerGroup,
};

const PLUGIN_ID: &str = "extra.hello";
const PLUGIN_VERSION: &str = "0.1.0";
const EVENT_HELLO: &str = "event.hello";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    triggers: [
        TriggerGroup::slash(EVENT_HELLO, "hello", "Say hello.")
            .message("!hello"),
    ],
    subscribes: [],
    capabilities: [
        Capability::DiscordInteractionReply,
        Capability::DiscordMessageSend,
    ],
    handlers: [
        {
            event: EVENT_HELLO,
            handle: handle_hello,
        },
    ],
}

fn handle_hello(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::DiscordInteractionCommand { interaction_id, .. } => {
            vec![EffectRequest::interaction_reply(
                "reply-hello",
                interaction_id,
                "Hello from Modulebot.",
            )]
        }
        BotEvent::DiscordMessage { channel_id, .. } => {
            vec![EffectRequest::discord_message_send(
                "send-hello",
                channel_id,
                "Hello from Modulebot.",
            )]
        }
        _ => Vec::new(),
    }
}
```

handler は外部副作用を直接実行せず、event を見て必要な `EffectRequest` を返します。
実際の Discord reply、message send、HTTP request は host が実行します。

## 3. WASM に build する

target が未追加の場合は一度だけ追加します。

```sh
rustup target add wasm32-unknown-unknown
```

repository root から個別 plugin を build します。

```sh
cargo build --manifest-path plugins/extra/hello/Cargo.toml --release --target wasm32-unknown-unknown
```

host は `plugins/` 以下の `.wasm` を検出します。ただし `deps` 配下の artifact は除外します。
既存の build script と同じ配置になるよう、plugin ごとの artifact を plugin directory 配下に置いてください。

## 4. 必要な capability だけを宣言する

host は manifest の capability で許可されていない effect を拒否します。capability は最小限にしてください。

```rust
capabilities: [
    Capability::DiscordInteractionReply,
    Capability::http_get("api.example.com"),
]
```

固定の外部 API を使う場合は `Capability::http_get("hostname")` を使います。user 入力などで接続先が
変わる plugin だけ `HttpOriginPolicy::Dynamic` を検討してください。

現在使える capability は次の通りです。

| capability                            | できること                                 |
| ------------------------------------- | ------------------------------------------ |
| `Capability::DiscordInteractionReply` | slash command interaction に reply する。  |
| `Capability::http_get("hostname")`    | 指定 hostname へ HTTP GET request を送る。 |
| `Capability::DiscordMessageSend`      | Discord text channel に message を送る。   |
| `Capability::Agent`                   | LLM を呼び出す。                           |
| `Capability::DiscordChannelHistory`   | チャンネルのメッセージ履歴を取得する。     |

## 5. 複数 step の処理は effect.result でつなぐ

plugin から見ると effect は非同期です。HTTP response を受け取ってから Discord に返答したい場合は、
最初に HTTP effect を返し、`effect.result` を subscribe して result event を処理します。

```rust
const EFFECT_RESULT_TRIGGER: &str = "effect.result";

export_plugin! {
    id: "extra.lookup",
    version: "0.1.0",
    triggers: [
        TriggerGroup::slash("event.lookup", "lookup", "Look up data."),
    ],
    subscribes: [EFFECT_RESULT_TRIGGER],
    capabilities: [
        Capability::DiscordInteractionReply,
        Capability::http_get("api.example.com"),
    ],
    handlers: [
        { event: "event.lookup", handle: handle_lookup },
        { event: EFFECT_RESULT_TRIGGER, handle: handle_result },
    ],
}
```

result event には effect id と汎用 result body だけが入ります。`fetch-thing:` のような prefix を使い、
どの処理の結果か plugin 側で判定できる id にしてください。

## 6. host を起動する

`host` directory で依存関係を install し、build します。

```sh
pnpm install
pnpm run build
```

Discord に接続しない dry-run 起動:

```sh
pnpm start
```

実際の Discord bot として動かす場合は、`host/.env.example` を `host/.env` に copy して設定します。

```env
DISCORD_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-guild-id
MODULEBOT_DATA_DIR=
```

Modulebot は guild slash command だけを登録します。message trigger を使う場合は、
Discord Developer Portal で Message Content Intent も有効にしてください。

## 開発時の convention

- plugin id は `builtin.agent` や `extra.joke` のように namespace 付きで安定させる。
- 内部 event 名は `event.agent` や `event.joke` のようにする。
- handler が処理しない event には `Vec::new()` を返す。
- Discord への出力は短く保ち、外部 API response は防御的に parse する。
- plugin code 内で filesystem、network、environment へ直接アクセスできる前提を置かず、host effect を要求する。
