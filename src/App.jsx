import { useEffect, useMemo, useRef, useState } from "react";
import {
  Microphone,
  MusicNotes,
  ChatCircleDots,
  ArrowsOutSimple,
  GearSix,
  Waveform,
  Sparkle,
  Check,
} from "@phosphor-icons/react";
import { STATE_META } from "./companion-state.js";
import { EMPTY_CONVERSATION_SNAPSHOT, resolveConversationAdapter } from "./conversation-adapter.js";
import { TextChatPanel, VoiceConversationPopover, VoiceSessionRail } from "./conversation-surfaces.jsx";
import { CharacterAssetsManager } from "./character-assets-manager.jsx";
import {
  ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
  ELEVEN_V3_MODEL_ID,
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

function IconFeatureButton({ id, className = "", onClick, icon, label, ...buttonProps }) {
  return (
    <button
      type="button"
      className={`icon-feature-button feature-${id} ${className}`}
      onClick={onClick}
      aria-label={label}
      {...buttonProps}
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
  const [settingsSection, setSettingsSection] = useState("voice");
  const [settings, setSettings] = useState({
    demoMode: !api.isDesktop,
    voiceId: "",
    microphoneId: "",
    ttsModelId: ELEVEN_V3_CONVERSATIONAL_MODEL_ID,
  });
  const settingsBaselineRef = useRef(settings);
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
  const [voiceModeMenuOpen, setVoiceModeMenuOpen] = useState(false);
  const [voiceModeSwitching, setVoiceModeSwitching] = useState(false);
  const [featureNotice, setFeatureNotice] = useState("");
  const featureNoticeTimer = useRef(null);
  const voiceModeOpenTimer = useRef(null);
  const voiceModeCloseTimer = useRef(null);
  const voiceModePickerRef = useRef(null);
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
      if (event.key !== "Escape") return;
      if (voiceModeMenuOpen) {
        setVoiceModeMenuOpen(false);
        return;
      }
      if (conversationSurface === "none") return;
      conversation.closeSurface?.(conversationSurface);
      setConversationSurface("none");
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [conversation, conversationSurface, voiceModeMenuOpen]);

  useEffect(() => {
    if (!voiceModeMenuOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!voiceModePickerRef.current?.contains(event.target)) setVoiceModeMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [voiceModeMenuOpen]);

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
      setSettings((current) => {
        const nextSettings = { ...current, ...data.settings, demoMode: !api.isDesktop || Boolean(data.smokeMode) };
        settingsBaselineRef.current = nextSettings;
        return nextSettings;
      });
      setCredentials(data.credentials);
      conversation.setBackendStatus?.(data.conversationBackend);
      conversation.hydrate?.(data.chat);
      setLocked(Boolean(data.locked));
      if (data.characterAssets) setCharacterAssets(data.characterAssets);
    }).catch((error) => conversation.setBackendStatus?.({
      configured: false,
      issues: [{ message: error.message || "应用初始化失败" }],
    }));
    const unsubscribe = api.onOpenSettings?.(() => {
      setSettings((current) => { settingsBaselineRef.current = current; return current; });
      setSettingsSection("voice");
      setPanel("settings");
    });
    const unsubscribeLocked = api.onLockedChanged?.(setLocked);
    const handleDeviceChange = () => refreshMicrophones().catch(() => setMicrophones([]));
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    handleDeviceChange();
    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeLocked?.();
      clearTimeout(featureNoticeTimer.current);
      clearTimeout(voiceModeOpenTimer.current);
      clearTimeout(voiceModeCloseTimer.current);
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
      const savedSettings = { ...settings, ...next, demoMode: !api.isDesktop };
      settingsBaselineRef.current = savedSettings;
      setSettings(savedSettings);
      const ready = !api.isDesktop || (credentials.deepseek && credentials.elevenlabs && next.voiceId);
      setSaveNote(ready ? "音色已应用，可以开始对话" : "仍需填写缺失的配置");
      if (ready) setPanel("compact");
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
    setVoiceModeMenuOpen(false);
    if (conversationSurface === "chat") {
      closeConversationSurface();
      return;
    }
    if (conversationSurface === "voice") conversation.endVoice?.();
    setPanel("compact");
    setConversationSurface("chat");
  };
  const startVoiceConversation = (preferences = settings) => {
    setPanel("compact");
    conversation.closeSurface?.(conversationSurface);
    setConversationSurface("voice");
    conversation.startVoice?.(preferences.microphoneId, {
      voiceId: preferences.voiceId,
      ttsModelId: preferences.ttsModelId,
    });
  };
  const handleVoiceRequest = () => {
    setVoiceModeMenuOpen(false);
    if (conversationSurface !== "voice") return startVoiceConversation(settings);
    if (["paused", "error", "idle"].includes(conversationSnapshot.phase)) conversation.resumeVoice?.();
    else conversation.pauseVoice?.();
  };
  const openVoiceModeMenuSoon = () => {
    clearTimeout(voiceModeCloseTimer.current);
    clearTimeout(voiceModeOpenTimer.current);
    voiceModeOpenTimer.current = setTimeout(() => setVoiceModeMenuOpen(true), 350);
  };
  const openVoiceModeMenuNow = () => {
    clearTimeout(voiceModeCloseTimer.current);
    clearTimeout(voiceModeOpenTimer.current);
    setVoiceModeMenuOpen(true);
  };
  const closeVoiceModeMenuSoon = () => {
    clearTimeout(voiceModeOpenTimer.current);
    clearTimeout(voiceModeCloseTimer.current);
    voiceModeCloseTimer.current = setTimeout(() => setVoiceModeMenuOpen(false), 180);
  };
  const selectVoiceMode = async (ttsModelId) => {
    if (voiceModeSwitching) return;
    const previousSettings = settings;
    const nextSettings = { ...settings, ttsModelId };
    setVoiceModeMenuOpen(false);
    setVoiceModeSwitching(true);
    setSettings(nextSettings);
    try {
      const saved = await api.saveSettings(nextSettings);
      const appliedSettings = { ...nextSettings, ...saved, demoMode: nextSettings.demoMode };
      settingsBaselineRef.current = appliedSettings;
      setSettings(appliedSettings);
      startVoiceConversation(appliedSettings);
    } catch (error) {
      setSettings(previousSettings);
      showFeatureNotice(error.message || "语音模式切换失败");
    } finally {
      setVoiceModeSwitching(false);
    }
  };
  const endVoiceConversation = () => {
    conversation.endVoice?.();
    setConversationSurface("none");
  };
  const openSettingsPanel = (event) => {
    event?.preventDefault?.();
    if (conversationSurface === "voice") conversation.endVoice?.();
    else if (conversationSurface !== "none") conversation.closeSurface?.(conversationSurface);
    setConversationSurface("none");
    settingsBaselineRef.current = settings;
    setSettingsSection("voice");
    setPanel("settings");
  };
  const cancelSettings = () => {
    setSettings(settingsBaselineRef.current);
    setSaveNote("");
    setSettingsSection("voice");
    setPanel("compact");
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
            {conversationSurface === "voice" ? (
              <VoiceSessionRail
                snapshot={conversationSnapshot}
                onPause={() => conversation.pauseVoice?.()}
                onResume={() => conversation.resumeVoice?.()}
                onEnd={endVoiceConversation}
              />
            ) : <>
            <div className="icon-feature-group" aria-label="快捷功能">
              <div
                ref={voiceModePickerRef}
                className={`voice-mode-picker ${voiceModeMenuOpen ? "is-open" : ""}`}
                data-no-window-drag
                onPointerEnter={openVoiceModeMenuSoon}
                onPointerLeave={closeVoiceModeMenuSoon}
                onFocusCapture={openVoiceModeMenuNow}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) closeVoiceModeMenuSoon();
                }}
              >
                <IconFeatureButton
                  id="companion"
                  className={`state-${visualState}`}
                  onClick={handleVoiceRequest}
                  icon={<Microphone weight="light" />}
                  label="开始语音对话"
                  aria-haspopup="menu"
                  aria-expanded={voiceModeMenuOpen}
                />
                {voiceModeMenuOpen && (
                  <div className="voice-mode-menu" role="menu" aria-label="选择语音模式">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={settings.ttsModelId === ELEVEN_V3_CONVERSATIONAL_MODEL_ID}
                      disabled={voiceModeSwitching}
                      onClick={() => selectVoiceMode(ELEVEN_V3_CONVERSATIONAL_MODEL_ID)}
                    >
                      <Waveform weight="light" aria-hidden="true" />
                      <span><strong>实时对话</strong><small>可打断 · 低延迟</small></span>
                      {settings.ttsModelId === ELEVEN_V3_CONVERSATIONAL_MODEL_ID && <Check weight="bold" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={settings.ttsModelId === ELEVEN_V3_MODEL_ID}
                      disabled={voiceModeSwitching}
                      onClick={() => selectVoiceMode(ELEVEN_V3_MODEL_ID)}
                    >
                      <Sparkle weight="light" aria-hidden="true" />
                      <span><strong>表现力优先</strong><small>声线更完整 · 不可打断</small></span>
                      {settings.ttsModelId === ELEVEN_V3_MODEL_ID && <Check weight="bold" aria-hidden="true" />}
                    </button>
                  </div>
                )}
              </div>
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
            </>}

            <span className="rail-main-spacer" />
            <CodexStatus working={codexWorking} />

            <div className="rail-actions window-traffic-lights" aria-label="窗口控制">
              <button type="button" className="traffic-light traffic-light-close" data-no-window-drag data-tooltip="关闭程序" title="关闭程序" onClick={() => api.quitApp?.()} aria-label="关闭程序">
                <span aria-hidden="true" />
              </button>
              <button type="button" className="traffic-light traffic-light-minimize" data-no-window-drag data-tooltip="缩小悬浮窗" title="缩小悬浮窗" onClick={() => { closeConversationSurface(); setPanel("compact"); setMinimized(true); }} aria-label="缩小悬浮窗">
                <span aria-hidden="true" />
              </button>
              <button type="button" className="traffic-light traffic-light-settings" data-no-window-drag data-tooltip="打开设置" title="打开设置" onClick={openSettingsPanel} aria-label="打开设置">
                <span aria-hidden="true"><GearSix weight="bold" /></span>
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
            onRetry={(turnId) => conversation.retryVoiceTurn?.(turnId)}
          />
        )}

        {panel === "settings" && (
          <section className="glass-panel settings-panel" aria-label="设置与偏好">
            <header className="panel-header">
              <div><span className="eyebrow">PREFERENCES</span><h1>设置</h1></div>
              <button type="button" className="text-button" onClick={cancelSettings} aria-label="取消设置">取消</button>
            </header>

            <div className="settings-segmented-control" role="tablist" aria-label="设置分类">
              <button type="button" role="tab" aria-selected={settingsSection === "voice"} onClick={() => setSettingsSection("voice")}>声音</button>
              <button type="button" role="tab" aria-selected={settingsSection === "character"} onClick={() => setSettingsSection("character")}>角色资产</button>
            </div>

            {settingsSection === "voice" && <div className="settings-grid" role="tabpanel" aria-label="声音设置">
              <div className="voice-id-setting">
                <label><span>ElevenLabs 音色</span><select aria-label="ElevenLabs 音色" value={settings.voiceId} onChange={(event) => setSettings({ ...settings, voiceId: event.target.value })} disabled={voiceCatalogState === "loading"}>
                  {!settings.voiceId && <option value="">{voiceCatalogState === "loading" ? "正在加载音色…" : "请选择音色"}</option>}
                  {settings.voiceId && !voices.some((voice) => voice.voiceId === settings.voiceId) && <option value={settings.voiceId}>当前音色 · {settings.voiceId}</option>}
                  {voices.map((voice) => <option value={voice.voiceId} key={voice.voiceId}>{voice.name} · {voice.language || "未标注语言"} · {voice.category || "voice"}</option>)}
                </select></label>
                <div className="voice-setting-meta"><small className={`settings-hint ${voiceCatalogState === "error" ? "is-error" : ""}`}>{voiceCatalogState === "error" ? voiceCatalogError : "选择后将同步到语音 Agent，下次语音对话生效"}</small><button type="button" className="voice-refresh-button" onClick={refreshVoices} disabled={voiceCatalogState === "loading"}>{voiceCatalogState === "loading" ? "加载中" : "刷新音色"}</button></div>
              </div>
              <label><span>麦克风</span><select value={settings.microphoneId} onChange={(event) => setSettings({ ...settings, microphoneId: event.target.value })}><option value="">系统默认麦克风</option>{microphones.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}</select></label>
            </div>}
            {settingsSection === "character" && <div role="tabpanel" aria-label="角色资产设置"><CharacterAssetsManager
              assets={characterAssets}
              busyKey={assetBusyKey}
              note={assetNote}
              onImport={importCharacterAsset}
              onReset={resetCharacterAsset}
            /></div>}
            <button type="button" className="primary-button" onClick={savePreferences} disabled={savingSettings}>{saveNote || "保存设置"}</button>
          </section>
        )}
      </section>
    </main>
  );
}
