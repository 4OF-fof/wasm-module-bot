import { jsonSchema, tool, type ToolSet } from "ai";
import { authorizeEffect } from "../authorize.js";
import type { LoadedPlugin } from "../plugin-registry.js";
import type { AgentToolDefinition, PluginManifest } from "../generated/plugin-api.js";

export type DiscordHistoryRange = {
  start: number;
  end: number;
};

type AgentToolModule = {
  manifestId: string;
  plugin: LoadedPlugin["plugin"];
  manifest: PluginManifest;
  definitions: AgentToolDefinition[];
};

type AgentToolEvents = {
  onCloseSession?(): void;
  onNoReply?(): void;
  fetchDiscordHistory?(range: DiscordHistoryRange): Promise<unknown>;
};

let agentToolModules: AgentToolModule[] = [];

export function setAgentToolModules(plugins: LoadedPlugin[]): void {
  agentToolModules = plugins.flatMap((loadedPlugin) => {
    if (!loadedPlugin.plugin.hasAgentTools()) {
      return [];
    }

    return [
      {
        manifestId: loadedPlugin.manifest.id,
        plugin: loadedPlugin.plugin,
        manifest: loadedPlugin.manifest,
        definitions: loadedPlugin.plugin.getAgentToolDefinitions(),
      },
    ];
  });
}

export function createAgentTools(
  moduleIds?: string[],
  events: AgentToolEvents = {},
): ToolSet | undefined {
  const selectedModules =
    moduleIds === undefined
      ? agentToolModules
      : moduleIds.map((moduleId) => {
          const module = agentToolModules.find((candidate) => candidate.manifestId === moduleId);
          if (!module) {
            throw new Error(`Agent tool module ${moduleId} is not enabled or does not export tools`);
          }
          return module;
        });

  if (selectedModules.length === 0) {
    return undefined;
  }

  const tools: ToolSet = {};

  for (const module of selectedModules) {
    for (const definition of module.definitions) {
      if (tools[definition.name]) {
        throw new Error(`Duplicate agent tool name ${definition.name}`);
      }

      tools[definition.name] = tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.inputSchema),
        execute: async (input) => {
          const result = module.plugin.executeAgentTool({
            name: definition.name,
            input,
          });

          if (result.status === "err") {
            throw new Error(`${result.error.code}: ${result.error.message}`);
          }

          if (definition.name === "close_session" && isCloseSessionOutput(result.output)) {
            events.onCloseSession?.();
          }

          if (definition.name === "no_reply" && isNoReplyOutput(result.output)) {
            events.onNoReply?.();
          }

          if (definition.name === "discord_history" && isDiscordHistoryRequest(result.output)) {
            if (!events.fetchDiscordHistory) {
              throw new Error("discord_history is not available for this agent target");
            }
            authorizeEffect(module.manifest, {
              type: "discord.channel.history",
              id: `agent-tool:${definition.name}`,
              channelId: "__agent_current_channel__",
              before: null,
              limit: result.output.end,
            });
            return events.fetchDiscordHistory({
              start: result.output.start,
              end: result.output.end,
            });
          }

          return result.output;
        },
      });
    }
  }

  return tools;
}

function isDiscordHistoryRequest(
  output: unknown,
): output is { type: "discord.history.request"; start: number; end: number } {
  if (typeof output !== "object" || output === null) {
    return false;
  }
  const request = output as Record<string, unknown>;
  return (
    request.type === "discord.history.request" &&
    Number.isSafeInteger(request.start) &&
    typeof request.start === "number" &&
    request.start > 0 &&
    Number.isSafeInteger(request.end) &&
    typeof request.end === "number" &&
    request.end >= request.start
  );
}

function isNoReplyOutput(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    "type" in output &&
    output.type === "session.no_reply" &&
    "status" in output &&
    output.status === "silent"
  );
}

function isCloseSessionOutput(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    "type" in output &&
    output.type === "session.close" &&
    "status" in output &&
    output.status === "closing"
  );
}
