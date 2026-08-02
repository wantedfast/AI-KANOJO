import { describe, expect, it, vi } from "vitest";
import {
  configureElevenAgent,
  createElevenAgentsConversationToken,
  getElevenAgent,
  inspectElevenAgentConfig,
} from "../electron/elevenagents-provider.js";
import { ELEVENAGENTS_BASE_PROMPT, ELEVENAGENTS_EXPECTED_CONFIG } from "../shared/elevenagents-contracts.js";

const validAgent = (overrides = {}) => ({
  agent_id: "agent_7101k5zvyjhmfg983brhmhkd98n6",
  conversation_config: {
    language_presets: { zh: {}, ja: {} },
    asr: { provider: "scribe_realtime" },
    turn: { turn_eagerness: "normal" },
    tts: { model_id: "eleven_v3_conversational", voice_id: "voice_1234567890" },
    conversation: { client_events: ["audio", "interruption", "user_transcript"] },
    agent: {
      language: "en",
      disable_first_message_interruptions: false,
      prompt: {
        llm: "qwen36-35b-a3b",
        prompt: ELEVENAGENTS_BASE_PROMPT,
        ignore_default_personality: true,
        built_in_tools: { language_detection: { type: "system", name: "language_detection" } },
        thinking_budget: 0,
        enable_reasoning_summary: false,
        backup_llm_config: { preference: "disabled" },
      },
    },
  },
  ...overrides,
});

describe("ElevenAgents provider", () => {
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
    expect(body.conversation_config.agent.prompt.custom_llm).toBeNull();
    expect(body.conversation_config.tts).toMatchObject({ model_id: "eleven_v3_conversational", stability: 0.42 });
    expect(JSON.stringify(body)).not.toContain("secret");
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
