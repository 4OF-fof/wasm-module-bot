use patchouli_plugin_api::{
    export_agent_tools, AgentToolCall, AgentToolDefinition, AgentToolResult, PluginError,
};
use serde_json::{json, Value};

const PLUGIN_ID: &str = "builtin.agent-tools";
const PLUGIN_VERSION: &str = "0.1.0";

export_agent_tools! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    definitions: math_tool_definitions,
    execute: execute_agent_tool,
}

fn math_tool_definitions() -> Vec<AgentToolDefinition> {
    vec![AgentToolDefinition {
        name: "add_numbers".to_string(),
        description: "Add two numbers and return the sum.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "a": {
                    "type": "number",
                    "description": "The first number."
                },
                "b": {
                    "type": "number",
                    "description": "The second number."
                }
            },
            "required": ["a", "b"],
            "additionalProperties": false
        }),
    }]
}

fn execute_agent_tool(call: AgentToolCall) -> AgentToolResult {
    match call.name.as_str() {
        "add_numbers" => add_numbers(call.input),
        name => AgentToolResult::Err {
            error: PluginError::new("unknown_tool", format!("unknown agent tool '{name}'")),
        },
    }
}

fn add_numbers(input: Value) -> AgentToolResult {
    let Some(a) = input.get("a").and_then(Value::as_f64) else {
        return AgentToolResult::Err {
            error: PluginError::new("invalid_input", "add_numbers requires numeric field 'a'"),
        };
    };

    let Some(b) = input.get("b").and_then(Value::as_f64) else {
        return AgentToolResult::Err {
            error: PluginError::new("invalid_input", "add_numbers requires numeric field 'b'"),
        };
    };

    AgentToolResult::Ok {
        output: json!({ "sum": a + b }),
    }
}
