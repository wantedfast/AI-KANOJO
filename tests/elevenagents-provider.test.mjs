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

const validAgent = (overrides = {}) => ({
  agent_id: "agent_7101k5zvyjhmfg983brhmhkd98n6",
  conversation_config: {
    language_presets: { en: {}, ja: {} },
    asr: { provider: "scribe_realtime" },
    turn: {
      turn_eagerness: "normal",
      soft_timeout_config: { timeout_seconds: -1, message: "Hmm..." },
    },
    tts: { model_id: "eleven_v3_conversational", voice_id: "voice_1234567890" },
    conversation: { client_events: ["audio", "interruption", "user_transcript"] },
    agent: {
      language: "zh",
      disable_first_message_interruptions: false,
      prompt: {
        llm: "qwen36-35b-a3b",
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

describe("ElevenAgents provider", () => {
  it("lists all available voices with pagination and safe metadata", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const parsed = new URL(url);
      if (!parsed.searchParams.get("next_page_token")) {
        return {
          ok: true,
          json: async () => ({
            voices: [{ voice_id: "voiceA12345678901234", name: "雪之乃", category: "cloned", labels: { language: "zh", secret: "omit" }, preview_url: "https://example.com/a.mp3" }],
            has_more: true,
            next_page_token: "page-2",
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          voices: [{ voice_id: "voiceB12345678901234", name: "Hikari", category: "professional", labels: { language: "ja", accent: "tokyo" } }],
          has_more: false,
          next_page_token: null,
        }),
      };
    });

    await expect(listElevenVoices({ apiKey: "xi-private-key", fetchImpl })).resolves.toEqual([
      { voiceId: "voiceB12345678901234", name: "Hikari", category: "professional", language: "ja", accent: "tokyo", previewUrl: "" },
      { voiceId: "voiceA12345678901234", name: "雪之乃", category: "cloned", language: "zh", accent: "", previewUrl: "https://example.com/a.mp3" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain("/v2/voices");
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("voice_type")).toBe("personal");
    expect(JSON.stringify(await listElevenVoices({ apiKey: "xi-private-key", fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ voices: [], has_more: false }) })) }))).not.toContain("xi-private-key");
  });

  it("pins and validates the required agent configuration", () => {
    const result = inspectElevenAgentConfig(validAgent());
    expect(result.ok).toBe(true);
    expect(result.expectedModels).toEqual(ELEVENAGENTS_EXPECTED_CONFIG);
  });

  it("resolves the native Qwen model and publishes a preserved agent configuration", async () => {
    const existing = validAgent();
    existing.name = "Luo Zhaoyue";
    existing.conversation_config.agent.prompt.llm = "custom-llm";
    existing.conversation_config.agent.prompt.custom_llm = { model_id: "deepseek-v4-flash", api_key: { secret_id: "secret" } };
    existing.conversation_config.tts.stability = 0.42;
    existing.conversation_config.turn.soft_timeout_config = {
      timeout_seconds: 3,
      message: "Are you still there?",
    };
    const published = validAgent({ name: existing.name });
    published.conversation_config.tts.stability = 0.42;
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (url.endsWith("/v1/convai/llm/list")) {
        return { ok: true, json: async () => ({ llms: [{ llm: "qwen36-35b-a3b", name: "Qwen3.6-35B-A3B" }] }) };
      }
      if (options.method === "PATCH") return { ok: true, json: async () => published };
      const getCount = fetchImpl.mock.calls.filter(([calledUrl, calledOptions = {}]) => calledUrl.includes("/v1/convai/agents/") && calledOptions.method !== "PATCH").length;
      return { ok: true, json: async () => (getCount === 1 ? existing : published) };
    });

    const result = await configureElevenAgent({ apiKey: "xi-private-key", agentId: existing.agent_id, fetchImpl });
    expect(result).toMatchObject({ ok: true, agentId: existing.agent_id, modelId: "qwen36-35b-a3b" });
    const patchCall = fetchImpl.mock.calls.find(([, options = {}]) => options.method === "PATCH");
    const body = JSON.parse(patchCall[1].body);
    expect(body.conversation_config.agent.prompt).toMatchObject({ llm: "qwen36-35b-a3b", thinking_budget: 0, enable_reasoning_summary: false });
    expect(body.conversation_config.agent.prompt.built_in_tools.language_detection).toMatchObject({
      pre_tool_speech: "off",
      params: { system_tool_type: "language_detection" },
    });
    expect(body.conversation_config.agent.prompt.built_in_tools.language_detection).not.toHaveProperty("tool_call_sound");
    expect(body.conversation_config.agent.prompt.prompt).toContain("Return only the user-facing reply");
    expect(body.conversation_config.agent.prompt.custom_llm).toBeNull();
    expect(body.conversation_config.agent.language).toBe("zh");
    expect(Object.keys(body.conversation_config.language_presets).sort()).toEqual(["en", "ja"]);
    expect(body.conversation_config.tts).toMatchObject({ model_id: "eleven_v3_conversational", stability: 0.42 });
    expect(body.conversation_config.turn.soft_timeout_config).toEqual({ timeout_seconds: -1, message: "Hmm..." });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("validates and publishes a user-selected voice ID", async () => {
    const existing = validAgent();
    const nextVoiceId = "YyODrkDd1qMUj9jupJch";
    const published = validAgent();
    published.conversation_config.tts.voice_id = nextVoiceId;
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (url.endsWith(`/v1/voices/${nextVoiceId}`)) {
        return { ok: true, json: async () => ({ voice_id: nextVoiceId, name: "雪之乃" }) };
      }
      if (url.endsWith("/v1/convai/llm/list")) {
        return { ok: true, json: async () => ({ llms: [{ llm: "qwen36-35b-a3b", name: "Qwen3.6-35B-A3B" }] }) };
      }
      if (options.method === "PATCH") return { ok: true, json: async () => published };
      const getCount = fetchImpl.mock.calls.filter(([calledUrl, calledOptions = {}]) => calledUrl.includes("/v1/convai/agents/") && calledOptions.method !== "PATCH").length;
      return { ok: true, json: async () => (getCount === 1 ? existing : published) };
    });

    await expect(configureElevenAgent({ apiKey: "xi-private-key", agentId: existing.agent_id, voiceId: nextVoiceId, fetchImpl }))
      .resolves.toMatchObject({ ok: true, voiceId: nextVoiceId });
    const patchCall = fetchImpl.mock.calls.find(([, options = {}]) => options.method === "PATCH");
    expect(JSON.parse(patchCall[1].body).conversation_config.tts.voice_id).toBe(nextVoiceId);
  });

  it("does not publish when the selected voice is unavailable", async () => {
    const nextVoiceId = "missingVoice12345678";
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith(`/v1/voices/${nextVoiceId}`)) return { ok: false, status: 404 };
      if (url.endsWith("/v1/convai/llm/list")) {
        return { ok: true, json: async () => ({ llms: [{ llm: "qwen36-35b-a3b", name: "Qwen3.6-35B-A3B" }] }) };
      }
      return { ok: true, json: async () => validAgent() };
    });

    await expect(configureElevenAgent({ apiKey: "xi-private-key", agentId: validAgent().agent_id, voiceId: nextVoiceId, fetchImpl }))
      .rejects.toMatchObject({ code: "VOICE_NOT_FOUND" });
    expect(fetchImpl.mock.calls.some(([, options = {}]) => options.method === "PATCH")).toBe(false);
  });

  it("does not publish or fall back when Qwen3.6 is unavailable", async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith("/v1/convai/llm/list")
        ? { llms: [{ llm: "qwen3.5-397b-a17b", name: "Qwen3.5-397B-A17B" }] }
        : validAgent(),
    }));
    await expect(configureElevenAgent({ apiKey: "xi-private-key", agentId: validAgent().agent_id, fetchImpl }))
      .rejects.toMatchObject({ code: "QWEN_MODEL_MISMATCH" });
    expect(fetchImpl.mock.calls.some(([, options = {}]) => options.method === "PATCH")).toBe(false);
  });

  it("reports every fixed-model and turn mismatch without exposing secrets", () => {
    const agent = validAgent();
    agent.conversation_config.agent.prompt.llm = "gemini-2.5-flash";
    agent.conversation_config.agent.prompt.backup_llm_config.preference = "default";
    agent.conversation_config.asr.provider = "elevenlabs";
    agent.conversation_config.tts = { model_id: "eleven_flash_v2_5", voice_id: "" };
    agent.conversation_config.turn.turn_eagerness = "eager";
    agent.conversation_config.conversation.client_events = ["audio"];
    const result = inspectElevenAgentConfig(agent);
    expect(result.ok).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "QWEN_MODEL_MISMATCH", "TTS_MODEL_MISMATCH", "VOICE_NOT_CONFIGURED", "TURN_CONFIG_MISMATCH",
    ]));
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("uses the official get-agent endpoint and never returns the API key", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => validAgent() }));
    const result = await getElevenAgent({ apiKey: "xi-private-key", agentId: "agent_7101k5zvyjhmfg983brhmhkd98n6", fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain("/v1/convai/agents/agent_7101k5zvyjhmfg983brhmhkd98n6");
    expect(fetchImpl.mock.calls[0][1].headers["xi-api-key"]).toBe("xi-private-key");
    expect(JSON.stringify(result)).not.toContain("xi-private-key");
  });

  it("rejects any configured TTS fallback", () => {
    const agent = validAgent();
    agent.conversation_config.tts.fallback_model_id = "eleven_flash_v2_5";
    const result = inspectElevenAgentConfig(agent);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "TTS_MODEL_MISMATCH",
      field: "conversation_config.tts.fallback",
    }));
  });

  it("rejects an enabled soft timeout that can speak over the real reply", () => {
    const agent = validAgent();
    agent.conversation_config.turn.soft_timeout_config = {
      timeout_seconds: 3,
      message: "Are you still there?",
    };
    const result = inspectElevenAgentConfig(agent);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "TURN_CONFIG_MISMATCH",
      field: "conversation_config.turn.soft_timeout_config",
    }));
  });

  it("rejects a non-system language detection tool", () => {
    const agent = validAgent();
    agent.conversation_config.agent.prompt.built_in_tools.language_detection.params.system_tool_type = "end_call";
    expect(inspectElevenAgentConfig(agent)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ field: "conversation_config.agent.prompt.built_in_tools.language_detection" })],
    });
  });

  it("creates a WebRTC token with the official endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ token: "short-token", conversation_id: "conv_123" }) }));
    const result = await createElevenAgentsConversationToken({ apiKey: "xi-private-key", agentId: "agent_7101k5zvyjhmfg983brhmhkd98n6", fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain("/v1/convai/conversation/token?agent_id=agent_7101k5zvyjhmfg983brhmhkd98n6");
    expect(result).toEqual({ connectionType: "webrtc", conversationToken: "short-token", conversationId: "conv_123" });
  });

  it("normalizes raw provider failures without returning their bodies", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, text: async () => "raw-secret-body" }));
    await expect(getElevenAgent({ apiKey: "bad", agentId: "agent_7101k5zvyjhmfg983brhmhkd98n6", fetchImpl })).rejects.toMatchObject({ code: "ELEVENLABS_AUTH_FAILED" });
    try {
      await getElevenAgent({ apiKey: "bad", agentId: "agent_7101k5zvyjhmfg983brhmhkd98n6", fetchImpl });
    } catch (error) {
      expect(error.message).not.toContain("raw-secret-body");
    }
  });
});
