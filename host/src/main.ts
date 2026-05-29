import { Client, Events, GatewayIntentBits, Routes } from "discord.js";
import { getAgentStore, initAgentStore } from "./agent/store.js";
import { createSessionSummarizer } from "./agent/summarizer.js";
import { executeEffects, sendErrorToDiscord, type EffectTarget } from "./effect-executor.js";
import type { BotEvent } from "./generated/plugin-api.js";
import { configCommand, handleConfigAutocomplete, handleConfigCommand } from "./config-command.js";
import {
  handleModuleAutocomplete,
  handleModuleButton,
  handleModuleCommand,
  moduleCommand,
} from "./module-command.js";
import {
  enabledPlugins,
  loadPluginCatalog,
  type LoadedPlugin,
  pluginModules,
} from "./plugin-registry.js";
import { findMessageTrigger, findMentionTrigger, findSlashCommandTrigger } from "./triggers.js";

const maxEffectLoopSteps = 5;
const token = process.env.DISCORD_TOKEN;
const guildId = configuredGuildId();
const pluginCatalog = await loadPluginCatalog();
let plugins = enabledPlugins(pluginCatalog);
let discordClient: Client<true> | undefined;
const moduleCommandState = {
  catalog: pluginCatalog,
  refreshEnabledPlugins,
};

// Initialize the agent session store (SQLite-backed, 1h TTL, ring-buffer capped).
const agentStore = initAgentStore(undefined, createSessionSummarizer());

if (!token) {
  console.log("Patchouli host started in dry-run mode.");
  console.log("Set DISCORD_TOKEN to log in as a Discord bot.");
  console.log(`Loaded host commands: /${configCommand.name}, /${moduleCommand.name}.`);
  for (const loadedPlugin of plugins) {
    console.log(
      `Loaded WASM plugin ${loadedPlugin.manifest.id} with slash commands: ${loadedPlugin.manifest.discord.slashCommands
        .map((command) => `/${command.name}`)
        .join(", ")}`,
    );
  }
  agentStore.close();
  process.exitCode = 0;
} else {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    discordClient = readyClient;
    console.log(`Patchouli host logged in as ${readyClient.user.tag}.`);
    void registerSlashCommands(readyClient);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isAutocomplete()) {
      void handleConfigAutocomplete(interaction);
      void handleModuleAutocomplete(interaction, moduleCommandState);
      return;
    }

    if (interaction.isButton()) {
      void handleModuleButton(interaction, moduleCommandState).then((handled) => {
        if (handled) {
          void registerSlashCommandsIfReady();
        }
      });
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    // Host commands (not plugin-handled).
    void handleConfigCommand(interaction);
    void handleModuleCommand(interaction, moduleCommandState).then((handled) => {
      if (handled) {
        void registerSlashCommandsIfReady();
      }
    });
    if (
      interaction.commandName === configCommand.name ||
      interaction.commandName === moduleCommand.name
    ) {
      return;
    }

    for (const loadedPlugin of plugins) {
      const trigger = findSlashCommandTrigger(
        loadedPlugin.manifest.trigger,
        interaction.commandName,
      );
      if (!trigger) {
        continue;
      }

      void runPluginLoop(loadedPlugin, interaction, {
        type: "discord.interaction.command",
        trigger: trigger.event,
        interactionId: interaction.id,
        modules: pluginModules(plugins),
      });
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) {
      return;
    }

    if (!client.user) return;

    // Check for an active agent session in this channel.
    // If one exists, forward the message to the owning plugin (no mention needed).
    const activeSession = await getAgentStore().getActiveSessionByChannel(message.channelId);
    if (activeSession) {
      const plugin = plugins.find((p) => p.manifest.id === activeSession.pluginId);
      if (plugin) {
        const triggerEvent =
          plugin.manifest.trigger.type === "triggerGroup"
            ? plugin.manifest.trigger.event
            : "discord.message";
        // If the user explicitly asks to end, let the plugin say goodbye,
        // then immediately archive and delete the session.
        if (isEndCommand(message.content)) {
          await runPluginLoop(plugin, message.channel, {
            type: "discord.message",
            trigger: triggerEvent,
            channelId: message.channelId,
            content: message.content,
          });
          await getAgentStore().endSession(activeSession.sessionId);
          return;
        }

        void runPluginLoop(plugin, message.channel, {
          type: "discord.message",
          trigger: triggerEvent,
          channelId: message.channelId,
          content: message.content,
        });
        return;
      }
    }

    const isMentioned = message.mentions.has(client.user.id);

    for (const loadedPlugin of plugins) {
      // Check for mention trigger
      if (isMentioned) {
        const mentionTrigger = findMentionTrigger(loadedPlugin.manifest.trigger);
        if (mentionTrigger) {
          void runPluginLoop(loadedPlugin, message.channel, {
            type: "discord.message",
            trigger: mentionTrigger.event,
            channelId: message.channelId,
            content: message.content,
          });
          continue;
        }
      }

      // Check for content match trigger
      const trigger = findMessageTrigger(loadedPlugin.manifest.trigger, message.content);
      if (!trigger) {
        continue;
      }

      void runPluginLoop(loadedPlugin, message.channel, {
        type: "discord.message",
        trigger: trigger.event,
        channelId: message.channelId,
        content: message.content,
      });
    }
  });

  client.on(Events.Error, (error) => {
    console.error("Discord client error:", error);
  });

  process.once("SIGINT", () => {
    void shutdown(client, "SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown(client, "SIGTERM");
  });

  await client.login(token);
}

