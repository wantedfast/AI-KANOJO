import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeScribe } from "../src/realtime-scribe.js";

const originalWebSocket = globalThis.WebSocket;
const originalAudioContext = globalThis.AudioContext;
const originalMediaDevices = navigator.mediaDevices;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.AudioContext = originalAudioContext;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  vi.restoreAllMocks();
});

describe("RealtimeScribe caption stream", () => {
  it("reuses a supplied microphone clone, supports mute, and releases it on stop", async () => {
    const track = { enabled: true, stop: vi.fn() };
    const sourceStream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };
    const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
    const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
    const closeAudio = vi.fn(async () => {});
    globalThis.AudioContext = class {
      sampleRate = 48000;
      createMediaStreamSource = vi.fn(() => sourceNode);
      createScriptProcessor = vi.fn(() => processor);
      close = closeAudio;
      destination = {};
    };
    globalThis.WebSocket = class {
      static OPEN = 1;
      readyState = 0;
      send = vi.fn();
      close = vi.fn();
      constructor() {}
    };
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const scribe = new RealtimeScribe({ token: "token", sourceStream });

    await scribe.start();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sourceNode.connect).toHaveBeenCalledWith(processor);
    scribe.setMuted(true);
    expect(track.enabled).toBe(false);
    scribe.setMuted(false);
    expect(track.enabled).toBe(true);
    scribe.stop();
    expect(sourceNode.disconnect).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(closeAudio).toHaveBeenCalledOnce();
  });

  it("limits automatic caption language detection to Chinese, English, and Japanese", async () => {
    const sourceStream = {
      getAudioTracks: () => [],
      getTracks: () => [],
    };
    const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
    const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
    globalThis.AudioContext = class {
      sampleRate = 48000;
      createMediaStreamSource = vi.fn(() => sourceNode);
      createScriptProcessor = vi.fn(() => processor);
      close = vi.fn(async () => {});
      destination = {};
    };
    let connectionUrl = "";
    globalThis.WebSocket = class {
      static OPEN = 1;
      readyState = 0;
      send = vi.fn();
      close = vi.fn();
      constructor(url) { connectionUrl = String(url); }
    };

    const scribe = new RealtimeScribe({ token: "token", sourceStream });
    await scribe.start();

    const url = new URL(connectionUrl);
    expect(url.searchParams.get("language_code")).toBe("zh");
    expect(url.searchParams.getAll("secondary_languages")).toEqual(["en", "ja"]);
    expect(url.searchParams.get("filter_background_audio")).toBe("true");
    scribe.stop();
  });
});
