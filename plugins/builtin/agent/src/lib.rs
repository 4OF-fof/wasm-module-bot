use patchouli_plugin_api::{
    export_plugin, BotEvent, Capability, EffectRequest, LlmMessage, TriggerGroup,
};

const PLUGIN_ID: &str = "builtin.agent";
const PLUGIN_VERSION: &str = "0.1.0";
const TRIGGER: &str = "agent.trigger";
const EFFECT_RESULT_TRIGGER: &str = "builtin.agent.effect.result";

export_plugin! {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    trigger: TriggerGroup::register(TRIGGER)
        .mention(),
    subscribes: [EFFECT_RESULT_TRIGGER],
    capabilities: [Capability::Agent, Capability::DiscordMessageSend, Capability::DiscordChannelHistory],
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
                return vec![EffectRequest::discord_message_send(
                    "empty-prompt",
                    channel_id,
                    "何か質問はありますか？",
                )];
            }

            // Explicit session end: user asked to stop the conversation.
            if is_end_command(&prompt) {
                return vec![EffectRequest::discord_message_send(
                    "end-session",
                    channel_id,
                    "会話を終了しました。また必要なときはメンションで呼びかけてください。",
                )];
            }

            // Generate a deterministic session ID from the channel ID.
            // Format: p-{6-digit hex} (e.g. p-a3f2b1)
            let session_id = channel_session_id(&channel_id);
            let effect_id = format!("chat:{}", channel_id);

            // The host injects the system prompt. The plugin only sends user messages.
            let messages = vec![LlmMessage {
                role: "user".to_string(),
                content: prompt,
            }];

            vec![EffectRequest::agent(effect_id, session_id, messages)]
            // Note: channel_id is now available as `channel_id` from the event.
            // The host will persist it to the session automatically on first agent effect.
        }
        _ => Vec::new(),
    }
}

/// Returns true if the user's message is an explicit request to end the conversation.
fn is_end_command(prompt: &str) -> bool {
    let trimmed = prompt.trim().to_lowercase();
    trimmed == "終了"
        || trimmed == "終わり"
        || trimmed == "さようなら"
        || trimmed == "bye"
        || trimmed == "end"
        || trimmed == "exit"
        || trimmed == "quit"
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
                return vec![EffectRequest::discord_message_send(
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

            vec![EffectRequest::discord_message_send(
                "agent-response",
                channel_id,
                text,
            )]
        }
        _ => Vec::new(),
    }
}

/// Generates a deterministic session ID from a string key.
/// Format: p-{6-digit hex} (e.g. p-a3f2b1)
fn channel_session_id(key: &str) -> String {
    let mut hash: u32 = 5381;
    for byte in key.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u32);
    }
    let hex = format!("{:06x}", hash & 0xFFFFFF);
    format!("p-{}", hex)
}

/// Strips Discord mention patterns (<@...>) and role mention patterns (<@&...>)
/// from the message content, returning the trimmed remaining text.
fn strip_mentions(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '<' {
            match chars.peek() {
                Some(&'@') => {
                    chars.next();
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if c == '>' {
                            break;
                        }
                    }
                }
                Some(&'#') => {
                    chars.next();
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
