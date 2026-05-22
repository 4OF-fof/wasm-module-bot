import type { EffectRequest, PluginManifest } from "./generated/plugin-api.js";

export function authorizeEffect(manifest: PluginManifest, effect: EffectRequest): void {
  switch (effect.type) {
    case "discord.interaction.reply": {
      const allowed = manifest.capabilities.some(
        (capability) => capability.type === "discord.interaction.reply",
      );

      if (!allowed) {
        throw new Error(`Plugin ${manifest.id} is not allowed to reply to Discord interactions`);
      }
      return;
    }

    case "http.fetch": {
      const url = new URL(effect.url);
      const allowed = manifest.capabilities.some((capability) => {
        return (
          capability.type === "http.fetch" &&
          capability.domains.includes(url.hostname) &&
          capability.methods.includes(effect.method)
        );
      });

      if (!allowed) {
        throw new Error(`Plugin ${manifest.id} is not allowed to fetch ${effect.method} ${url.hostname}`);
      }
      return;
    }

    case "message.send": {
      const allowed = manifest.capabilities.some((capability) => capability.type === "message.send");

      if (!allowed) {
        throw new Error(`Plugin ${manifest.id} is not allowed to send messages`);
      }
      return;
    }

    // TODO: Authorize state.write when that effect is added to the shared API.
  }

  const exhaustive: never = effect;
  throw new Error(`Unsupported effect type ${(exhaustive as { type: string }).type}`);
}
