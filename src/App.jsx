import { useEffect, useMemo, useRef, useState } from "react";
import {
  Microphone,
  MusicNotes,
  ChatCircleDots,
  ArrowsOutSimple,
} from "@phosphor-icons/react";
import { STATE_META } from "./companion-state.js";
import { EMPTY_CONVERSATION_SNAPSHOT, resolveConversationAdapter } from "./conversation-adapter.js";
import { TextChatPanel, VoiceConversationPopover } from "./conversation-surfaces.jsx";
import { CharacterAssetsManager } from "./character-assets-manager.jsx";
import {
  ELEVEN_TTS_MODEL_OPTIONS,
  ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
} from "../shared/model-contracts.js";
import { CHARACTER_ASSET_STATES, DEFAULT_CHARACTER_ASSETS, visualStateAssetKey } from "../shared/character-assets.js";

const api = window.kanojo ?? {
  isDesktop: false,
  getBootstrap: async () => ({
    settings: { demoMode: true, voiceId: "", microphoneId: "", ttsModelId: ELEVEN_V3_CONVERSATIONAL_MODEL_ID },
    chat: [],
    credentials: { deepseek: false, elevenlabs: false },
    locked: false,
    characterAssets: { portrait: { src: null, fileName: null, customized: false }, states: {} },
  }),
  saveSettings: async (settings) => settings,
  saveChat: async () => true,
  saveCredentials: async () => ({ deepseek: false, elevenlabs: false }),
  getScribeToken: async () => { throw new Error("桌面应用中才能连接 Scribe"); },
  streamReply: async () => { throw new Error("桌面应用中才能连接 DeepSeek"); },
  synthesize: async () => { throw new Error("桌面应用中才能连接 Eleven v3"); },
  listVoices: async () => ({ ok: true, value: [] }),
  importCharacterAsset: async () => ({ canceled: true }),
  resetCharacterAsset: async () => ({ assets: null }),
  setLocked: async (locked) => locked,
  startWindowDrag: () => {},
  moveWindowDrag: () => {},
  endWindowDrag: () => {},
  quitApp: () => {},
  onAudioStop: () => () => {},
  onLockedChanged: () => () => {},
  onOpenSettings: () => () => {},
};

const emptyCharacterAssets = () => ({
  portrait: { src: null, fileName: null, customized: false },
  states: Object.fromEntries(CHARACTER_ASSET_STATES.map((state) => [state, { src: null, fileName: null, customized: false }])),
});

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

