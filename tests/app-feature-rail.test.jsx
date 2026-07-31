import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("flat spectrum feature rail", () => {
  it("renders three primary features, Codex, and Apple-style window controls", async () => {
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".status-rail.drag-surface")).toBeInTheDocument();
    expect(container.querySelectorAll(".icon-feature-button")).toHaveLength(3);
    expect(container.querySelectorAll(".avatar-button img")).toHaveLength(1);
    expect(container.querySelector(".runtime-avatar-slot")).toBeNull();
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

  it("hides the 2D portrait whenever the companion returns to sleep", async () => {
    vi.useFakeTimers();
    const { container } = render(<App />);
    await act(async () => Promise.resolve());

    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-companion"));
    expect(container.querySelector(".portrait-button")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-idle");
    expect(container.querySelector(".portrait-button")).not.toBeInTheDocument();
  });
});
