use serde::Serialize;

#[derive(Clone, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "type")]
pub enum Capability {
    #[serde(rename = "discord.interaction.reply")]
    DiscordInteractionReply,
    #[serde(rename = "http.get", rename_all = "camelCase")]
    HttpGet { origin_policy: HttpOriginPolicy },
    #[serde(rename = "agent")]
    Agent,
    #[serde(rename = "discord.message.send")]
    DiscordMessageSend,
    #[serde(rename = "discord.channel.history")]
    DiscordChannelHistory,
    // TODO: Add state.read and state.write when the host gains a state store.
}

impl Capability {
    pub fn http_get(origin_policy: impl Into<HttpOriginPolicy>) -> Self {
        Self::HttpGet {
            origin_policy: origin_policy.into(),
        }
    }
}

#[derive(Clone, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[serde(tag = "type")]
pub enum HttpOriginPolicy {
    #[serde(rename = "known", rename_all = "camelCase")]
    Known { origins: Vec<String> },
    #[serde(rename = "dynamic")]
    Dynamic,
}

impl HttpOriginPolicy {
    pub fn known(origins: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self::Known {
            origins: origins.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<String> for HttpOriginPolicy {
    fn from(origin: String) -> Self {
        Self::known([origin])
    }
}

impl From<&str> for HttpOriginPolicy {
    fn from(origin: &str) -> Self {
        Self::known([origin])
    }
}

impl<T, const N: usize> From<[T; N]> for HttpOriginPolicy
where
    T: Into<String>,
{
    fn from(origins: [T; N]) -> Self {
        Self::known(origins)
    }
}

impl From<Vec<String>> for HttpOriginPolicy {
    fn from(origins: Vec<String>) -> Self {
        Self::Known { origins }
    }
}

#[derive(Clone, Copy, serde::Deserialize, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
pub enum HttpMethod {
    GET,
    POST,
}
