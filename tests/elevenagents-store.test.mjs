import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "../electron/store.js";
import { VOICE_MODE_EXPRESSIVE, VOICE_MODE_REALTIME } from "../shared/model-contracts.js";

const directories = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("ElevenAgents store", () => {
  it("persists only Agent metadata and never session credentials", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-kanojo-agent-"));
    directories.push(directory);
    const store = new JsonStore(directory);
    await store.load();
    await store.patch({ elevenAgents: { agentId: "agent_7101k5zvyjhmfg983brhmhkd98n6", verifiedAgentId: "agent_7101k5zvyjhmfg983brhmhkd98n6", verifiedAt: 123, configVersion: "qwen-native-v1" } });
    const raw = await readFile(path.join(directory, "state.json"), "utf8");
    expect(raw).toContain("agent_7101k5zvyjhmfg983brhmhkd98n6");
    expect(raw).not.toContain("conversationToken");
    expect(raw).not.toContain("signedUrl");
  });

  it("sanitizes malformed persisted Agent metadata", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-kanojo-agent-"));
    directories.push(directory);
    const store = new JsonStore(directory);
    await store.load();
    await store.patch({ elevenAgents: { agentId: "x".repeat(300), verifiedAgentId: "y".repeat(300), verifiedAt: -1, configVersion: "z".repeat(300) } });
    const reloaded = new JsonStore(directory);
    const data = await reloaded.load();
    expect(data.elevenAgents.agentId).toHaveLength(160);
    expect(data.elevenAgents.verifiedAgentId).toHaveLength(160);
    expect(data.elevenAgents.verifiedAt).toBe(0);
    expect(data.elevenAgents.configVersion).toHaveLength(80);
  });

  it("migrates legacy ttsModelId settings to semantic voiceMode", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-kanojo-agent-"));
    directories.push(directory);
    const file = path.join(directory, "state.json");
    await writeFile(file, JSON.stringify({
      settings: { voiceId: "voice", microphoneId: "mic", ttsModelId: "eleven_v3" },
    }));
    const store = new JsonStore(directory);
    const data = await store.load();
    expect(data.settings).toEqual({ voiceId: "voice", microphoneId: "mic", voiceMode: VOICE_MODE_EXPRESSIVE });
  });

  it("defaults invalid persisted settings to realtime voice mode", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-kanojo-agent-"));
    directories.push(directory);
    const file = path.join(directory, "state.json");
    await writeFile(file, JSON.stringify({
      settings: { voiceId: "voice", microphoneId: "mic", voiceMode: "bad-mode" },
    }));
    const store = new JsonStore(directory);
    const data = await store.load();
    expect(data.settings.voiceMode).toBe(VOICE_MODE_REALTIME);
  });
});
