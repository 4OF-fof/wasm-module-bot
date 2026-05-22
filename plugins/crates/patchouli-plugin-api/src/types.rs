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

#[derive(Clone, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct TriggerGroup {
    pub event: String,
    pub name: String,
    pub description: String,
    pub sources: Vec<TriggerSource>,
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

#[derive(Clone, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "type")]
pub enum Capability {
    #[serde(rename = "discord.interaction.reply")]
    DiscordInteractionReply,
    #[serde(rename = "http.fetch", rename_all = "camelCase")]
    HttpFetch {
        domains: Vec<String>,
        methods: Vec<HttpMethod>,
    },
    #[serde(rename = "message.send")]
    MessageSend,
    // TODO: Add state.read and state.write when the host gains a state store.
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
pub enum HttpMethod {
    GET,
    POST,
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
