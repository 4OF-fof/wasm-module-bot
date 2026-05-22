import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PluginOrigin = "builtin" | "extra" | "unknown";

export type PluginSetting = {
  pluginId: string;
  enabled: boolean;
};

export class PluginStore {
  private readonly database: DatabaseSync;

  constructor(path = databasePathFromEnv()) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  ensurePluginSetting(pluginId: string, origin: PluginOrigin): PluginSetting {
    const existing = this.findPluginSetting(pluginId);
    if (existing) {
      return existing;
    }

    const enabled = defaultEnabledForOrigin(origin);
    this.database
      .prepare(
        "insert into plugin_settings (plugin_id, enabled, updated_at) values (?, ?, datetime('now'))",
      )
      .run(pluginId, enabled ? 1 : 0);

    return { pluginId, enabled };
  }

  setPluginEnabled(pluginId: string, enabled: boolean): PluginSetting {
    this.database
      .prepare(
        `insert into plugin_settings (plugin_id, enabled, updated_at)
         values (?, ?, datetime('now'))
         on conflict(plugin_id) do update set
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(pluginId, enabled ? 1 : 0);

    return { pluginId, enabled };
  }

  private findPluginSetting(pluginId: string): PluginSetting | undefined {
    const row = this.database
      .prepare("select plugin_id, enabled from plugin_settings where plugin_id = ?")
      .get(pluginId);

    if (!isPluginSettingRow(row)) {
      return undefined;
    }

    return {
      pluginId: row.plugin_id,
      enabled: row.enabled === 1,
    };
  }

  private migrate(): void {
    this.database.exec(`
      create table if not exists plugin_settings (
        plugin_id text primary key,
        enabled integer not null check (enabled in (0, 1)),
        updated_at text not null
      );
    `);
  }
}

export function databasePathFromEnv(): string {
  return resolve(process.env.PATCHOULI_DATA_DIR ?? "data", "patchouli.sqlite");
}

function defaultEnabledForOrigin(origin: PluginOrigin): boolean {
  return origin === "builtin";
}

function isPluginSettingRow(
  value: unknown,
): value is { plugin_id: string; enabled: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "plugin_id" in value &&
    "enabled" in value &&
    typeof value.plugin_id === "string" &&
    typeof value.enabled === "number"
  );
}
