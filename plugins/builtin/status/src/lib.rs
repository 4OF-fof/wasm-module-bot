use patchouli_plugin_api::{
    export_plugin, BotEvent, Capability, DiscordEmbed, DiscordEmbedField, EffectRequest,
    TriggerGroup,
};

const PLUGIN_ID: &str = "builtin.status";
const PLUGIN_VERSION: &str = "0.1.0";

const EVENT_STATUS: &str = "event.status";
const COMMAND_NAME: &str = "status";
const COMMAND_DESCRIPTION: &str = "Show Patchouli runtime status.";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    triggers: [
        TriggerGroup::slash(EVENT_STATUS, COMMAND_NAME, COMMAND_DESCRIPTION),
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

            vec![EffectRequest::ephemeral_interaction_reply(
                "reply-status",
                interaction_id,
                None,
                vec![DiscordEmbed {
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
            )]
        }
        _ => Vec::new(),
    }
}
