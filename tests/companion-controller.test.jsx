import { describe, expect, it, vi } from "vitest";
import { createCompanionController } from "../src/companion-controller.js";

describe("companion controller", () => {
  it("runs the complete conversation state chain", () => {
    vi.useFakeTimers();
    const controller = createCompanionController({ completedDelay: 5000 });
    controller.startListening();
    expect(controller.getSnapshot().state).toBe("listening");
    controller.setPartial("你好");
    expect(controller.getSnapshot().partial).toBe("你好");
    controller.commitUser("你好");
    expect(controller.getSnapshot().state).toBe("thinking");
    controller.appendReply("我在");
    expect(controller.getSnapshot().state).toBe("thinking");
    controller.beginSpeaking();
    expect(controller.getSnapshot().state).toBe("speaking");
    controller.finishReply();
    expect(controller.getSnapshot().state).toBe("completed");
    expect(controller.getSnapshot().messages).toHaveLength(2);
    vi.advanceTimersByTime(5000);
    expect(controller.getSnapshot().state).toBe("idle");
    vi.useRealTimers();
  });

  it("deduplicates committed transcript ids", () => {
    const controller = createCompanionController();
    expect(controller.acceptTranscript("segment-1")).toBe(true);
    expect(controller.acceptTranscript("segment-1")).toBe(false);
    expect(controller.acceptTranscript("segment-2")).toBe(true);
  });

  it("returns to listening immediately when interrupted", () => {
    const controller = createCompanionController();
    controller.commitUser("继续");
    controller.appendReply("正在回答");
    controller.interrupt();
    expect(controller.getSnapshot()).toMatchObject({ state: "listening", draftReply: "", partial: "" });
    expect(controller.getSnapshot().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "正在回答",
      interrupted: true,
    });
  });
});
