import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { getAgentStore } from "./agent/store.js";

export const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Manage Patchouli agent settings.")
  .addStringOption((option) =>
    option
      .setName("key")
      .setDescription("Setting key. Omit to show all settings.")
      .setAutocomplete(true)
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option.setName("value").setDescription("New value for the setting.").setRequired(false),
  )
  .toJSON();

const SETTINGS = [
  {
    key: "max_messages",
    label: "Max Messages",
    description: "Maximum messages per session (ring buffer cap).",
  },
  {
    key: "session_ttl_minutes",
    label: "Session TTL (min)",
    description: "Minutes of inactivity before a session is evicted.",
  },
] as const;

type SettingKey = (typeof SETTINGS)[number]["key"];

export async function handleConfigCommand(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.commandName !== configCommand.name) {
    return false;
  }

  const key = interaction.options.getString("key");
  const value = interaction.options.getInteger("value");
  const store = getAgentStore();

  // No key — show all settings.
  if (!key) {
    await interaction.reply({
      embeds: [settingsListEmbed(store)],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Validate key.
  const setting = findSetting(key);
  if (!setting) {
    await interaction.reply({
      content: `Unknown setting: \`${key}\`. Available keys: ${SETTINGS.map((s) => `\`${s.key}\``).join(", ")}`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Key without value — show current value.
  if (value === null) {
    const current = readSetting(store, setting.key);
    await interaction.reply({
      content: `**${setting.label}**: \`${current}\``,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Key with value — update.
  if (value < 1) {
    await interaction.reply({
      content: "Value must be a positive integer.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  writeSetting(store, setting.key, value);
  await interaction.reply({
    content: `**${setting.label}** updated: \`${value}\``,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

export async function handleConfigAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<boolean> {
  if (interaction.commandName !== configCommand.name) {
    return false;
  }

  const focused = interaction.options.getFocused();
  const choices = SETTINGS.filter(
    (s) =>
      s.key.toLowerCase().includes(focused.toLowerCase()) ||
      s.label.toLowerCase().includes(focused.toLowerCase()),
  )
    .slice(0, 25)
    .map((s) => ({ name: s.label, value: s.key }));

  await interaction.respond(choices);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSetting(key: string): (typeof SETTINGS)[number] | undefined {
  return SETTINGS.find((s) => s.key === key);
}

function readSetting(store: ReturnType<typeof getAgentStore>, key: SettingKey): number {
  switch (key) {
    case "max_messages":
      return store.maxMessages;
    case "session_ttl_minutes":
      return store.sessionTtlMinutes;
  }
}

function writeSetting(
  store: ReturnType<typeof getAgentStore>,
  key: SettingKey,
  value: number,
): void {
  switch (key) {
    case "max_messages":
      store.setMaxMessages(value);
      break;
    case "session_ttl_minutes":
      store.setSessionTtlMinutes(value);
      break;
  }
}

function settingsListEmbed(store: ReturnType<typeof getAgentStore>): EmbedBuilder {
  return new EmbedBuilder().setTitle("Patchouli Agent Settings").addFields(
    ...SETTINGS.map((s) => ({
      name: s.label,
      value: `${s.description}\nCurrent: \`${readSetting(store, s.key)}\``,
      inline: false,
    })),
  );
}
