import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("flat spectrum feature rail", () => {
  it("loads the voice catalog and saves the semantic voice mode", async () => {
    const saveSettings = vi.fn(async (settings) => settings);
    const listVoices = vi.fn(async () => ({ ok: true, value: [
      { voiceId: "oldVoice1234567890ab", name: "Current", category: "cloned", language: "zh", accent: "", previewUrl: "" },
      { voiceId: "YyODrkDd1qMUj9jupJch", name: "Yuki", category: "cloned", language: "zh", accent: "", previewUrl: "" },
    ] }));
    const runtimeApi = {
      isDesktop: false,
      getBootstrap: async () => ({
        settings: { voiceId: "oldVoice1234567890ab", microphoneId: "", voiceMode: "realtime" },
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

    render(<App runtimeApi={runtimeApi} />);
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    fireEvent.change(await screen.findByRole("combobox", { name: /ElevenLabs/ }), {
      target: { value: "YyODrkDd1qMUj9jupJch" },
    });

    const modeSelect = screen.getByRole("combobox", { name: "语音模式" });
    expect(modeSelect).toHaveValue("realtime");
    expect(screen.getByRole("option", { name: "实时对话 · 可打断（推荐）" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "高表现力 · 轮流对话" })).toBeInTheDocument();
    fireEvent.change(modeSelect, { target: { value: "expressive" } });

    fireEvent.click(screen.getByRole("button", { name: /保存|应用/ }));
    await act(async () => Promise.resolve());

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      voiceId: "YyODrkDd1qMUj9jupJch",
      voiceMode: "expressive",
    }));
    expect(screen.getByText(/Scribe v2 Realtime/)).toBeInTheDocument();
  });

  it("renders the three primary features, Codex, and window controls", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".status-rail.drag-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".icon-feature-button")).toHaveLength(3);
    expect(container.querySelector(".runtime-avatar-slot")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex Standby")).toHaveTextContent("CodexReady");
    expect(screen.getByLabelText(/窗口控制|绐楀彛/).querySelectorAll("button")).toHaveLength(2);
  });

  it("opens text chat without starting voice and keeps the capsule awake", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".feature-chat"));
    expect(screen.getByTestId("text-chat-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("voice-popover")).not.toBeInTheDocument();
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-completed", "is-awake");
  });

  it("shows one conversation portrait only while a conversation surface is open", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-companion"));
    expect(container.querySelectorAll(".portrait-button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /结束语音|缁撴潫/ }));
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-chat"));
    expect(container.querySelectorAll(".portrait-button")).toHaveLength(1);
  });

  it("hides the conversation portrait when settings opens", async () => {
    let openSettings;
    const runtimeApi = {
      isDesktop: false,
      getBootstrap: async () => ({
        settings: { voiceId: "", microphoneId: "", voiceMode: "realtime" },
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
});
