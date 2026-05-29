import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { SessionMessage } from "./store.js";

export interface SessionSummarizer {
  summarize(sessionId: string, messages: SessionMessage[]): Promise<string>;
}

const promptPath = join(import.meta.dirname, "..", "..", "prompt", "session_summary_compat.md");
const summarySystemPrompt = readFileSync(promptPath, "utf-8");

export function createSessionSummarizer(): SessionSummarizer {
  const apiKey = process.env.LLM_API_KEY;
  const providerName = process.env.LLM_PROVIDER ?? "opencode";
  const providerType = process.env.LLM_PROVIDER_TYPE ?? "openai-compatible";
  const model = process.env.LLM_MODEL ?? "qwen3.6-plus";

  if (!apiKey) {
    console.warn("LLM_API_KEY not set — session summarization is disabled.");
    return { summarize: async () => "No LLM_API_KEY configured." };
  }

  let baseURL: string;
  switch (providerName) {
    case "opencode":
      baseURL = "https://opencode.ai/zen/go/v1";
      break;
    default:
      console.warn(`LLM provider "${providerName}" not supported for summarization — disabled.`);
      return { summarize: async () => `Provider "${providerName}" not supported.` };
  }

  return {
    async summarize(sessionId: string, messages: SessionMessage[]): Promise<string> {
      // Create a model instance tied to this session so the provider
      // can reuse the conversation cache from the ongoing agent loop.
      const languageModel = resolveModel(
        providerName,
        providerType,
        baseURL,
        apiKey,
        model,
        sessionId,
      );

      // Non-system messages form the history; summarization instruction is system-level.
      const chatMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      try {
        const result = await generateText({
          model: languageModel,
          system: `${summarySystemPrompt}\n\nSummarize the conversation below.`,
          messages: chatMessages,
          providerOptions: {
            anthropic: { cacheControl: true },
          },
        });
        return result.text;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Summarization failed: ${message}`;
      }
    },
  };
}

function resolveModel(
  providerName: string,
  providerType: string,
  baseURL: string,
  apiKey: string,
  model: string,
  sessionId: string,
): LanguageModel {
  if (providerType === "anthropic") {
    const anthropic = createAnthropic({
      baseURL,
      apiKey,
      headers: { "x-opencode-session": sessionId },
    });
    return anthropic(model);
  }
  const openaiCompatible = createOpenAICompatible({
    name: providerName,
    baseURL,
    apiKey,
    headers: { "x-opencode-session": sessionId },
  });
  return openaiCompatible.chatModel(model);
}
