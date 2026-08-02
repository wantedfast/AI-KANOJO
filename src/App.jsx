import { useEffect, useMemo, useRef, useState } from "react";
import {
  Microphone,
  MusicNotes,
  ChatCircleDots,
  ArrowsOutSimple,
} from "@phosphor-icons/react";
import { createCompanionController, STATE_META } from "./companion-controller.js";
import { RealtimeScribe } from "./realtime-scribe.js";
import { EMPTY_CONVERSATION_SNAPSHOT, resolveConversationAdapter } from "./conversation-adapter.js";
import { TextChatPanel, VoiceConversationPopover } from "./conversation-surfaces.jsx";

const api = window.kanojo ?? {
  isDesktop: false,
  getBootstrap: async () => ({
    settings: { demoMode: true, voiceId: "", microphoneId: "" },
    chat: [],
    credentials: { deepseek: false, elevenlabs: false },
    locked: false,
  }),
  saveSettings: async (settings) => settings,
  saveChat: async () => true,
  saveCredentials: async () => ({ deepseek: false, elevenlabs: false }),
  getScribeToken: async () => { throw new Error("桌面应用中才能连接 Scribe"); },
  streamReply: async () => { throw new Error("桌面应用中才能连接 DeepSeek"); },
  synthesize: async () => { throw new Error("桌面应用中才能连接 Eleven v3"); },
  listVoices: async () => ({ ok: true, value: [] }),
  setLocked: async (locked) => locked,
  startWindowDrag: () => {},
  moveWindowDrag: () => {},
  endWindowDrag: () => {},
  quitApp: () => {},
  onAudioStop: () => () => {},
  onLockedChanged: () => () => {},
  onOpenSettings: () => () => {},
};

const DEMO_PARTIAL = "今天也想和你聊";
const DEMO_FINAL = "今天也想和你聊一会儿。";

function IconFeatureButton({ id, className = "", onClick, icon, label }) {
  return (
    <button
      type="button"
      className={`icon-feature-button feature-${id} ${className}`}
      onClick={onClick}
      aria-label={label}
    >
      {icon}
      <span className="icon-tooltip" aria-hidden="true">{label}</span>
    </button>
  );
}

function CodexStatus({ working }) {
  return (
    <div className={`codex-status ${working ? "is-working" : "is-standby"}`} aria-label={working ? "Codex Working" : "Codex Standby"}>
      <span className="codex-identity"><i /><strong>Codex</strong></span>
      <span className="codex-mode">{working ? "Working" : "Ready"}</span>
      <span className="codex-meter" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
      </span>
    </div>
  );
}

function SleepIndicator() {
  return (
    <span className="sleep-indicator" aria-hidden="true">
      <i>Z</i><i>Z</i><i>Z</i>
    </span>
  );
}