async function runPluginLoop(
  loadedPlugin: LoadedPlugin,
  target: EffectTarget,
  initialEvent: BotEvent,
  dispatchDepth: number = 0,
): Promise<void> {
  const eventQueue: BotEvent[] = [initialEvent];
  let step = 0;

  while (eventQueue.length > 0 && step < maxEffectLoopSteps) {
    const event = eventQueue.shift();
    if (!event) {
      break;
    }
    step += 1;

    let nextEvents: BotEvent[] = [];
    try {
      const plan = loadedPlugin.plugin.plan(event);
      nextEvents = await executeEffects(loadedPlugin.manifest, target, plan.effects);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${loadedPlugin.manifest.id}] Plugin loop error: ${message}`);
      await sendErrorToDiscord(
        target,
        `Plugin \`${loadedPlugin.manifest.id}\` で予期しないエラーが発生しました: ${message}`,
      );
      continue;
    }

    eventQueue.push(
      ...nextEvents.filter((nextEvent) =>
        loadedPlugin.manifest.subscribes.includes(nextEvent.trigger),
      ),
    );

    // Dispatch effect.result events to other subscribing plugins (depth 0 only to prevent cascading)
    if (dispatchDepth === 0) {
      const effectResultEvents = nextEvents.filter((e) => e.type === "effect.result");
      for (const effectEvent of effectResultEvents) {
        await dispatchToOtherPlugins(effectEvent, loadedPlugin, target);
      }
    }
  }
}

async function dispatchToOtherPlugins(
  event: BotEvent,
  sourcePlugin: LoadedPlugin,
  target: EffectTarget,
): Promise<void> {
  for (const plugin of plugins) {
    if (plugin.manifest.id === sourcePlugin.manifest.id) continue;
    if (plugin.manifest.subscribes.includes(event.trigger)) {
      try {
        await runPluginLoop(plugin, target, event, 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${plugin.manifest.id}] Dispatch error: ${message}`);
      }
    }
  }
}

async function shutdown(client: Client, signal: string): Promise<void> {
  console.log(`Received ${signal}. Shutting down Patchouli host.`);
  agentStore.close();
  client.destroy();
}

async function registerSlashCommands(client: Client<true>): Promise<void> {
  if (!guildId) {
    throw new Error(
      "DISCORD_GUILD_ID is required because Patchouli only registers guild commands.",
    );
  }

  const commands = [
    configCommand,
    moduleCommand,
    ...plugins.flatMap((loadedPlugin) => loadedPlugin.manifest.discord.slashCommands),
  ];

  await client.rest.put(Routes.applicationGuildCommands(client.application.id, guildId), {
    body: commands,
  });
  console.log(`Registered slash commands for guild ${guildId}.`);
}

function refreshEnabledPlugins(): void {
  plugins = enabledPlugins(pluginCatalog);
}

async function registerSlashCommandsIfReady(): Promise<void> {
  if (discordClient) {
    await registerSlashCommands(discordClient);
  }
}

function configuredGuildId(): string | undefined {
  if (!token) {
    return undefined;
  }

  const value = process.env.DISCORD_GUILD_ID;
  if (!value) {
    throw new Error(
      "DISCORD_GUILD_ID is required because Patchouli only registers guild commands.",
    );
  }
  return value;
}

function isEndCommand(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  return (
    trimmed === "終了" ||
    trimmed === "終わり" ||
    trimmed === "さようなら" ||
    trimmed === "bye" ||
    trimmed === "end" ||
    trimmed === "exit" ||
    trimmed === "quit"
  );
}
