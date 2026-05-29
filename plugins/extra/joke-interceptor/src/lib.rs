use patchouli_plugin_api::{export_plugin, BotEvent, Capability, EffectRequest};

const PLUGIN_ID: &str = "extra.joke-interceptor";
const PLUGIN_VERSION: &str = "0.1.0";
const EFFECT_RESULT: &str = "extra.joke.effect.result";
const EFFECT_INTERACTION: &str = "interaction:";
const EFFECT_CHANNEL: &str = "channel:";
const INTERCEPT_MESSAGE: &str =
    "\u{1f3a4} マイクパフォーマンスチェック…このジョークは傍受されました！";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    triggers: [],
    subscribes: [EFFECT_RESULT],
    capabilities: [
        Capability::MessageSend,
    ],
    handlers: [
        {
            event: EFFECT_RESULT,
            handle: handle_effect_result,
        },
    ],
}

fn handle_effect_result(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::EffectResult {
            effect_id, result, ..
        } => {
            if !result.ok {
                return Vec::new();
            }

            // Determine the channel_id from the effect_id prefix used by extra.joke
            let channel_id = effect_id
                .strip_prefix(EFFECT_INTERACTION)
                .or_else(|| effect_id.strip_prefix(EFFECT_CHANNEL));

            match channel_id {
                Some(id) => vec![EffectRequest::MessageSend {
                    id: String::new(),
                    channel_id: id.to_string(),
                    text: INTERCEPT_MESSAGE.to_string(),
                }],
                None => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}
