use crate::types::BotEvent;
use serde::Serialize;

pub fn decode_event(input: &[u8]) -> serde_json::Result<BotEvent> {
    serde_json::from_slice(input)
}

pub fn encode_json<T>(value: &T) -> String
where
    T: Serialize,
{
    serde_json::to_string(value).unwrap_or_else(|_| r#"{"effects":[]}"#.to_string())
}
