use crate::capability::{Capability, HttpMethod};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub version: String,
    pub trigger: TriggerGroup,
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
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TriggerGroup {
    #[serde(rename = "triggerGroup")]
    Group {
        event: String,
        name: String,
        description: String,
        sources: Vec<TriggerSource>,
    },
    #[serde(rename = "none")]
    None,
}

impl TriggerGroup {
    pub fn register(event: impl Into<String>) -> Self {
        TriggerGroup::Group {
            event: event.into(),
            name: String::new(),
            description: String::new(),
            sources: Vec::new(),
        }
    }

    pub fn slash(mut self, cmd_name: impl Into<String>, desc: impl Into<String>) -> Self {
        if let TriggerGroup::Group {
            ref mut name,
            ref mut description,
            ref mut sources,
            ..
        } = self
        {
            let cmd_name = cmd_name.into();
            *name = cmd_name.clone();
            *description = desc.into();
            sources.push(TriggerSource::DiscordSlashCommand {
                command_name: cmd_name,
            });
        }
        self
    }

    pub fn message(mut self, content: impl Into<String>) -> Self {
        if let TriggerGroup::Group {
            ref mut sources, ..
        } = self
        {
            sources.push(TriggerSource::DiscordMessage {
                content: content.into(),
            });
        }
        self
    }

    pub fn mention(mut self) -> Self {
        if let TriggerGroup::Group {
            ref mut sources, ..
        } = self
        {
            sources.push(TriggerSource::DiscordMention);
        }
        self
    }

    pub fn event(&self) -> Option<&str> {
        match self {
            TriggerGroup::Group { event, .. } => Some(event),
            TriggerGroup::None => None,
        }
    }

    pub fn description(&self) -> Option<&str> {
        match self {
            TriggerGroup::Group { description, .. } => Some(description),
            TriggerGroup::None => None,
        }
    }

    pub fn sources(&self) -> &[TriggerSource] {
        match self {
            TriggerGroup::Group { sources, .. } => sources,
            TriggerGroup::None => &[],
        }
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
    #[serde(rename = "discordMention")]
    DiscordMention,
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
    #[serde(rename = "agent", rename_all = "camelCase")]
    Agent {
        id: String,
        session_id: String,
        messages: Vec<LlmMessage>,
    },
    #[serde(rename = "discord.message.send", rename_all = "camelCase")]
    DiscordMessageSend {
        id: String,
        channel_id: String,
        text: String,
    },
    #[serde(rename = "discord.channel.history", rename_all = "camelCase")]
    DiscordChannelHistory {
        id: String,
        channel_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        before: Option<String>,
        limit: u32,
    },
    // TODO: Add state.write when the host can authorize and persist state.
}

impl EffectRequest {
    pub fn id(&self) -> &str {
        match self {
            Self::DiscordInteractionReply { id, .. } => id,
            Self::HttpFetch { id, .. } => id,
            Self::Agent { id, .. } => id,
            Self::DiscordMessageSend { id, .. } => id,
            Self::DiscordChannelHistory { id, .. } => id,
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

    pub fn agent(
        id: impl Into<String>,
        session_id: impl Into<String>,
        messages: Vec<LlmMessage>,
    ) -> Self {
        Self::Agent {
            id: id.into(),
            session_id: session_id.into(),
            messages,
        }
    }

    pub fn discord_message_send(
        id: impl Into<String>,
        channel_id: impl Into<String>,
        text: impl Into<String>,
    ) -> Self {
        Self::DiscordMessageSend {
            id: id.into(),
            channel_id: channel_id.into(),
            text: text.into(),
        }
    }

    pub fn channel_history(
        id: impl Into<String>,
        channel_id: impl Into<String>,
        before: Option<String>,
        limit: u32,
    ) -> Self {
        Self::DiscordChannelHistory {
            id: id.into(),
            channel_id: channel_id.into(),
            before,
            limit,
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
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EffectResult {
    pub ok: bool,
    pub status: u16,
    pub body: String,
}
