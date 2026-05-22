use crate::capability::{Capability, HttpMethod};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub version: String,
    pub triggers: Vec<TriggerGroup>,
    pub subscribes: Vec<String>,
    pub capabilities: Vec<Capability>,
    pub discord: DiscordManifest,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ManifestResult {
    Ok { manifest: PluginManifest },
    Err { error: PluginError },
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PlanResult {
    Ok { plan: ActionPlan },
    Err { error: PluginError },
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PluginError {
    pub code: String,
    pub message: String,
}

impl PluginError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct TriggerGroup {
    pub event: String,
    pub name: String,
    pub description: String,
    pub sources: Vec<TriggerSource>,
}

impl TriggerGroup {
    pub fn slash(
        event: impl Into<String>,
        name: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        let name = name.into();
        Self {
            event: event.into(),
            name: name.clone(),
            description: description.into(),
            sources: vec![TriggerSource::DiscordSlashCommand { command_name: name }],
        }
    }

    pub fn message(mut self, content: impl Into<String>) -> Self {
        self.sources.push(TriggerSource::DiscordMessage {
            content: content.into(),
        });
        self
    }
}

#[derive(Clone, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "type")]
pub enum TriggerSource {
    #[serde(rename = "discordSlashCommand", rename_all = "camelCase")]
    DiscordSlashCommand { command_name: String },
    #[serde(rename = "discordMessage", rename_all = "camelCase")]
    DiscordMessage { content: String },
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DiscordManifest {
    pub slash_commands: Vec<SlashCommand>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PluginModuleInfo {
    pub id: String,
    pub version: String,
}

#[derive(Deserialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "type")]
pub enum BotEvent {
    #[serde(rename = "discord.interaction.command", rename_all = "camelCase")]
    DiscordInteractionCommand {
        trigger: String,
        interaction_id: String,
        modules: Vec<PluginModuleInfo>,
    },
    #[serde(rename = "discord.message", rename_all = "camelCase")]
    DiscordMessage {
        trigger: String,
        channel_id: String,
        content: String,
    },
    #[serde(rename = "effect.result", rename_all = "camelCase")]
    EffectResult {
        trigger: String,
        effect_id: String,
        result: EffectResult,
    },
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ActionPlan {
    pub effects: Vec<EffectRequest>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "type")]
pub enum EffectRequest {
    #[serde(rename = "discord.interaction.reply", rename_all = "camelCase")]
    DiscordInteractionReply {
        id: String,
        interaction_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        embeds: Vec<DiscordEmbed>,
        ephemeral: bool,
    },
    #[serde(rename = "http.fetch", rename_all = "camelCase")]
    HttpFetch {
        id: String,
        method: HttpMethod,
        url: String,
    },
    #[serde(rename = "message.send", rename_all = "camelCase")]
    MessageSend {
        id: String,
        channel_id: String,
        text: String,
    },
    // TODO: Add state.write when the host can authorize and persist state.
}

impl EffectRequest {
    pub fn id(&self) -> &str {
        match self {
            Self::DiscordInteractionReply { id, .. } => id,
            Self::HttpFetch { id, .. } => id,
            Self::MessageSend { id, .. } => id,
        }
    }

    pub fn interaction_reply(
        id: impl Into<String>,
        interaction_id: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self::DiscordInteractionReply {
            id: id.into(),
            interaction_id: interaction_id.into(),
            content: Some(content.into()),
            embeds: Vec::new(),
            ephemeral: false,
        }
    }

    pub fn ephemeral_interaction_reply(
        id: impl Into<String>,
        interaction_id: impl Into<String>,
        content: Option<String>,
        embeds: Vec<DiscordEmbed>,
    ) -> Self {
        Self::DiscordInteractionReply {
            id: id.into(),
            interaction_id: interaction_id.into(),
            content,
            embeds,
            ephemeral: true,
        }
    }

    pub fn http_get(id: impl Into<String>, url: impl Into<String>) -> Self {
        Self::HttpFetch {
            id: id.into(),
            method: HttpMethod::GET,
            url: url.into(),
        }
    }

    pub fn message_send(
        id: impl Into<String>,
        channel_id: impl Into<String>,
        text: impl Into<String>,
    ) -> Self {
        Self::MessageSend {
            id: id.into(),
            channel_id: channel_id.into(),
            text: text.into(),
        }
    }
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DiscordEmbed {
    pub title: String,
    pub description: String,
    pub fields: Vec<DiscordEmbedField>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct DiscordEmbedField {
    pub name: String,
    pub value: String,
    pub inline: bool,
}

#[derive(Deserialize, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EffectResult {
    pub ok: bool,
    pub status: u16,
    pub body: String,
}
