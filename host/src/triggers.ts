import type { TriggerGroup } from "./generated/plugin-api.js";

export type MatchedTrigger = {
  event: string;
};

export function findSlashCommandTrigger(
  trigger: TriggerGroup,
  commandName: string,
): MatchedTrigger | undefined {
  if (trigger.type === "none") return undefined;
  const matched = trigger.sources.some(
    (source) => source.type === "discordSlashCommand" && source.commandName === commandName,
  );
  return matched ? { event: trigger.event } : undefined;
}

export function findMessageTrigger(
  trigger: TriggerGroup,
  content: string,
): MatchedTrigger | undefined {
  if (trigger.type === "none") return undefined;
  const normalizedContent = content.trim();
  const matched = trigger.sources.some(
    (source) => source.type === "discordMessage" && source.content === normalizedContent,
  );
  return matched ? { event: trigger.event } : undefined;
}
