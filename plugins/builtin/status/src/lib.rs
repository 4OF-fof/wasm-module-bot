use patchouli_plugin_api::{
    export_plugin, BotEvent, Capability, DiscordEmbed, DiscordEmbedField, EffectRequest,
    TriggerGroup, TriggerSource,
};

const PLUGIN_ID: &str = "builtin.status";
const PLUGIN_VERSION: &str = "0.1.0";

const EVENT_STATUS: &str = "event.status";
const COMMAND_NAME: &str = "status";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    triggers: [
        TriggerGroup {
            event: EVENT_STATUS.to_string(),
            name: COMMAND_NAME.to_string(),
            description: "Show Patchouli runtime status.".to_string(),
            sources: vec![
                TriggerSource::DiscordSlashCommand { command_name: COMMAND_NAME.to_string() },
            ],
        },
    ],
    subscribes: [],
    capabilities: [Capability::DiscordInteractionReply],
    handlers: [
        {
            event: EVENT_STATUS,
            handle: handle_status,
        },
    ],
}

fn handle_status(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::DiscordInteractionCommand {
            interaction_id,
            modules,
            ..
        } => {
            let module_list = modules
                .iter()
                .map(|module| format!("`{}` v{}", module.id, module.version))
                .collect::<Vec<_>>()
                .join("\n");

            vec![EffectRequest::DiscordInteractionReply {
                id: "reply-status".to_string(),
                interaction_id,
                content: None,
                embeds: vec![DiscordEmbed {
                    title: "Patchouli Status".to_string(),
                    description: "Patchouli is running.".to_string(),
                    fields: vec![
                        DiscordEmbedField {
                            name: "Loaded modules".to_string(),
                            value: modules.len().to_string(),
                            inline: true,
                        },
                        DiscordEmbedField {
                            name: "Module list".to_string(),
                            value: if module_list.is_empty() {
                                "None".to_string()
                            } else {
                                module_list
                            },
                            inline: false,
                        },
                    ],
                }],
                ephemeral: true,
            }]
        }
        _ => Vec::new(),
    }
}
