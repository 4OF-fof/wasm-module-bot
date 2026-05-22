import {
  Client,
  Events,
  GatewayIntentBits,
  Routes,
} from "discord.js";
import { executeEffects, type EffectTarget } from "./effect-executor.js";
import type {
  BotEvent,
} from "./generated/plugin-api.js";
import {
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
import { findMessageTrigger, findSlashCommandTrigger } from "./triggers.js";

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

if (!token) {
  console.log("Patchouli host started in dry-run mode.");
  console.log("Set DISCORD_TOKEN to log in as a Discord bot.");
  console.log(`Loaded host command /${moduleCommand.name}.`);
  for (const loadedPlugin of plugins) {
    console.log(
      `Loaded WASM plugin ${loadedPlugin.manifest.id} with slash commands: ${loadedPlugin.manifest.discord.slashCommands
        .map((command) => `/${command.name}`)
        .join(", ")}`,
    );
  }
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

    void handleModuleCommand(interaction, moduleCommandState).then((handled) => {
      if (handled) {
        void registerSlashCommandsIfReady();
      }
    });
    if (interaction.commandName === moduleCommand.name) {
      return;
    }

    for (const loadedPlugin of plugins) {
      const trigger = findSlashCommandTrigger(
        loadedPlugin.manifest.triggers,
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

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) {
      return;
    }

    for (const loadedPlugin of plugins) {
      const trigger = findMessageTrigger(loadedPlugin.manifest.triggers, message.content);
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
): Promise<void> {
  const eventQueue: BotEvent[] = [initialEvent];
  let step = 0;

  while (eventQueue.length > 0 && step < maxEffectLoopSteps) {
    const event = eventQueue.shift();
    if (!event) {
      break;
    }
    step += 1;
    const plan = loadedPlugin.plugin.plan(event);
    const nextEvents = await executeEffects(loadedPlugin.manifest, target, plan.effects);
    eventQueue.push(
      ...nextEvents.filter((nextEvent) =>
        loadedPlugin.manifest.subscribes.includes(nextEvent.trigger),
      ),
    );
  }
}

async function shutdown(client: Client, signal: string): Promise<void> {
  console.log(`Received ${signal}. Shutting down Patchouli host.`);
  client.destroy();
}

async function registerSlashCommands(client: Client<true>): Promise<void> {
  if (!guildId) {
    throw new Error("DISCORD_GUILD_ID is required because Patchouli only registers guild commands.");
  }

  const commands = [
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
    throw new Error("DISCORD_GUILD_ID is required because Patchouli only registers guild commands.");
  }
  return value;
}
