import { type ChatInputCommandInteraction, MessageFlags, type TextBasedChannel } from "discord.js";
import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { authorizeEffect } from "./authorize.js";
import { effectResultEvent } from "./effect-results.js";
import type { BotEvent, EffectRequest, PluginManifest } from "./generated/plugin-api.js";

export type EffectTarget = ChatInputCommandInteraction | TextBasedChannel;

type EffectHandler<T extends EffectRequest> = (
  effect: T,
  target: EffectTarget,
  pluginId: string,
) => Promise<BotEvent>;

const effectHandlers = {
  "discord.interaction.reply": executeInteractionReply,
  "http.fetch": executeHttpFetch,
  "llm.provider": executeLlmProvider,
  "message.send": executeMessageSend,
} satisfies {
  [Type in EffectRequest["type"]]: EffectHandler<Extract<EffectRequest, { type: Type }>>;
};

export async function executeEffects(
  manifest: PluginManifest,
  target: EffectTarget,
  effects: EffectRequest[],
): Promise<BotEvent[]> {
  const resultEvents: BotEvent[] = [];

  for (const effect of effects) {
    // Separate authorization from execution so we can distinguish
    // capability errors (host's responsibility to report) from
    // runtime errors (plugin's responsibility to handle).

    try {
      authorizeEffect(manifest, effect);
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : String(authError);
      console.error(`[${manifest.id}] Authorization error: ${message}`);
      await sendErrorToDiscord(target, `Plugin ${manifest.id} error: ${message}`);
      // Don't push an error effect.result: capability errors are
      // configuration problems the plugin cannot recover from.
      break;
    }

    try {
      resultEvents.push(await executeEffect(effect, target, manifest.id));
    } catch (execError) {
      const message = execError instanceof Error ? execError.message : String(execError);
      console.error(`[${manifest.id}] Effect execution error: ${message}`);
      // Return an error effect.result so the plugin can handle the
      // runtime failure gracefully (e.g. send a user-friendly reply).
      resultEvents.push(
        effectResultEvent(manifest.id, effect.id, {
          ok: false,
          status: 0,
          body: message,
        }),
      );
      break;
    }
  }

  return resultEvents;
}

export async function sendErrorToDiscord(target: EffectTarget, message: string): Promise<void> {
  try {
    if ("reply" in target) {
      if (target.replied || target.deferred) {
        await target.followUp({ content: message, flags: MessageFlags.Ephemeral });
      } else {
        await target.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    } else if ("send" in target) {
      await target.send(message);
    }
  } catch (sendError) {
    console.error("Failed to send error message to Discord:", sendError);
  }
}

async function executeEffect(
  effect: EffectRequest,
  target: EffectTarget,
  pluginId: string,
): Promise<BotEvent> {
  switch (effect.type) {
    case "discord.interaction.reply":
      return effectHandlers[effect.type](effect, target, pluginId);
    case "http.fetch":
      return effectHandlers[effect.type](effect, target, pluginId);
    case "llm.provider":
      return effectHandlers[effect.type](effect, target, pluginId);
    case "message.send":
      return effectHandlers[effect.type](effect, target, pluginId);
  }
}

async function executeHttpFetch(
  effect: Extract<EffectRequest, { type: "http.fetch" }>,
  _target: EffectTarget,
  pluginId: string,
): Promise<BotEvent> {
  const response = await fetch(effect.url, { method: effect.method });
  return effectResultEvent(pluginId, effect.id, {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  });
}

async function executeLlmProvider(
  effect: Extract<EffectRequest, { type: "llm.provider" }>,
  _target: EffectTarget,
  pluginId: string,
): Promise<BotEvent> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return effectResultEvent(pluginId, effect.id, {
      ok: false,
      status: 0,
      body: "LLM_API_KEY is not configured",
    });
  }

  const providerName = process.env.LLM_PROVIDER ?? "opencode";
  const providerType = process.env.LLM_PROVIDER_TYPE ?? "openai-compatible";
  const model = process.env.LLM_MODEL ?? "qwen3.6-plus";

  // Resolve provider endpoints
  let baseURL: string;
  switch (providerName) {
    case "opencode":
      baseURL = "https://opencode.ai/zen/go/v1";
      break;
    default:
      return effectResultEvent(pluginId, effect.id, {
        ok: false,
        status: 0,
        body: `LLM provider "${providerName}" は未対応です。現在は "opencode" のみ利用可能です。`,
      });
  }

  try {
    let languageModel: LanguageModel;
    if (providerType === "anthropic") {
      const anthropic = createAnthropic({
        baseURL,
        apiKey,
      });
      languageModel = anthropic(model);
    } else {
      const openaiCompatible = createOpenAICompatible({
        name: providerName,
        baseURL,
        apiKey,
      });
      languageModel = openaiCompatible.chatModel(model);
    }

    const allMessages = effect.messages;
    const systemMessage = allMessages.find((m) => m.role === "system");
    const chatMessages = allMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const result = await generateText({
      model: languageModel,
      ...(systemMessage && { system: systemMessage.content }),
      messages: chatMessages,
    });

    return effectResultEvent(pluginId, effect.id, {
      ok: true,
      status: 200,
      body: result.text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[${pluginId}] LLM provider error (provider=${providerName}, type=${providerType}, model=${model}): ${message}`,
    );
    return effectResultEvent(pluginId, effect.id, {
      ok: false,
      status: 0,
      body: message,
    });
  }
}

async function executeMessageSend(
  effect: Extract<EffectRequest, { type: "message.send" }>,
  target: EffectTarget,
  pluginId: string,
): Promise<BotEvent> {
  const channel = "send" in target ? target : "channel" in target ? target.channel : null;
  if (!channel || !("send" in channel)) {
    throw new Error("Message send effect requires a text channel target");
  }

  await channel.send(effect.text);
  return effectResultEvent(pluginId, effect.id, {
    ok: true,
    status: 200,
    body: "",
  });
}

async function executeInteractionReply(
  effect: Extract<EffectRequest, { type: "discord.interaction.reply" }>,
  target: EffectTarget,
  pluginId: string,
): Promise<BotEvent> {
  if (!("reply" in target)) {
    throw new Error("Discord interaction reply effect requires an interaction target");
  }

  if (effect.interactionId !== target.id) {
    throw new Error(`Effect targets unexpected interaction ${effect.interactionId}`);
  }

  if (target.replied || target.deferred) {
    await target.followUp({
      content: effect.content ?? undefined,
      embeds: effect.embeds,
      flags: effect.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  } else {
    await target.reply({
      content: effect.content ?? undefined,
      embeds: effect.embeds,
      flags: effect.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  return effectResultEvent(pluginId, effect.id, {
    ok: true,
    status: 200,
    body: "",
  });
}
