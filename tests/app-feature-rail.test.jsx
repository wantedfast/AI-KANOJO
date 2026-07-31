import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Gallery 02 minimal feature rail", () => {
  it("renders three icon-only features and the reference-style Codex status", async () => {
    const { container } = render(<App />);

    expect(container.querySelector(".status-rail.drag-surface")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "唤醒照月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "给我唱首歌，功能准备中" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "换装，功能准备中" })).toBeInTheDocument();
    expect(container.querySelectorAll(".icon-feature-button")).toHaveLength(3);
    expect(container.querySelectorAll(".avatar-button img")).toHaveLength(1);
    expect(container.querySelectorAll(".rail-flow-edge i")).toHaveLength(2);
    expect(container.querySelector(".feature-tile")).toBeNull();
    expect(screen.getByLabelText("Codex Standby")).toHaveTextContent("CodexReady");
    expect(screen.getByLabelText("Codex Standby").querySelectorAll(".codex-meter i")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "打开更多控制" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu", { name: "更多控制" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    expect(screen.getByRole("menu", { name: "更多控制" }).querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("menuitem", { name: "开启字幕" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "结束对话" })).toBeDisabled();
  });

  it("closes the icon-only utility menu with Escape and outside interaction", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "打开更多控制" });

    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "更多控制" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "更多控制" })).not.toBeInTheDocument();
  });

  it("shows honest placeholder feedback without starting a session", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "唤醒照月" });

    fireEvent.click(screen.getByRole("button", { name: "给我唱首歌，功能准备中" }));
    expect(screen.getByRole("status")).toHaveTextContent("唱歌功能准备中");

    fireEvent.click(screen.getByRole("button", { name: "换装，功能准备中" }));
    expect(screen.getByRole("status")).toHaveTextContent("换装功能准备中");
    expect(screen.getByRole("button", { name: "唤醒照月" })).toBeInTheDocument();
  });

  it("collapses to a small draggable rail and can expand again", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "唤醒照月" });

    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "缩小悬浮窗" }));
    expect(screen.getByLabelText("已缩小悬浮窗")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开悬浮窗" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开悬浮窗" }));
    expect(screen.getByRole("button", { name: "打开更多控制" })).toBeInTheDocument();
  });

  it("wakes into listening, enables utilities, and shows Codex working while thinking", async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => Promise.resolve());
    const wakeButton = screen.getByRole("button", { name: "唤醒照月" });

    fireEvent.click(wakeButton);

    expect(screen.getByRole("button", { name: "正在听，点击切换聆听" })).toHaveClass("state-listening");
    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    expect(screen.getByRole("menuitem", { name: "开启字幕" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "结束对话" })).toBeEnabled();

    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByLabelText("Codex Working")).toHaveTextContent("Generating…");
  });

  it("runs caption, pause, and end actions from the utility menu", async () => {
    render(<App />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "唤醒照月" }));

    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "开启字幕" }));
    expect(screen.queryByRole("menu", { name: "更多控制" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "暂停聆听" }));
    fireEvent.click(screen.getByRole("button", { name: "打开更多控制" }));
    expect(screen.getByRole("menuitem", { name: "继续聆听" })).toBeEnabled();

    fireEvent.click(screen.getByRole("menuitem", { name: "结束对话" }));
    expect(screen.getByRole("button", { name: "唤醒照月" })).toBeInTheDocument();
  });
});
