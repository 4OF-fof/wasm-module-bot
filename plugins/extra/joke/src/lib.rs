use patchouli_plugin_api::{
    export_plugin, BotEvent, Capability, EffectRequest, HttpMethod, TriggerGroup, TriggerSource,
};

const PLUGIN_ID: &str = "extra.joke";
const PLUGIN_VERSION: &str = "0.1.0";
const TRIGGER: &str = "joke.trigger";
const NAME: &str = "joke";
const DISCRIPTION: &str = "Fetch a Chuck Norris joke.";
const TRIGGER_MESSAGE: &str = "!joke";
const EFFECT_RESULT: &str = "extra.joke.effect.result";
const TARGET_ORIGIN: &str = "api.chucknorris.io";
const TARGET_URL: &str = "https://api.chucknorris.io/jokes/random";
const EFFECT_INTERACTION: &str = "interaction:";
const EFFECT_CHANNEL: &str = "channel:";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    triggers: [
        TriggerGroup {
            event: TRIGGER.to_string(),
            name: NAME.to_string(),
            description: DISCRIPTION.to_string(),
            sources: vec![
                TriggerSource::DiscordSlashCommand { command_name: NAME.to_string() },
                TriggerSource::DiscordMessage { content: TRIGGER_MESSAGE.to_string() },
            ],
        },
    ],
    subscribes: [EFFECT_RESULT],
    capabilities: [
        Capability::DiscordInteractionReply,
        Capability::HttpFetch {
            domains: vec![TARGET_ORIGIN.to_string()],
            methods: vec![HttpMethod::GET],
        },
        Capability::MessageSend,
    ],
    handlers: [
        {
            event: TRIGGER,
            handle: handle_joke_message,
        },
        {
            event: EFFECT_RESULT,
            handle: handle_effect_result,
        },
    ],
}

fn handle_joke_message(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::DiscordInteractionCommand { interaction_id, .. } => {
            vec![EffectRequest::HttpFetch {
                id: format!("{EFFECT_INTERACTION}{interaction_id}"),
                method: HttpMethod::GET,
                url: TARGET_URL.to_string(),
            }]
        }
        BotEvent::DiscordMessage {
            channel_id,
            content,
            ..
        } if content.trim() == "!joke" => vec![EffectRequest::HttpFetch {
            id: format!("{EFFECT_CHANNEL}{channel_id}"),
            method: HttpMethod::GET,
            url: TARGET_URL.to_string(),
        }],
        _ => Vec::new(),
    }
}

fn handle_effect_result(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::EffectResult {
            effect_id, result, ..
        } => {
            let text = joke_text(&result.body)
                .unwrap_or_else(|| "I could not fetch a joke right now.".to_string());

            if let Some(interaction_id) = effect_id.strip_prefix(EFFECT_INTERACTION) {
                return vec![EffectRequest::DiscordInteractionReply {
                    id: String::new(),
                    interaction_id: interaction_id.to_string(),
                    content: Some(text),
                    embeds: Vec::new(),
                    ephemeral: false,
                }];
            }

            if let Some(channel_id) = effect_id.strip_prefix(EFFECT_CHANNEL) {
                return vec![EffectRequest::MessageSend {
                    id: String::new(),
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
