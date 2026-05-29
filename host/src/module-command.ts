import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { PluginStore } from "./plugin-store.js";
import type { PluginCatalogEntry } from "./plugin-registry.js";

export const moduleCommand = new SlashCommandBuilder()
  .setName("module")
  .setDescription("Manage Patchouli modules.")
  .addStringOption((option) =>
    option.setName("id").setDescription("Module id. Omit to show all modules.").setRequired(false),
  )
  .toJSON();

export type ModuleCommandState = {
  catalog: PluginCatalogEntry[];
  refreshEnabledPlugins(): void;
};

const customIdPrefix = "module:";
const togglePrefix = `${customIdPrefix}toggle:`;
const infoPrefix = `${customIdPrefix}info:`;
const listView = "list";
const infoView = "info";

export async function handleModuleCommand(
  interaction: ChatInputCommandInteraction,
  state: ModuleCommandState,
): Promise<boolean> {
  if (interaction.commandName !== moduleCommand.name) {
    return false;
  }

  const id = interaction.options.getString("id");
  if (!id) {
    await interaction.reply({
      ...moduleListPayload(state.catalog),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await replyModuleInfo(interaction, state, id);
  return true;
}

export async function handleModuleButton(
  interaction: ButtonInteraction,
  state: ModuleCommandState,
): Promise<boolean> {
  if (interaction.customId.startsWith(infoPrefix)) {
    const id = interaction.customId.slice(infoPrefix.length);
    const entry = findModule(state.catalog, id);
    if (!entry) {
      await interaction.reply({
        content: `Module ${id} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.update(moduleInfoPayload(entry));
    return true;
  }

  if (!interaction.customId.startsWith(togglePrefix)) {
    return false;
  }

  const { id, view } = parseToggleId(interaction.customId);
  const entry = findModule(state.catalog, id);
  if (!entry) {
    await interaction.reply({
      content: `Module ${id} was not found.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  setCatalogEnabled(state, entry, !entry.enabled);
  await interaction.update(
    view === listView ? moduleListPayload(state.catalog) : moduleInfoPayload(entry),
  );
  return true;
}

async function replyModuleInfo(
  interaction: ChatInputCommandInteraction,
  state: ModuleCommandState,
  id: string,
): Promise<void> {
  const entry = findModule(state.catalog, id);
  if (!entry) {
    await interaction.reply({
      content: `Module ${id} was not found.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    ...moduleInfoPayload(entry),
    flags: MessageFlags.Ephemeral,
  });
}

function setCatalogEnabled(
  state: ModuleCommandState,
  entry: PluginCatalogEntry,
  enabled: boolean,
): void {
  const store = new PluginStore();
  try {
    store.setPluginEnabled(entry.manifest.id, enabled);
  } finally {
    store.close();
  }

  entry.enabled = enabled;
  state.refreshEnabledPlugins();
}

function moduleInfoPayload(entry: PluginCatalogEntry) {
  const embed = new EmbedBuilder()
    .setTitle(entry.manifest.id)
    .setDescription(entry.manifest.triggers.map((trigger) => trigger.description).join("\n"))
    .addFields(
      { name: "Version", value: entry.manifest.version, inline: true },
      { name: "Status", value: entry.enabled ? "Enabled" : "Disabled", inline: true },
      { name: "Origin", value: entry.origin, inline: true },
      {
        name: "Slash commands",
        value: slashCommandList(entry),
        inline: false,
      },
      {
        name: "Capabilities",
        value: capabilityList(entry),
        inline: false,
      },
    );

  const button = new ButtonBuilder()
    .setCustomId(toggleId(infoView, entry.manifest.id))
    .setLabel(entry.enabled ? "Disable" : "Enable")
    .setStyle(entry.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  };
}

function moduleListPayload(catalog: PluginCatalogEntry[]) {
  const embed = new EmbedBuilder()
    .setTitle("Patchouli Modules")
    .setDescription(`${catalog.length} module${catalog.length === 1 ? "" : "s"} found.`)
    .addFields(
      ...catalog.map((entry) => ({
        name: `${entry.manifest.id} ${entry.enabled ? "(enabled)" : "(disabled)"}`,
        value: moduleSummary(entry),
        inline: false,
      })),
    );

  return {
    embeds: [embed],
    components: moduleListRows(catalog),
  };
}

function moduleListRows(catalog: PluginCatalogEntry[]): ActionRowBuilder<ButtonBuilder>[] {
  return catalog.slice(0, 5).map((entry) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${infoPrefix}${entry.manifest.id}`)
        .setLabel(`${entry.manifest.id} details`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(toggleId(listView, entry.manifest.id))
        .setLabel(entry.enabled ? "Disable" : "Enable")
        .setStyle(entry.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    ),
  );
}

function findModule(catalog: PluginCatalogEntry[], id: string): PluginCatalogEntry | undefined {
  return catalog.find((entry) => entry.manifest.id === id);
}

function slashCommandList(entry: PluginCatalogEntry): string {
  const commands = entry.manifest.discord.slashCommands.map((command) => `/${command.name}`);
  return commands.length > 0 ? commands.join("\n") : "None";
}

function capabilityList(entry: PluginCatalogEntry): string {
  if (entry.manifest.capabilities.length === 0) {
    return "None";
  }

  return entry.manifest.capabilities.map((capability) => capability.type).join("\n");
}

function moduleSummary(entry: PluginCatalogEntry): string {
  const descriptions = entry.manifest.triggers
    .map((trigger) => trigger.description)
    .filter((description) => description.length > 0);

  return descriptions.length > 0 ? descriptions.join("\n") : "No description.";
}

function toggleId(view: typeof listView | typeof infoView, id: string): string {
  return `${togglePrefix}${view}:${id}`;
}

function parseToggleId(customId: string): { id: string; view: typeof listView | typeof infoView } {
  const value = customId.slice(togglePrefix.length);
  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) {
    return { id: value, view: infoView };
  }

  const view = value.slice(0, separatorIndex);
  return {
    id: value.slice(separatorIndex + 1),
    view: view === listView ? listView : infoView,
  };
}
