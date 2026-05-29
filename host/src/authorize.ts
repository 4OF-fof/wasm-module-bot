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
          capability.type === "http.get" &&
          effect.method === "GET" &&
          originPolicyAllows(capability.originPolicy, url.hostname)
        );
      });

      if (!allowed) {
        throw new Error(
          `Plugin ${manifest.id} is not allowed to fetch ${effect.method} ${url.hostname}`,
        );
      }
      return;
    }

    case "agent": {
      const allowed = manifest.capabilities.some((capability) => capability.type === "agent");

      if (!allowed) {
        throw new Error(`Plugin ${manifest.id} is not allowed to use agent capability`);
      }
      return;
    }

    case "discord.message.send": {
      const allowed = manifest.capabilities.some(
        (capability) => capability.type === "discord.message.send",
      );

      if (!allowed) {
        throw new Error(`Plugin ${manifest.id} is not allowed to send messages`);
      }
      return;
    }

    case "discord.channel.history": {
      const allowed = manifest.capabilities.some(
        (capability) => capability.type === "discord.channel.history",
      );

      if (!allowed) {
        throw new Error(`Plugin ${manifest.id} is not allowed to read channel history`);
      }
      return;
    }

    // TODO: Authorize state.write when that effect is added to the shared API.
  }

  const exhaustive: never = effect;
  throw new Error(`Unsupported effect type ${(exhaustive as { type: string }).type}`);
}

function originPolicyAllows(
  policy: Extract<PluginManifest["capabilities"][number], { type: "http.get" }>["originPolicy"],
  hostname: string,
): boolean {
  switch (policy.type) {
    case "known":
      return policy.origins.includes(hostname);
    case "dynamic":
      return true;
  }
}
