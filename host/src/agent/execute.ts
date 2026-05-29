import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { effectResultEvent } from "../effect-results.js";
import type { BotEvent, EffectRequest } from "../generated/plugin-api.js";
import { getAgentStore } from "./store.js";

export async function executeAgent(
  effect: Extract<EffectRequest, { type: "agent" }>,
  pluginId: string,
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

    // Append incoming messages to the session.
    // This also evicts stale sessions and enforces the ring-buffer cap.
    const store = getAgentStore();
    const newMessages = effect.messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));
    const allMessages = store.appendMessages(effect.sessionId, newMessages);

    // Extract the latest system message as the system prompt; everything else
    // is sent as chat messages.
    const systemMessages = allMessages.filter((m) => m.role === "system");
    const systemPrompt =
      systemMessages.length > 0 ? systemMessages[systemMessages.length - 1].content : undefined;
    const chatMessages = allMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const result = await generateText({
      model: languageModel,
      ...(systemPrompt && { system: systemPrompt }),
      messages: chatMessages,
      providerOptions: {
        anthropic: { cacheControl: true },
      },
    });

    // Persist assistant response to session history.
    store.appendMessages(effect.sessionId, [{ role: "assistant", content: result.text }]);

    return effectResultEvent(pluginId, effect.id, {
      ok: true,
      status: 200,
      body: result.text,
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
