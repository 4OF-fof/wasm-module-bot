import { type ChatInputCommandInteraction, MessageFlags, type TextBasedChannel } from "discord.js";
import { authorizeEffect } from "./authorize.js";
import { executeAgent } from "./agent/execute.js";
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
  agent: (effect, target, pluginId) => executeAgent(effect, pluginId, extractChannelId(target)),
  "discord.message.send": executeDiscordMessageSend,
  "discord.channel.history": executeChannelHistory,
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
    try {
      authorizeEffect(manifest, effect);
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : String(authError);
      console.error(`[${manifest.id}] Authorization error: ${message}`);
      await sendErrorToDiscord(target, `Plugin ${manifest.id} error: ${message}`);
      break;
    }

    try {
      resultEvents.push(await executeEffect(effect, target, manifest.id));
    } catch (execError) {
      const message = execError instanceof Error ? execError.message : String(execError);
      console.error(`[${manifest.id}] Effect execution error: ${message}`);
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
    case "agent":
      return effectHandlers[effect.type](effect, target, pluginId);
    case "discord.message.send":
      return effectHandlers[effect.type](effect, target, pluginId);
    case "discord.channel.history":
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

async function executeDiscordMessageSend(
  effect: Extract<EffectRequest, { type: "discord.message.send" }>,
  target: EffectTarget,
  pluginId: string,
): Promise<BotEvent> {
  const channel = await fetchEffectChannel(target, effect.channelId);
  if (!channel || !("send" in channel)) {
    throw new Error(`Message send effect requires a sendable channel: ${effect.channelId}`);
  }

  await channel.send(effect.text);
  return effectResultEvent(pluginId, effect.id, {
    ok: true,
    status: 200,
    body: "",
  });
}

async function executeChannelHistory(
  effect: Extract<EffectRequest, { type: "discord.channel.history" }>,
  target: EffectTarget,
  pluginId: string,
): Promise<BotEvent> {
  const channel = await fetchEffectChannel(target, effect.channelId);
  if (!channel || !("messages" in channel)) {
    throw new Error(`Channel history effect requires a message channel: ${effect.channelId}`);
  }

  try {
    const fetchOptions: { limit: number; before?: string } = { limit: effect.limit };
    if (effect.before) {
      fetchOptions.before = effect.before;
    }
    const messages = await channel.messages.fetch(fetchOptions);

    const history = messages
      .filter((m) => !m.author.bot)
      .map((m) => ({ author: m.author.displayName, content: m.content }))
      .reverse();

    return effectResultEvent(pluginId, effect.id, {
      ok: true,
      status: 200,
      body: JSON.stringify({ messages: history }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return effectResultEvent(pluginId, effect.id, {
      ok: false,
      status: 0,
      body: message,
    });
  }
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

function extractChannelId(target: EffectTarget): string | undefined {
  if ("channelId" in target) {
    return (target as ChatInputCommandInteraction).channelId ?? undefined;
  }
  return (target as TextBasedChannel).id;
}

async function fetchEffectChannel(target: EffectTarget, channelId: string) {
  const channel = await target.client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }
  return channel;
}
