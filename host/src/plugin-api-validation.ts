import type {
  ActionPlan,
  AgentToolDefinition,
  AgentToolDefinitionsResult,
  AgentToolResult,
  Capability,
  DiscordEmbed,
  DiscordEmbedField,
  DiscordManifest,
  EffectRequest,
  HttpMethod,
  HttpOriginPolicy,
  LlmMessage,
  ManifestResult,
  PlanResult,
  PluginError,
  PluginManifest,
  SlashCommand,
  TriggerGroup,
  TriggerSource,
} from "./generated/plugin-api.js";

export function parseManifestResult(value: unknown): PluginManifest {
  if (!isManifestResult(value)) {
    throw new Error("WASM plugin returned an invalid manifest result");
  }

  if (value.status === "err") {
    throw new Error(`WASM plugin manifest failed: ${value.error.code}: ${value.error.message}`);
  }

  return value.manifest;
}

export function parsePlanResult(value: unknown): ActionPlan {
  if (!isPlanResult(value)) {
    throw new Error("WASM plugin returned an invalid plan result");
  }

  if (value.status === "err") {
    throw new Error(`WASM plugin plan failed: ${value.error.code}: ${value.error.message}`);
  }

  return parseActionPlan(value.plan);
}

export function parseAgentToolDefinitionsResult(value: unknown): AgentToolDefinition[] {
  if (!isAgentToolDefinitionsResult(value)) {
    throw new Error("WASM plugin returned an invalid agent tool definitions result");
  }

  if (value.status === "err") {
    throw new Error(`WASM agent tool definitions failed: ${value.error.code}: ${value.error.message}`);
  }

  return value.tools;
}

export function parseAgentToolResult(value: unknown): AgentToolResult {
  if (!isAgentToolResult(value)) {
    throw new Error("WASM plugin returned an invalid agent tool result");
  }

  return value;
}

export function parsePluginManifest(value: unknown): PluginManifest {
  if (!isPluginManifest(value)) {
    throw new Error("WASM plugin returned an invalid manifest");
  }
  return value;
}

export function parseActionPlan(value: unknown): ActionPlan {
  const actionPlan = normalizeActionPlan(value);
  if (!actionPlan) {
    throw new Error("WASM plugin returned an invalid action plan");
  }
  return actionPlan;
}

function isPluginManifest(value: unknown): value is PluginManifest {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.version) &&
    isTriggerGroup(value.trigger) &&
    isArrayOf(value.subscribes, isString) &&
    isArrayOf(value.capabilities, isCapability) &&
    isDiscordManifest(value.discord)
  );
}

function isManifestResult(value: unknown): value is ManifestResult {
  if (!isRecord(value) || !isString(value.status)) {
    return false;
  }

  switch (value.status) {
    case "ok":
      return isPluginManifest(value.manifest);
    case "err":
      return isPluginError(value.error);
    default:
      return false;
  }
}

function isPlanResult(value: unknown): value is PlanResult {
  if (!isRecord(value) || !isString(value.status)) {
    return false;
  }

  switch (value.status) {
    case "ok":
      return normalizeActionPlan(value.plan) !== undefined;
    case "err":
      return isPluginError(value.error);
    default:
      return false;
  }
}

function isAgentToolDefinitionsResult(value: unknown): value is AgentToolDefinitionsResult {
  if (!isRecord(value) || !isString(value.status)) {
    return false;
  }

  switch (value.status) {
    case "ok":
      return isArrayOf(value.tools, isAgentToolDefinition);
    case "err":
      return isPluginError(value.error);
    default:
      return false;
  }
}

function isAgentToolResult(value: unknown): value is AgentToolResult {
  if (!isRecord(value) || !isString(value.status)) {
    return false;
  }

  switch (value.status) {
    case "ok":
      return "output" in value;
    case "err":
      return isPluginError(value.error);
    default:
      return false;
  }
}

function isPluginError(value: unknown): value is PluginError {
  return isRecord(value) && isString(value.code) && isString(value.message);
}

function isTriggerGroup(value: unknown): value is TriggerGroup {
  if (!isRecord(value) || !isString(value.type)) return false;
  if (value.type === "none") return true;
  return (
    value.type === "triggerGroup" &&
    isString(value.event) &&
    isString(value.name) &&
    isString(value.description) &&
    isArrayOf(value.sources, isTriggerSource)
  );
}