export function App({ runtimeApi = api, conversationAdapter, ScribeClient = RealtimeScribe, audioFactory = (url) => new Audio(url) } = {}) {
  const api = runtimeApi;
  const controller = useMemo(() => createCompanionController(), []);
  const [frontendPreviewMode, setFrontendPreviewMode] = useState(!api.isDesktop);
  const conversation = useMemo(
    () => resolveConversationAdapter({
      isDesktop: api.isDesktop && !frontendPreviewMode,
      injected: conversationAdapter,
      runtimeApi: api,
    }),
    [api.isDesktop, conversationAdapter, frontendPreviewMode],
  );
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());
  const [conversationSnapshot, setConversationSnapshot] = useState(() => conversation.getSnapshot?.() ?? EMPTY_CONVERSATION_SNAPSHOT);
  const [conversationSurface, setConversationSurface] = useState("none");
  const [activeSession, setActiveSession] = useState(false);
  const [paused, setPaused] = useState(false);
  const [panel, setPanel] = useState("compact");
  const [settings, setSettings] = useState({ demoMode: !api.isDesktop, voiceId: "", microphoneId: "" });
  const [credentials, setCredentials] = useState({ deepseek: false, elevenlabs: false });
  const [microphones, setMicrophones] = useState([]);
  const [voices, setVoices] = useState([]);
  const [voiceCatalogState, setVoiceCatalogState] = useState("idle");
  const [voiceCatalogError, setVoiceCatalogError] = useState("");
  const [locked, setLocked] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [featureNotice, setFeatureNotice] = useState("");
  const scribeRef = useRef(null);
  const demoTimers = useRef([]);
  const audioRef = useRef(null);
  const featureNoticeTimer = useRef(null);
  const dragPointer = useRef(null);
  const sessionActiveRef = useRef(false);
  const pausedRef = useRef(false);
  const conversationRunRef = useRef(0);
  const listeningRunRef = useRef(0);
  const continuousTimerRef = useRef(null);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  useEffect(() => {
    const unsubscribe = conversation.subscribe(setConversationSnapshot);
    return () => {
      unsubscribe?.();
      if (!conversationAdapter && conversation !== window.kanojoConversation) conversation.dispose?.();
    };
  }, [conversation, conversationAdapter]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== "Escape" || conversationSurface === "none") return;
      conversation.closeSurface?.(conversationSurface);
      setConversationSurface("none");
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [conversation, conversationSurface]);

  const refreshMicrophones = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicrophones([]);
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMicrophones(devices.filter((device) => device.kind === "audioinput"));
  };

  const refreshVoices = async () => {
    setVoiceCatalogState("loading");
    setVoiceCatalogError("");
    try {
      const result = await api.listVoices?.();
      if (!result?.ok) throw new Error(result?.error?.message || "无法读取 ElevenLabs 音色");
      setVoices(Array.isArray(result.value) ? result.value : []);
      setVoiceCatalogState("ready");
    } catch (error) {
      setVoices([]);
      setVoiceCatalogState("error");
      setVoiceCatalogError(error.message || "无法读取 ElevenLabs 音色");
    }
  };

  useEffect(() => {
    let mounted = true;
    api.getBootstrap().then((data) => {
      if (!mounted) return;
      setFrontendPreviewMode(!api.isDesktop || Boolean(data.smokeMode));
      setSettings((current) => ({ ...current, ...data.settings, demoMode: !api.isDesktop || Boolean(data.smokeMode) }));
      setCredentials(data.credentials);
      conversation.setBackendStatus?.(data.conversationBackend);
      conversation.hydrate?.(data.chat);
      setLocked(Boolean(data.locked));
      controller.hydrate(data.chat);
    }).catch((error) => controller.fail(error.message));
    const unsubscribe = api.onOpenSettings?.(() => setPanel("settings"));
    const unsubscribeLocked = api.onLockedChanged?.(setLocked);
    const handleDeviceChange = () => refreshMicrophones().catch(() => setMicrophones([]));
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    handleDeviceChange();
    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeLocked?.();
      demoTimers.current.forEach(clearTimeout);
      scribeRef.current?.stop();
      audioRef.current?.pause();
      clearTimeout(featureNoticeTimer.current);
      clearTimeout(continuousTimerRef.current);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [controller, conversation]);

  useEffect(() => {
    if (panel === "settings") refreshMicrophones().catch(() => setMicrophones([]));
    if (panel === "settings") refreshVoices();
    if (panel === "settings" && conversationSurface !== "none") {
      conversation.closeSurface?.(conversationSurface);
      setConversationSurface("none");
    }
  }, [conversation, conversationSurface, panel]);

  const clearDemoTimers = () => {
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
  };

  const playAudio = async (arrayBuffer) => {
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = audioFactory(url);
    audioRef.current = audio;
    await audio.play();
    await new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      audio.onended = settle;
      audio.onerror = settle;
      audio.onpause = settle;
    });
    URL.revokeObjectURL(url);
    audioRef.current = null;
  };

  const runReply = async (text) => {
    const runId = ++conversationRunRef.current;
    const userMessage = controller.commitUser(text);
    if (!userMessage) return;
    await api.saveChat(controller.getSnapshot().messages);
    if (settings.demoMode) {
      controller.beginThinking();
      const chunks = ["当然可以。", "我一直都在。", "今天过得怎么样？"];
      const chunkDelays = [200, 1200, 2400];
      chunks.forEach((chunk, index) => {
        demoTimers.current.push(setTimeout(() => {
          if (index === 0) controller.beginSpeaking();
          controller.appendReply(chunk);
          if (index === chunks.length - 1) {
            controller.finishReply();
            api.saveChat(controller.getSnapshot().messages);
          }
        }, chunkDelays[index]));
      });
      return;
    }
    try {
      controller.beginThinking();
      await api.streamReply({
        messages: controller.getSnapshot().messages.map(({ role, content }) => ({ role, content })),
      }, (delta) => controller.appendReply(delta));
      if (runId !== conversationRunRef.current) return;
      const spokenText = controller.getSnapshot().draftReply;
      if (!spokenText.trim()) throw new Error("DeepSeek 未返回可朗读的回复");
      const audio = await api.synthesize({ text: spokenText, voiceId: settings.voiceId });
      if (runId !== conversationRunRef.current) return;
      controller.beginSpeaking();
      await playAudio(audio);
      if (runId !== conversationRunRef.current) return;
      controller.finishReply();
      await api.saveChat(controller.getSnapshot().messages);
      clearTimeout(continuousTimerRef.current);
      continuousTimerRef.current = setTimeout(() => {
        if (sessionActiveRef.current && !pausedRef.current) beginListening();
      }, 450);
    } catch (error) {
      if (runId === conversationRunRef.current && sessionActiveRef.current) controller.fail(error.message);
    }
  };

  const startDemoListening = () => {
    clearDemoTimers();
    setPaused(false);
    controller.startListening();
    demoTimers.current.push(setTimeout(() => controller.setPartial(DEMO_PARTIAL), 550));
    demoTimers.current.push(setTimeout(() => {
      controller.setPartial("");
      runReply(DEMO_FINAL);
    }, 1500));
  };

  const startRealListening = async () => {
    const listeningId = ++listeningRunRef.current;
    try {
      setPaused(false);
      pausedRef.current = false;
      controller.startListening();
      const token = await api.getScribeToken();
      if (listeningId !== listeningRunRef.current || !sessionActiveRef.current || pausedRef.current) return;
      const scribe = new ScribeClient({
        token,
        deviceId: settings.microphoneId,
        onPartial: (text) => controller.setPartial(text),
        onCommitted: (text, id) => {
          if (!controller.acceptTranscript(id)) return;
          listeningRunRef.current += 1;
          scribe.stop();
          scribeRef.current = null;
          runReply(text);
        },
        onError: (message) => {
          scribe.stop();
          scribeRef.current = null;
          if (listeningId !== listeningRunRef.current || !sessionActiveRef.current) return;
          controller.fail(message);
        },
      });
      scribeRef.current = scribe;
      await scribe.start();
    } catch (error) {
      scribeRef.current?.stop();
      scribeRef.current = null;
      if (listeningId !== listeningRunRef.current || !sessionActiveRef.current || pausedRef.current) return;
      controller.fail(error.message);
    }
  };

  const beginListening = () => settings.demoMode ? startDemoListening() : startRealListening();

  const wakeCompanion = () => {
    if (api.isDesktop && !settings.demoMode && (!credentials.deepseek || !credentials.elevenlabs || !settings.voiceId.trim())) {
      setPanel("settings");
      setSaveNote("请先配置两项密钥和 ElevenLabs Voice ID");
      return;
    }
    sessionActiveRef.current = true;
    pausedRef.current = false;
    setActiveSession(true);
    setPanel("compact");
    beginListening();
  };

  const toggleListening = () => {
    if (snapshot.state === "listening" && !paused) {
      clearDemoTimers();
      listeningRunRef.current += 1;
      api.cancelActive?.();
      scribeRef.current?.stop();
      scribeRef.current = null;
      controller.stopListening();
      pausedRef.current = true;
      setPaused(true);
      return;
    }
    if (["idle", "completed"].includes(snapshot.state) || paused) {
      sessionActiveRef.current = true;
      pausedRef.current = false;
      beginListening();
    }
  };

  const stopSpeaking = () => {
    clearDemoTimers();
    clearTimeout(continuousTimerRef.current);
    conversationRunRef.current += 1;
    listeningRunRef.current += 1;
    api.cancelActive?.();
    audioRef.current?.pause();
    audioRef.current = null;
    controller.interrupt();
    api.saveChat(controller.getSnapshot().messages);
    continuousTimerRef.current = setTimeout(() => {
      if (sessionActiveRef.current && !pausedRef.current) beginListening();
    }, 0);
  };

  const endSession = () => {
    clearDemoTimers();
    clearTimeout(continuousTimerRef.current);
    conversationRunRef.current += 1;
    listeningRunRef.current += 1;
    sessionActiveRef.current = false;
    pausedRef.current = false;
    api.cancelActive?.();
    audioRef.current?.pause();
    audioRef.current = null;
    scribeRef.current?.stop();
    scribeRef.current = null;
    controller.endSession();
    setPaused(false);
    setActiveSession(false);
  };

  useEffect(() => api.onAudioStop?.(() => {
    clearDemoTimers();
    clearTimeout(continuousTimerRef.current);
    conversationRunRef.current += 1;
    listeningRunRef.current += 1;
    pausedRef.current = false;
    setPaused(false);
    api.cancelActive?.();
    audioRef.current?.pause();
    audioRef.current = null;
    scribeRef.current?.stop();
    scribeRef.current = null;
    if (controller.getSnapshot().state === "speaking") {
      controller.interrupt();
      api.saveChat(controller.getSnapshot().messages);
    }
    if (conversationSurface === "voice") conversation.resumeVoice?.();
  }), [api, controller, conversation, conversationSurface]);

  const savePreferences = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    setSaveNote("正在校验并应用音色…");
    try {
      const next = await api.saveSettings(settings);
      setSettings((current) => ({ ...current, ...next, demoMode: !api.isDesktop }));
      const ready = !api.isDesktop || (credentials.deepseek && credentials.elevenlabs && next.voiceId);
      setSaveNote(ready ? "音色已应用，可以开始对话" : "仍需填写缺失的配置");
      if (ready) setTimeout(() => setPanel("compact"), 700);
    } catch (error) {
      setSaveNote(error.message || "保存失败");
    } finally {
      setSavingSettings(false);
    }
    setTimeout(() => setSaveNote(""), 1800);
  };

  const startWindowDrag = (event) => {
    const interactiveTarget = event.target instanceof Element
      && event.target.closest("button, input, select, textarea, a, [data-no-window-drag]");
    if (locked || event.button !== 0 || interactiveTarget) return;
    event.preventDefault();
    dragPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    api.startWindowDrag?.({ x: event.screenX, y: event.screenY });
  };

  const moveWindowDrag = (event) => {
    if (dragPointer.current !== event.pointerId) return;
    api.moveWindowDrag?.({ x: event.screenX, y: event.screenY });
  };

  const endWindowDrag = (event) => {
    if (dragPointer.current !== event.pointerId) return;
    dragPointer.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    api.endWindowDrag?.();
  };

  const showFeatureNotice = (message) => {
    clearTimeout(featureNoticeTimer.current);
    setFeatureNotice(message);
    featureNoticeTimer.current = setTimeout(() => setFeatureNotice(""), 2200);
  };

  const handleSingRequest = () => showFeatureNotice("唱歌功能准备中");
  const closeConversationSurface = () => {
    conversation.closeSurface?.(conversationSurface);
    setConversationSurface("none");
  };
  const handleChatRequest = () => {
    if (conversationSurface === "chat") {
      closeConversationSurface();
      return;
    }
    if (conversationSurface === "voice") conversation.endVoice?.();
    setPanel("compact");
    setConversationSurface("chat");
  };
  const handleVoiceRequest = () => {
    setPanel("compact");
    if (conversationSurface !== "voice") {
      conversation.closeSurface?.(conversationSurface);
      setConversationSurface("voice");
      conversation.startVoice?.(settings.microphoneId);
      return;
    }
    if (["paused", "error", "idle"].includes(conversationSnapshot.phase)) conversation.resumeVoice?.();
    else conversation.pauseVoice?.();
  };
  const endVoiceConversation = () => {
    conversation.endVoice?.();
    setConversationSurface("none");
  };

  const conversationVisualPhase = ["connecting", "transcribing"].includes(conversationSnapshot.phase)
    ? "listening"
    : conversationSnapshot.phase === "sending" ? "thinking" : conversationSnapshot.phase;
  const supportedVisualState = ["idle", "listening", "thinking", "speaking", "completed", "error"].includes(conversationVisualPhase)
    ? conversationVisualPhase
    : "idle";
  const visualState = conversationSurface === "none"
    ? "idle"
    : conversationSnapshot.phase === "paused"
      ? "idle"
      : supportedVisualState === "idle" ? "completed" : supportedVisualState;
  const meta = STATE_META[visualState];
  const displayActiveSession = conversationSurface !== "none";
  const visibleNotice = featureNotice;
  const codexWorking = displayActiveSession && ["thinking", "speaking"].includes(visualState);
  return (
    <main className={`desktop-stage state-${visualState} ${displayActiveSession ? "is-awake" : "is-asleep"} ${minimized ? "is-minimized" : ""} ${panel === "settings" ? "has-settings" : ""} ${api.isDesktop ? "is-desktop-runtime" : "is-browser-preview"}`}>
      <section className="companion-shell" aria-label="AI-KANOJO 桌面女友">
        {minimized && (
          <button
            className={`avatar-button animation-${meta.animation}`}
            style={{ "--seat-anchor-y": meta.seatAnchor, "--seat-bottom": `${(meta.seatAnchor - 1) * 150}px` }}
            type="button"
            onClick={() => { setMinimized(false); handleVoiceRequest(); }}
            aria-label="展开并开始语音对话"
          >
            <img src={meta.src} alt={`8-bit 罗照月，${meta.label}`} draggable="false" />
            <span className="avatar-halo" />
            {visualState === "idle" && <SleepIndicator />}
            {!activeSession && <span className="wake-hint">唤醒照月</span>}
          </button>
        )}

        <div
          className={`status-rail drag-surface ${locked ? "is-locked" : ""}`}
          onPointerDown={startWindowDrag}
          onPointerUp={endWindowDrag}
          onPointerCancel={endWindowDrag}
          onLostPointerCapture={endWindowDrag}
          title={locked ? "位置已锁定" : "拖动胶囊空白区域可移动窗口"}
        >
          <span className="rail-flow-edge" aria-hidden="true">
            <i className="rail-flow-top" />
            <i className="rail-flow-bottom" />
          </span>
          {minimized ? (
            <div className="mini-rail" aria-label="已缩小悬浮窗">
              <span className={`mini-status state-${visualState}`} aria-hidden="true" />
              <button type="button" className="round-button restore-button" onClick={() => setMinimized(false)} aria-label="展开悬浮窗"><ArrowsOutSimple weight="bold" /></button>
            </div>
          ) : (<>
          <div className="rail-mainline">
            <div className="icon-feature-group" aria-label="快捷功能">
              <IconFeatureButton
                id="companion"
                className={`state-${visualState}`}
                onClick={handleVoiceRequest}
                icon={<Microphone weight="light" />}
                label={conversationSurface === "voice" ? `${meta.label}，点击暂停或继续` : "开始简短语音对话"}
              />
              <IconFeatureButton
                id="sing"
                onClick={handleSingRequest}
                icon={<MusicNotes weight="light" />}
                label="给我唱首歌，功能准备中"
              />
              <IconFeatureButton
                id="chat"
                onClick={handleChatRequest}
                icon={<ChatCircleDots weight="light" />}
                label={conversationSurface === "chat" ? "关闭文字聊天" : "打开文字聊天"}
              />
            </div>

            {!minimized && (
              <div className="runtime-avatar-slot" aria-label={`${meta.label} 8-bit 状态`}>
                <button
                  className={`avatar-button runtime-avatar-button animation-${meta.animation}`}
                  style={{ "--seat-anchor-y": meta.seatAnchor, "--seat-bottom": `${(meta.seatAnchor - 1) * 160}px` }}
                  type="button"
                  onClick={handleVoiceRequest}
                  aria-label={`${meta.label}角色，点击开始或切换语音对话`}
                >
                  <img src={meta.src} alt={`8-bit 罗照月，${meta.label}`} draggable="false" />
                  <span className="avatar-halo" />
                  {visualState === "idle" && <SleepIndicator />}
                </button>
              </div>
            )}

            <span className="rail-main-spacer" />
            <CodexStatus working={codexWorking} />

            <div className="rail-actions window-traffic-lights" aria-label="窗口控制">
              <button type="button" className="traffic-light traffic-light-close" data-no-window-drag data-tooltip="关闭程序" title="关闭程序" onClick={() => api.quitApp?.()} aria-label="关闭程序">
                <span aria-hidden="true" />
              </button>
              <button type="button" className="traffic-light traffic-light-minimize" data-no-window-drag data-tooltip="缩小悬浮窗" title="缩小悬浮窗" onClick={() => { closeConversationSurface(); setPanel("compact"); setMinimized(true); }} aria-label="缩小悬浮窗">
                <span aria-hidden="true" />
              </button>
            </div>
          </div>

          {visibleNotice && <div className="feature-notice" role="status">{visibleNotice}</div>}
          </>)}
        </div>

        {!minimized && panel !== "settings" && conversationSurface === "chat" && (
          <TextChatPanel
            snapshot={conversationSnapshot}
            onClose={closeConversationSurface}
            onSend={(message) => conversation.sendText?.(message) !== false}
          />
        )}

        {!minimized && panel !== "settings" && conversationSurface === "voice" && (
          <VoiceConversationPopover
            snapshot={conversationSnapshot}
            onPause={() => conversation.pauseVoice?.()}
            onResume={() => conversation.resumeVoice?.()}
            onEnd={endVoiceConversation}
            onRetry={(turnId) => conversation.retryVoiceTurn?.(turnId)}
          />
        )}

        {panel === "settings" && (
          <section className="glass-panel settings-panel" aria-label="设置与诊断">
            <header className="panel-header">
              <div><span className="eyebrow">VOICE</span><h1>音色与麦克风</h1></div>
              <button type="button" className="text-button" onClick={() => setPanel("compact")}>完成</button>
            </header>

            <div className="settings-grid">
              <div className="voice-id-setting">
                <label><span>ElevenLabs 音色</span><select aria-label="ElevenLabs 音色" value={settings.voiceId} onChange={(event) => setSettings({ ...settings, voiceId: event.target.value })} disabled={voiceCatalogState === "loading"}>
                  {!settings.voiceId && <option value="">{voiceCatalogState === "loading" ? "正在加载音色…" : "请选择音色"}</option>}
                  {settings.voiceId && !voices.some((voice) => voice.voiceId === settings.voiceId) && <option value={settings.voiceId}>当前音色 · {settings.voiceId}</option>}
                  {voices.map((voice) => <option value={voice.voiceId} key={voice.voiceId}>{voice.name} · {voice.language || "未标注语言"} · {voice.category || "voice"}</option>)}
                </select></label>
                <div className="voice-setting-meta"><small className={`settings-hint ${voiceCatalogState === "error" ? "is-error" : ""}`}>{voiceCatalogState === "error" ? voiceCatalogError : "选择后将同步到语音 Agent，下次语音对话生效"}</small><button type="button" className="voice-refresh-button" onClick={refreshVoices} disabled={voiceCatalogState === "loading"}>{voiceCatalogState === "loading" ? "加载中" : "刷新音色"}</button></div>
              </div>
              <label><span>麦克风</span><select value={settings.microphoneId} onChange={(event) => setSettings({ ...settings, microphoneId: event.target.value })}><option value="">系统默认麦克风</option>{microphones.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}</select></label>
            </div>
            <button type="button" className="primary-button" onClick={savePreferences} disabled={savingSettings}>{saveNote || "应用并保存设置"}</button>
          </section>
        )}
      </section>
    </main>
  );
}
