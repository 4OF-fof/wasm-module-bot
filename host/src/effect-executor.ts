import {
  type ChatInputCommandInteraction,
  MessageFlags,
  type TextBasedChannel,
} from "discord.js";
import { authorizeEffect } from "./authorize.js";
import { effectResultEvent } from "./effect-results.js";
import type { BotEvent, EffectRequest, PluginManifest } from "./generated/plugin-api.js";

export type EffectTarget = ChatInputCommandInteraction | TextBasedChannel;

type EffectHandler<T extends EffectRequest> = (
  effect: T,
  target: EffectTarget,
) => Promise<BotEvent>;

const effectHandlers = {
  "discord.interaction.reply": executeInteractionReply,
  "http.fetch": executeHttpFetch,
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
    authorizeEffect(manifest, effect);
    resultEvents.push(await executeEffect(effect, target));
  }

  return resultEvents;
}

async function executeEffect(effect: EffectRequest, target: EffectTarget): Promise<BotEvent> {
  switch (effect.type) {
    case "discord.interaction.reply":
      return effectHandlers[effect.type](effect, target);
    case "http.fetch":
      return effectHandlers[effect.type](effect, target);
    case "message.send":
      return effectHandlers[effect.type](effect, target);
  }
}

async function executeHttpFetch(
  effect: Extract<EffectRequest, { type: "http.fetch" }>,
  _target: EffectTarget,
): Promise<BotEvent> {
  const response = await fetch(effect.url, { method: effect.method });
  return effectResultEvent(effect.id, {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  });
}

async function executeMessageSend(
  effect: Extract<EffectRequest, { type: "message.send" }>,
  target: EffectTarget,
): Promise<BotEvent> {
  if (!("send" in target)) {
    throw new Error("Message send effect requires a text channel target");
  }

  await target.send(effect.text);
  return effectResultEvent(effect.id, {
    ok: true,
    status: 200,
    body: "",
  });
}

async function executeInteractionReply(
  effect: Extract<EffectRequest, { type: "discord.interaction.reply" }>,
  target: EffectTarget,
): Promise<BotEvent> {
  if (!("reply" in target)) {
    throw new Error("Discord interaction reply effect requires an interaction target");
  }

  if (effect.interactionId !== target.id) {
    throw new Error(`Effect targets unexpected interaction ${effect.interactionId}`);
  }

  await target.reply({
    content: effect.content ?? undefined,
    embeds: effect.embeds,
    flags: effect.ephemeral ? MessageFlags.Ephemeral : undefined,
  });

  return effectResultEvent(effect.id, {
    ok: true,
    status: 200,
    body: "",
  });
}
