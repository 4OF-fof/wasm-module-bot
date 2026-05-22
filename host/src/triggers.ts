import type { TriggerGroup } from "./generated/plugin-api.js";

export type MatchedTrigger = {
  event: string;
};

export function findSlashCommandTrigger(
  triggers: TriggerGroup[],
  commandName: string,
): MatchedTrigger | undefined {
  return findTrigger(triggers, (group) =>
    group.sources.some(
      (source) => source.type === "discordSlashCommand" && source.commandName === commandName,
    ),
  );
}

export function findMessageTrigger(
  triggers: TriggerGroup[],
  content: string,
): MatchedTrigger | undefined {
  const normalizedContent = content.trim();
  return findTrigger(triggers, (group) =>
    group.sources.some(
      (source) => source.type === "discordMessage" && source.content === normalizedContent,
    ),
  );
}

function findTrigger(
  triggers: TriggerGroup[],
  matchesGroup: (group: TriggerGroup) => boolean,
): MatchedTrigger | undefined {
  const group = triggers.find(matchesGroup);
  return group ? { event: group.event } : undefined;
}
