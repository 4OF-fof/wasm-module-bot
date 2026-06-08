use patchouli_plugin_api::{
    export_agent_tools, AgentToolCall, AgentToolDefinition, AgentToolResult, PluginError,
};
use serde_json::json;

const PLUGIN_ID: &str = "builtin.session_control";
const PLUGIN_VERSION: &str = "0.1.0";

export_agent_tools! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    definitions: session_control_tool_definitions,
    execute: execute_agent_tool,
}

fn session_control_tool_definitions() -> Vec<AgentToolDefinition> {
    vec![
        AgentToolDefinition {
            name: "close_session".to_string(),
            description: "Close and archive the current conversation session when continuing the session would no longer be natural or useful.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        AgentToolDefinition {
            name: "no_reply".to_string(),
            description: "Use when the latest Discord message does not need an assistant reply, such as side chatter, acknowledgements not directed at the assistant, or messages where staying silent would be more natural.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
    ]
}

fn execute_agent_tool(call: AgentToolCall) -> AgentToolResult {
    match call.name.as_str() {
        "close_session" => close_session(),
        "no_reply" => no_reply(),
        name => AgentToolResult::Err {
            error: PluginError::new("unknown_tool", format!("unknown agent tool '{name}'")),
        },
    }
}

fn close_session() -> AgentToolResult {
    AgentToolResult::Ok {
        output: json!({
            "type": "session.close",
            "status": "closing",
            "message": "The session will be archived after the final assistant response."
        }),
    }
}

fn no_reply() -> AgentToolResult {
    AgentToolResult::Ok {
        output: json!({
            "type": "session.no_reply",
            "status": "silent",
            "message": "No assistant reply should be sent for this message."
        }),
    }
}
