import { describe, expect, it, vi } from "vitest";
import {
  configureElevenAgent,
  createElevenAgentsConversationToken,
  getElevenAgent,
  inspectElevenAgentConfig,
  listElevenVoices,
} from "../electron/elevenagents-provider.js";
import {
  ELEVENAGENTS_BASE_PROMPT,
  ELEVENAGENTS_EXPECTED_CONFIG,
  ELEVENAGENTS_LANGUAGE_DETECTION_TOOL,
} from "../shared/elevenagents-contracts.js";

const QWEN_ID = "qwen36-35b-a3b";

const validAgent = (overrides = {}) => ({
  agent_id: "agent_7101k5zvyjhmfg983brhmhkd98n6",
  conversation_config: {
    language_presets: { en: {}, ja: {} },
    asr: { provider: "scribe_realtime" },
    turn: {
      mode: "turn",
      turn_model: "turn_v3",
      turn_eagerness: "normal",
      turn_timeout: 7,
      silence_end_call_timeout: -1,
      soft_timeout_config: { timeout_seconds: -1, message: "…" },
    },
    tts: { model_id: "eleven_v3_conversational", voice_id: "voice_1234567890" },
    conversation: { client_events: ["audio", "interruption", "user_transcript", "agent_response_correction"] },
    agent: {
      language: "zh",
      disable_first_message_interruptions: false,
      prompt: {
        llm: QWEN_ID,
        custom_llm: null,
        prompt: ELEVENAGENTS_BASE_PROMPT,
        ignore_default_personality: true,
        built_in_tools: { language_detection: structuredClone(ELEVENAGENTS_LANGUAGE_DETECTION_TOOL) },
        thinking_budget: 0,
        enable_reasoning_summary: false,
        backup_llm_config: { preference: "disabled" },
      },
    },
  },
  ...overrides,
});

