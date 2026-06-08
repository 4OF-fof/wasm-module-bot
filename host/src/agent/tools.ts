import { jsonSchema, tool, type ToolSet } from "ai";
import type { LoadedPlugin } from "../plugin-registry.js";
import type { AgentToolDefinition } from "../generated/plugin-api.js";

type AgentToolModule = {
  manifestId: string;
  plugin: LoadedPlugin["plugin"];
  definitions: AgentToolDefinition[];
};

type AgentToolEvents = {
  onCloseSession?(): void;
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

          return result.output;
        },
      });
    }
  }

  return tools;
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
