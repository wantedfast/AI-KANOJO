const now = () => Date.now();

export const EMPTY_CONVERSATION_SNAPSHOT = Object.freeze({
  configured: true,
  messages: [],
  phase: "idle",
  transcript: "",
  reply: "",
  error: "",
});

function normalizeSnapshot(snapshot = {}) {
  return {
    ...EMPTY_CONVERSATION_SNAPSHOT,
    ...snapshot,
    messages: Array.isArray(snapshot.messages) ? snapshot.messages.slice(-24) : [],
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

export function createElevenAgentsConversationAdapter({
  api,
  conversationClient,
  loadConversationClient = () => import("@elevenlabs/client").then(({ Conversation }) => Conversation),
  nowFn = now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setupTimeoutMs = 15000,
} = {}) {
  const store = createStore({ configured: false });
  let session = null;
  let sessionKind = null;
  let pendingRequestId = "";
  let runId = 0;
  let messageSequence = 0;
  let completionTimer = null;
  let setupTimer = null;
  let lastInputDeviceId = "";

  const nextMessageId = (role) => `${role}-${nowFn()}-${messageSequence += 1}`;
  const publishError = (message) => store.publish({
    phase: "error",
    error: normalizeConversationClientError(message),
  });
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
    clearTimer(completionTimer);
    completionTimer = null;
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
    if (reset) store.publish({ phase: "idle", transcript: "", reply: "", error: "" });
  };

  const sessionCallbacks = (currentRun, kind) => ({
    onConnect: () => {
      if (currentRun !== runId) return;
      clearSetupTimer();
      store.publish({ phase: kind === "voice" ? "listening" : store.getSnapshot().phase, error: "" });
    },
    onMessage: ({ message, role, source }) => {
      if (currentRun !== runId) return;
      const normalizedRole = role === "agent" || source === "ai" ? "assistant" : "user";
      const text = String(message || "").trim();
      if (!text) return;
      appendMessage(normalizedRole, text);
      if (normalizedRole === "user") {
        store.publish({ transcript: text, phase: "thinking", error: "" });
      } else {
        store.publish({ reply: text, phase: kind === "voice" ? "speaking" : "completed", error: "" });
      }
    },
    onModeChange: ({ mode }) => {
      if (currentRun !== runId || kind !== "voice") return;
      clearTimer(completionTimer);
      if (mode === "speaking") {
        store.publish({ phase: "speaking" });
        return;
      }
      if (store.getSnapshot().phase === "speaking") {
        store.publish({ phase: "completed" });
        completionTimer = setTimer(() => {
          if (currentRun === runId && sessionKind === "voice") {
            store.publish({ phase: "listening", transcript: "", reply: "" });
          }
        }, 320);
      } else {
        store.publish({ phase: "listening" });
      }
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
      session = null;
      sessionKind = null;
      if (details?.reason === "error") publishError(details.message);
      else if (store.getSnapshot().phase !== "error") store.publish({ phase: "idle" });
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
    return created;
  };

  const startVoice = (inputDeviceId = "") => {
    lastInputDeviceId = String(inputDeviceId || "").trim();
    store.publish({ phase: "connecting", transcript: "", reply: "", error: "" });
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
    startVoice,
    pauseVoice() {
      if (store.getSnapshot().phase === "connecting") {
        closeCurrentSession();
        store.publish({ phase: "paused", error: "" });
        return;
      }
      if (sessionKind !== "voice" || !session) return;
      Promise.resolve(session.setMicMuted?.(true)).catch((error) => publishError(error.message));
      store.publish({ phase: "paused" });
    },
    resumeVoice() {
      if (sessionKind !== "voice" || !session) {
        startVoice(lastInputDeviceId);
        return;
      }
      Promise.resolve(session.setMicMuted?.(false)).catch((error) => publishError(error.message));
      store.publish({ phase: "listening", error: "" });
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
