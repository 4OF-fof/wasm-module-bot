// In-memory agent session message history.
// Not persisted to SQLite — lives only for the process lifetime.

interface SessionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const sessions = new Map<string, SessionMessage[]>();

export function getSessionMessages(sessionId: string): SessionMessage[] {
  return sessions.get(sessionId) ?? [];
}

export function appendSessionMessages(sessionId: string, messages: SessionMessage[]): void {
  const existing = sessions.get(sessionId) ?? [];
  sessions.set(sessionId, [...existing, ...messages]);
}
