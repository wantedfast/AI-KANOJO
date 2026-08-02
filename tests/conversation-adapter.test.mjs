import { describe, expect, it, vi } from "vitest";
import {
  createElevenAgentsConversationAdapter,
  normalizeConversationClientError,
} from "../src/conversation-adapter.js";

const configuredStatus = { configured: true, issues: [] };

const createHarness = ({ credential } = {}) => {
  let callbacks;
  const session = {
    endSession: vi.fn(async () => {}),
    sendUserMessage: vi.fn(),
    setMicMuted: vi.fn(),
  };
  const conversationClient = {
    startSession: vi.fn(async (options) => {
      callbacks = options;
      options.onConnect?.({ conversationId: "conv" });
      return session;
    }),
  };
  const api = {
    getConversationBackendStatus: vi.fn(async () => configuredStatus),
    configureElevenAgent: vi.fn(async () => ({ ok: true, value: { modelId: "qwen36-35b-a3b" } })),
    createConversationCredential: vi.fn(async () => ({
      ok: true,
      value: { connectionType: "webrtc", conversationToken: "voice-token" },
      ...credential,
    })),
    cancelConversationRequest: vi.fn(async () => ({ ok: true })),
    saveChat: vi.fn(async () => true),
    streamReply: vi.fn(async (_payload, onDelta) => {
      onDelta?.("Hi ");
      onDelta?.("there");
      return "Hi there";
    }),
  };
  const adapter = createElevenAgentsConversationAdapter({ api, conversationClient, nowFn: () => 100 });
  return { adapter, api, conversationClient, session, getCallbacks: () => callbacks };
};

describe("ElevenAgents renderer adapter", () => {
  it("normalizes stale Custom LLM and microphone failures into actionable errors", () => {
    expect(normalizeConversationClientError("Server error: unknown server")).toContain("Qwen");
    expect(normalizeConversationClientError("custom_llm_error: Failed to generate response from custom LLM")).toContain("Qwen");
    expect(normalizeConversationClientError(new DOMException("Permission denied", "NotAllowedError"))).toContain("麦克风");
  });

  it("opens voice with a WebRTC token and maps transcript, reply, pause and resume", async () => {
    const { adapter, api, conversationClient, session, getCallbacks } = createHarness();
    adapter.startVoice("microphone-123");
    expect(adapter.getSnapshot().phase).toBe("connecting");
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());
    expect(api.createConversationCredential).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.any(String) }));
    expect(api.createConversationCredential.mock.calls[0][0]).not.toHaveProperty("connectionType");
    expect(conversationClient.startSession).toHaveBeenCalledWith(expect.objectContaining({
      connectionType: "webrtc",
      conversationToken: "voice-token",
      textOnly: false,
      inputDeviceId: "microphone-123",
    }));

    getCallbacks().onMessage({ role: "user", message: "你好" });
    expect(adapter.getSnapshot()).toMatchObject({ phase: "thinking", transcript: "你好" });
    getCallbacks().onMessage({ role: "agent", message: "你好呀" });
    expect(adapter.getSnapshot()).toMatchObject({ phase: "speaking", reply: "你好呀" });
    adapter.pauseVoice();
    expect(session.setMicMuted).toHaveBeenCalledWith(true);
    expect(adapter.getSnapshot().phase).toBe("paused");
    adapter.resumeVoice();
    expect(session.setMicMuted).toHaveBeenCalledWith(false);
    expect(adapter.getSnapshot().phase).toBe("listening");
  });

  it("sends text directly to Electron DeepSeek without an ElevenAgents credential", async () => {
    const { adapter, api, conversationClient } = createHarness();
    expect(adapter.sendText("Hello")).toBe(true);
    await vi.waitFor(() => expect(api.streamReply).toHaveBeenCalledOnce());
    expect(api.createConversationCredential).not.toHaveBeenCalled();
    expect(conversationClient.startSession).not.toHaveBeenCalled();
    expect(adapter.getSnapshot()).toMatchObject({ phase: "completed", reply: "Hi there" });
    expect(adapter.getSnapshot().messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("cancels a pending credential and ignores its late result", async () => {
    let resolveCredential;
    const { adapter, api, conversationClient } = createHarness();
    api.createConversationCredential.mockImplementationOnce(() => new Promise((resolve) => { resolveCredential = resolve; }));
    adapter.startVoice();
    await vi.waitFor(() => expect(api.createConversationCredential).toHaveBeenCalledOnce());
    adapter.endVoice();
    expect(api.cancelConversationRequest).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.any(String) }));
    resolveCredential({ ok: true, value: { connectionType: "webrtc", conversationToken: "late" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(conversationClient.startSession).not.toHaveBeenCalled();
    expect(adapter.getSnapshot().phase).toBe("idle");
  });

  it("surfaces a normalized stale Custom LLM failure from the SDK callback", async () => {
    const { adapter, conversationClient, getCallbacks } = createHarness();
    adapter.startVoice();
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());
    getCallbacks().onError("custom_llm_error: Failed to generate response from custom LLM");
    expect(adapter.getSnapshot()).toMatchObject({
      phase: "error",
      error: expect.stringContaining("Qwen"),
    });
  });

  it("fails a voice setup that never connects instead of showing listening forever", async () => {
    const { api } = createHarness();
    api.createConversationCredential.mockImplementationOnce(() => new Promise(() => {}));
    const adapter = createElevenAgentsConversationAdapter({
      api,
      conversationClient: { startSession: vi.fn() },
      nowFn: () => 100,
      setupTimeoutMs: 5,
    });
    adapter.startVoice();
    expect(adapter.getSnapshot().phase).toBe("connecting");
    await vi.waitFor(() => expect(adapter.getSnapshot()).toMatchObject({ phase: "error", error: expect.stringContaining("连接超时") }));
  });
});
