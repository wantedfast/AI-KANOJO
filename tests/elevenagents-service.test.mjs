import { describe, expect, it, vi } from "vitest";
import { ElevenAgentsService } from "../electron/elevenagents-service.js";
import { ELEVENAGENTS_EXPECTED_CONFIG } from "../shared/elevenagents-contracts.js";

const agentId = "agent_7101k5zvyjhmfg983brhmhkd98n6";

const createStore = (initial = {}) => {
  let data = {
    secrets: { elevenlabs: "encrypted" },
    elevenAgents: { agentId: "", verifiedAgentId: "", verifiedAt: 0, configVersion: "" },
    ...initial,
  };
  return {
    get: () => structuredClone(data),
    patch: vi.fn(async (patch) => { data = { ...data, ...patch }; return structuredClone(data); }),
  };
};

const configVersion = ELEVENAGENTS_EXPECTED_CONFIG.configVersion;
const validResult = { ok: true, issues: [], expectedModels: {}, modelId: ELEVENAGENTS_EXPECTED_CONFIG.llmModelId, configVersion };
const verifiedAgent = { agentId, verifiedAgentId: agentId, verifiedAt: 1, configVersion };

describe("ElevenAgents service", () => {
  it("reports missing Agent ID without falling back", () => {
    const service = new ElevenAgentsService({ store: createStore(), getApiKey: () => "key" });
    expect(service.getStatus()).toMatchObject({ configured: false, elevenlabsKeyConfigured: true, agentIdConfigured: false });
    expect(service.getStatus().issues[0].code).toBe("AGENT_ID_MISSING");
  });

  it("configures Qwen before atomically saving an Agent ID", async () => {
    const store = createStore();
    const configureProvider = vi.fn(async () => validResult);
    const service = new ElevenAgentsService({ store, getApiKey: () => "key", provider: { configureElevenAgent: configureProvider } });
    await service.saveAgentId({ agentId });
    expect(configureProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "key", agentId }));
    expect(store.patch).toHaveBeenCalledWith(expect.objectContaining({ elevenAgents: expect.objectContaining({ agentId, verifiedAgentId: agentId, configVersion }) }));
    expect(service.getStatus().configured).toBe(true);
  });

  it("does not overwrite the last good Agent ID when validation fails", async () => {
    const store = createStore({ elevenAgents: verifiedAgent });
    const service = new ElevenAgentsService({
      store,
      getApiKey: () => "key",
      provider: { configureElevenAgent: async () => { throw Object.assign(new Error("wrong model"), { code: "AGENT_CONFIG_MISMATCH" }); } },
    });
    await expect(service.saveAgentId({ agentId: "agent_aaaaaaaaaaaaaaaaaaaa" })).rejects.toMatchObject({ code: "AGENT_CONFIG_MISMATCH" });
    expect(store.patch).not.toHaveBeenCalled();
    expect(store.get().elevenAgents.agentId).toBe(agentId);
  });

  it("validates config before issuing a one-time WebRTC credential", async () => {
    const store = createStore({ elevenAgents: verifiedAgent });
    const createConversationToken = vi.fn(async () => ({ connectionType: "webrtc", conversationToken: "short", conversationId: "conv" }));
    const service = new ElevenAgentsService({
      store,
      getApiKey: () => "long-key",
      provider: { validateElevenAgent: async () => validResult, createConversationToken },
    });
    const result = await service.createCredential({ requestId: "req-1" });
    expect(result).toEqual({ requestId: "req-1", connectionType: "webrtc", conversationToken: "short", conversationId: "conv" });
    expect(JSON.stringify(result)).not.toContain("long-key");
    await expect(service.createCredential({ requestId: "req-1" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  });

  it("rejects all caller-selected credential connection types", async () => {
    const service = new ElevenAgentsService({ store: createStore(), getApiKey: () => "key" });
    await expect(service.createCredential({ requestId: "bad-type", connectionType: "websocket" })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });

  it("rejects concurrent issuance and suppresses a cancelled late result", async () => {
    const store = createStore({ elevenAgents: verifiedAgent });
    let release;
    const validateElevenAgent = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      release = () => signal.aborted ? reject(Object.assign(new Error("aborted"), { name: "AbortError" })) : resolve(validResult);
    }));
    const service = new ElevenAgentsService({ store, getApiKey: () => "key", provider: { validateElevenAgent, createConversationToken: vi.fn() } });
    const pending = service.createCredential({ requestId: "req-active" });
    await expect(service.createCredential({ requestId: "req-other" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    expect(service.cancel({ requestId: "req-active" })).toMatchObject({ cancelled: true });
    release();
    await expect(pending).rejects.toBeTruthy();
    expect(service.getStatus()).toMatchObject({ configured: true, agentConfigVerified: true });
  });

  it("clears stale verification when a previously valid saved Agent drifts", async () => {
    const store = createStore({ elevenAgents: verifiedAgent });
    const service = new ElevenAgentsService({
      store,
      getApiKey: () => "key",
      provider: { validateElevenAgent: async () => ({ ok: false, issues: [{ message: "drifted" }] }) },
    });
    await expect(service.createCredential({ requestId: "req-drift" })).rejects.toMatchObject({ code: "AGENT_CONFIG_MISMATCH" });
    expect(service.getStatus()).toMatchObject({ configured: false, agentConfigVerified: false });
    expect(store.get().elevenAgents).toMatchObject({ agentId, verifiedAgentId: "", verifiedAt: 0 });
  });

  it("records successful explicit validation for the saved Agent", async () => {
    const store = createStore({ elevenAgents: { agentId, verifiedAgentId: "", verifiedAt: 0, configVersion: "" } });
    const service = new ElevenAgentsService({
      store,
      getApiKey: () => "key",
      now: () => 42,
      provider: { validateElevenAgent: async () => validResult },
    });
    await expect(service.validate()).resolves.toMatchObject({ ok: true, verifiedAt: 42 });
    expect(service.getStatus()).toMatchObject({ configured: true, agentConfigVerified: true });
  });

  it("rate-limits sequential credential bursts with unique request IDs", async () => {
    let now = 1_000;
    const store = createStore({ elevenAgents: verifiedAgent });
    const service = new ElevenAgentsService({
      store,
      getApiKey: () => "key",
      now: () => now,
      provider: {
        validateElevenAgent: async () => validResult,
        createConversationToken: async () => ({ connectionType: "webrtc", conversationToken: "short", conversationId: "conv" }),
      },
    });
    await service.createCredential({ requestId: "burst-1" });
    await service.createCredential({ requestId: "burst-2" });
    await service.createCredential({ requestId: "burst-3" });
    await expect(service.createCredential({ requestId: "burst-4" })).rejects.toMatchObject({ code: "REQUEST_RATE_LIMITED" });
    now += 10_001;
    await expect(service.createCredential({ requestId: "burst-5" })).resolves.toMatchObject({ requestId: "burst-5" });
  });
});
