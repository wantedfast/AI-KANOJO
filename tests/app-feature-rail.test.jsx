import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("flat spectrum feature rail", () => {
  it("renders three primary features, Codex, and a two-action utility menu", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".status-rail.drag-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".icon-feature-button")).toHaveLength(3);
    expect(container.querySelectorAll(".avatar-button img")).toHaveLength(1);
    expect(container.querySelector(".runtime-avatar-slot")).toBeNull();
    expect(screen.getByLabelText("Codex Standby")).toHaveTextContent("CodexReady");

    const trigger = container.querySelector(".utility-menu-trigger");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "更多控制" });
    expect(menu.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByRole("menuitem", { name: "缩小悬浮窗" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "退出程序" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "开启字幕" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "暂停聆听" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "结束对话" })).not.toBeInTheDocument();
  });

  it("closes the utility menu with Escape and outside interaction", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());
    const trigger = container.querySelector(".utility-menu-trigger");

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "更多控制" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "更多控制" })).not.toBeInTheDocument();
  });

  it("keeps singing and wardrobe as honest near-term entries", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".feature-sing"));
    expect(screen.getByRole("status")).toHaveTextContent("唱歌功能准备中");
    fireEvent.click(container.querySelector(".feature-wardrobe"));
    expect(screen.getByRole("status")).toHaveTextContent("换装功能准备中");
  });

  it("collapses to the small draggable rail and restores", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".utility-menu-trigger"));
    fireEvent.click(screen.getByRole("menuitem", { name: "缩小悬浮窗" }));
    expect(screen.getByLabelText("已缩小悬浮窗")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开悬浮窗" }));
    expect(container.querySelector(".utility-menu-trigger")).toBeInTheDocument();
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
    expect(screen.getByLabelText("Codex Working")).toHaveTextContent("Generating…");
  });
});
