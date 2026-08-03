import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("flat spectrum feature rail", () => {
  it("offers voice modes from the microphone and starts the selected mode immediately", async () => {
    vi.useFakeTimers();
    const saveSettings = vi.fn(async (settings) => settings);
    const startVoice = vi.fn();
    const listeners = new Set();
    const conversationAdapter = {
      getSnapshot: () => ({ phase: "idle", voiceState: "Idle", messages: [], voiceTurns: [], transcript: "", transcriptPartial: "", reply: "", error: "" }),
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      startVoice,
      closeSurface: vi.fn(),
      dispose: vi.fn(),
    };
    const runtimeApi = {
      isDesktop: false,
      getBootstrap: async () => ({
        settings: { voiceId: "voice-a", microphoneId: "mic-a", ttsModelId: "eleven_v3_conversational" },
        chat: [], credentials: { deepseek: true, elevenlabs: true }, locked: false,
      }),
      saveSettings,
      listVoices: async () => ({ ok: true, value: [] }),
      onOpenSettings: () => () => {},
      onLockedChanged: () => () => {},
    };
    const { container } = render(<App runtimeApi={runtimeApi} conversationAdapter={conversationAdapter} />);
    await act(async () => Promise.resolve());

    fireEvent.pointerEnter(container.querySelector(".voice-mode-picker"));
    await act(async () => vi.advanceTimersByTimeAsync(360));
    expect(screen.getByRole("menu", { name: "选择语音模式" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /实时对话/ })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: /表现力优先/ }));
    await act(async () => Promise.resolve());

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ ttsModelId: "eleven_v3" }));
    expect(startVoice).toHaveBeenCalledWith("mic-a", expect.objectContaining({ voiceId: "voice-a", ttsModelId: "eleven_v3" }));
    expect(screen.queryByRole("menu", { name: "选择语音模式" })).not.toBeInTheDocument();
  });

  it("opens the voice mode menu from keyboard focus and closes it with Escape", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.focus(container.querySelector(".feature-companion"));
    expect(screen.getByRole("menu", { name: "选择语音模式" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "选择语音模式" })).not.toBeInTheDocument();

    fireEvent.focus(container.querySelector(".feature-companion"));
    expect(screen.getByRole("menu", { name: "选择语音模式" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "选择语音模式" })).not.toBeInTheDocument();
  });

  it("loads the account voice catalog and lets the user select a voice", async () => {
    const saveSettings = vi.fn(async (settings) => settings);
    const listVoices = vi.fn(async () => ({ ok: true, value: [
      { voiceId: "oldVoice1234567890ab", name: "Current", category: "cloned", language: "zh", accent: "", previewUrl: "" },
      { voiceId: "YyODrkDd1qMUj9jupJch", name: "雪之乃", category: "cloned", language: "zh", accent: "", previewUrl: "" },
    ] }));
    const runtimeApi = {
      isDesktop: false,
      getBootstrap: async () => ({
        settings: { voiceId: "oldVoice1234567890ab", microphoneId: "", ttsModelId: "eleven_v3_conversational" },
        chat: [],
        credentials: { deepseek: true, elevenlabs: true },
        locked: false,
      }),
      saveSettings,
      listVoices,
      onOpenSettings: (callback) => {
        queueMicrotask(callback);
        return () => {};
      },
    };
    const { container } = render(<App runtimeApi={runtimeApi} />);
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    const voiceSelect = await screen.findByRole("combobox", { name: "ElevenLabs 音色" });
    expect(listVoices).toHaveBeenCalledOnce();
    expect(voiceSelect).toHaveValue("oldVoice1234567890ab");
    expect(screen.getByRole("option", { name: /雪之乃/ })).toBeInTheDocument();
    fireEvent.change(voiceSelect, { target: { value: "YyODrkDd1qMUj9jupJch" } });
    const modelSelect = screen.getByRole("combobox", { name: "语音模型" });
    expect(modelSelect).toHaveValue("eleven_v3_conversational");
    expect(screen.getByRole("option", { name: /Eleven v3 · 表现力优先/ })).toBeInTheDocument();
    fireEvent.change(modelSelect, { target: { value: "eleven_v3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await act(async () => Promise.resolve());

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "YyODrkDd1qMUj9jupJch", ttsModelId: "eleven_v3" }));
    expect(screen.queryByLabelText("设置与偏好")).not.toBeInTheDocument();
    expect(screen.queryByText("固定模型")).not.toBeInTheDocument();
    expect(screen.queryByText("DeepSeek API Key")).not.toBeInTheDocument();
    expect(screen.queryByText("ElevenLabs API Key")).not.toBeInTheDocument();
    expect(container.querySelector(".lock-row")).not.toBeInTheDocument();
    expect(container.querySelector(".diagnostic-bar")).not.toBeInTheDocument();
  });

  it("renders three primary features, Codex, and Apple-style window controls", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".status-rail.drag-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".icon-feature-button")).toHaveLength(3);
    expect(container.querySelectorAll(".avatar-button img")).toHaveLength(1);
    expect(container.querySelector(".runtime-avatar-slot")).toBeInTheDocument();
    expect(container.querySelectorAll(".sleep-indicator i")).toHaveLength(3);
    expect(screen.getByLabelText("Codex Standby")).toHaveTextContent("CodexReady");

    const controls = screen.getByLabelText("窗口控制");
    expect(controls.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveClass("traffic-light-close");
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveAttribute("data-tooltip", "关闭程序");
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveAttribute("title", "关闭程序");
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveAttribute("data-no-window-drag");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveClass("traffic-light-minimize");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveAttribute("data-tooltip", "缩小悬浮窗");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveAttribute("title", "缩小悬浮窗");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveAttribute("data-no-window-drag");
    expect(screen.getByRole("button", { name: "打开设置" })).toHaveClass("traffic-light-settings");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
      await Promise.resolve();
    });
    expect(screen.getByLabelText("设置与偏好")).toBeInTheDocument();
    expect(container.querySelector(".utility-menu-trigger")).not.toBeInTheDocument();
  });

  it("keeps singing as a placeholder and opens text chat without starting voice", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".feature-sing"));
    expect(screen.getByRole("status")).toHaveTextContent("唱歌功能准备中");
    fireEvent.click(container.querySelector(".feature-chat"));
    expect(screen.getByLabelText("与罗照月文字聊天")).toBeInTheDocument();
    expect(screen.queryByLabelText("简短语音对话")).not.toBeInTheDocument();
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-completed", "is-awake");
  });

  it("separates voice preferences from character assets in settings", async () => {
    render(<App />);
    await act(async () => Promise.resolve());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("tab", { name: "声音" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "语音模型" })).toBeInTheDocument();
    expect(screen.queryByText("角色资产")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "角色资产" }));
    expect(screen.getByRole("tab", { name: "角色资产" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("combobox", { name: "语音模型" })).not.toBeInTheDocument();
    expect(screen.getByText("会话立绘")).toBeInTheDocument();
  });

  it("discards unsaved settings when the user cancels", async () => {
    const saveSettings = vi.fn();
    const runtimeApi = {
      isDesktop: false,
      getBootstrap: async () => ({
        settings: { voiceId: "voice-a", microphoneId: "", ttsModelId: "eleven_v3_conversational" },
        chat: [], credentials: { deepseek: true, elevenlabs: true }, locked: false,
      }),
      saveSettings,
      listVoices: async () => ({ ok: true, value: [
        { voiceId: "voice-a", name: "Voice A", category: "cloned", language: "zh" },
        { voiceId: "voice-b", name: "Voice B", category: "cloned", language: "ja" },
      ] }),
      onOpenSettings: () => () => {},
      onLockedChanged: () => () => {},
    };
    render(<App runtimeApi={runtimeApi} />);
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    const voiceSelect = await screen.findByRole("combobox", { name: "ElevenLabs 音色" });
    expect(voiceSelect).toHaveValue("voice-a");
    fireEvent.change(voiceSelect, { target: { value: "voice-b" } });
    fireEvent.click(screen.getByRole("button", { name: "取消设置" }));
    expect(screen.queryByLabelText("设置与偏好")).not.toBeInTheDocument();
    expect(saveSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    expect(await screen.findByRole("combobox", { name: "ElevenLabs 音色" })).toHaveValue("voice-a");
  });

  it("collapses to the small draggable rail and restores", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "缩小悬浮窗" }));
    expect(screen.getByLabelText("已缩小悬浮窗")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开悬浮窗" }));
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toBeInTheDocument();
  });

  it("places the voice session rail before Codex and hides the 8-bit avatar", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".feature-companion"));
    const mainline = container.querySelector(".rail-mainline");
    const voiceRail = mainline.querySelector(".voice-session-rail");
    const codex = mainline.querySelector(".codex-status");

    expect(container.querySelector(".desktop-stage")).toHaveClass("state-listening", "is-awake");
    expect(voiceRail).toBeInTheDocument();
    expect(mainline.querySelector(".runtime-avatar-slot")).not.toBeInTheDocument();
    expect(voiceRail.compareDocumentPosition(codex) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("advances the dynamic voice rail while Codex remains available", async () => {
    vi.useFakeTimers();
    const { container } = render(<App />);
    await act(async () => Promise.resolve());
    fireEvent.click(container.querySelector(".feature-companion"));

    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-thinking");
    expect(screen.getByLabelText("语音会话控制")).toHaveTextContent("正在思考");
    expect(container.querySelector(".runtime-avatar-slot")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Codex Working")).toHaveTextContent("Working");
  });

  it("shows one Modern JK portrait only while voice or text chat is open", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-companion"));
    expect(container.querySelectorAll(".portrait-button")).toHaveLength(1);
    expect(container.querySelector(".portrait-button img")).toHaveAttribute("src", "./avatar/outfits/front/02-modern-jk-conversation.png");
    fireEvent.click(screen.getByRole("button", { name: "暂停语音对话" }));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续语音对话" }));
    expect(container.querySelectorAll(".portrait-button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "结束语音对话" }));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-chat"));
    expect(container.querySelectorAll(".portrait-button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "缩小悬浮窗" }));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开悬浮窗" }));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-chat"));
    expect(container.querySelectorAll(".portrait-button")).toHaveLength(1);
    fireEvent.click(container.querySelector(".conversation-icon-button"));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
  });

  it("hides the conversation portrait when settings opens", async () => {
    let openSettings;
    const runtimeApi = {
      isDesktop: false,
      getBootstrap: async () => ({
        settings: { voiceId: "", microphoneId: "", ttsModelId: "eleven_v3_conversational" },
        chat: [],
        credentials: { deepseek: true, elevenlabs: true },
        locked: false,
      }),
      listVoices: async () => ({ ok: true, value: [] }),
      onOpenSettings: (callback) => { openSettings = callback; return () => {}; },
      onLockedChanged: () => () => {},
    };
    const { container } = render(<App runtimeApi={runtimeApi} />);
    await waitFor(() => expect(openSettings).toBeTypeOf("function"));

    fireEvent.click(container.querySelector(".feature-chat"));
    expect(container.querySelector(".portrait-button")).toBeInTheDocument();
    await act(async () => {
      openSettings();
      await Promise.resolve();
    });
    expect(container.querySelector(".settings-panel")).toBeInTheDocument();
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
  });

  it("imports and previews replacement portrait and 8-bit assets from settings", async () => {
    let openSettings;
    const importCharacterAsset = vi.fn(async (payload) => ({
      canceled: false,
      assets: {
        portrait: payload.type === "portrait"
          ? { src: "data:image/png;base64,cG9ydHJhaXQ=", fileName: "portrait.png", customized: true }
          : { src: null, fileName: null, customized: false },
        states: {
          idle: payload.state === "idle"
            ? { src: "data:image/webp;base64,cGl4ZWw=", fileName: "idle.webp", customized: true }
            : { src: null, fileName: null, customized: false },
          listening: { src: null, fileName: null, customized: false },
          thinking: { src: null, fileName: null, customized: false },
          completed: { src: null, fileName: null, customized: false },
        },
      },
    }));
    const runtimeApi = {
      isDesktop: false,
      getBootstrap: async () => ({
        settings: { voiceId: "voice", microphoneId: "", ttsModelId: "eleven_v3_conversational" },
        chat: [], credentials: { deepseek: true, elevenlabs: true }, locked: false,
        characterAssets: {
          portrait: { src: null, fileName: null, customized: false },
          states: Object.fromEntries(["idle", "listening", "thinking", "completed"].map((state) => [state, { src: null, fileName: null, customized: false }])),
        },
      }),
      listVoices: async () => ({ ok: true, value: [] }),
      importCharacterAsset,
      onOpenSettings: (callback) => { openSettings = callback; return () => {}; },
      onLockedChanged: () => () => {},
    };
    const { container } = render(<App runtimeApi={runtimeApi} />);
    await waitFor(() => expect(openSettings).toBeTypeOf("function"));
    fireEvent.contextMenu(container.querySelector(".status-rail"));
    fireEvent.click(screen.getByRole("tab", { name: "角色资产" }));

    const manager = container.querySelector(".character-assets-manager");
    expect(manager).toBeInTheDocument();
    fireEvent.click(manager.querySelector(".portrait-asset-card button"));
    await waitFor(() => expect(importCharacterAsset).toHaveBeenCalledWith({ type: "portrait" }));
    expect(manager.querySelector(".portrait-asset-preview img")).toHaveAttribute("src", "data:image/png;base64,cG9ydHJhaXQ=");

    fireEvent.click(manager.querySelector(".pixel-asset-item button"));
    await waitFor(() => expect(importCharacterAsset).toHaveBeenCalledWith({ type: "state", state: "idle" }));
    expect(manager.querySelector(".pixel-asset-preview img")).toHaveAttribute("src", "data:image/webp;base64,cGl4ZWw=");
  });
});
