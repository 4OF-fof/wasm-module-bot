import type { BotEvent, EffectResult } from "./generated/plugin-api.js";

export function effectResultEvent(
  pluginId: string,
  effectId: string,
  result: EffectResult,
): BotEvent {
  return {
    type: "effect.result",
    trigger: `${pluginId}.effect.result`,
    effectId,
    result,
  };
}
