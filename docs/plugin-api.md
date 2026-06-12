# Modulebot plugin API 仕様

この文書は、`modulebot-plugin-api` Rust crate が提供し、TypeScript host が消費する
plugin API の仕様です。

実装上の正は Rust の型定義です。TypeScript 側の API 型は次の command で Rust crate から
生成します。

```sh
cargo run --manifest-path plugins/crates/modulebot-plugin-api/Cargo.toml --features ts-export --bin export_ts
```

## manifest

すべての plugin は `manifest()` から `PluginManifest` を返します。

| field                   | 内容                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `id`                    | 一意で安定した plugin id。例: `builtin.agent`, `extra.joke`。                            |
| `version`               | plugin version 文字列。                                                                  |
| `triggers`              | plugin 処理を開始できる外部入力。                                                        |
| `subscribes`            | 初期 trigger 後に plugin が受け取る event trigger。trigger event は自動で merge される。 |
| `capabilities`          | host がこの plugin に許可できる effect の宣言。                                          |
| `discord.slashCommands` | trigger group から生成された slash command 一覧。                                        |

通常は `export_plugin!` macro を使って manifest と必要な WASM export を生成します。

## trigger

`TriggerGroup` は、1 つの内部 event 名を 1 つ以上の外部 source に対応づけます。

```rust
TriggerGroup::slash("event.joke", "joke", "Fetch a joke.")
    .message("!joke")
```

この例では次を宣言します。

- Discord slash command `/joke`
- trim 後の message content が `!joke` と完全一致する Discord message trigger
- plugin 内部で使う event trigger `event.joke`

source が一致すると、host は `trigger` field に内部 event 名を入れた `BotEvent` を plugin に渡します。

## event

plugin は `BotEvent` を処理します。

| event type                    | 配信タイミング                                                                | 主な field                            |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| `discord.interaction.command` | slash command source が一致したとき。                                         | `trigger`, `interactionId`, `modules` |
| `discord.message`             | message source が一致したとき。                                               | `trigger`, `channelId`, `content`     |
| `effect.result`               | 以前の effect が完了し、plugin が `effect.result` を subscribe しているとき。 | `trigger`, `effectId`, `result`       |

`modules` には、現在有効な plugin の id と version が入ります。plugin は host へ直接問い合わせずに
loaded module 一覧を参照できます。

## effect と action plan

plugin handler は `Vec<EffectRequest>` を返します。API macro がこれを `ActionPlan` に包みます。

host が現在実行できる effect は次の通りです。

| effect type                 | Rust helper                                                                       | 必要な capability                     | 内容                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `discord.interaction.reply` | `EffectRequest::interaction_reply` / `EffectRequest::ephemeral_interaction_reply` | `Capability::DiscordInteractionReply` | 現在の Discord interaction に reply する。                                        |
| `http.fetch`                | `EffectRequest::http_get`                                                         | `Capability::http_get(...)`           | HTTP GET request を実行し、結果を `effect.result` で返す。                        |
| `discord.message.send`      | `EffectRequest::discord_message_send`                                             | `Capability::DiscordMessageSend`      | Discord text channel に plain text message を送る。                               |
| `agent`                     | `EffectRequest::agent`                                                            | `Capability::Agent`                   | LLM を呼び出し応答を得る。sessionId で会話履歴を管理。                            |
| `discord.channel.history`   | `EffectRequest::channel_history`                                                  | `Capability::DiscordChannelHistory`   | 指定チャンネルのメッセージ履歴を取得。`before` + `limit` でページネーション可能。 |

すべての effect には `id` が必要です。後続の `effect.result` を routing できるよう、
用途と target を含む id にしてください。例: `fetch-joke:interaction:{interaction_id}`。

`agent` effect は任意で `toolModuleIds` を指定できます。省略した場合、host は現在有効な
agent tool module をすべて LLM に注入します。指定した場合は、その module id の tool だけを注入します。

```rust
EffectRequest::agent_with_tools(
    "chat",
    "session-1",
    messages,
    ["builtin.discord_history"],
)
```

## agent tool module

agent の tool 定義と実行本体は、通常の plugin とは別の WASM module として提供できます。
tool 定義だけを持つ module は `export_agent_tools!` だけで manifest と必要な WASM export を生成できます。
通常の plugin に tool を追加したい場合は、従来通り `export_plugin!` と `export_agent_tools!` を併用できます。

| WASM export          | 内容                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `tool_definitions()` | `AgentToolDefinition` の配列を返す。name, description, inputSchema。 |
| `execute_tool(...)`  | `{ name, input }` を受け取り、tool の `output` または error を返す。 |

