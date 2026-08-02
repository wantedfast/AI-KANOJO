import { readFile } from "node:fs/promises";

const LABELS = new Map([
  ["ds", "deepseek"],
  ["deepseek", "deepseek"],
  ["elevenlabs", "elevenlabs"],
]);

export function parseDesktopCredentials(contents) {
  const parsed = {};
  const lines = String(contents || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const fields = line.split(/\s+/);
    if (fields.length !== 2) throw new Error("密钥文件格式无效");
    const [secret, rawLabel] = fields;
    const name = LABELS.get(rawLabel.toLowerCase());
    if (!name || secret.length < 16 || /\s/.test(secret) || parsed[name]) {
      throw new Error("密钥文件格式无效");
    }
    parsed[name] = secret;
  }
  if (!parsed.deepseek || !parsed.elevenlabs || lines.length !== 2) {
    throw new Error("密钥文件必须同时包含 DS 和 ElevenLabs");
  }
  return parsed;
}

export async function importDesktopCredentials({ store, safeStorage, filePath, read = readFile }) {
  const existing = store.get().secrets || {};
  if (existing.deepseek || existing.elevenlabs) return { imported: false, reason: "already-configured" };
  if (!safeStorage.isEncryptionAvailable()) return { imported: false, reason: "encryption-unavailable" };

  let contents;
  try {
    contents = await read(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { imported: false, reason: "file-missing" };
    return { imported: false, reason: "file-unreadable" };
  }

  let credentials;
  try {
    credentials = parseDesktopCredentials(contents);
  } catch {
    return { imported: false, reason: "invalid-format" };
  }

  await store.patch({
    secrets: {
      deepseek: safeStorage.encryptString(credentials.deepseek).toString("base64"),
      elevenlabs: safeStorage.encryptString(credentials.elevenlabs).toString("base64"),
    },
  });
  return { imported: true, reason: "imported" };
}
