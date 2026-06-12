import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionSummarizer } from "./summarizer.js";

export interface SessionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const SESSION_START_SEPARATOR = "__MODULEBOT_SESSION_START__";

interface StaleRow {
  session_id: string;
  messages: string;
  created_at: string;
  last_access_at: string;
}

const DEFAULT_MAX_MESSAGES = 500;
const DEFAULT_SESSION_TTL_MINUTES = 60;
const DEFAULT_INITIAL_HISTORY_MESSAGES = 20;
const DEFAULT_NO_REPLY_SESSION_LIMIT = 5;

export class AgentStore {
  private readonly database: DatabaseSync;
  private readonly summarizer: SessionSummarizer | undefined;
  private _maxMessages: number | null = null;
  private _sessionTtlMinutes: number | null = null;
  private _initialHistoryMessages: number | null = null;
  private _noReplySessionLimit: number | null = null;

  constructor(path = agentDatabasePath(), summarizer?: SessionSummarizer) {
    this.summarizer = summarizer;
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

  get sessionTtlMinutes(): number {
    if (this._sessionTtlMinutes === null) {
      this._sessionTtlMinutes = this.loadSessionTtlMinutes();
    }
    return this._sessionTtlMinutes;
  }

  setSessionTtlMinutes(value: number): void {
    this.database
      .prepare(
        `INSERT INTO agent_settings (key, value) VALUES ('session_ttl_minutes', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(value));
    this._sessionTtlMinutes = value;
  }

  get initialHistoryMessages(): number {
    if (this._initialHistoryMessages === null) {
      this._initialHistoryMessages = this.loadInitialHistoryMessages();
    }
    return this._initialHistoryMessages;
  }

  setInitialHistoryMessages(value: number): void {
    this.database
      .prepare(
        `INSERT INTO agent_settings (key, value) VALUES ('initial_history_messages', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(value));
    this._initialHistoryMessages = value;
  }

  get noReplySessionLimit(): number {
    if (this._noReplySessionLimit === null) {
      this._noReplySessionLimit = this.loadNoReplySessionLimit();
    }
    return this._noReplySessionLimit;
  }

  setNoReplySessionLimit(value: number): void {
    this.database
      .prepare(
        `INSERT INTO agent_settings (key, value) VALUES ('no_reply_session_limit', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(value));
    this._noReplySessionLimit = value;
  }

  /**
   * Returns all messages for the given session.
   * Returns an empty array if the session doesn't exist or has been evicted by TTL.
   */
  async getMessages(sessionId: string): Promise<SessionMessage[]> {
    await this.purgeStale();

    const row = this.database
      .prepare("SELECT messages FROM agent_sessions WHERE session_id = ?")
      .get(sessionId) as unknown as { messages: string } | undefined;

    if (!row) {
      return [];
    }

    this.touch(sessionId);
    return JSON.parse(row.messages) as SessionMessage[];
  }

  /**
   * Appends messages to a session and returns the full message list after
   * applying the ring-buffer cap.
   * Creates the session if it doesn't exist.
   * Stale sessions are purged (summarized → archived → deleted) before the append.
   * When creating a new session, channelId is persisted as metadata.
   */
  async appendMessages(
    sessionId: string,
    newMessages: SessionMessage[],
    channelId?: string,
    pluginId?: string,
  ): Promise<SessionMessage[]> {
    await this.purgeStale();

    const existing = this.readMessages(sessionId);
    const isNew = existing.length === 0;
    let allMessages = [...existing, ...newMessages];

    if (allMessages.length > this.maxMessages) {
      allMessages = allMessages.slice(allMessages.length - this.maxMessages);
    }

    if (isNew && channelId) {
      this.database
        .prepare(
          `INSERT INTO agent_sessions (session_id, channel_id, plugin_id, messages, created_at, last_access_at)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(session_id) DO UPDATE SET
             channel_id = COALESCE(agent_sessions.channel_id, excluded.channel_id),
             plugin_id = COALESCE(agent_sessions.plugin_id, excluded.plugin_id),
             messages = excluded.messages,
             last_access_at = excluded.last_access_at`,
        )
        .run(sessionId, channelId, pluginId ?? null, JSON.stringify(allMessages));
    } else {
      this.database
        .prepare(
          `INSERT INTO agent_sessions (session_id, messages, created_at, last_access_at)
           VALUES (?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(session_id) DO UPDATE SET
             messages = excluded.messages,
             last_access_at = excluded.last_access_at`,
        )
        .run(sessionId, JSON.stringify(allMessages));
    }

    return allMessages;
  }

  /**
   * Returns the active session bound to the given channel, if any.
   * Excludes sessions past TTL.
   */
  async getActiveSessionByChannel(
    channelId: string,
  ): Promise<{ sessionId: string; pluginId: string } | undefined> {
    await this.purgeStale();

    const ttlParam = `-${this.sessionTtlMinutes} minutes`;
    const row = this.database
      .prepare(
        `SELECT session_id, plugin_id FROM agent_sessions
         WHERE channel_id = ? AND last_access_at >= datetime('now', ?)`,
      )
      .get(channelId, ttlParam) as unknown as { session_id: string; plugin_id: string } | undefined;

    if (!row || !row.plugin_id) return undefined;
    return { sessionId: row.session_id, pluginId: row.plugin_id };
  }

  /**
   * Immediately archives the session (summarize → write Markdown) and deletes
   * it from the database. Use this for explicit session termination.
   */
  async endSession(sessionId: string): Promise<void> {
    const row = this.database
      .prepare(
        `SELECT session_id, messages, created_at, last_access_at
         FROM agent_sessions WHERE session_id = ?`,
      )
      .get(sessionId) as unknown as StaleRow | undefined;

    if (!row) return;

    await this.archiveSession(row);
    this.database.prepare("DELETE FROM agent_sessions WHERE session_id = ?").run(sessionId);
  }

  incrementNoReplyCount(sessionId: string): number {
    const row = this.database
      .prepare(
        `UPDATE agent_sessions
         SET no_reply_count = no_reply_count + 1,
             last_access_at = datetime('now')
         WHERE session_id = ?
         RETURNING no_reply_count`,
      )
      .get(sessionId) as unknown as { no_reply_count: number } | undefined;

    return row?.no_reply_count ?? 0;
  }

  resetNoReplyCount(sessionId: string): void {
    this.database
      .prepare(
        `UPDATE agent_sessions
         SET no_reply_count = 0,
             last_access_at = datetime('now')
         WHERE session_id = ?`,
      )
      .run(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private readMessages(sessionId: string): SessionMessage[] {
    const row = this.database
      .prepare("SELECT messages FROM agent_sessions WHERE session_id = ?")
      .get(sessionId) as unknown as { messages: string } | undefined;

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

  /**
   * Flow for each stale session:
   *   1. Summarize via LLM
   *   2. Write summary to {memoryDir}/{date}/{session_id}.md
   *   3. Delete from DB
   */
  private async purgeStale(): Promise<void> {
    const ttlParam = `-${this.sessionTtlMinutes} minutes`;

    const stale = this.database
      .prepare(
        `SELECT session_id, messages, created_at, last_access_at
         FROM agent_sessions
         WHERE last_access_at < datetime('now', ?)`,
      )
      .all(ttlParam) as unknown as StaleRow[];

    for (const row of stale) {
      await this.archiveSession(row);
    }

    this.database
      .prepare("DELETE FROM agent_sessions WHERE last_access_at < datetime('now', ?)")
      .run(ttlParam);
  }

  private async archiveSession(row: StaleRow): Promise<void> {
    const messages = messagesAfterSessionStart(JSON.parse(row.messages) as SessionMessage[]);
    if (messages.length === 0) {
      return;
    }

    const summary = this.summarizer
      ? await this.summarizer.summarize(row.session_id, messages)
      : formatFallbackSummary(row, messages);

    // Derive date from created_at (YYYY-MM-DD).
    const date = row.created_at.slice(0, 10);
    const dir = join(memoryDirPath(), date);
    mkdirSync(dir, { recursive: true });

    const lines: string[] = [
      `# Session ${row.session_id}`,
      "",
      `**Created**: ${row.created_at}`,
      `**Expired**: ${row.last_access_at}`,
      `**Messages**: ${messages.length}`,
      "",
      "---",
      "",
      summary,
    ];

    writeFileSync(join(dir, `${row.session_id}.md`), lines.join("\n"), "utf-8");
  }

  private loadMaxMessages(): number {
    return this.loadIntSetting("max_messages", DEFAULT_MAX_MESSAGES);
  }

  private loadSessionTtlMinutes(): number {
    return this.loadIntSetting("session_ttl_minutes", DEFAULT_SESSION_TTL_MINUTES);
  }

  private loadInitialHistoryMessages(): number {
    return this.loadIntSetting("initial_history_messages", DEFAULT_INITIAL_HISTORY_MESSAGES);
  }

  private loadNoReplySessionLimit(): number {
    return this.loadIntSetting("no_reply_session_limit", DEFAULT_NO_REPLY_SESSION_LIMIT);
  }

  private loadIntSetting(key: string, fallback: number): number {
    const row = this.database.prepare("SELECT value FROM agent_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;

    if (row) {
      const parsed = Number.parseInt(row.value, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return fallback;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        session_id TEXT PRIMARY KEY,
        channel_id TEXT,
        plugin_id TEXT,
        messages TEXT NOT NULL DEFAULT '[]',
        no_reply_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_access_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agent_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO agent_settings (key, value) VALUES
        ('max_messages', '${DEFAULT_MAX_MESSAGES}'),
        ('session_ttl_minutes', '${DEFAULT_SESSION_TTL_MINUTES}'),
        ('initial_history_messages', '${DEFAULT_INITIAL_HISTORY_MESSAGES}'),
        ('no_reply_session_limit', '${DEFAULT_NO_REPLY_SESSION_LIMIT}');
    `);
  }
}

function messagesAfterSessionStart(messages: SessionMessage[]): SessionMessage[] {
  const markerIndex = messages.findLastIndex(
    (message) => message.role === "system" && message.content === SESSION_START_SEPARATOR,
  );

  return markerIndex >= 0 ? messages.slice(markerIndex + 1) : messages;
}

function agentDatabasePath(): string {
  return resolve(process.env.MODULEBOT_DATA_DIR ?? "data", "agent.sqlite");
}

function memoryDirPath(): string {
  return resolve(process.env.MODULEBOT_MEMORY_DIR ?? "memory");
}

/**
 * Fallback summary when no Summarizer is available.
 * Formats the conversation as a plain Markdown transcript.
 */
function formatFallbackSummary(_row: StaleRow, messages: SessionMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    parts.push(`### ${msg.role}`);
    parts.push(msg.content);
    parts.push("");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AgentStore | undefined;

export function initAgentStore(path?: string, summarizer?: SessionSummarizer): AgentStore {
  instance = new AgentStore(path, summarizer);
  return instance;
}

export function getAgentStore(): AgentStore {
  if (!instance) {
    throw new Error("AgentStore has not been initialized. Call initAgentStore() first.");
  }
  return instance;
}
