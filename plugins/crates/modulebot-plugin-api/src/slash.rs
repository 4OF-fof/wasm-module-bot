use crate::capability::Capability;
use crate::codec::{decode_event, decode_tool_call};
use crate::types::{
    ActionPlan, AgentToolCall, AgentToolDefinition, AgentToolDefinitionsResult, AgentToolResult,
    BotEvent, DiscordManifest, EffectRequest, ManifestResult, PlanResult, PluginError,
    PluginManifest, SlashCommand, TriggerGroup, TriggerSource,
};

pub type PluginEventHandler = fn(BotEvent) -> Vec<EffectRequest>;
pub type AgentToolDefinitionProvider = fn() -> Vec<AgentToolDefinition>;
pub type AgentToolHandler = fn(AgentToolCall) -> AgentToolResult;

pub struct PluginHandlerDefinition {
    pub event: &'static str,
    pub handle: PluginEventHandler,
}

pub fn manifest_for(
    id: &'static str,
    version: &'static str,
    trigger: &TriggerGroup,
    subscribes: &'static [&'static str],
    capabilities: &[Capability],
) -> PluginManifest {
    PluginManifest {
        id: id.to_string(),
        version: version.to_string(),
        trigger: trigger.clone(),
        subscribes: merged_subscribes(trigger, subscribes),
        capabilities: capabilities.to_vec(),
        discord: DiscordManifest {
            slash_commands: collect_slash_commands(trigger),
        },
    }
}

pub fn manifest_result_for(
    id: &'static str,
    version: &'static str,
    trigger: &TriggerGroup,
    subscribes: &'static [&'static str],
    capabilities: &[Capability],
) -> ManifestResult {
    ManifestResult::Ok {
        manifest: manifest_for(id, version, trigger, subscribes, capabilities),
    }
}

fn collect_slash_commands(trigger: &TriggerGroup) -> Vec<SlashCommand> {
    let mut commands = Vec::new();
    let description = trigger.description().unwrap_or("");
    for source in trigger.sources() {
        if let TriggerSource::DiscordSlashCommand { command_name } = source {
            push_unique_command(&mut commands, command_name, description);
        }
    }
    commands
}

fn push_unique_command(commands: &mut Vec<SlashCommand>, name: &str, description: &str) {
    if !commands.iter().any(|existing| existing.name == name) {
        commands.push(SlashCommand {
            name: name.to_string(),
            description: description.to_string(),
        });
    }
}

fn merged_subscribes(trigger: &TriggerGroup, subscribes: &'static [&'static str]) -> Vec<String> {
    let mut merged: Vec<String> = trigger.event().into_iter().map(String::from).collect();

    for subscribe in subscribes {
        if !merged.iter().any(|existing| existing == *subscribe) {
            merged.push(subscribe.to_string());
        }
    }

    merged
}

pub fn plan_for(input: &[u8], handlers: &'static [PluginHandlerDefinition]) -> PlanResult {
    let event = match decode_event(input) {
        Ok(event) => event,
        Err(error) => {
            return PlanResult::Err {
                error: PluginError::new(
                    "invalid_event",
                    format!("failed to decode bot event: {error}"),
                ),
            }
        }
    };

    let Some(trigger) = event_trigger(&event) else {
        return PlanResult::Err {
            error: PluginError::new("missing_trigger", "bot event did not include a trigger"),
        };
    };

    let Some(handler) = handlers.iter().find(|handler| handler.event == trigger) else {
        return PlanResult::Err {
            error: PluginError::new(
                "handler_not_found",
                format!("no plugin handler registered for trigger '{trigger}'"),
            ),
        };
    };

    PlanResult::Ok {
        plan: ActionPlan {
            effects: (handler.handle)(event),
        },
    }
}

pub fn agent_tool_definitions_result_for(
    definitions: AgentToolDefinitionProvider,
) -> AgentToolDefinitionsResult {
    AgentToolDefinitionsResult::Ok {
        tools: definitions(),
    }
}

pub fn agent_tool_result_for(input: &[u8], execute: AgentToolHandler) -> AgentToolResult {
    let call = match decode_tool_call(input) {
        Ok(call) => call,
        Err(error) => {
            return AgentToolResult::Err {
                error: PluginError::new(
                    "invalid_tool_call",
                    format!("failed to decode agent tool call: {error}"),
                ),
            }
        }
    };

    execute(call)
}

fn event_trigger(event: &BotEvent) -> Option<&str> {
    match event {
        BotEvent::DiscordInteractionCommand { trigger, .. } => Some(trigger),
        BotEvent::DiscordMessage { trigger, .. } => Some(trigger),
        BotEvent::EffectResult { trigger, .. } => Some(trigger),
    }
}
