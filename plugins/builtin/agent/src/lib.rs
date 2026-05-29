use patchouli_plugin_api::{
    export_plugin, BotEvent, Capability, EffectRequest, LlmMessage, TriggerGroup,
};

const PLUGIN_ID: &str = "builtin.agent";
const PLUGIN_VERSION: &str = "0.1.0";
const TRIGGER: &str = "agent.trigger";
const EFFECT_RESULT_TRIGGER: &str = "builtin.agent.effect.result";

const SYSTEM_PROMPT: &str = "You are a helpful AI assistant in a Discord server. \
    Respond concisely and naturally in the same language as the user. \
    Keep responses friendly and to the point.";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    trigger: TriggerGroup::register(TRIGGER)
        .mention(),
    subscribes: [EFFECT_RESULT_TRIGGER],
    capabilities: [Capability::LlmProvider, Capability::MessageSend],
    handlers: [
        {
            event: TRIGGER,
            handle: handle_agent,
        },
        {
            event: EFFECT_RESULT_TRIGGER,
            handle: handle_llm_result,
        },
    ],
}

fn handle_agent(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::DiscordMessage {
            channel_id,
            content,
            ..
        } => {
            let prompt = strip_mentions(&content);
            if prompt.is_empty() {
                return vec![EffectRequest::message_send(
                    "empty-prompt",
                    channel_id,
                    "何か質問はありますか？",
                )];
            }

            let effect_id = format!("chat:{}", channel_id);
            let messages = vec![
                LlmMessage {
                    role: "system".to_string(),
                    content: SYSTEM_PROMPT.to_string(),
                },
                LlmMessage {
                    role: "user".to_string(),
                    content: prompt,
                },
            ];

            vec![EffectRequest::llm_provider(effect_id, messages)]
        }
        _ => Vec::new(),
    }
}

fn handle_llm_result(event: BotEvent) -> Vec<EffectRequest> {
    match event {
        BotEvent::EffectResult {
            effect_id, result, ..
        } => {
            let channel_id = parse_chat_channel_id(&effect_id);
            let Some(channel_id) = channel_id else {
                return Vec::new();
            };

            if !result.ok {
                return vec![EffectRequest::message_send(
                    "llm-error",
                    channel_id,
                    format!("AIへのリクエストに失敗しました: {}", result.body),
                )];
            }

            let text = if result.body.is_empty() {
                "（応答が空でした）".to_string()
            } else {
                result.body
            };

            vec![EffectRequest::message_send(
                "llm-response",
                channel_id,
                text,
            )]
        }
        _ => Vec::new(),
    }
}

/// Strips Discord mention patterns (<@...>) and role mention patterns (<@&...>)
/// from the message content, returning the trimmed remaining text.
fn strip_mentions(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '<' {
            // Check if this looks like a mention or role mention
            match chars.peek() {
                Some(&'@') => {
                    // Skip until we find the closing '>'
                    chars.next(); // consume '@'
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if c == '>' {
                            break;
                        }
                    }
                }
                Some(&'#') => {
                    // Channel mention <#...>, skip it
                    chars.next(); // consume '#'
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if c == '>' {
                            break;
                        }
                    }
                }
                _ => {
                    result.push(ch);
                }
            }
        } else {
            result.push(ch);
        }
    }

    result.trim().to_string()
}

/// Parses the channel_id from an effect_id in the format "chat:{channel_id}".
fn parse_chat_channel_id(effect_id: &str) -> Option<String> {
    effect_id.strip_prefix("chat:").map(|id| id.to_string())
}
