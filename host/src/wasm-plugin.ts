import { readFile } from "node:fs/promises";
import type {
  AgentToolCall,
  AgentToolDefinition,
  AgentToolResult,
  BotEvent,
  PluginManifest,
} from "./generated/plugin-api.js";
import type { ActionPlan } from "./generated/plugin-api.js";
import {
  parseAgentToolDefinitionsResult,
  parseAgentToolResult,
  parseManifestResult,
  parsePlanResult,
} from "./plugin-api-validation.js";

type WasmExports = {
  memory: WebAssembly.Memory;
  alloc(size: number): number;
  dealloc(ptr: number, len: number): void;
  manifest(): bigint;
  plan(ptr: number, len: number): bigint;
  tool_definitions?: () => bigint;
  execute_tool?: (ptr: number, len: number) => bigint;
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class WasmPlugin {
  private readonly exports: WasmExports;

  private constructor(exports: WasmExports) {
    this.exports = exports;
  }

  static async load(path: string): Promise<WasmPlugin> {
    const bytes = await readFile(path);
    const instance = await WebAssembly.instantiate(bytes, {});
    return new WasmPlugin(instance.instance.exports as WasmExports);
  }

  getManifest(): PluginManifest {
    return parseManifestResult(this.readReturnedJson(this.exports.manifest()));
  }

  plan(event: BotEvent): ActionPlan {
    const input = encoder.encode(JSON.stringify(event));
    const ptr = this.exports.alloc(input.length);
    new Uint8Array(this.exports.memory.buffer, ptr, input.length).set(input);

    try {
      return parsePlanResult(this.readReturnedJson(this.exports.plan(ptr, input.length)));
    } finally {
      this.exports.dealloc(ptr, input.length);
    }
  }

  hasAgentTools(): boolean {
    return (
      typeof this.exports.tool_definitions === "function" &&
      typeof this.exports.execute_tool === "function"
    );
  }

  getAgentToolDefinitions(): AgentToolDefinition[] {
    if (!this.exports.tool_definitions) {
      return [];
    }
    return parseAgentToolDefinitionsResult(this.readReturnedJson(this.exports.tool_definitions()));
  }

  executeAgentTool(call: AgentToolCall): AgentToolResult {
    if (!this.exports.execute_tool) {
      throw new Error("WASM module does not export execute_tool");
    }

    const input = encoder.encode(JSON.stringify(call));
    const ptr = this.exports.alloc(input.length);
    new Uint8Array(this.exports.memory.buffer, ptr, input.length).set(input);

    try {
      return parseAgentToolResult(
        this.readReturnedJson(this.exports.execute_tool(ptr, input.length)),
      );
    } finally {
      this.exports.dealloc(ptr, input.length);
    }
  }

  private readReturnedJson(packed: bigint): unknown {
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffff_ffffn);
    const bytes = new Uint8Array(this.exports.memory.buffer, ptr, len);
    const json = decoder.decode(bytes);
    this.exports.dealloc(ptr, len);
    return JSON.parse(json) as unknown;
  }
}
