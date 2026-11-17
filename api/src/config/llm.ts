import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  ModelSettings,
  setDefaultOpenAIKey,
  setTracingDisabled,
} from "@openai/agents";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { env } from "./env";

type AgentModel = string | ReturnType<typeof aisdk>;

const isAnthropic = env.AI_PROVIDER === "anthropic";

const createGeminiModel = () => {
  const googleProvider = createGoogleGenerativeAI({
    apiKey: env.GEMINI_API_KEY,
  });

  // TODO: temporarily hardcoded. Gemini 2.x (e.g. gemini-2.5-flash-lite) rejects
  // function calling combined with a JSON response schema; Gemini 3.x supports it.
  // Switch back to env.GEMINI_MODEL once .env points at a 3.x model.
  return aisdk(googleProvider("gemini-3.5-flash-lite") as never);
};

const createOpenAIModel = () => {
  setDefaultOpenAIKey(env.OPENAI_API_KEY);
  return env.OPENAI_MODEL;
};

const anthropicProvider = isAnthropic
  ? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : undefined;

const createAnthropicModel = (modelId: string) =>
  aisdk(anthropicProvider!(modelId) as never);

/**
 * The OpenAI Agents AI SDK adapter ignores `reasoning` and forwards
 * `modelSettings.providerData` into the AI SDK call, so Anthropic options go there.
 * Thinking is adaptive by default on current Claude models; effort controls depth.
 * Sampling params (temperature/top_p) are rejected by current Claude models, so none are sent.
 */
const anthropicSettings = (
  options: Record<string, unknown>,
): ModelSettings => ({
  providerData: { providerOptions: { anthropic: options } },
});

setTracingDisabled(!env.OPENAI_AGENTS_TRACING_ENABLED);
setDefaultOpenAIKey(env.OPENAI_API_KEY);

const createChatModel = (): AgentModel => {
  if (isAnthropic) return createAnthropicModel(env.ANTHROPIC_MODEL);
  if (env.AI_PROVIDER === "openai") return createOpenAIModel();
  return createGeminiModel();
};

export const llmModel = createChatModel();

/** Provider-specific settings for the main chat agent. */
export const chatModelSettings: ModelSettings = isAnthropic
  ? anthropicSettings({
      effort: "medium",
      // On a safety-classifier refusal, retry on the recommended fallback model
      // (server-side; the provider adds the required beta header).
      fallbacks: "default",
    })
  : {
      reasoning: {
        effort: "medium",
        summary: "concise",
      },
    };

// Memory and summary agents: Claude when AI_PROVIDER=anthropic, otherwise OpenAI (unchanged).
export const memoryLlmModel: AgentModel = isAnthropic
  ? createAnthropicModel(env.ANTHROPIC_MEMORY_MODEL)
  : env.OPENAI_MEMORY_MODEL;

// Memory/summary calls are short, non-streaming requests: keep max_tokens well
// under the 128K default so they stay within HTTP timeouts.
const anthropicMemorySettings: ModelSettings = {
  ...anthropicSettings({ effort: "low" }),
  maxTokens: 16000,
};

/** Provider-specific settings for the memory extraction agent. */
export const memoryModelSettings: ModelSettings = isAnthropic
  ? anthropicMemorySettings
  : { temperature: 0.5 };

/** Provider-specific settings for the thread summary agent. */
export const summaryModelSettings: ModelSettings = isAnthropic
  ? anthropicMemorySettings
  : {};

export const llmProviderName = env.AI_PROVIDER;