最小例:

```rust
use modulebot_plugin_api::{
    export_agent_tools, AgentToolCall, AgentToolDefinition, AgentToolResult,
};
use serde_json::json;

export_agent_tools! {
    id: "extra.agent-tools.example",
    version: "0.1.0",
    capabilities: [],
    definitions: definitions,
    execute: execute,
}

fn definitions() -> Vec<AgentToolDefinition> {
    vec![AgentToolDefinition {
        name: "ping".to_string(),
        description: "Return pong.".to_string(),
        input_schema: json!({ "type": "object", "properties": {} }),
    }]
}

fn execute(call: AgentToolCall) -> AgentToolResult {
    AgentToolResult::Ok {
        output: json!({ "message": format!("{}: pong", call.name) }),
    }
}
```

## capability 一覧

capability は manifest の `capabilities` に宣言し、host が effect 実行前に検査します。

```rust
capabilities: [
    Capability::DiscordInteractionReply,
    Capability::http_get("api.example.com"),
    Capability::DiscordMessageSend,
],
```

| Rust API                                                                     | manifest type               | 許可される effect           | 認可条件                                                                  |
| ---------------------------------------------------------------------------- | --------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `Capability::DiscordInteractionReply`                                        | `discord.interaction.reply` | `discord.interaction.reply` | 現在処理中の interaction id への reply のみ許可。                         |
| `Capability::http_get("hostname")`                                           | `http.get`                  | `http.fetch`                | method が `GET` で、URL hostname が指定 hostname と一致する場合のみ許可。 |
| `Capability::HttpGet { origin_policy: HttpOriginPolicy::Known { origins } }` | `http.get`                  | `http.fetch`                | method が `GET` で、URL hostname が `origins` に含まれる場合のみ許可。    |
| `Capability::HttpGet { origin_policy: HttpOriginPolicy::Dynamic }`           | `http.get`                  | `http.fetch`                | method が `GET` なら任意 hostname を許可。必要な場合だけ使う。            |
| `Capability::DiscordMessageSend`                                             | `discord.message.send`      | `discord.message.send`      | text channel target に対する message send を許可。                        |
| `Capability::Agent`                                                          | `agent`                     | `agent`                     | LLM 呼び出しを許可。                                                      |
| `Capability::DiscordChannelHistory`                                          | `discord.channel.history`   | `discord.channel.history`   | チャンネルメッセージ履歴の取得を許可。                                    |

現在の host は URL の full origin ではなく hostname だけを見ます。そのため、known origin は
`https://api.example.com` ではなく `api.example.com` のように hostname で書きます。

## host 提供 API と effect result

plugin から見ると、host が提供する API は直接呼び出しではなく effect request です。

| host 機能                 | plugin からの使い方                                       | result                                                              |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Discord interaction reply | `discord.interaction.reply` effect を返す。               | 成功時に `ok: true`, `status: 200`, `body: ""` の `effect.result`。 |
| Discord message send      | `discord.message.send` effect を返す。                    | 成功時に `ok: true`, `status: 200`, `body: ""` の `effect.result`。 |
| LLM agent                 | `agent` effect を返す。                                   | LLM の応答テキストが `body` に入った `effect.result`。              |
| チャンネル履歴取得        | `discord.channel.history` effect を返す。                 | `body` に `{"messages": [...]}` の JSON が入る。                    |
| HTTP GET                  | `http.fetch` effect を返す。                              | HTTP response の `ok`, `status`, response text が `body` に入る。   |
| 有効 module 情報          | `discord.interaction.command` event の `modules` を読む。 | effect ではなく event field として提供される。                      |

`effect.result` の payload は共通で `{ ok, status, body }` です。HTTP response body の JSON parse や
error handling は plugin 側で行います。

## error result

crate は `manifest()` または `plan()` から構造化 error を返せます。

```json
{
  "status": "err",
  "error": {
    "code": "handler_not_found",
    "message": "no plugin handler registered for trigger 'event.x'"
  }
}
```

host は manifest error と plan error を実行失敗として扱います。通常の plugin logic では、
処理対象ではない event に対して `Vec::new()` を返してください。

## 現在の制限

- slash command option はまだ plugin に渡していません。
- message trigger は trim 後の完全一致です。
- shared `HttpMethod` enum には `POST` もありますが、host の認可は現在 `GET` のみです。
- state read/write effect は未実装です。
- effect result は汎用の `{ ok, status, body }` です。response body の解釈は plugin が行います。
