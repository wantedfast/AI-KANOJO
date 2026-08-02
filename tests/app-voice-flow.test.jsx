import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";
import { EMPTY_CONVERSATION_SNAPSHOT } from "../src/conversation-adapter.js";

function createFrontendAdapter(initial = {}) {
  let snapshot = { ...EMPTY_CONVERSATION_SNAPSHOT, ...initial };
  const listeners = new Set();
  const publish = (patch) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener(snapshot));
  };
  return {
    publish,
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    }),
    sendText: vi.fn(() => true),
    retryVoiceTurn: vi.fn(() => true),
    startVoice: vi.fn(() => publish({ phase: "listening", transcript: "", reply: "" })),
    pauseVoice: vi.fn(() => publish({ phase: "paused" })),
    resumeVoice: vi.fn(() => publish({ phase: "listening" })),
    endVoice: vi.fn(() => publish({ phase: "idle", transcript: "", reply: "" })),
    closeSurface: vi.fn(() => publish({ phase: "idle" })),
  };
}

afterEach(() => cleanup());

describe("frontend conversation surfaces", () => {
  it("opens a compact voice popover and reflects injected voice phases", async () => {
    const adapter = createFrontendAdapter();
    const { container } = render(<App conversationAdapter={adapter} />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".feature-companion"));
    expect(adapter.startVoice).toHaveBeenCalledOnce();
    expect(adapter.startVoice).toHaveBeenCalledWith("");
    expect(screen.getByLabelText("简短语音对话")).toHaveTextContent("正在听");

    act(() => adapter.publish({ phase: "thinking", transcript: "今天过得怎么样？" }));
    expect(screen.getByLabelText("简短语音对话")).toHaveTextContent("正在思考");
    expect(screen.getByLabelText("简短语音对话")).toHaveTextContent("今天过得怎么样？");
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-thinking");

    act(() => adapter.publish({ phase: "speaking", reply: "见到你之后，心情就更好啦。" }));
    expect(screen.getByLabelText("简短语音对话")).toHaveTextContent("正在回复");
    expect(screen.getByLabelText("简短语音对话")).toHaveTextContent("见到你之后，心情就更好啦。");
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-speaking");
  });

  it("pauses, resumes, and ends voice through adapter intentions", async () => {
    const adapter = createFrontendAdapter();
    const { container } = render(<App conversationAdapter={adapter} />);
    await act(async () => Promise.resolve());
    fireEvent.click(container.querySelector(".feature-companion"));

    fireEvent.click(screen.getByRole("button", { name: "暂停语音对话" }));
    expect(adapter.pauseVoice).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("简短语音对话")).toHaveTextContent("已暂停");
    fireEvent.click(screen.getByRole("button", { name: "继续语音对话" }));
    expect(adapter.resumeVoice).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "结束语音对话" }));
    expect(adapter.endVoice).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("简短语音对话")).not.toBeInTheDocument();
    expect(container.querySelector(".desktop-stage")).toHaveClass("state-idle", "is-asleep");
  });

  it("shows separate partial and final captions and exposes retry for a failed turn", async () => {
    const adapter = createFrontendAdapter();
    const { container } = render(<App conversationAdapter={adapter} />);
    await act(async () => Promise.resolve());
    fireEvent.click(container.querySelector(".feature-companion"));

    act(() => adapter.publish({
      phase: "transcribing",
      voiceState: "Transcribing",
      voiceTurns: [
        { turnId: "turn-1", transcriptPartial: "今天天", transcriptFinal: "", status: "partial" },
      ],
    }));
    expect(screen.getByTestId("voice-debug-state")).toHaveTextContent("Transcribing");
    expect(container.querySelector(".voice-caption-partial")).toHaveTextContent("今天天");

    act(() => adapter.publish({
      phase: "error",
      voiceState: "Error",
      voiceTurns: [
        { turnId: "turn-1", transcriptPartial: "", transcriptFinal: "今天天气很好", status: "complete" },
        { turnId: "turn-2", transcriptPartial: "", transcriptFinal: "陪我出去走走", status: "send_failed", error: "发送失败，可重试" },
      ],
    }));
    expect(screen.getAllByText("今天天气很好")).toHaveLength(1);
    expect(screen.getAllByText("陪我出去走走")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(adapter.retryVoiceTurn).toHaveBeenCalledWith("turn-2");
  });

  it("opens text chat, sends with Enter, and keeps Shift+Enter as a newline", async () => {
    const adapter = createFrontendAdapter({
      messages: [{ id: "hello", role: "assistant", content: "我在这里。", createdAt: Date.now(), status: "complete" }],
    });
    const { container } = render(<App conversationAdapter={adapter} />);
    await act(async () => Promise.resolve());
    fireEvent.click(container.querySelector(".feature-chat"));

    const composer = screen.getByRole("textbox", { name: "输入聊天消息" });
    fireEvent.change(composer, { target: { value: "陪我聊一会儿" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    expect(adapter.sendText).toHaveBeenCalledWith("陪我聊一会儿");
    expect(composer).toHaveValue("");

    fireEvent.change(composer, { target: { value: "第一行" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter", shiftKey: true });
    expect(adapter.sendText).toHaveBeenCalledTimes(1);
    expect(composer).toHaveValue("第一行");
  });

  it("keeps text and voice mutually exclusive and ignores late display events", async () => {
    const adapter = createFrontendAdapter();
    const { container } = render(<App conversationAdapter={adapter} />);
    await act(async () => Promise.resolve());

    fireEvent.click(container.querySelector(".feature-companion"));
    expect(screen.getByLabelText("简短语音对话")).toBeInTheDocument();
    fireEvent.click(container.querySelector(".feature-chat"));
    expect(adapter.endVoice).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("与罗照月文字聊天")).toBeInTheDocument();
    expect(screen.queryByLabelText("简短语音对话")).not.toBeInTheDocument();

    act(() => adapter.publish({ phase: "speaking", reply: "迟到的语音事件" }));
    expect(screen.getByLabelText("与罗照月文字聊天")).toBeInTheDocument();
    expect(screen.queryByLabelText("简短语音对话")).not.toBeInTheDocument();
  });

  it("shows injected errors in the active surface and closes it with Escape", async () => {
    const adapter = createFrontendAdapter();
    const { container } = render(<App conversationAdapter={adapter} />);
    await act(async () => Promise.resolve());
    fireEvent.click(container.querySelector(".feature-chat"));

    act(() => adapter.publish({ phase: "error", error: "后端暂时不可用" }));
    expect(screen.getByRole("status")).toHaveTextContent("后端暂时不可用");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(adapter.closeSurface).toHaveBeenCalledWith("chat");
    expect(screen.queryByLabelText("与罗照月文字聊天")).not.toBeInTheDocument();
  });
});
