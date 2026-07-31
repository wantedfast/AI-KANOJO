export const STATE_META = {
  idle: { label: "休眠", hint: "点击照月开始对话", src: "./avatar/8bit/states/idle.png", animation: "sleep-breathe", seatAnchor: 1 },
  listening: { label: "正在听", hint: "请继续，我在听", src: "./avatar/8bit/states/listening.png", animation: "listen-pulse", seatAnchor: 0.55 },
  thinking: { label: "正在想", hint: "让我想一想……", src: "./avatar/8bit/states/thinking.png", animation: "thinking-flicker", seatAnchor: 0.58 },
  speaking: { label: "正在说", hint: "正在用 Eleven v3 回答", src: "./avatar/8bit/states/listening.png", animation: "speech-bob", seatAnchor: 0.55 },
  completed: { label: "完成", hint: "很高兴和你聊天", src: "./avatar/8bit/states/completed.png", animation: "happy-bounce", seatAnchor: 0.57 },
  error: { label: "需要注意", hint: "连接遇到问题", src: "./avatar/8bit/states/thinking.png", animation: "error-shake", seatAnchor: 0.58 },
};

const validStates = new Set(Object.keys(STATE_META));
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function createCompanionController({ completedDelay = 5000 } = {}) {
  let snapshot = {
    state: "idle",
    partial: "",
    draftReply: "",
    messages: [],
    error: "",
  };
  let completedTimer;
  const listeners = new Set();
  const transcriptIds = new Set();

  const emit = (patch = {}) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener({ ...snapshot }));
  };
  const setState = (state, patch = {}) => {
    if (!validStates.has(state)) throw new Error(`Unknown companion state: ${state}`);
    clearTimeout(completedTimer);
    emit({ state, error: "", ...patch });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...snapshot });
      return () => listeners.delete(listener);
    },
    getSnapshot: () => ({ ...snapshot, messages: [...snapshot.messages] }),
    hydrate(messages = []) {
      emit({ messages: Array.isArray(messages) ? messages : [] });
    },
    startListening() {
      setState("listening", { partial: "", draftReply: "" });
    },
    stopListening() {
      setState("idle", { partial: "" });
    },
    setPartial(partial) {
      if (snapshot.state === "listening") emit({ partial });
    },
    acceptTranscript(id) {
      if (!id || transcriptIds.has(id)) return false;
      transcriptIds.add(id);
      return true;
    },
    commitUser(content) {
      const text = content?.trim();
      if (!text) return null;
      const message = { id: uid(), role: "user", content: text, createdAt: Date.now() };
      setState("thinking", { partial: "", messages: [...snapshot.messages, message], draftReply: "" });
      return message;
    },
    beginThinking() {
      setState("thinking");
    },
    appendReply(delta) {
      if (!delta) return;
      if (snapshot.state === "thinking") setState("speaking");
      emit({ draftReply: snapshot.draftReply + delta });
    },
    beginSpeaking() {
      setState("speaking");
    },
    finishReply() {
      const text = snapshot.draftReply.trim();
      const messages = text
        ? [...snapshot.messages, { id: uid(), role: "assistant", content: text, createdAt: Date.now() }]
        : snapshot.messages;
      setState("completed", { messages, draftReply: "" });
      completedTimer = setTimeout(() => setState("idle"), completedDelay);
    },
    interrupt() {
      const text = snapshot.draftReply.trim();
      const messages = text
        ? [...snapshot.messages, { id: uid(), role: "assistant", content: text, createdAt: Date.now(), interrupted: true }]
        : snapshot.messages;
      setState("listening", { messages, draftReply: "", partial: "" });
    },
    endSession() {
      setState("idle", { partial: "", draftReply: "" });
    },
    fail(error) {
      setState("error", { error: String(error || "未知错误") });
    },
    clearChat() {
      setState("idle", { messages: [], draftReply: "", partial: "" });
    },
  };
}
