import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface SessionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULT_MAX_MESSAGES = 100;
const SESSION_TTL_MINUTES = 60;

export class AgentStore {
  private readonly database: DatabaseSync;
  private _maxMessages: number | null = null;

  constructor(path = agentDatabasePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  get maxMessages(): number {
    if (this._maxMessages === null) {
      this._maxMessages = this.loadMaxMessages();
    }
    return this._maxMessages;
  }

  setMaxMessages(value: number): void {
    this.database
      .prepare(
        `INSERT INTO agent_settings (key, value) VALUES ('max_messages', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(value));
    this._maxMessages = value;
  }

  /**
   * Returns all messages for the given session.
   * Returns an empty array if the session doesn't exist or has been evicted by TTL.
   */
  getMessages(sessionId: string): SessionMessage[] {
    this.purgeStale();

    const row = this.database
      .prepare("SELECT messages FROM agent_sessions WHERE session_id = ?")
      .get(sessionId) as { messages: string } | undefined;

    if (!row) {
      return [];
    }

    this.touch(sessionId);
    return JSON.parse(row.messages) as SessionMessage[];
  }

  /**
   * Appends messages to a session and returns the full message list after
   * applying the ring-buffer cap (default 100 messages).
   * Creates the session if it doesn't exist.
   * Stale sessions are purged before the append.
   */
  appendMessages(sessionId: string, newMessages: SessionMessage[]): SessionMessage[] {
    this.purgeStale();

    const existing = this.readMessages(sessionId);
    let allMessages = [...existing, ...newMessages];

    if (allMessages.length > this.maxMessages) {
      allMessages = allMessages.slice(allMessages.length - this.maxMessages);
    }

    this.database
      .prepare(
        `INSERT INTO agent_sessions (session_id, messages, created_at, last_access_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(session_id) DO UPDATE SET
           messages = excluded.messages,
           last_access_at = excluded.last_access_at`,
      )
      .run(sessionId, JSON.stringify(allMessages));

    return allMessages;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private readMessages(sessionId: string): SessionMessage[] {
    const row = this.database
      .prepare("SELECT messages FROM agent_sessions WHERE session_id = ?")
      .get(sessionId) as { messages: string } | undefined;

    if (!row) {
      return [];
    }

    return JSON.parse(row.messages) as SessionMessage[];
  }

  private touch(sessionId: string): void {
    this.database
      .prepare("UPDATE agent_sessions SET last_access_at = datetime('now') WHERE session_id = ?")
      .run(sessionId);
  }

  private purgeStale(): void {
    this.database
      .prepare("DELETE FROM agent_sessions WHERE last_access_at < datetime('now', ?)")
      .run(`-${SESSION_TTL_MINUTES} minutes`);
  }

  private loadMaxMessages(): number {
    const row = this.database
      .prepare("SELECT value FROM agent_settings WHERE key = 'max_messages'")
      .get() as { value: string } | undefined;

    if (row) {
      const parsed = Number.parseInt(row.value, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return DEFAULT_MAX_MESSAGES;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        session_id TEXT PRIMARY KEY,
        messages TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_access_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agent_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO agent_settings (key, value)
      VALUES ('max_messages', '${DEFAULT_MAX_MESSAGES}');
    `);
  }
}

function agentDatabasePath(): string {
  return resolve(process.env.PATCHOULI_DATA_DIR ?? "data", "agent.sqlite");
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AgentStore | undefined;

export function initAgentStore(path?: string): AgentStore {
  instance = new AgentStore(path);
  return instance;
}

export function getAgentStore(): AgentStore {
  if (!instance) {
    throw new Error("AgentStore has not been initialized. Call initAgentStore() first.");
  }
  return instance;
}
