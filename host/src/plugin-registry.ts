import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { PluginManifest, PluginModuleInfo } from "./generated/plugin-api.js";
import { PluginStore, type PluginOrigin } from "./plugin-store.js";
import { WasmPlugin } from "./wasm-plugin.js";

export type LoadedPlugin = {
  path: string;
  plugin: WasmPlugin;
  manifest: PluginManifest;
};

export type PluginCatalogEntry = LoadedPlugin & {
  enabled: boolean;
  origin: PluginOrigin;
};

const pluginsRoot = resolve("../plugins");

export async function loadPluginCatalog(): Promise<PluginCatalogEntry[]> {
  const discoveredPlugins = await discoverPlugins(pluginsRoot);
  const store = new PluginStore();

  try {
    return filterDuplicatePlugins(discoveredPlugins).map((loadedPlugin) => {
      const origin = pluginOrigin(loadedPlugin.path);
      const setting = store.ensurePluginSetting(
        loadedPlugin.manifest.id,
        origin,
      );
      return {
        ...loadedPlugin,
        enabled: setting.enabled,
        origin,
      };
    });
  } finally {
    store.close();
  }
}

export async function loadConfiguredPlugins(): Promise<LoadedPlugin[]> {
  return enabledPlugins(await loadPluginCatalog());
}

export function enabledPlugins(catalog: PluginCatalogEntry[]): LoadedPlugin[] {
  return catalog.filter((entry) => entry.enabled);
}

export function pluginModules(plugins: LoadedPlugin[]): PluginModuleInfo[] {
  return plugins.map((loadedPlugin) => ({
    id: loadedPlugin.manifest.id,
    version: loadedPlugin.manifest.version,
  }));
}

async function discoverPlugins(root: string): Promise<LoadedPlugin[]> {
  const paths = await findWasmFiles(root);
  const plugins = await Promise.all(paths.map(loadPluginCandidate));
  return plugins.filter((plugin) => plugin !== undefined);
}

async function loadPluginCandidate(path: string): Promise<LoadedPlugin | undefined> {
  try {
    const plugin = await WasmPlugin.load(path);
    return {
      path,
      plugin,
      manifest: plugin.getManifest(),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping invalid WASM plugin candidate ${path}: ${reason}`);
    return undefined;
  }
}

async function findWasmFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return findWasmFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".wasm") && !isDependencyArtifact(path)
        ? [path]
        : [];
    }),
  );

  return paths.flat().sort();
}

function isDependencyArtifact(path: string): boolean {
  return path.split(sep).includes("deps");
}

function filterDuplicatePlugins(plugins: LoadedPlugin[]): LoadedPlugin[] {
  const seen = new Map<string, LoadedPlugin>();
  for (const loadedPlugin of plugins) {
    const existing = seen.get(loadedPlugin.manifest.id);
    if (existing) {
      throw new Error(
        `Duplicate plugin id ${loadedPlugin.manifest.id} found at ${existing.path} and ${loadedPlugin.path}`,
      );
    }
    seen.set(loadedPlugin.manifest.id, loadedPlugin);
  }

  return plugins;
}

function pluginOrigin(path: string): PluginOrigin {
  const parts = relative(pluginsRoot, path).split(sep);
  if (parts[0] === "builtin") {
    return "builtin";
  }
  if (parts[0] === "extra") {
    return "extra";
  }
  return "unknown";
}
