use crate::codec::decode_event;
use crate::types::{
    ActionPlan, BotEvent, Capability, DiscordManifest, EffectRequest, PluginManifest, SlashCommand,
    TriggerGroup, TriggerSource,
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

pub fn plan_for(input: &[u8], handlers: &'static [PluginHandlerDefinition]) -> ActionPlan {
    let effects = match decode_event(input) {
        Ok(event) => {
            let handler = event_trigger(&event)
                .and_then(|trigger| handlers.iter().find(|handler| handler.event == trigger));

            handler
                .map(|handler| (handler.handle)(event))
                .unwrap_or_default()
        }
        _ => Vec::new(),
    };

    ActionPlan { effects }
}

fn event_trigger(event: &BotEvent) -> Option<&str> {
    match event {
        BotEvent::DiscordInteractionCommand { trigger, .. } => Some(trigger),
        BotEvent::DiscordMessage { trigger, .. } => Some(trigger),
        BotEvent::EffectResult { trigger, .. } => Some(trigger),
    }
}