export function App({ runtimeApi = api, conversationAdapter } = {}) {
  const api = runtimeApi;
  const [frontendPreviewMode, setFrontendPreviewMode] = useState(!api.isDesktop);
  const conversation = useMemo(
    () => resolveConversationAdapter({
      isDesktop: api.isDesktop && !frontendPreviewMode,
      injected: conversationAdapter,
      runtimeApi: api,
    }),
    [api.isDesktop, conversationAdapter, frontendPreviewMode],
  );
  const [conversationSnapshot, setConversationSnapshot] = useState(() => conversation.getSnapshot?.() ?? EMPTY_CONVERSATION_SNAPSHOT);
  const [conversationSurface, setConversationSurface] = useState("none");
  const [panel, setPanel] = useState("compact");
  const [settings, setSettings] = useState({
    demoMode: !api.isDesktop,
    voiceId: "",
    microphoneId: "",
    ttsModelId: ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
  });
  const [credentials, setCredentials] = useState({ deepseek: false, elevenlabs: false });
  const [microphones, setMicrophones] = useState([]);
  const [voices, setVoices] = useState([]);
  const [voiceCatalogState, setVoiceCatalogState] = useState("idle");
  const [voiceCatalogError, setVoiceCatalogError] = useState("");
  const [locked, setLocked] = useState(false);
  const [characterAssets, setCharacterAssets] = useState(emptyCharacterAssets);
  const [assetBusyKey, setAssetBusyKey] = useState("");
  const [assetNote, setAssetNote] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [featureNotice, setFeatureNotice] = useState("");
  const featureNoticeTimer = useRef(null);
  const dragPointer = useRef(null);

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
      if (data.characterAssets) setCharacterAssets(data.characterAssets);
    }).catch((error) => conversation.setBackendStatus?.({
      configured: false,
      issues: [{ message: error.message || "应用初始化失败" }],
    }));
    const unsubscribe = api.onOpenSettings?.(() => setPanel("settings"));
    const unsubscribeLocked = api.onLockedChanged?.(setLocked);
    const handleDeviceChange = () => refreshMicrophones().catch(() => setMicrophones([]));
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    handleDeviceChange();
    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeLocked?.();
      clearTimeout(featureNoticeTimer.current);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [conversation]);

  useEffect(() => {
    if (panel === "settings") refreshMicrophones().catch(() => setMicrophones([]));
    if (panel === "settings") refreshVoices();
    if (panel === "settings" && conversationSurface !== "none") {
      conversation.closeSurface?.(conversationSurface);
      setConversationSurface("none");
    }
  }, [conversation, conversationSurface, panel]);

  useEffect(() => api.onAudioStop?.(() => {
    if (conversationSurface === "voice") {
      conversation.resumeVoice?.();
    }
  }), [api, conversation, conversationSurface]);

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

  const importCharacterAsset = async (payload) => {
    const key = payload.type === "portrait" ? "portrait" : payload.state;
    setAssetBusyKey(key);
    setAssetNote("");
    try {
      const result = await api.importCharacterAsset?.(payload);
      if (result?.assets) setCharacterAssets(result.assets);
      setAssetNote(result?.canceled ? "已取消导入" : "角色资产已替换");
    } catch (error) {
      setAssetNote(error.message || "角色资产导入失败");
    } finally {
      setAssetBusyKey("");
    }
  };

  const resetCharacterAsset = async (payload) => {
    const key = payload.type === "portrait" ? "portrait" : "states";
    setAssetBusyKey(key);
    setAssetNote("");
    try {
      const result = await api.resetCharacterAsset?.(payload);
      if (result?.assets) setCharacterAssets(result.assets);
      setAssetNote("已恢复默认角色资产");
    } catch (error) {
      setAssetNote(error.message || "恢复默认资产失败");
    } finally {
      setAssetBusyKey("");
    }
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
      conversation.startVoice?.(settings.microphoneId, {
        voiceId: settings.voiceId,
        ttsModelId: settings.ttsModelId,
      });
      return;
    }
    if (["paused", "error", "idle"].includes(conversationSnapshot.phase)) conversation.resumeVoice?.();
    else conversation.pauseVoice?.();
  };
  const endVoiceConversation = () => {
    conversation.endVoice?.();
    setConversationSurface("none");
  };
  const openSettingsPanel = (event) => {
    event?.preventDefault?.();
    if (conversationSurface !== "none") conversation.closeSurface?.(conversationSurface);
    setConversationSurface("none");
    setPanel("settings");
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
  const assetStateKey = visualStateAssetKey(visualState);
  const meta = {
    ...STATE_META[visualState],
    src: characterAssets.states?.[assetStateKey]?.src || DEFAULT_CHARACTER_ASSETS.states[assetStateKey],
  };
  const portraitSrc = characterAssets.portrait?.src || DEFAULT_CHARACTER_ASSETS.portrait;
  const displayActiveSession = conversationSurface !== "none";
  const visibleNotice = featureNotice;
  const codexWorking = displayActiveSession && ["thinking", "speaking"].includes(visualState);
  const showConversationPortrait = displayActiveSession && visualState !== "idle" && !minimized && panel !== "settings";
  return (
    <main className={`desktop-stage state-${visualState} ${displayActiveSession ? "is-awake" : "is-asleep"} ${minimized ? "is-minimized" : ""} ${panel === "settings" ? "has-settings" : ""} ${api.isDesktop ? "is-desktop-runtime" : "is-browser-preview"}`}>
      <section className="companion-shell" aria-label="AI-KANOJO 桌面女友">
        {showConversationPortrait && (
          <div className="portrait-button conversation-portrait" data-testid="conversation-portrait" aria-hidden="true">
            <img src={portraitSrc} alt="" draggable="false" />
          </div>
        )}

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
            {conversationSurface === "none" && <span className="wake-hint">唤醒照月</span>}
          </button>
        )}

        <div
          className={`status-rail drag-surface ${locked ? "is-locked" : ""}`}
          onPointerDown={startWindowDrag}
          onPointerUp={endWindowDrag}
          onPointerCancel={endWindowDrag}
          onLostPointerCapture={endWindowDrag}
          onContextMenu={openSettingsPanel}
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
            portraitSrc={portraitSrc}
            onPause={() => conversation.pauseVoice?.()}
            onResume={() => conversation.resumeVoice?.()}
            onEnd={endVoiceConversation}
            onRetry={(turnId) => conversation.retryVoiceTurn?.(turnId)}
          />
        )}

        {panel === "settings" && (
          <section className="glass-panel settings-panel" aria-label="设置与诊断">
            <header className="panel-header">
              <div><span className="eyebrow">VOICE & CHARACTER</span><h1>声音与角色</h1></div>
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
              <label><span>语音模型</span><select aria-label="语音模型" value={settings.ttsModelId} onChange={(event) => setSettings({ ...settings, ttsModelId: event.target.value })}>
                {ELEVEN_TTS_MODEL_OPTIONS.map((model) => <option value={model.id} key={model.id}>{model.label}{model.mode === "realtime" ? " · 实时优先" : " · 表现力优先"}</option>)}
              </select><small className="settings-hint">Conversational 响应更快；标准 V3 使用独立合成，音质优先但延迟更高。</small></label>
              <label><span>麦克风</span><select value={settings.microphoneId} onChange={(event) => setSettings({ ...settings, microphoneId: event.target.value })}><option value="">系统默认麦克风</option>{microphones.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}</select></label>
            </div>
            <CharacterAssetsManager
              assets={characterAssets}
              busyKey={assetBusyKey}
              note={assetNote}
              onImport={importCharacterAsset}
              onReset={resetCharacterAsset}
            />
            <button type="button" className="primary-button" onClick={savePreferences} disabled={savingSettings}>{saveNote || "应用并保存设置"}</button>
          </section>
        )}
      </section>
    </main>
  );
}
