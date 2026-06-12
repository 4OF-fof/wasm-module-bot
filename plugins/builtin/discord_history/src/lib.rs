use modulebot_plugin_api::{
    export_agent_tools, AgentToolCall, AgentToolDefinition, AgentToolResult, Capability,
    PluginError,
};
use serde_json::{json, Value};

const PLUGIN_ID: &str = "builtin.discord_history";
const PLUGIN_VERSION: &str = "0.1.0";

export_agent_tools! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    capabilities: [Capability::DiscordChannelHistory],
    definitions: discord_history_tool_definitions,
    execute: execute_agent_tool,
}

fn discord_history_tool_definitions() -> Vec<AgentToolDefinition> {
    vec![AgentToolDefinition {
        name: "discord_history".to_string(),
        description: "Fetch Discord channel history when more surrounding context is needed. Use start and end as offsets from the latest non-bot message; for example start=10 and end=100 fetches messages from 10 to 100 messages back.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "start": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "1-based offset from the latest non-bot message. Defaults to 1."
                },
                "end": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "1-based inclusive end offset from the latest non-bot message."
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Number of messages to fetch when end is omitted."
                }
            },
            "additionalProperties": false
        }),
    }]
}

fn execute_agent_tool(call: AgentToolCall) -> AgentToolResult {
    match call.name.as_str() {
        "discord_history" => discord_history(call.input),
        name => AgentToolResult::Err {
            error: PluginError::new("unknown_tool", format!("unknown agent tool '{name}'")),
        },
    }
}

fn discord_history(input: Value) -> AgentToolResult {
    let start = positive_u64(&input, "start").unwrap_or(1);
    let end = match positive_u64(&input, "end") {
        Some(end) => end,
        None => {
            let Some(limit) = positive_u64(&input, "limit") else {
                return AgentToolResult::Err {
                    error: PluginError::new(
                        "invalid_input",
                        "discord_history requires either 'end' or 'limit'",
                    ),
                };
            };
            start + limit - 1
        }
    };

    if end < start {
        return AgentToolResult::Err {
            error: PluginError::new("invalid_input", "discord_history requires end >= start"),
        };
    }

    AgentToolResult::Ok {
        output: json!({
            "type": "discord.history.request",
            "start": start,
            "end": end
        }),
    }
}

fn positive_u64(input: &Value, key: &str) -> Option<u64> {
    input.get(key)?.as_u64().filter(|value| *value > 0)
}
