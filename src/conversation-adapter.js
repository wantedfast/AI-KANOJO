import { RealtimeScribe } from "./realtime-scribe.js";
import {
  ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
  ELEVEN_V3_MODEL_ID,
  isSupportedElevenTtsModel,
} from "../shared/model-contracts.js";

const now = () => Date.now();

export const EMPTY_CONVERSATION_SNAPSHOT = Object.freeze({
  configured: true,
  messages: [],
  phase: "idle",
  voiceState: "Idle",
  voiceTurns: [],
  activeTurnId: "",
  transcript: "",
  transcriptPartial: "",
  reply: "",
  error: "",
});

function normalizeSnapshot(snapshot = {}) {
  return {
    ...EMPTY_CONVERSATION_SNAPSHOT,
    ...snapshot,
    messages: Array.isArray(snapshot.messages) ? snapshot.messages.slice(-24) : [],
    voiceTurns: Array.isArray(snapshot.voiceTurns) ? snapshot.voiceTurns.slice(-12) : [],
  };
}

function createStore(initialSnapshot) {
  let snapshot = normalizeSnapshot(initialSnapshot);
  const listeners = new Set();
  const publish = (patch) => {
    snapshot = normalizeSnapshot({ ...snapshot, ...patch });
    listeners.forEach((listener) => listener(snapshot));
  };
  return {
    getSnapshot: () => snapshot,
    publish,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    clear: () => listeners.clear(),
  };
}

export function createPreviewConversationAdapter({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const seed = [
    { id: "welcome-1", role: "assistant", content: "早安，今天打算先做点什么呢？", createdAt: now() - 180000, status: "complete" },
    { id: "welcome-2", role: "user", content: "想先整理一下今天的计划。", createdAt: now() - 120000, status: "complete" },
    { id: "welcome-3", role: "assistant", content: "好呀，把最重要的一件事告诉我，我们慢慢来。", createdAt: now() - 60000, status: "complete" },
  ];
  const store = createStore({ messages: seed });
  const timers = new Set();
  let runId = 0;

  const schedule = (callback, delay) => {
    const timer = setTimer(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };
  const cancelRun = () => {
    runId += 1;
    timers.forEach(clearTimer);
    timers.clear();
  };

  const sendText = (content) => {
    const text = content?.trim();
    if (!text) return false;
    cancelRun();
    const currentRun = runId;
    const userMessage = { id: `preview-user-${now()}`, role: "user", content: text, createdAt: now(), status: "complete" };
    const replyId = `preview-reply-${now()}`;
    const pendingReply = { id: replyId, role: "assistant", content: "", createdAt: now(), status: "streaming" };
    const messages = [...store.getSnapshot().messages, userMessage, pendingReply].slice(-24);
    store.publish({ messages, phase: "thinking", reply: "", transcript: text, error: "" });

    const chunks = ["听起来很不错。", "我们先把最重要的一件事做好，", "剩下的就不会那么累啦。"];
    chunks.forEach((chunk, index) => schedule(() => {
      if (currentRun !== runId) return;
      const nextMessages = store.getSnapshot().messages.map((message) => message.id === replyId
        ? { ...message, content: `${message.content}${chunk}`, status: index === chunks.length - 1 ? "complete" : "streaming" }
        : message);
      const reply = nextMessages.find((message) => message.id === replyId)?.content ?? "";
      store.publish({ messages: nextMessages, reply, phase: index === chunks.length - 1 ? "speaking" : "thinking" });
      if (index === chunks.length - 1) {
        schedule(() => currentRun === runId && store.publish({ phase: "completed" }), 900);
      }
    }, 420 + index * 520));
    return true;
  };
  const startVoice = () => {
    cancelRun();
    const currentRun = runId;
    store.publish({ phase: "listening", transcript: "", reply: "", error: "" });
    schedule(() => currentRun === runId && store.publish({ transcript: "今天过得怎么样？" }), 700);
    schedule(() => currentRun === runId && store.publish({ phase: "thinking" }), 1500);
    schedule(() => currentRun === runId && store.publish({ phase: "speaking", reply: "见到你之后，心情就更好啦。" }), 2400);
    schedule(() => currentRun === runId && store.publish({ phase: "completed" }), 3900);
    schedule(() => currentRun === runId && store.publish({ phase: "listening", transcript: "", reply: "" }), 4500);
  };

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    sendText,
    startVoice,
    pauseVoice() {
      cancelRun();
      store.publish({ phase: "paused" });
    },
    resumeVoice: startVoice,
    endVoice() {
      cancelRun();
      store.publish({ phase: "idle", transcript: "", reply: "", error: "" });
    },
    closeSurface() {
      cancelRun();
      store.publish({ phase: "idle", transcript: "", reply: "", error: "" });
    },
    dispose() {
      cancelRun();
      store.clear();
    },
  };
}

export function createUnavailableConversationAdapter() {
  const store = createStore({
    configured: false,
    error: "等待后端会话适配器接入",
  });
  const fail = (phase = "error") => store.publish({ phase, error: "等待后端会话适配器接入" });
  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    sendText: () => { fail(); return false; },
    startVoice: () => fail(),
    pauseVoice: () => fail("paused"),
    resumeVoice: () => fail(),
    endVoice: () => store.publish({ phase: "idle" }),
    closeSurface: () => store.publish({ phase: "idle" }),
    dispose: store.clear,
  };
}

