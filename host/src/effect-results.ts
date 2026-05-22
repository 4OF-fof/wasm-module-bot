import type { BotEvent, EffectResult } from "./generated/plugin-api.js";

export function effectResultEvent(effectId: string, result: EffectResult): BotEvent {
  return {
    type: "effect.result",
    trigger: "effect.result",
    effectId,
    result,
  };
}
