import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createElevenAgentsConversationAdapter,
  normalizeConversationClientError,
  sanitizeAgentReply,
} from "../src/conversation-adapter.js";

const configuredStatus = { configured: true, issues: [] };

afterEach(() => vi.unstubAllGlobals());

const createHarness = ({ credential, sendTimeoutMs = 8000, createCaptionTranscriber, playStandaloneAudio } = {}) => {
  let callbacks;
  const roomListeners = new Map();
  const clonedMicrophoneTrack = { enabled: true, stop: vi.fn() };
  const room = {
    localParticipant: {
      identity: "local-user",
      audioTrackPublications: new Map([["microphone", {
        track: { mediaStreamTrack: { clone: vi.fn(() => clonedMicrophoneTrack) } },
      }]]),
    },
    on: vi.fn((event, listener) => roomListeners.set(event, listener)),
    off: vi.fn((event, listener) => {
      if (roomListeners.get(event) === listener) roomListeners.delete(event);
    }),
    emit(event, ...args) {
      roomListeners.get(event)?.(...args);
    },
  };
  const session = {
    endSession: vi.fn(async () => {}),
    sendUserMessage: vi.fn(),
    setMicMuted: vi.fn(),
    setVolume: vi.fn(),
    connection: { getRoom: () => room },
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
    synthesize: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  const logs = [];
  const logger = {
    info: (_label, payload) => logs.push(payload),
    error: (_label, payload) => logs.push(payload),
  };
  const adapter = createElevenAgentsConversationAdapter({
    api,
    conversationClient,
    nowFn: () => 100,
    sendTimeoutMs,
    logger,
    ...(createCaptionTranscriber ? { createCaptionTranscriber } : {}),
    ...(playStandaloneAudio ? { playStandaloneAudio } : {}),
  });
  return { adapter, api, conversationClient, session, room, logs, getCallbacks: () => callbacks };
};

describe("ElevenAgents renderer adapter", () => {
  it("normalizes stale Custom LLM and microphone failures into actionable errors", () => {
    expect(normalizeConversationClientError("Server error: unknown server")).toContain("Qwen");
    expect(normalizeConversationClientError("custom_llm_error: Failed to generate response from custom LLM")).toContain("Qwen");
    expect(normalizeConversationClientError(new DOMException("Permission denied", "NotAllowedError"))).toContain("麦克风");
  });

  it("removes leaked language routing metadata from an agent reply", () => {
    expect(sanitizeAgentReply("[language_detection] User switched to Chinese. [reason] Changed. [language] zh\n你好，很高兴见到你。")).toBe("你好，很高兴见到你。");
    expect(sanitizeAgentReply("Use Chinese.\n你好，很高兴见到你。")).toBe("你好，很高兴见到你。");
    expect(sanitizeAgentReply('language_detection tool call: reason="User requested switching to Japanese", language="ja"\nこんにちは。')).toBe("こんにちは。");
    expect(sanitizeAgentReply("[laughs] 当然可以。")).toBe("[laughs] 当然可以。");
  });

  it("mutes Agent audio and uses standalone Eleven v3 when selected", async () => {
    const playStandaloneAudio = vi.fn(async () => {});
    const { adapter, api, session, getCallbacks } = createHarness({ playStandaloneAudio });
    adapter.startVoice("mic-1", { voiceId: "YyODrkDd1qMUj9jupJch", ttsModelId: "eleven_v3" });
    await vi.waitFor(() => expect(session.setVolume).toHaveBeenCalledWith({ volume: 0 }));

    getCallbacks().onVadScore({ vadScore: 0.8 });
    getCallbacks().onMessage({ role: "user", message: "你好" });
    getCallbacks().onMessage({ role: "agent", message: "[language_detection] User switched to Chinese. [reason] Changed. [language] zh\n你好呀。" });

    await vi.waitFor(() => expect(api.synthesize).toHaveBeenCalledWith({
      text: "你好呀。",
      voiceId: "YyODrkDd1qMUj9jupJch",
      modelId: "eleven_v3",
    }));
    await vi.waitFor(() => expect(playStandaloneAudio).toHaveBeenCalledOnce());
    expect(adapter.getSnapshot().reply).toBe("你好呀。");
    expect(adapter.getSnapshot().messages.at(-1).content).toBe("你好呀。");
  });

  it("ignores punctuation-only microphone turns and their unsolicited Agent reply", async () => {
    const playStandaloneAudio = vi.fn(async () => {});
    const { adapter, api, session, getCallbacks } = createHarness({ playStandaloneAudio });
    adapter.startVoice("mic-1", { voiceId: "YyODrkDd1qMUj9jupJch", ttsModelId: "eleven_v3" });
    await vi.waitFor(() => expect(session.setVolume).toHaveBeenCalledWith({ volume: 0 }));

    getCallbacks().onMessage({ role: "user", message: "..." });
    getCallbacks().onMessage({ role: "agent", message: "Hey, are you still there?" });

    expect(api.synthesize).not.toHaveBeenCalled();
    expect(playStandaloneAudio).not.toHaveBeenCalled();
    expect(adapter.getSnapshot()).toMatchObject({
      phase: "listening",
      transcript: "",
      reply: "",
      messages: [],
    });
  });

  it("does not create a caption turn for punctuation-only Scribe output", async () => {
    const { adapter, conversationClient, room } = createHarness();
    adapter.startVoice();
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());

    room.emit("transcriptionReceived", [{ id: "silence", text: "...", final: true }], room.localParticipant);

    expect(adapter.getSnapshot()).toMatchObject({
      phase: "listening",
      transcript: "",
      transcriptPartial: "",
      voiceTurns: [],
    });
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

  it("keeps V3 Conversational listening and isolates the new turn when the user interrupts", async () => {
    const { adapter, conversationClient, session, room, logs, getCallbacks } = createHarness();
    adapter.startVoice("microphone-123", { ttsModelId: "eleven_v3_conversational" });
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());

    getCallbacks().onMessage({ role: "user", message: "first question" });
    getCallbacks().onMessage({ role: "agent", message: "first long reply" });
    getCallbacks().onModeChange({ mode: "speaking" });
    const firstTurnId = adapter.getSnapshot().activeTurnId;

    expect(session.setMicMuted).not.toHaveBeenCalledWith(true);
    getCallbacks().onInterruption({ event_id: 42 });
    getCallbacks().onVadScore({ vadScore: 0.8 });
    room.emit("transcriptionReceived", [{ id: "interrupt-partial", text: "second", final: false }], room.localParticipant);
    room.emit("transcriptionReceived", [{ id: "interrupt-final", text: "second question", final: true }], room.localParticipant);
    getCallbacks().onMessage({ role: "user", message: "second question" });

    const snapshot = adapter.getSnapshot();
    const firstTurn = snapshot.voiceTurns.find((turn) => turn.turnId === firstTurnId);
    const secondTurn = snapshot.voiceTurns.find((turn) => turn.turnId === snapshot.activeTurnId);
    expect(firstTurn).toMatchObject({ status: "interrupted", responseStarted: true, responseCompleted: true });
    expect(secondTurn).toMatchObject({ transcriptFinal: "second question", messageSent: true, status: "thinking" });
    expect(secondTurn.turnId).not.toBe(firstTurnId);
    expect(logs.some((entry) => entry.turnId === firstTurnId && entry.event === "interrupted")).toBe(true);
  });

  it("keeps standalone Eleven v3 non-interruptible while its local audio is playing", async () => {
    let finishPlayback;
    const playStandaloneAudio = vi.fn(() => new Promise((resolve) => { finishPlayback = resolve; }));
    const { adapter, conversationClient, session, getCallbacks } = createHarness({ playStandaloneAudio });
    adapter.startVoice("microphone-123", { voiceId: "YyODrkDd1qMUj9jupJch", ttsModelId: "eleven_v3" });
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());

    getCallbacks().onMessage({ role: "user", message: "first question" });
    getCallbacks().onMessage({ role: "agent", message: "standalone reply" });
    await vi.waitFor(() => expect(adapter.getSnapshot().phase).toBe("speaking"));
    const firstTurnId = adapter.getSnapshot().activeTurnId;

    expect(session.setMicMuted).toHaveBeenCalledWith(true);
    getCallbacks().onInterruption({ event_id: 43 });
    getCallbacks().onVadScore({ vadScore: 0.8 });
    expect(adapter.getSnapshot()).toMatchObject({ phase: "speaking", activeTurnId: firstTurnId });
    expect(adapter.getSnapshot().voiceTurns).toHaveLength(1);

    finishPlayback();
    await vi.waitFor(() => expect(adapter.getSnapshot().phase).toBe("completed"));
  });

  it("does not let a late interruption event resume a manually paused conversation", async () => {
    const { adapter, conversationClient, session, getCallbacks } = createHarness();
    adapter.startVoice("microphone-123", { ttsModelId: "eleven_v3_conversational" });
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());
    getCallbacks().onMessage({ role: "user", message: "first question" });
    getCallbacks().onMessage({ role: "agent", message: "first reply" });
    getCallbacks().onModeChange({ mode: "speaking" });

    adapter.pauseVoice();
    const pausedTurnId = adapter.getSnapshot().activeTurnId;
    getCallbacks().onInterruption({ event_id: 44 });
    getCallbacks().onModeChange({ mode: "speaking" });

    expect(adapter.getSnapshot()).toMatchObject({ phase: "paused", activeTurnId: pausedTurnId });
    expect(session.setMicMuted.mock.calls.at(-1)).toEqual([true]);
  });

  it("does not let the previous playback completion erase a fast second turn", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, conversationClient, getCallbacks } = createHarness();
      adapter.startVoice();
      await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());

      getCallbacks().onMessage({ role: "user", message: "first" });
      getCallbacks().onMessage({ role: "agent", message: "first reply" });
      getCallbacks().onModeChange({ mode: "speaking" });
      getCallbacks().onModeChange({ mode: "listening" });
      expect(adapter.getSnapshot().phase).toBe("completed");

      getCallbacks().onMessage({ role: "user", message: "second" });
      expect(adapter.getSnapshot()).toMatchObject({ phase: "thinking", transcript: "second" });
      await vi.advanceTimersByTimeAsync(321);

      expect(adapter.getSnapshot()).toMatchObject({ phase: "thinking", transcript: "second" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not downgrade Thinking when a sidecar final transcript arrives after messageSent", async () => {
    const { adapter, conversationClient, room, getCallbacks } = createHarness();
    adapter.startVoice();
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());
    getCallbacks().onMessage({ role: "user", message: "already sent" });
    expect(adapter.getSnapshot().phase).toBe("thinking");
    room.emit("transcriptionReceived", [{ id: "late-final", text: "already sent", final: true }], room.localParticipant);
    expect(adapter.getSnapshot()).toMatchObject({ phase: "thinking", voiceState: "Thinking", transcript: "already sent" });
  });

  it("keeps five consecutive voice turns isolated with partial captions and complete lifecycle logs", async () => {
    const { adapter, conversationClient, room, logs, getCallbacks } = createHarness();
    adapter.startVoice();
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());

    for (let index = 1; index <= 5; index += 1) {
      const partial = `sentence ${index}`;
      const final = `sentence ${index} final`;
      room.emit("transcriptionReceived", [{ id: `partial-${index}`, text: partial, final: false }], room.localParticipant);
      expect(adapter.getSnapshot()).toMatchObject({ phase: "transcribing", voiceState: "Transcribing", transcriptPartial: partial });
      room.emit("transcriptionReceived", [{ id: `final-${index}`, text: final, final: true }], room.localParticipant);
      expect(adapter.getSnapshot()).toMatchObject({ phase: "sending", voiceState: "Sending", transcript: final });
      getCallbacks().onMessage({ role: "user", message: final });
      expect(adapter.getSnapshot()).toMatchObject({ phase: "thinking", voiceState: "Thinking" });
      getCallbacks().onMessage({ role: "agent", message: `reply ${index}` });
      getCallbacks().onModeChange({ mode: "speaking" });
      expect(adapter.getSnapshot()).toMatchObject({ phase: "speaking", voiceState: "Speaking" });
      getCallbacks().onModeChange({ mode: "listening" });
      await new Promise((resolve) => setTimeout(resolve, 330));
      expect(adapter.getSnapshot()).toMatchObject({ phase: "listening", voiceState: "Listening" });
    }

    const turns = adapter.getSnapshot().voiceTurns;
    expect(turns).toHaveLength(5);
    expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(5);
    expect(turns.map((turn) => turn.transcriptFinal)).toEqual([
      "sentence 1 final",
      "sentence 2 final",
      "sentence 3 final",
      "sentence 4 final",
      "sentence 5 final",
    ]);
    for (const event of [
      "recordingStarted",
      "speechDetected",
      "transcriptPartial",
      "transcriptFinal",
      "messageSent",
      "responseStarted",
      "responseCompleted",
      "listeningRestarted",
    ]) {
      expect(logs.filter((entry) => entry.event === event)).toHaveLength(5);
    }
  });

  it("keeps the realtime Scribe caption sidecar live during V3 Conversational playback", async () => {
    vi.stubGlobal("MediaStream", class {
      constructor(tracks) { this.tracks = tracks; }
      getTracks() { return this.tracks; }
      getAudioTracks() { return this.tracks; }
    });
    let captionCallbacks;
    const captionTranscriber = {
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      setMuted: vi.fn(),
    };
    const createCaptionTranscriber = vi.fn((options) => {
      captionCallbacks = options;
      return captionTranscriber;
    });
    const { adapter, api, conversationClient, getCallbacks } = createHarness({ createCaptionTranscriber });
    api.getScribeToken = vi.fn(async () => "scribe-token");
    adapter.startVoice("mic-1");
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(captionTranscriber.start).toHaveBeenCalledOnce());
    expect(createCaptionTranscriber).toHaveBeenCalledWith(expect.objectContaining({ token: "scribe-token", deviceId: "mic-1" }));

    captionCallbacks.onPartial("real time");
    expect(adapter.getSnapshot()).toMatchObject({ phase: "transcribing", transcriptPartial: "real time" });
    captionCallbacks.onCommitted("real time caption");
    expect(adapter.getSnapshot()).toMatchObject({ phase: "sending", transcript: "real time caption" });
    getCallbacks().onMessage({ role: "user", message: "real time caption" });
    getCallbacks().onMessage({ role: "agent", message: "reply" });
    getCallbacks().onModeChange({ mode: "speaking" });
    expect(captionTranscriber.setMuted).not.toHaveBeenCalledWith(true);
    expect(captionTranscriber.setMuted).toHaveBeenCalledWith(false);
    getCallbacks().onModeChange({ mode: "listening" });
    expect(captionTranscriber.setMuted).toHaveBeenCalledWith(false);
    adapter.endVoice();
    expect(captionTranscriber.stop).toHaveBeenCalledOnce();
  });

  it("preserves a final transcript when send confirmation times out and retries it", async () => {
    const { adapter, conversationClient, room, session } = createHarness({ sendTimeoutMs: 5 });
    adapter.startVoice();
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());
    room.emit("transcriptionReceived", [{ id: "final", text: "please retry", final: true }], room.localParticipant);

    await vi.waitFor(() => expect(adapter.getSnapshot()).toMatchObject({ phase: "error", voiceState: "Error" }));
    const [turn] = adapter.getSnapshot().voiceTurns;
    expect(turn).toMatchObject({ transcriptFinal: "please retry", status: "send_failed", error: "发送失败，可重试" });
    expect(adapter.retryVoiceTurn(turn.turnId)).toBe(true);
    expect(session.sendUserMessage).toHaveBeenCalledWith("please retry");
    expect(adapter.getSnapshot()).toMatchObject({ phase: "thinking", voiceState: "Thinking", error: "" });
  });

  it("detaches live transcription and stops listening after the microphone session ends", async () => {
    const { adapter, conversationClient, room, session } = createHarness();
    adapter.startVoice();
    await vi.waitFor(() => expect(conversationClient.startSession).toHaveBeenCalledOnce());
    adapter.endVoice();
    await vi.waitFor(() => expect(session.endSession).toHaveBeenCalledOnce());
    room.emit("transcriptionReceived", [{ id: "late", text: "late audio", final: false }], room.localParticipant);
    expect(adapter.getSnapshot()).toMatchObject({ phase: "idle", voiceState: "Idle", voiceTurns: [] });
    expect(room.off).toHaveBeenCalledWith("transcriptionReceived", expect.any(Function));
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
