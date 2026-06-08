import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { effectResultEvent } from "../effect-results.js";
import type { BotEvent, EffectRequest } from "../generated/plugin-api.js";
import { getAgentStore } from "./store.js";
import { createAgentTools, type DiscordHistoryRange } from "./tools.js";

const systemPromptPath = join(import.meta.dirname, "..", "..", "prompt", "agent_system_prompt.md");
const agentSystemPrompt = readFileSync(systemPromptPath, "utf-8");

export type DiscordHistoryMessage = {
  offset: number;
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

export type DiscordHistoryResult = {
  type: "discord.history";
  start: number;
  end: number;
  messages: DiscordHistoryMessage[];
};

export type AgentExecutionOptions = {
  fetchDiscordHistory?(range: DiscordHistoryRange): Promise<DiscordHistoryResult>;
};

export async function executeAgent(
  effect: Extract<EffectRequest, { type: "agent" }>,
  pluginId: string,
  channelId?: string,
  options: AgentExecutionOptions = {},
): Promise<BotEvent> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return effectResultEvent(pluginId, effect.id, {
      ok: false,
      status: 0,
      body: "LLM_API_KEY is not configured",
    });
  }

  const providerName = process.env.LLM_PROVIDER ?? "opencode";
  const providerType = process.env.LLM_PROVIDER_TYPE ?? "openai-compatible";
  const model = process.env.LLM_MODEL ?? "qwen3.6-plus";

  let baseURL: string;
  switch (providerName) {
    case "opencode":
      baseURL = "https://opencode.ai/zen/go/v1";
      break;
    default:
      return effectResultEvent(pluginId, effect.id, {
        ok: false,
        status: 0,
        body: `LLM provider "${providerName}" は未対応です。現在は "opencode" のみ利用可能です。`,
      });
  }

  try {
    let languageModel: LanguageModel;
    if (providerType === "anthropic") {
      const anthropic = createAnthropic({
        baseURL,
        apiKey,
        headers: { "x-opencode-session": effect.sessionId },
      });
      languageModel = anthropic(model);
    } else {
      const openaiCompatible = createOpenAICompatible({
        name: providerName,
        baseURL,
        apiKey,
        headers: { "x-opencode-session": effect.sessionId },
      });
      languageModel = openaiCompatible.chatModel(model);
    }

    // Append incoming messages (user/assistant only — plugin no longer sends system).
    // The core system prompt is always passed from the file, never mixed into session history.
    const store = getAgentStore();
    const newMessages = effect.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const existingMessages = await store.getMessages(effect.sessionId);
    const initialContext =
      existingMessages.length === 0
        ? await initialDiscordHistoryContext(store.initialHistoryMessages, options)
        : [];

    const allMessages = await store.appendMessages(
      effect.sessionId,
      [...initialContext, ...newMessages],
      channelId,
      pluginId,
    );

    const chatMessages = allMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    let shouldCloseSession = false;
    let shouldSkipReply = false;
    const tools = createAgentTools(effect.toolModuleIds, {
      onCloseSession: () => {
        shouldCloseSession = true;
      },
      onNoReply: () => {
        shouldSkipReply = true;
      },
      fetchDiscordHistory: options.fetchDiscordHistory,
    });
    const result = await generateText({
      model: languageModel,
      system: agentSystemPrompt,
      messages: chatMessages,
      tools,
      stopWhen: tools ? stepCountIs(Number(process.env.LLM_TOOL_MAX_STEPS ?? 5)) : stepCountIs(1),
      providerOptions: {
        anthropic: { cacheControl: true },
      },
    });

    const responseText =
      shouldSkipReply
        ? ""
        : result.text ||
          (shouldCloseSession
            ? "会話を終了しました。また必要なときはメンションで呼びかけてください。"
            : "");

    // Persist assistant response to session history.
    if (responseText) {
      await store.appendMessages(effect.sessionId, [{ role: "assistant", content: responseText }]);
    }

    if (shouldSkipReply) {
      const noReplyCount = store.incrementNoReplyCount(effect.sessionId);
      if (noReplyCount >= store.noReplySessionLimit) {
        await store.endSession(effect.sessionId);
      }
    } else if (shouldCloseSession) {
      await store.endSession(effect.sessionId);
    } else if (responseText) {
      store.resetNoReplyCount(effect.sessionId);
    }

    return effectResultEvent(pluginId, effect.id, {
      ok: true,
      status: 200,
      body: responseText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[${pluginId}] Agent error (provider=${providerName}, model=${model}, session=${effect.sessionId}): ${message}`,
    );
    return effectResultEvent(pluginId, effect.id, {
      ok: false,
      status: 0,
      body: message,
    });
  }
}

async function initialDiscordHistoryContext(
  messageCount: number,
  options: AgentExecutionOptions,
) {
  if (messageCount < 1 || !options.fetchDiscordHistory) {
    return [];
  }

  try {
    const history = await options.fetchDiscordHistory({ start: 1, end: messageCount });
    if (history.messages.length === 0) {
      return [];
    }
    return history.messages.map((message) => ({
      role: "user" as const,
      content: formatInitialDiscordHistoryMessage(message),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to fetch initial Discord history: ${message}`);
    return [];
  }
}

function formatInitialDiscordHistoryMessage(message: DiscordHistoryMessage): string {
  return `[Discord history before session start] ${message.author}: ${message.content}`;
}