describe("ElevenAgents native-Qwen voice provider", () => {
  it("allows answers to use the length required by the user's request", () => {
    expect(ELEVENAGENTS_BASE_PROMPT).toContain("Match the depth and length of the answer to the user's request");
    expect(ELEVENAGENTS_BASE_PROMPT).not.toMatch(/1-3 sentences|short follow-up|Do not use Markdown or long lists/i);
  });

  it("keeps text chat on DeepSeek while the voice Agent contract uses native Qwen", () => {
    expect(ELEVENAGENTS_EXPECTED_CONFIG.llmType).toBe(QWEN_ID);
    expect(ELEVENAGENTS_EXPECTED_CONFIG.configVersion).toContain("qwen-native");
    expect(inspectElevenAgentConfig(validAgent()).ok).toBe(true);
  });

  it("lists available voices with bounded public metadata", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        voices: [{ voice_id: "voiceA12345678901234", name: "Yuki", category: "cloned", labels: { language: "zh", secret: "omit" } }],
        has_more: false,
      }),
    }));
    await expect(listElevenVoices({ apiKey: "xi-private-key", fetchImpl })).resolves.toEqual([
      { voiceId: "voiceA12345678901234", name: "Yuki", category: "cloned", language: "zh", accent: "", previewUrl: "" },
    ]);
  });

  it("publishes native Qwen with turn_v3, seven-second fallback, correction events, and no soft-timeout speech", async () => {
    const existing = validAgent();
    existing.conversation_config.agent.prompt.llm = "old-model";
    existing.conversation_config.agent.prompt.custom_llm = { url: "https://obsolete.example" };
    existing.conversation_config.turn.turn_timeout = 30;
    existing.conversation_config.turn.soft_timeout_config = { timeout_seconds: 3, message: "Are you still there?" };
    existing.conversation_config.conversation.client_events = ["audio"];
    const published = validAgent();
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (url.endsWith("/v1/convai/llm/list")) {
        return { ok: true, json: async () => ({ llms: [{ llm: QWEN_ID, name: "Qwen3.6-35B-A3B" }] }) };
      }
      if (options.method === "PATCH") return { ok: true, json: async () => published };
      const gets = fetchImpl.mock.calls.filter(([calledUrl, calledOptions = {}]) => calledUrl.includes("/v1/convai/agents/") && calledOptions.method !== "PATCH").length;
      return { ok: true, json: async () => (gets === 1 ? existing : published) };
    });

    await expect(configureElevenAgent({ apiKey: "xi-private-key", agentId: existing.agent_id, fetchImpl }))
      .resolves.toMatchObject({ ok: true, modelId: QWEN_ID });
    const patchCall = fetchImpl.mock.calls.find(([, options = {}]) => options.method === "PATCH");
    const config = JSON.parse(patchCall[1].body).conversation_config;
    expect(config.agent.prompt).toMatchObject({ llm: QWEN_ID, custom_llm: null, thinking_budget: 0 });
    expect(config.turn).toMatchObject({ turn_model: "turn_v3", turn_timeout: 7, turn_eagerness: "normal" });
    expect(config.turn.soft_timeout_config).toEqual({ timeout_seconds: -1, message: "…" });
    expect(config.conversation.client_events).toEqual(expect.arrayContaining(["interruption", "user_transcript", "agent_response_correction"]));
    expect(JSON.stringify(config)).not.toContain("Are you still there?");
  });

  it("applies a selected shared Voice ID without changing the native voice LLM", async () => {
    const existing = validAgent();
    const nextVoiceId = "YyODrkDd1qMUj9jupJch";
    const published = validAgent();
    published.conversation_config.tts.voice_id = nextVoiceId;
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (url.endsWith(`/v1/voices/${nextVoiceId}`)) return { ok: true, json: async () => ({ voice_id: nextVoiceId }) };
      if (url.endsWith("/v1/convai/llm/list")) return { ok: true, json: async () => ({ llms: [{ llm: QWEN_ID, name: "Qwen3.6-35B-A3B" }] }) };
      if (options.method === "PATCH") return { ok: true, json: async () => published };
      const gets = fetchImpl.mock.calls.filter(([calledUrl, calledOptions = {}]) => calledUrl.includes("/v1/convai/agents/") && calledOptions.method !== "PATCH").length;
      return { ok: true, json: async () => (gets === 1 ? existing : published) };
    });
    await expect(configureElevenAgent({ apiKey: "xi-private-key", agentId: existing.agent_id, voiceId: nextVoiceId, fetchImpl }))
      .resolves.toMatchObject({ voiceId: nextVoiceId, modelId: QWEN_ID });
  });

  it("does not silently substitute a different voice LLM", async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith("/v1/convai/llm/list")
        ? { llms: [{ llm: "gemini", name: "Gemini" }] }
        : validAgent(),
    }));
    await expect(configureElevenAgent({ apiKey: "xi-private-key", agentId: validAgent().agent_id, fetchImpl }))
      .rejects.toMatchObject({ code: "QWEN_MODEL_MISMATCH" });
  });

  it("reports turn and native-Qwen drift without exposing provider secrets", () => {
    const agent = validAgent();
    agent.conversation_config.agent.prompt.llm = "custom-llm";
    agent.conversation_config.agent.prompt.custom_llm = { api_key: "secret-value" };
    agent.conversation_config.turn.turn_timeout = 30;
    agent.conversation_config.conversation.client_events = ["audio"];
    const result = inspectElevenAgentConfig(agent);
    expect(result.ok).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining(["QWEN_MODEL_MISMATCH", "TURN_CONFIG_MISMATCH"]));
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("uses the official get-agent endpoint without returning the API key", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => validAgent() }));
    const result = await getElevenAgent({ apiKey: "xi-private-key", agentId: validAgent().agent_id, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain(`/v1/convai/agents/${validAgent().agent_id}`);
    expect(JSON.stringify(result)).not.toContain("xi-private-key");
  });

  it("creates a WebRTC conversation token", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ token: "short-token", conversation_id: "conv_123" }) }));
    await expect(createElevenAgentsConversationToken({ apiKey: "xi-private-key", agentId: validAgent().agent_id, fetchImpl }))
      .resolves.toEqual({ connectionType: "webrtc", conversationToken: "short-token", conversationId: "conv_123" });
  });
});
