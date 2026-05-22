use patchouli_plugin_api::{
    export_plugin, BotEvent, Capability, EffectRequest, HttpMethod, TriggerGroup, TriggerSource,
};

const PLUGIN_ID: &str = "extra.joke";
const PLUGIN_VERSION: &str = "0.1.0";
const JOKE_TRIGGER: &str = "joke";
const JOKE_COMMAND_NAME: &str = "joke";
const EFFECT_RESULT_TRIGGER: &str = "effect.result";
const JOKE_URL: &str = "https://api.chucknorris.io/jokes/random";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    triggers: [
        TriggerGroup {
            event: JOKE_TRIGGER.to_string(),
            name: JOKE_COMMAND_NAME.to_string(),
            description: "Fetch a Chuck Norris joke.".to_string(),
            sources: vec![
                TriggerSource::DiscordSlashCommand { command_name: JOKE_COMMAND_NAME.to_string() },
                TriggerSource::DiscordMessage { content: "!joke".to_string() },
            ],
        },
    ],
    subscribes: [EFFECT_RESULT_TRIGGER],
    capabilities: [
        Capability::DiscordInteractionReply,
        Capability::HttpFetch {
            domains: vec!["api.chucknorris.io".to_string()],
            methods: vec![HttpMethod::GET],
        },
        Capability::MessageSend,
    ],
    handlers: [
        {
            event: JOKE_TRIGGER,
            handle: handle_joke_message,
        },
        {
            event: EFFECT_RESULT_TRIGGER,
            handle: handle_effect_result,
        },
    ],
}

fn handle_joke_message(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::DiscordInteractionCommand { interaction_id, .. } => {
            vec![EffectRequest::HttpFetch {
                id: format!("fetch-joke:interaction:{interaction_id}"),
                method: HttpMethod::GET,
                url: JOKE_URL.to_string(),
            }]
        }
        BotEvent::DiscordMessage {
            channel_id,
            content,
            ..
        } if content.trim() == "!joke" => vec![EffectRequest::HttpFetch {
            id: format!("fetch-joke:channel:{channel_id}"),
            method: HttpMethod::GET,
            url: JOKE_URL.to_string(),
        }],
        _ => Vec::new(),
    }
}

fn handle_effect_result(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::EffectResult {
            effect_id, result, ..
        } if effect_id.starts_with("fetch-joke:") => {
            let text = joke_text(&result.body)
                .unwrap_or_else(|| "I could not fetch a joke right now.".to_string());

            if let Some(interaction_id) = effect_id.strip_prefix("fetch-joke:interaction:") {
                return vec![EffectRequest::DiscordInteractionReply {
                    id: format!("reply-joke:{interaction_id}"),
                    interaction_id: interaction_id.to_string(),
                    content: Some(text),
                    embeds: Vec::new(),
                    ephemeral: false,
                }];
            }

            if let Some(channel_id) = effect_id.strip_prefix("fetch-joke:channel:") {
                return vec![EffectRequest::MessageSend {
                    id: format!("send-joke:{channel_id}"),
                    channel_id: channel_id.to_string(),
                    text,
                }];
            }

            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn joke_text(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("value")?
        .as_str()
        .map(ToString::to_string)
}
