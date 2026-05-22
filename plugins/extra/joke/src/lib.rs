use patchouli_plugin_api::{export_plugin, BotEvent, Capability, EffectRequest, TriggerGroup};

const PLUGIN_ID: &str = "extra.joke";
const PLUGIN_VERSION: &str = "0.1.0";

const EVENT_JOKE: &str = "event.joke";
const COMMAND_NAME: &str = "joke";
const COMMAND_DESCRIPTION: &str = "Fetch a Chuck Norris joke.";
const TRIGGER_MESSAGE: &str = "!joke";
const EFFECT_RESULT_TRIGGER: &str = "effect.result";
const JOKE_URL: &str = "https://api.chucknorris.io/jokes/random";
const JOKE_ORIGIN: &str = "api.chucknorris.io";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    triggers: [
        TriggerGroup::slash(EVENT_JOKE, COMMAND_NAME, COMMAND_DESCRIPTION)
            .message(TRIGGER_MESSAGE),
    ],
    subscribes: [EFFECT_RESULT_TRIGGER],
    capabilities: [
        Capability::DiscordInteractionReply,
        Capability::http_get(JOKE_ORIGIN),
        Capability::MessageSend,
    ],
    handlers: [
        {
            event: EVENT_JOKE,
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
            vec![EffectRequest::http_get(
                format!("fetch-joke:interaction:{interaction_id}"),
                JOKE_URL,
            )]
        }
        BotEvent::DiscordMessage {
            channel_id,
            content,
            ..
        } if content.trim() == TRIGGER_MESSAGE => vec![EffectRequest::http_get(
            format!("fetch-joke:channel:{channel_id}"),
            JOKE_URL,
        )],
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
                return vec![EffectRequest::interaction_reply(
                    format!("reply-joke:{interaction_id}"),
                    interaction_id,
                    text,
                )];
            }

            if let Some(channel_id) = effect_id.strip_prefix("fetch-joke:channel:") {
                return vec![EffectRequest::message_send(
                    format!("send-joke:{channel_id}"),
                    channel_id,
                    text,
                )];
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
