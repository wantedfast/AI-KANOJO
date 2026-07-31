import { useEffect, useMemo, useRef, useState } from "react";
import {
  Lock,
  LockOpen,
  Microphone,
  MusicNotes,
  TShirt,
  ArrowsOutSimple,
} from "@phosphor-icons/react";
import { createCompanionController, STATE_META } from "./companion-controller.js";
import { RealtimeScribe } from "./realtime-scribe.js";

const api = window.kanojo ?? {
  isDesktop: false,
  getBootstrap: async () => ({
    settings: { demoMode: true, deepseekModel: "deepseek-v4-flash", voiceId: "", microphoneId: "" },
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
const PORTRAIT_SRC = "./avatar/outfits/front/02-modern-jk.png";

function ServicePill({ ok, children }) {
  return <span className={`service-pill ${ok ? "is-ready" : "is-missing"}`}><i />{children}</span>;
}

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
      <span className="codex-mode">{working ? "Generating…" : "Ready"}</span>
      <span className="codex-meter" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
      </span>
    </div>
  );
}

export function App() {
  const controller = useMemo(() => createCompanionController(), []);
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());
  const [activeSession, setActiveSession] = useState(false);
  const [paused, setPaused] = useState(false);
  const [panel, setPanel] = useState("compact");
  const [settings, setSettings] = useState({ demoMode: true, deepseekModel: "deepseek-v4-flash", voiceId: "", microphoneId: "" });
  const [credentials, setCredentials] = useState({ deepseek: false, elevenlabs: false });
  const [microphones, setMicrophones] = useState([]);
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const [scribeStatus, setScribeStatus] = useState("idle");
  const [locked, setLocked] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [keys, setKeys] = useState({ deepseek: "", elevenlabs: "" });
  const [saveNote, setSaveNote] = useState("");
  const [featureNotice, setFeatureNotice] = useState("");
  const scribeRef = useRef(null);
  const demoTimers = useRef([]);
  const audioRef = useRef(null);
  const featureNoticeTimer = useRef(null);
  const dragPointer = useRef(null);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  const refreshMicrophones = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicrophones([]);
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMicrophones(devices.filter((device) => device.kind === "audioinput"));
  };

  useEffect(() => {
    let mounted = true;
    api.getBootstrap().then((data) => {
      if (!mounted) return;
      setSettings((current) => ({ ...current, ...data.settings }));
      setCredentials(data.credentials);
      setLocked(Boolean(data.locked));
      controller.hydrate(data.chat);
    }).catch((error) => controller.fail(error.message));
    const unsubscribe = api.onOpenSettings?.(() => setPanel("settings"));
    const unsubscribeLocked = api.onLockedChanged?.(setLocked);
    const handleOnline = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);
    const handleDeviceChange = () => refreshMicrophones().catch(() => setMicrophones([]));
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
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
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [controller]);

  useEffect(() => {
    if (panel === "settings") refreshMicrophones().catch(() => setMicrophones([]));
  }, [panel]);

  const clearDemoTimers = () => {
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
  };

  const playAudio = async (arrayBuffer) => {
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    await audio.play();
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;
    });
    URL.revokeObjectURL(url);
    audioRef.current = null;
  };

  const runReply = async (text) => {
    const userMessage = controller.commitUser(text);
    if (!userMessage) return;
    await api.saveChat(controller.getSnapshot().messages);
    if (settings.demoMode) {
      controller.beginThinking();
      const chunks = ["当然可以。", "我一直都在。", "今天过得怎么样？"];
      chunks.forEach((chunk, index) => {
        demoTimers.current.push(setTimeout(() => {
          controller.appendReply(chunk);
          if (index === chunks.length - 1) {
            controller.finishReply();
            api.saveChat(controller.getSnapshot().messages);
          }
        }, 520 + index * 420));
      });
      return;
    }
    try {
      controller.beginThinking();
      await api.streamReply({
        messages: controller.getSnapshot().messages.map(({ role, content }) => ({ role, content })),
        model: settings.deepseekModel,
      }, (delta) => controller.appendReply(delta));
      controller.beginSpeaking();
      const spokenText = controller.getSnapshot().draftReply;
      const audio = await api.synthesize({ text: spokenText, voiceId: settings.voiceId });
      await playAudio(audio);
      controller.finishReply();
      await api.saveChat(controller.getSnapshot().messages);
    } catch (error) {
      controller.fail(error.message);
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
    try {
      setPaused(false);
      controller.startListening();
      const token = await api.getScribeToken();
      const scribe = new RealtimeScribe({
        token,
        deviceId: settings.microphoneId,
        onPartial: (text) => controller.setPartial(text),
        onCommitted: (text, id) => {
          if (!controller.acceptTranscript(id)) return;
          scribe.stop();
          scribeRef.current = null;
          runReply(text);
        },
        onStatus: setScribeStatus,
        onError: (message) => {
          scribe.stop();
          scribeRef.current = null;
          setScribeStatus("error");
          controller.fail(message);
        },
      });
      scribeRef.current = scribe;
      await scribe.start();
    } catch (error) {
      scribeRef.current?.stop();
      scribeRef.current = null;
      setScribeStatus("error");
      controller.fail(error.message);
    }
  };

  const beginListening = () => settings.demoMode ? startDemoListening() : startRealListening();

  const wakeCompanion = () => {
    setActiveSession(true);
    setPanel("compact");
    beginListening();
  };

  const toggleListening = () => {
    if (snapshot.state === "listening" && !paused) {
      clearDemoTimers();
      scribeRef.current?.stop();
      scribeRef.current = null;
      controller.stopListening();
      setPaused(true);
      return;
    }
    if (["idle", "completed"].includes(snapshot.state) || paused) beginListening();
  };

  const stopSpeaking = () => {
    clearDemoTimers();
    api.cancelActive?.();
    audioRef.current?.pause();
    audioRef.current = null;
    controller.interrupt();
    api.saveChat(controller.getSnapshot().messages);
  };

  const endSession = () => {
    clearDemoTimers();
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
    api.cancelActive?.();
    audioRef.current?.pause();
    audioRef.current = null;
    scribeRef.current?.stop();
    scribeRef.current = null;
    if (controller.getSnapshot().state === "speaking") {
      controller.interrupt();
      api.saveChat(controller.getSnapshot().messages);
    }
  }), [controller]);

  const savePreferences = async () => {
    const next = await api.saveSettings(settings);
    setSettings(next);
    if (keys.deepseek || keys.elevenlabs) {
      const status = await api.saveCredentials(keys);
      setCredentials(status);
      setKeys({ deepseek: "", elevenlabs: "" });
    }
    setSaveNote("已安全保存");
    setTimeout(() => setSaveNote(""), 1800);
  };

  const setWindowLocked = async () => {
    const next = !locked;
    await api.setLocked(next);
    setLocked(next);
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
  const handleWardrobeRequest = () => showFeatureNotice("换装功能准备中");

  const meta = STATE_META[snapshot.state];
  const codexWorking = activeSession && ["thinking", "speaking"].includes(snapshot.state);
  return (
    <main className={`desktop-stage state-${snapshot.state} ${activeSession ? "is-awake" : "is-asleep"} ${minimized ? "is-minimized" : ""} ${panel === "settings" ? "has-settings" : ""} ${api.isDesktop ? "is-desktop-runtime" : "is-browser-preview"}`}>
      <section className="companion-shell" aria-label="AI-KANOJO 桌面女友">
        {activeSession && !minimized && (
          <button
            className="portrait-button"
            type="button"
            onClick={snapshot.state === "speaking" ? stopSpeaking : undefined}
            aria-label={snapshot.state === "speaking" ? "停止照月说话" : "罗照月半身立绘"}
          >
            <img src={PORTRAIT_SRC} alt="罗照月，现代 JK 半身立绘" draggable="false" />
          </button>
        )}

        {(!activeSession || minimized) && (
          <button
            className={`avatar-button animation-${meta.animation}`}
            style={{ "--seat-anchor-y": meta.seatAnchor, "--seat-bottom": `${(meta.seatAnchor - 1) * 150}px` }}
            type="button"
            onClick={activeSession ? toggleListening : wakeCompanion}
            aria-label={activeSession ? `${meta.label}角色，点击切换聆听` : "唤醒照月角色"}
          >
            <img src={meta.src} alt={`8-bit 罗照月，${meta.label}`} draggable="false" />
            <span className="avatar-halo" />
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
              <span className={`mini-status state-${snapshot.state}`} aria-hidden="true" />
              <button type="button" className="round-button restore-button" onClick={() => setMinimized(false)} aria-label="展开悬浮窗"><ArrowsOutSimple weight="bold" /></button>
            </div>
          ) : (<>
          <div className="rail-mainline">
            <div className="icon-feature-group" aria-label="快捷功能">
              <IconFeatureButton
                id="companion"
                className={`state-${snapshot.state}`}
                onClick={activeSession ? toggleListening : wakeCompanion}
                icon={<Microphone weight="light" />}
                label={activeSession ? `${meta.label}，点击切换聆听` : "唤醒照月"}
              />
              <IconFeatureButton
                id="sing"
                onClick={handleSingRequest}
                icon={<MusicNotes weight="light" />}
                label="给我唱首歌，功能准备中"
              />
              <IconFeatureButton
                id="wardrobe"
                onClick={handleWardrobeRequest}
                icon={<TShirt weight="light" />}
                label="换装，功能准备中"
              />
            </div>

            {activeSession && (
              <div className="runtime-avatar-slot" aria-label={`${meta.label} 8-bit 工作状态`}>
                <button
                  className={`avatar-button runtime-avatar-button animation-${meta.animation}`}
                  style={{ "--seat-anchor-y": meta.seatAnchor, "--seat-bottom": `${(meta.seatAnchor - 1) * 160}px` }}
                  type="button"
                  onClick={toggleListening}
                  aria-label={`${meta.label}角色，点击切换聆听`}
                >
                  <img src={meta.src} alt={`8-bit 罗照月，${meta.label}`} draggable="false" />
                  <span className="avatar-halo" />
                </button>
              </div>
            )}

            <span className="rail-main-spacer" />
            <CodexStatus working={codexWorking} />

            <div className="rail-actions window-traffic-lights" aria-label="窗口控制">
              <button type="button" className="traffic-light traffic-light-close" data-no-window-drag data-tooltip="关闭程序" title="关闭程序" onClick={() => api.quitApp?.()} aria-label="关闭程序">
                <span aria-hidden="true" />
              </button>
              <button type="button" className="traffic-light traffic-light-minimize" data-no-window-drag data-tooltip="缩小悬浮窗" title="缩小悬浮窗" onClick={() => { setPanel("compact"); setMinimized(true); }} aria-label="缩小悬浮窗">
                <span aria-hidden="true" />
              </button>
            </div>
          </div>

          {featureNotice && <div className="feature-notice" role="status">{featureNotice}</div>}
          </>)}
        </div>

        {panel === "settings" && (
          <section className="glass-panel settings-panel" aria-label="设置与诊断">
            <header className="panel-header">
              <div><span className="eyebrow">AI CORE</span><h1>连接与偏好</h1></div>
              <button type="button" className="text-button" onClick={() => setPanel("compact")}>完成</button>
            </header>

            <div className="settings-grid">
              <label className="toggle-row">
                <span><strong>演示模式</strong><small>无需凭据，体验完整状态流</small></span>
                <input type="checkbox" checked={settings.demoMode} onChange={(event) => setSettings({ ...settings, demoMode: event.target.checked })} />
              </label>
              <label><span>DeepSeek 模型</span><select value={settings.deepseekModel} onChange={(event) => setSettings({ ...settings, deepseekModel: event.target.value })}><option value="deepseek-v4-flash">DeepSeek V4 Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label>
              <label><span>DeepSeek API Key</span><input type="password" value={keys.deepseek} onChange={(event) => setKeys({ ...keys, deepseek: event.target.value })} placeholder={credentials.deepseek ? "已保存在系统保护区" : "sk-…"} autoComplete="off" /></label>
              <label><span>ElevenLabs API Key</span><input type="password" value={keys.elevenlabs} onChange={(event) => setKeys({ ...keys, elevenlabs: event.target.value })} placeholder={credentials.elevenlabs ? "已保存在系统保护区" : "xi-…"} autoComplete="off" /></label>
              <label><span>ElevenLabs Voice ID</span><input value={settings.voiceId} onChange={(event) => setSettings({ ...settings, voiceId: event.target.value })} placeholder="正式语音所需" /></label>
              <label><span>麦克风</span><select value={settings.microphoneId} onChange={(event) => setSettings({ ...settings, microphoneId: event.target.value })}><option value="">系统默认麦克风</option>{microphones.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}</select></label>
              <button type="button" className="lock-row" onClick={setWindowLocked}><span><strong>{locked ? "位置已锁定" : "位置可拖动"}</strong><small>锁定不影响角色和按钮点击</small></span>{locked ? <Lock weight="fill" /> : <LockOpen weight="light" />}</button>
            </div>

            <div className="diagnostic-bar">
              <ServicePill ok={credentials.deepseek}>DeepSeek Key</ServicePill>
              <ServicePill ok={credentials.elevenlabs}>ElevenLabs Key</ServicePill>
              <ServicePill ok={microphones.length > 0}>{microphones.length ? "麦克风已发现" : "未发现麦克风"}</ServicePill>
              <ServicePill ok={scribeStatus === "listening"}>{scribeStatus === "listening" ? "识别中" : scribeStatus === "error" ? "识别异常" : "识别待机"}</ServicePill>
              <ServicePill ok={networkOnline}>{networkOnline ? "网络在线" : "网络离线"}</ServicePill>
            </div>
            <button type="button" className="primary-button" onClick={savePreferences}>{saveNote || "保存设置"}</button>
          </section>
        )}
      </section>
    </main>
  );
}
