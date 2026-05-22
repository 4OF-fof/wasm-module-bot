use crate::types::{BotEvent, PluginError};
use serde::Serialize;

pub fn decode_event(input: &[u8]) -> serde_json::Result<BotEvent> {
    serde_json::from_slice(input)
}

pub fn encode_json<T>(value: &T) -> Result<String, PluginError>
where
    T: Serialize,
{
    serde_json::to_string(value).map_err(|error| {
        PluginError::new(
            "serialize_failed",
            format!("failed to serialize plugin API response: {error}"),
        )
    })
}
