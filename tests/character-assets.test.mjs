import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCharacterAssetManager, sanitizeCharacterAssetConfig } from "../electron/character-assets.js";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createStore = () => {
  let data = { characterAssets: sanitizeCharacterAssetConfig() };
  return {
    get: () => structuredClone(data),
    patch: async (patchValue) => { data = { ...data, ...patchValue }; return structuredClone(data); },
  };
};

describe("character asset manager", () => {
  it("sanitizes persisted filenames and rejects path traversal", () => {
    expect(sanitizeCharacterAssetConfig({
      portrait: "../portrait.png",
      states: { idle: "idle.png", listening: "../listening.webp", thinking: "thinking.jpg" },
    })).toEqual({
      portrait: null,
      states: { idle: "idle.png", listening: null, thinking: "thinking.jpg", completed: null },
    });
  });

  it("imports, resolves, and resets a portrait inside userData", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-kanojo-assets-"));
    temporaryDirectories.push(directory);
    const source = path.join(directory, "chosen.png");
    await writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const store = createStore();
    const manager = createCharacterAssetManager({
      directory,
      store,
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [source] }) },
      validateImage: () => true,
    });

    const imported = await manager.importAsset({ type: "portrait" });
    expect(imported.canceled).toBe(false);
    expect(imported.assets.portrait.customized).toBe(true);
    expect(imported.assets.portrait.src).toMatch(/^data:image\/png;base64,/);
    expect(await readFile(path.join(directory, "character-assets", "portrait.png"))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const reset = await manager.reset({ type: "portrait" });
    expect(reset.assets.portrait).toEqual({ src: null, fileName: null, customized: false });
  });

  it("imports only known 8-bit states and keeps canceled choices unchanged", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-kanojo-assets-"));
    temporaryDirectories.push(directory);
    const source = path.join(directory, "idle.webp");
    await writeFile(source, "pixel");
    const store = createStore();
    let canceled = false;
    const manager = createCharacterAssetManager({
      directory,
      store,
      dialog: { showOpenDialog: async () => canceled ? ({ canceled: true, filePaths: [] }) : ({ canceled: false, filePaths: [source] }) },
      validateImage: () => true,
    });

    await expect(manager.importAsset({ type: "state", state: "speaking" })).rejects.toThrow("不支持");
    const imported = await manager.importAsset({ type: "state", state: "idle" });
    expect(imported.assets.states.idle.customized).toBe(true);
    canceled = true;
    const result = await manager.importAsset({ type: "state", state: "thinking" });
    expect(result.canceled).toBe(true);
    expect(result.assets.states.thinking.customized).toBe(false);
  });
});
