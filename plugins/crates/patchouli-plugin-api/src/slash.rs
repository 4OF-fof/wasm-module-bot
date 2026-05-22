use crate::capability::Capability;
use crate::codec::decode_event;
use crate::types::{
    ActionPlan, BotEvent, DiscordManifest, EffectRequest, ManifestResult, PlanResult, PluginError,
    PluginManifest, SlashCommand, TriggerGroup, TriggerSource,
};

pub type PluginEventHandler = fn(BotEvent) -> Vec<EffectRequest>;

pub struct PluginHandlerDefinition {
    pub event: &'static str,
    pub handle: PluginEventHandler,
}

pub fn manifest_for(
    id: &'static str,
    version: &'static str,
    triggers: &[TriggerGroup],
    subscribes: &'static [&'static str],
    capabilities: &[Capability],
) -> PluginManifest {
    PluginManifest {
        id: id.to_string(),
        version: version.to_string(),
        triggers: triggers.to_vec(),
        subscribes: merged_subscribes(triggers, subscribes),
        capabilities: capabilities.to_vec(),
        discord: DiscordManifest {
            slash_commands: collect_slash_commands(triggers),
        },
    }
}

pub fn manifest_result_for(
    id: &'static str,
    version: &'static str,
    triggers: &[TriggerGroup],
    subscribes: &'static [&'static str],
    capabilities: &[Capability],
) -> ManifestResult {
    ManifestResult::Ok {
        manifest: manifest_for(id, version, triggers, subscribes, capabilities),
    }
}

fn collect_slash_commands(triggers: &[TriggerGroup]) -> Vec<SlashCommand> {
    let mut commands = Vec::new();
    for group in triggers {
        for source in &group.sources {
            if let TriggerSource::DiscordSlashCommand { command_name } = source {
                push_unique_command(&mut commands, command_name, &group.description);
            }
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

fn merged_subscribes(
    triggers: &[TriggerGroup],
    subscribes: &'static [&'static str],
) -> Vec<String> {
    let mut merged = Vec::new();

    for event in triggers.iter().map(|g| g.event.as_str()) {
        push_unique(&mut merged, event);
    }

    for subscribe in subscribes {
        push_unique(&mut merged, subscribe);
    }

    merged
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
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

fn event_trigger(event: &BotEvent) -> Option<&str> {
    match event {
        BotEvent::DiscordInteractionCommand { trigger, .. } => Some(trigger),
        BotEvent::DiscordMessage { trigger, .. } => Some(trigger),
        BotEvent::EffectResult { trigger, .. } => Some(trigger),
    }
}