function isTriggerSource(value: unknown): value is TriggerSource {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "discordSlashCommand":
      return isString(value.commandName);
    case "discordMessage":
      return isString(value.content);
    case "discordMention":
      return true;
    default:
      return false;
  }
}

function isCapability(value: unknown): value is Capability {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "discord.interaction.reply":
    case "agent":
    case "discord.message.send":
    case "discord.channel.history":
      return true;
    case "http.get":
      return isHttpOriginPolicy(value.originPolicy);
    default:
      return false;
  }
}

function isHttpOriginPolicy(value: unknown): value is HttpOriginPolicy {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "known":
      return isArrayOf(value.origins, isString);
    case "dynamic":
      return true;
    default:
      return false;
  }
}

function isDiscordManifest(value: unknown): value is DiscordManifest {
  return isRecord(value) && isArrayOf(value.slashCommands, isSlashCommand);
}

function isSlashCommand(value: unknown): value is SlashCommand {
  return isRecord(value) && isString(value.name) && isString(value.description);
}

function normalizeActionPlan(value: unknown): ActionPlan | undefined {
  if (!isRecord(value) || !Array.isArray(value.effects)) {
    return undefined;
  }

  const effects = value.effects.map(normalizeEffectRequest);
  if (effects.some((effect) => effect === undefined)) {
    return undefined;
  }

  return {
    effects: effects as EffectRequest[],
  };
}

function normalizeEffectRequest(value: unknown): EffectRequest | undefined {
  if (!isRecord(value) || !isString(value.type) || !isString(value.id)) {
    return undefined;
  }

  switch (value.type) {
    case "discord.interaction.reply":
      if (
        !isString(value.interactionId) ||
        !isOptionalString(value.content) ||
        !isArrayOf(value.embeds, isDiscordEmbed) ||
        typeof value.ephemeral !== "boolean"
      ) {
        return undefined;
      }

      return {
        type: value.type,
        id: value.id,
        interactionId: value.interactionId,
        content: value.content ?? null,
        embeds: value.embeds,
        ephemeral: value.ephemeral,
      };
    case "http.fetch":
      if (!isHttpMethod(value.method) || !isString(value.url)) {
        return undefined;
      }
      return {
        type: value.type,
        id: value.id,
        method: value.method,
        url: value.url,
      };
    case "discord.message.send":
      if (!isString(value.channelId) || !isString(value.text)) {
        return undefined;
      }
      return {
        type: value.type,
        id: value.id,
        channelId: value.channelId,
        text: value.text,
      };
    case "discord.channel.history":
      if (!isString(value.channelId) || typeof value.limit !== "number") {
        return undefined;
      }
      return {
        type: value.type,
        id: value.id,
        channelId: value.channelId,
        before: isOptionalString(value.before) ? (value.before ?? null) : null,
        limit: value.limit,
      };
    case "agent":
      if (!isString(value.sessionId) || !isArrayOf(value.messages, isLlmMessage)) {
        return undefined;
      }
      return {
        type: value.type,
        id: value.id,
        sessionId: value.sessionId,
        messages: value.messages,
        toolModuleIds: isArrayOf(value.toolModuleIds, isString) ? value.toolModuleIds : undefined,
      };
    default:
      return undefined;
  }
}

function isAgentToolDefinition(value: unknown): value is AgentToolDefinition {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.description) &&
    isJsonObject(value.inputSchema)
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isDiscordEmbed(value: unknown): value is DiscordEmbed {
  return (
    isRecord(value) &&
    isString(value.title) &&
    isString(value.description) &&
    isArrayOf(value.fields, isDiscordEmbedField)
  );
}

function isDiscordEmbedField(value: unknown): value is DiscordEmbedField {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.value) &&
    typeof value.inline === "boolean"
  );
}

function isHttpMethod(value: unknown): value is HttpMethod {
  return value === "GET" || value === "POST";
}

function isLlmMessage(value: unknown): value is LlmMessage {
  return isRecord(value) && isString(value.role) && isString(value.content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isString(value);
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}
