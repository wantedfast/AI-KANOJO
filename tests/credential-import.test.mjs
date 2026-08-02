import { describe, expect, it, vi } from "vitest";
import { importDesktopCredentials, parseDesktopCredentials } from "../electron/credential-import.js";

const DEEPSEEK_SECRET = `sk-${"d".repeat(32)}`;
const ELEVEN_SECRET = `xi-${"e".repeat(48)}`;
const credentialFile = `${DEEPSEEK_SECRET} DS\n${ELEVEN_SECRET} ElevenLabs\n`;

function createStore(initialSecrets = {}) {
  let data = { secrets: { ...initialSecrets } };
  return {
    get: () => structuredClone(data),
    patch: vi.fn(async (patch) => {
      data = { ...data, ...patch };
      return structuredClone(data);
    }),
  };
}

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: vi.fn((value) => Buffer.from(`encrypted:${value.length}`)),
};

describe("desktop credential import", () => {
  it("parses the existing secret-first two-line format", () => {
    expect(parseDesktopCredentials(credentialFile)).toEqual({
      deepseek: DEEPSEEK_SECRET,
      elevenlabs: ELEVEN_SECRET,
    });
  });

  it("atomically encrypts both credentials without logging or changing the source", async () => {
    const store = createStore();
    const read = vi.fn(async () => credentialFile);
    const consoleSpies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];

    await expect(importDesktopCredentials({ store, safeStorage, filePath: "desktop.txt", read }))
      .resolves.toEqual({ imported: true, reason: "imported" });

    expect(read).toHaveBeenCalledOnce();
    expect(store.patch).toHaveBeenCalledOnce();
    expect(store.patch.mock.calls[0][0].secrets).toEqual({
      deepseek: Buffer.from(`encrypted:${DEEPSEEK_SECRET.length}`).toString("base64"),
      elevenlabs: Buffer.from(`encrypted:${ELEVEN_SECRET.length}`).toString("base64"),
    });
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  it("does not read or overwrite when either credential already exists", async () => {
    const store = createStore({ deepseek: "protected" });
    const read = vi.fn();
    await expect(importDesktopCredentials({ store, safeStorage, filePath: "desktop.txt", read }))
      .resolves.toEqual({ imported: false, reason: "already-configured" });
    expect(read).not.toHaveBeenCalled();
    expect(store.patch).not.toHaveBeenCalled();
  });

  it("rejects malformed or incomplete files without a partial write", async () => {
    const store = createStore();
    await expect(importDesktopCredentials({
      store,
      safeStorage,
      filePath: "desktop.txt",
      read: async () => `${DEEPSEEK_SECRET} DS\n`,
    })).resolves.toEqual({ imported: false, reason: "invalid-format" });
    expect(store.patch).not.toHaveBeenCalled();
  });
});