const safeBackendMessage = (result, fallback) => result?.error?.message || fallback;

export const normalizeConversationClientError = (value) => {
  const message = String(value?.message || value || "").trim();
  if (/custom[_ -]?llm|failed to generate response from custom llm|unknown server/i.test(message)) {
    return "检测到旧的 Custom LLM 会话错误。请重新配置并发布使用原生 Qwen 的 ElevenAgent。";
  }
  if (/microphone|notallowederror|permission denied|permission dismissed/i.test(message)) {
    return "无法使用麦克风。请在 Windows 隐私设置中允许桌面应用访问麦克风后重试。";
  }
  return message || "ElevenAgents 会话暂时不可用。";
};

export const sanitizeAgentReply = (value) => {
  const text = String(value || "").trim();
  const lines = text.split(/\r?\n/);
  const routingLine = /^\s*(?:\[(?:language_detection|reason|language)\]|(?:use|switch(?:ing)?\s+to|respond(?:ing)?\s+in)\s+(?:chinese|english|japanese)\b)/i;
  while (lines.length && routingLine.test(lines[0])) lines.shift();
  return lines.join("\n").trim();
};

export function createElevenAgentsConversationAdapter({
  api,
  conversationClient,
  loadConversationClient = () => import("@elevenlabs/client").then(({ Conversation }) => Conversation),
  nowFn = now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setupTimeoutMs = 15000,
  sendTimeoutMs = 8000,
  recoveryTimeoutMs = 1200,
  logger = console,
  createCaptionTranscriber = (options) => new RealtimeScribe(options),
  playStandaloneAudio,
} = {}) {
  const store = createStore({ configured: false });
  let session = null;
  let sessionKind = null;
  let pendingRequestId = "";
  let runId = 0;
  let messageSequence = 0;
  let completionTimer = null;
  let setupTimer = null;
  let recoveryTimer = null;
  let lastInputDeviceId = "";
  let voicePreferences = { voiceId: "", ttsModelId: ELEVEN_V3_CONVERSATIONAL_MODEL_ID };
  let standaloneOutputRun = 0;
  let standaloneOutputPending = false;
  let standaloneAudio = null;
  let standaloneAudioUrl = "";
  let turnSequence = 0;
  let activeTurnId = "";
  let vadActive = false;
  let detachTranscriptionListener = null;
  let captionTranscriber = null;
  const sendTimers = new Map();

  const usesStandaloneV3 = () => voicePreferences.ttsModelId === ELEVEN_V3_MODEL_ID;
  const stopStandaloneOutput = () => {
    standaloneOutputRun += 1;
    standaloneOutputPending = false;
    try {
      standaloneAudio?.pause?.();
    } catch {
      // The session lifecycle is already closing.
    }
    standaloneAudio = null;
    if (standaloneAudioUrl) URL.revokeObjectURL?.(standaloneAudioUrl);
    standaloneAudioUrl = "";
  };
  const playAudioBytes = async (audioBytes) => {
    if (playStandaloneAudio) return playStandaloneAudio(audioBytes);
    const blob = new Blob([audioBytes], { type: "audio/mpeg" });
    standaloneAudioUrl = URL.createObjectURL(blob);
    standaloneAudio = new Audio(standaloneAudioUrl);
    await standaloneAudio.play();
    await new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      standaloneAudio.onended = settle;
      standaloneAudio.onerror = settle;
      standaloneAudio.onpause = settle;
    });
    if (standaloneAudioUrl) URL.revokeObjectURL(standaloneAudioUrl);
    standaloneAudio = null;
    standaloneAudioUrl = "";
  };

  const nextMessageId = (role) => `${role}-${nowFn()}-${messageSequence += 1}`;
  const nextTurnId = () => `turn-${nowFn()}-${turnSequence += 1}`;
  const logTurn = (turnId, event, detail = undefined) => {
    const payload = { turnId: turnId || "session", event, at: nowFn() };
    if (detail !== undefined) payload.detail = detail;
    const method = event === "error" ? "error" : "info";
    logger?.[method]?.("[voice-turn]", payload);
  };
  const findTurn = (turnId) => store.getSnapshot().voiceTurns.find((turn) => turn.turnId === turnId);
  const updateTurn = (turnId, patch) => {
    if (!turnId) return null;
    let updated = null;
    const voiceTurns = store.getSnapshot().voiceTurns.map((turn) => {
      if (turn.turnId !== turnId) return turn;
      updated = { ...turn, ...patch };
      return updated;
    });
    store.publish({ voiceTurns });
    return updated;
  };
  const ensureActiveTurn = ({ speechDetected = false } = {}) => {
    const current = activeTurnId && findTurn(activeTurnId);
    if (current && !["complete", "send_failed", "error"].includes(current.status)) {
      if (speechDetected && !current.speechDetected) {
        updateTurn(current.turnId, { speechDetected: true });
        logTurn(current.turnId, "speechDetected");
      }
      return current.turnId;
    }
    const turnId = nextTurnId();
    activeTurnId = turnId;
    const turn = {
      turnId,
      createdAt: nowFn(),
      transcriptPartial: "",
      transcriptFinal: "",
      status: "recognizing",
      speechDetected,
      messageSent: false,
      responseStarted: false,
      responseCompleted: false,
      error: "",
    };
    store.publish({
      voiceTurns: [...store.getSnapshot().voiceTurns, turn].slice(-12),
      activeTurnId: turnId,
      voiceState: "Transcribing",
      phase: "transcribing",
      transcriptPartial: "",
      error: "",
    });
    logTurn(turnId, "recordingStarted");
    if (speechDetected) logTurn(turnId, "speechDetected");
    return turnId;
  };
  const clearSendTimer = (turnId) => {
    const timer = sendTimers.get(turnId);
    if (timer != null) clearTimer(timer);
    sendTimers.delete(turnId);
  };
  const markSendFailed = (turnId, message = "发送失败，可重试") => {
    const turn = findTurn(turnId);
    if (!turn || turn.messageSent) return;
    clearSendTimer(turnId);
    updateTurn(turnId, { status: "send_failed", error: message });
    activeTurnId = "";
    store.publish({ activeTurnId: "", phase: "error", voiceState: "Error", error: message });
    logTurn(turnId, "error", message);
    scheduleRecovery();
  };
  const scheduleSendFailure = (turnId) => {
    clearSendTimer(turnId);
    sendTimers.set(turnId, setTimer(() => markSendFailed(turnId), sendTimeoutMs));
  };
  const scheduleRecovery = () => {
    clearTimer(recoveryTimer);
    recoveryTimer = setTimer(() => {
      if (sessionKind !== "voice" || !session || store.getSnapshot().phase !== "error") return;
      Promise.resolve(session.setMicMuted?.(false)).catch(() => {});
      captionTranscriber?.setMuted?.(false);
      store.publish({ phase: "listening", voiceState: "Listening" });
    }, recoveryTimeoutMs);
  };
  const publishError = (message) => {
    const normalized = normalizeConversationClientError(message);
    const turn = activeTurnId && findTurn(activeTurnId);
    if (turn?.transcriptFinal && !turn.messageSent) {
      markSendFailed(turn.turnId);
      return;
    }
    if (turn) {
      updateTurn(turn.turnId, { status: "error", error: normalized });
      logTurn(turn.turnId, "error", normalized);
      activeTurnId = "";
    } else {
      logTurn("session", "error", normalized);
    }
    store.publish({ phase: "error", voiceState: "Error", activeTurnId: "", error: normalized });
    scheduleRecovery();
  };
  const clearSetupTimer = () => {
    clearTimer(setupTimer);
    setupTimer = null;
  };
  const appendMessage = (role, content, status = "complete") => {
    const text = String(content || "").trim();
    if (!text) return;
    const current = store.getSnapshot().messages;
    const last = current.at(-1);
    if (last?.role === role && last.content === text) return;
    const messages = [...current, {
        id: nextMessageId(role),
        role,
        content: text,
        createdAt: nowFn(),
        status,
      }].slice(-24);
    store.publish({ messages });
    api?.saveChat?.(messages).catch?.(() => {});
  };
  const receivePartialTranscript = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    const turnId = ensureActiveTurn({ speechDetected: true });
    const turn = findTurn(turnId);
    if (turn?.messageSent) return;
    if (turn?.transcriptPartial === text) return;
    updateTurn(turnId, { transcriptPartial: text, status: "partial", error: "" });
    store.publish({
      phase: "transcribing",
      voiceState: "Transcribing",
      activeTurnId: turnId,
      transcriptPartial: text,
      error: "",
    });
    logTurn(turnId, "transcriptPartial", text);
  };
  const receiveFinalTranscript = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    const turnId = ensureActiveTurn({ speechDetected: true });
    const turn = findTurn(turnId);
    if (turn?.transcriptFinal !== text) logTurn(turnId, "transcriptFinal", text);
    if (turn?.messageSent) {
      updateTurn(turnId, { transcriptPartial: "", transcriptFinal: text });
      store.publish({ transcript: text, transcriptPartial: "" });
      return;
    }
    updateTurn(turnId, {
      transcriptPartial: "",
      transcriptFinal: text,
      status: "sending",
      error: "",
    });
    store.publish({
      phase: "sending",
      voiceState: "Sending",
      activeTurnId: turnId,
      transcript: text,
      transcriptPartial: "",
      error: "",
    });
    scheduleSendFailure(turnId);
  };
  const attachWebRtcTranscription = (created, currentRun) => {
    detachTranscriptionListener?.();
    detachTranscriptionListener = null;
    const room = created?.connection?.getRoom?.();
    if (!room?.on || !room?.off) return;
    const onTranscription = (segments, participant) => {
      if (currentRun !== runId || sessionKind !== "voice") return;
      if (participant && room.localParticipant && participant.identity !== room.localParticipant.identity) return;
      for (const segment of Array.isArray(segments) ? segments : []) {
        if (segment?.final) receiveFinalTranscript(segment.text);
        else receivePartialTranscript(segment?.text);
      }
    };
    room.on("transcriptionReceived", onTranscription);
    detachTranscriptionListener = () => room.off("transcriptionReceived", onTranscription);
  };
  const stopCaptionTranscriber = () => {
    const current = captionTranscriber;
    captionTranscriber = null;
    try {
      current?.stop?.();
    } catch {
      // Caption transcription is auxiliary; the ElevenAgents session owns the primary audio lifecycle.
    }
  };
  const cloneSessionMicrophone = (created) => {
    const room = created?.connection?.getRoom?.();
    const publications = room?.localParticipant?.audioTrackPublications;
    const publication = publications?.values?.().next?.().value
      || (publications ? [...publications][0]?.[1] : null);
    const track = publication?.track?.mediaStreamTrack;
    if (!track?.clone || typeof MediaStream === "undefined") return null;
    return new MediaStream([track.clone()]);
  };
  const startCaptionTranscriber = async ({ token, created, inputDeviceId, currentRun }) => {
    if (!token || currentRun !== runId || sessionKind !== "voice") return;
    stopCaptionTranscriber();
    const sourceStream = cloneSessionMicrophone(created);
    if (!sourceStream) {
      const message = "无法复用当前麦克风轨道，实时字幕未启动。";
      logTurn("session", "error", message);
      store.publish({ error: message });
      return;
    }
    const transcriber = createCaptionTranscriber({
      token,
      deviceId: inputDeviceId,
      sourceStream,
      onPartial: receivePartialTranscript,
      onCommitted: receiveFinalTranscript,
      onStatus: (status) => {
        if (currentRun !== runId || status !== "listening") return;
        if (["connecting", "completed"].includes(store.getSnapshot().phase)) {
          store.publish({ phase: "listening", voiceState: "Listening" });
        }
      },
      onError: (message) => {
        if (currentRun !== runId) return;
        const normalized = normalizeConversationClientError(message);
        logTurn(activeTurnId || "session", "error", normalized);
        store.publish({ error: `实时字幕暂时不可用：${normalized}` });
      },
    });
    captionTranscriber = transcriber;
    try {
      await transcriber.start();
      if (["speaking", "paused"].includes(store.getSnapshot().phase)) transcriber.setMuted?.(true);
    } catch (error) {
      if (captionTranscriber === transcriber) captionTranscriber = null;
      if (currentRun === runId) {
        const normalized = normalizeConversationClientError(error);
        logTurn(activeTurnId || "session", "error", normalized);
        store.publish({ error: `实时字幕暂时不可用：${normalized}` });
      }
    }
  };
  const setBackendStatus = (status) => {
    const configured = Boolean(status?.configured);
    store.publish({
      configured,
      error: configured ? "" : (status?.issues?.[0]?.message || store.getSnapshot().error),
    });
    return configured;
  };
  const refreshBackendStatus = async () => {
    if (!api?.getConversationBackendStatus) return false;
    return setBackendStatus(await api.getConversationBackendStatus());
  };
  const cancelPendingCredential = () => {
    if (!pendingRequestId) return;
    const requestId = pendingRequestId;
    pendingRequestId = "";
    api?.cancelConversationRequest?.({ requestId }).catch?.(() => {});
  };
  const closeCurrentSession = async ({ reset = false, preserveSetupTimer = false } = {}) => {
    runId += 1;
    stopStandaloneOutput();
    clearTimer(completionTimer);
    completionTimer = null;
    clearTimer(recoveryTimer);
    recoveryTimer = null;
    sendTimers.forEach((timer) => clearTimer(timer));
    sendTimers.clear();
    stopCaptionTranscriber();
    detachTranscriptionListener?.();
    detachTranscriptionListener = null;
    activeTurnId = "";
    vadActive = false;
    if (!preserveSetupTimer) clearSetupTimer();
    cancelPendingCredential();
    const current = session;
    session = null;
    sessionKind = null;
    if (current?.endSession) {
      try {
        await current.endSession();
      } catch {
        // The local UI is already closed; remote disconnect errors are non-actionable here.
      }
    }
    if (reset) store.publish({
      phase: "idle",
      voiceState: "Idle",
      voiceTurns: [],
      activeTurnId: "",
      transcript: "",
      transcriptPartial: "",
      reply: "",
      error: "",
    });
  };

  const speakStandaloneReply = async ({ text, turnId, currentRun }) => {
    const outputRun = ++standaloneOutputRun;
    standaloneOutputPending = true;
    captionTranscriber?.setMuted?.(true);
    await Promise.resolve(session?.setMicMuted?.(true)).catch(() => {});
    try {
      store.publish({ reply: text, phase: "thinking", voiceState: "Thinking", error: "" });
      const audio = await api.synthesize({
        text,
        voiceId: voicePreferences.voiceId,
        modelId: ELEVEN_V3_MODEL_ID,
      });
      if (currentRun !== runId || outputRun !== standaloneOutputRun || sessionKind !== "voice") return;
      if (turnId) updateTurn(turnId, { status: "speaking", responseStarted: true });
      store.publish({ phase: "speaking", voiceState: "Speaking" });
      await playAudioBytes(audio);
      if (currentRun !== runId || outputRun !== standaloneOutputRun || sessionKind !== "voice") return;
      if (turnId) {
        updateTurn(turnId, { status: "complete", responseCompleted: true });
        logTurn(turnId, "responseCompleted");
        logTurn(turnId, "listeningRestarted");
      }
      activeTurnId = "";
      standaloneOutputPending = false;
      await Promise.resolve(session?.setMicMuted?.(false)).catch(() => {});
      captionTranscriber?.setMuted?.(false);
      store.publish({ phase: "completed", voiceState: "Listening", activeTurnId: "" });
      clearTimer(completionTimer);
      completionTimer = setTimer(() => {
        if (currentRun === runId && sessionKind === "voice" && !standaloneOutputPending) {
          store.publish({ phase: "listening", voiceState: "Listening", reply: "" });
        }
      }, 320);
    } catch (error) {
      if (currentRun === runId && outputRun === standaloneOutputRun) {
        standaloneOutputPending = false;
        publishError(error);
      }
    }
  };

  const sessionCallbacks = (currentRun, kind) => ({
    onConnect: () => {
      if (currentRun !== runId) return;
      clearSetupTimer();
      store.publish({
        phase: kind === "voice" ? "listening" : store.getSnapshot().phase,
        voiceState: kind === "voice" ? "Listening" : store.getSnapshot().voiceState,
        error: "",
      });
    },
    onMessage: ({ message, role, source }) => {
      if (currentRun !== runId) return;
      const normalizedRole = role === "agent" || source === "ai" ? "assistant" : "user";
      const rawText = String(message || "").trim();
      const text = normalizedRole === "assistant" ? sanitizeAgentReply(rawText) : rawText;
      if (!text) return;
      appendMessage(normalizedRole, text);
      if (normalizedRole === "user") {
        let turnId = activeTurnId;
        if (!turnId || !findTurn(turnId)) turnId = ensureActiveTurn({ speechDetected: true });
        const turn = findTurn(turnId);
        if (!turn?.transcriptFinal) receiveFinalTranscript(text);
        clearSendTimer(turnId);
        updateTurn(turnId, {
          transcriptPartial: "",
          transcriptFinal: text,
          status: "thinking",
          messageSent: true,
          error: "",
        });
        logTurn(turnId, "messageSent", text);
        store.publish({
          transcript: text,
          transcriptPartial: "",
          phase: "thinking",
          voiceState: "Thinking",
          activeTurnId: turnId,
          error: "",
        });
      } else {
        const turnId = activeTurnId || [...store.getSnapshot().voiceTurns].reverse()
          .find((turn) => turn.messageSent && !turn.responseCompleted)?.turnId;
        if (turnId) {
          const turn = findTurn(turnId);
          if (!turn?.responseStarted) logTurn(turnId, "responseStarted");
          updateTurn(turnId, { status: usesStandaloneV3() ? "thinking" : "speaking", responseStarted: true });
          activeTurnId = turnId;
        }
        if (kind === "voice" && usesStandaloneV3()) {
          if (!voicePreferences.voiceId) {
            publishError("标准 Eleven v3 需要先选择一个 ElevenLabs 音色。");
            return;
          }
          void speakStandaloneReply({ text, turnId, currentRun });
          return;
        }
        store.publish({
          reply: text,
          phase: kind === "voice" ? "speaking" : "completed",
          voiceState: kind === "voice" ? "Speaking" : store.getSnapshot().voiceState,
          activeTurnId: turnId || store.getSnapshot().activeTurnId,
          error: "",
        });
      }
    },
    onModeChange: ({ mode }) => {
      if (currentRun !== runId || kind !== "voice") return;
      clearTimer(completionTimer);
      if (usesStandaloneV3()) {
        if (mode === "speaking" || standaloneOutputPending) {
          vadActive = false;
          captionTranscriber?.setMuted?.(true);
          Promise.resolve(session?.setMicMuted?.(true)).catch((error) => publishError(error.message));
          if (!standaloneOutputPending) store.publish({ phase: "thinking", voiceState: "Thinking" });
          return;
        }
        Promise.resolve(session?.setMicMuted?.(false)).catch((error) => publishError(error.message));
        captionTranscriber?.setMuted?.(false);
        if (!["transcribing", "sending", "thinking", "paused", "error"].includes(store.getSnapshot().phase)) {
          store.publish({ phase: "listening", voiceState: "Listening" });
        }
        return;
      }
      if (mode === "speaking") {
        vadActive = false;
        captionTranscriber?.setMuted?.(true);
        Promise.resolve(session?.setMicMuted?.(true)).catch((error) => publishError(error.message));
        const turnId = activeTurnId;
        if (turnId) {
          const turn = findTurn(turnId);
          if (!turn?.responseStarted) logTurn(turnId, "responseStarted");
          updateTurn(turnId, { status: "speaking", responseStarted: true });
        }
        store.publish({ phase: "speaking", voiceState: "Speaking" });
        return;
      }
      Promise.resolve(session?.setMicMuted?.(false)).catch((error) => publishError(error.message));
      captionTranscriber?.setMuted?.(false);
      vadActive = false;
      const snapshot = store.getSnapshot();
      if (snapshot.phase === "speaking") {
        const completedTurnId = activeTurnId;
        if (completedTurnId) {
          updateTurn(completedTurnId, { status: "complete", responseCompleted: true });
          logTurn(completedTurnId, "responseCompleted");
          logTurn(completedTurnId, "listeningRestarted");
        }
        activeTurnId = "";
        store.publish({ phase: "completed", voiceState: "Listening", activeTurnId: "" });
        completionTimer = setTimer(() => {
          const latest = store.getSnapshot();
          if (currentRun === runId
            && sessionKind === "voice"
            && latest.phase === "completed"
            && !latest.activeTurnId) {
            store.publish({ phase: "listening", voiceState: "Listening", reply: "" });
          }
        }, 320);
      } else if (!["transcribing", "sending", "thinking", "paused", "error"].includes(snapshot.phase)) {
        store.publish({ phase: "listening", voiceState: "Listening" });
      }
    },
    onVadScore: ({ vadScore }) => {
      if (currentRun !== runId || kind !== "voice") return;
      const speechNow = Number(vadScore) >= 0.35;
      if (speechNow && !vadActive && !["speaking", "paused", "error"].includes(store.getSnapshot().phase)) {
        ensureActiveTurn({ speechDetected: true });
      }
      vadActive = speechNow;
    },
    onError: (message) => {
      if (currentRun === runId) {
        clearSetupTimer();
        publishError(message);
      }
    },
    onDisconnect: (details) => {
      if (currentRun !== runId) return;
      clearSetupTimer();
      detachTranscriptionListener?.();
      detachTranscriptionListener = null;
      stopCaptionTranscriber();
      sendTimers.forEach((timer) => clearTimer(timer));
      sendTimers.clear();
      session = null;
      sessionKind = null;
      if (details?.reason === "error") publishError(details.message);
      else {
        activeTurnId = "";
        if (store.getSnapshot().phase !== "error") store.publish({ phase: "idle", voiceState: "Idle", activeTurnId: "" });
      }
    },
  });

  const openSession = async (kind, inputDeviceId = "") => {
    if (session && sessionKind === kind) return session;
    await closeCurrentSession({ preserveSetupTimer: true });
    const currentRun = ++runId;
    let statusReady = await refreshBackendStatus();
    if (currentRun !== runId) return null;
    if (!statusReady && api?.configureElevenAgent) {
      const configuration = await api.configureElevenAgent();
      if (!configuration?.ok) throw new Error(safeBackendMessage(configuration, "无法自动配置 ElevenAgent。"));
      statusReady = await refreshBackendStatus();
    }
    if (currentRun !== runId) return null;
    if (!statusReady) throw new Error(store.getSnapshot().error || "ElevenAgents 尚未配置完成。");
    const captionTokenPromise = kind === "voice" && api?.getScribeToken
      ? Promise.resolve(api.getScribeToken()).catch((error) => {
          logTurn("session", "error", normalizeConversationClientError(error));
          return "";
        })
      : Promise.resolve("");
    const connectionType = "webrtc";
    const requestId = `${kind}-${nowFn()}-${messageSequence += 1}`;
    pendingRequestId = requestId;
    const credentialResult = await api.createConversationCredential({ requestId });
    if (pendingRequestId === requestId) pendingRequestId = "";
    if (currentRun !== runId) return null;
    if (!credentialResult?.ok) throw new Error(safeBackendMessage(credentialResult, "无法创建 ElevenAgents 会话凭证。"));

    const credential = credentialResult.value || {};
    const options = {
      ...sessionCallbacks(currentRun, kind),
      connectionType,
      textOnly: false,
      conversationToken: credential.conversationToken,
      ...(String(inputDeviceId || "").trim() ? { inputDeviceId: String(inputDeviceId).trim() } : {}),
    };
    const client = conversationClient || await loadConversationClient();
    if (currentRun !== runId) return null;
    const created = await client.startSession(options);
    if (currentRun !== runId) {
      await created?.endSession?.();
      return null;
    }
    session = created;
    sessionKind = kind;
    if (kind === "voice") {
      await Promise.resolve(created?.setVolume?.({ volume: usesStandaloneV3() ? 0 : 1 }));
    }
    if (kind === "voice") {
      attachWebRtcTranscription(created, currentRun);
      void captionTokenPromise.then((captionToken) => {
        if (currentRun === runId) return startCaptionTranscriber({
          token: captionToken,
          created,
          inputDeviceId,
          currentRun,
        });
        return undefined;
      });
    }
    return created;
  };

  const startVoice = (inputDeviceId = "", preferences = voicePreferences) => {
    lastInputDeviceId = String(inputDeviceId || "").trim();
    voicePreferences = {
      voiceId: String(preferences?.voiceId || voicePreferences.voiceId || "").trim(),
      ttsModelId: isSupportedElevenTtsModel(preferences?.ttsModelId)
        ? preferences.ttsModelId
        : ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
    };
    store.publish({
      phase: "connecting",
      voiceState: "Idle",
      voiceTurns: [],
      activeTurnId: "",
      transcript: "",
      transcriptPartial: "",
      reply: "",
      error: "",
    });
    clearSetupTimer();
    setupTimer = setTimer(() => {
      if (store.getSnapshot().phase !== "connecting") return;
      runId += 1;
      cancelPendingCredential();
      const current = session;
      session = null;
      sessionKind = null;
      Promise.resolve(current?.endSession?.()).catch(() => {});
      publishError("ElevenAgents 连接超时，请检查网络和麦克风后重试。");
    }, setupTimeoutMs);
    openSession("voice", lastInputDeviceId).catch((error) => {
      clearSetupTimer();
      if (store.getSnapshot().phase !== "error") publishError(error.message);
    });
  };
  const sendText = (content) => {
    const text = String(content || "").trim();
    if (!text) return false;
    const currentRun = ++runId;
    appendMessage("user", text);
    const replyId = nextMessageId("assistant");
    const pendingReply = { id: replyId, role: "assistant", content: "", createdAt: nowFn(), status: "streaming" };
    const messages = [...store.getSnapshot().messages, pendingReply].slice(-24);
    store.publish({ messages, phase: "thinking", transcript: text, reply: "", error: "" });
    let streamed = "";
    const updateReply = (contentValue, status) => {
      const nextMessages = store.getSnapshot().messages.map((message) => message.id === replyId
        ? { ...message, content: contentValue, status }
        : message);
      store.publish({ messages: nextMessages, reply: contentValue, phase: status === "complete" ? "completed" : "thinking" });
      if (status === "complete") api?.saveChat?.(nextMessages).catch?.(() => {});
    };
    const requestMessages = messages.filter((message) => message.id !== replyId).map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    Promise.resolve(api?.streamReply?.({ messages: requestMessages }, (delta) => {
      if (currentRun !== runId) return;
      streamed += String(delta || "");
      updateReply(streamed, "streaming");
    })).then((result) => {
      if (currentRun !== runId) return;
      const finalReply = streamed || String(result || "");
      updateReply(finalReply, "complete");
    }).catch((error) => {
      if (currentRun === runId) publishError(error.message);
    });
    return true;
  };
  const retryVoiceTurn = (turnId) => {
    const turn = findTurn(String(turnId || ""));
    if (!turn?.transcriptFinal || turn.status !== "send_failed" || sessionKind !== "voice" || !session?.sendUserMessage) return false;
    activeTurnId = turn.turnId;
    updateTurn(turn.turnId, { status: "thinking", messageSent: true, error: "" });
    store.publish({
      activeTurnId: turn.turnId,
      phase: "thinking",
      voiceState: "Thinking",
      transcript: turn.transcriptFinal,
      error: "",
    });
    try {
      session.sendUserMessage(turn.transcriptFinal);
      logTurn(turn.turnId, "messageSent", { retry: true });
      appendMessage("user", turn.transcriptFinal);
      return true;
    } catch {
      markSendFailed(turn.turnId, "发送失败，可重试");
      return false;
    }
  };

  refreshBackendStatus().catch(() => setBackendStatus({ configured: false }));

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    setBackendStatus,
    hydrate(messages) {
      if (!Array.isArray(messages)) return;
      store.publish({
        messages: messages.slice(-24).map((message) => ({ ...message, status: message.status || "complete" })),
      });
    },
    sendText,
    retryVoiceTurn,
    startVoice,
    pauseVoice() {
      if (store.getSnapshot().phase === "connecting") {
        closeCurrentSession();
        store.publish({ phase: "paused", voiceState: "Idle", error: "" });
        return;
      }
      if (sessionKind !== "voice" || !session) return;
      if (usesStandaloneV3()) stopStandaloneOutput();
      captionTranscriber?.setMuted?.(true);
      Promise.resolve(session.setMicMuted?.(true)).catch((error) => publishError(error.message));
      store.publish({ phase: "paused", voiceState: "Idle" });
    },
    resumeVoice() {
      if (sessionKind !== "voice" || !session) {
        startVoice(lastInputDeviceId);
        return;
      }
      captionTranscriber?.setMuted?.(false);
      Promise.resolve(session.setMicMuted?.(false)).catch((error) => publishError(error.message));
      store.publish({ phase: "listening", voiceState: "Listening", error: "" });
    },
    endVoice() {
      closeCurrentSession({ reset: true });
    },
    closeSurface() {
      closeCurrentSession({ reset: true });
    },
    dispose() {
      closeCurrentSession();
      store.clear();
    },
  };
}

export function resolveConversationAdapter({ isDesktop = false, injected, runtimeApi } = {}) {
  if (injected?.subscribe) return injected;
  if (window.kanojoConversation?.subscribe) return window.kanojoConversation;
  return isDesktop && runtimeApi?.createConversationCredential
    ? createElevenAgentsConversationAdapter({ api: runtimeApi })
    : isDesktop ? createUnavailableConversationAdapter() : createPreviewConversationAdapter();
}
