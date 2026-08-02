import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("flat spectrum feature rail", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "应用并保存设置" }));
    await act(async () => Promise.resolve());

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "YyODrkDd1qMUj9jupJch", ttsModelId: "eleven_v3" }));
    expect(screen.getByText("选择后将同步到语音 Agent，下次语音对话生效")).toBeInTheDocument();
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
    expect(controls.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveClass("traffic-light-close");
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveAttribute("data-tooltip", "关闭程序");
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveAttribute("title", "关闭程序");
    expect(screen.getByRole("button", { name: "关闭程序" })).toHaveAttribute("data-no-window-drag");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveClass("traffic-light-minimize");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveAttribute("data-tooltip", "缩小悬浮窗");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveAttribute("title", "缩小悬浮窗");
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toHaveAttribute("data-no-window-drag");
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

  it("collapses to the small draggable rail and restores", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "缩小悬浮窗" }));
    expect(screen.getByLabelText("已缩小悬浮窗")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开悬浮窗" }));
    expect(screen.getByRole("button", { name: "缩小悬浮窗" })).toBeInTheDocument();
  });

  it("moves the active 8-bit avatar between the feature icons and Codex", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".feature-companion"));
    const mainline = container.querySelector(".rail-mainline");
    const features = mainline.querySelector(".icon-feature-group");
    const slot = mainline.querySelector(".runtime-avatar-slot");
    const codex = mainline.querySelector(".codex-status");

    expect(container.querySelector(".desktop-stage")).toHaveClass("state-listening", "is-awake");
    expect(slot).toBeInTheDocument();
    expect(slot.querySelector(".runtime-avatar-button img")).toHaveAttribute("src", expect.stringContaining("listening.png"));
    expect(slot.querySelector(".runtime-avatar-button")).toHaveStyle({ "--seat-bottom": "-72px" });
    expect(features.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(codex) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the reserved avatar slot while conversation state advances", async () => {
    vi.useFakeTimers();
    const { container } = render(<App />);
    await act(async () => Promise.resolve());
    fireEvent.click(container.querySelector(".feature-companion"));

    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-thinking");
    expect(container.querySelector(".runtime-avatar-slot img")).toHaveAttribute("src", expect.stringContaining("thinking.png"));
    expect(screen.getByLabelText("Codex Working")).toHaveTextContent("Working");
  });

  it("never renders the retired 2D portrait in voice or text chat", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-companion"));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "结束语音对话" }));
    fireEvent.click(container.querySelector(".feature-chat"));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
  });
});
