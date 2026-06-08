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
    vec![AgentToolDefinition {
        name: "close_session".to_string(),
        description: "Close and archive the current conversation session when the user clearly wants to end this ongoing chat.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
    }]
}

fn execute_agent_tool(call: AgentToolCall) -> AgentToolResult {
    match call.name.as_str() {
        "close_session" => close_session(),
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
