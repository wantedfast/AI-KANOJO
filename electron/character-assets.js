import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { CHARACTER_ASSET_STATES, normalizeCharacterAssetState } from "../shared/character-assets.js";

const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

const emptyConfig = () => ({ portrait: null, states: Object.fromEntries(CHARACTER_ASSET_STATES.map((state) => [state, null])) });

export function sanitizeCharacterAssetConfig(value) {
  const next = emptyConfig();
  const portrait = String(value?.portrait || "").trim();
  if (/^portrait\.(png|webp|jpe?g)$/i.test(portrait)) next.portrait = portrait;
  for (const state of CHARACTER_ASSET_STATES) {
    const name = String(value?.states?.[state] || "").trim();
    if (new RegExp(`^${state}\\.(png|webp|jpe?g)$`, "i").test(name)) next.states[state] = name;
  }
  return next;
}

const toDataUrl = async (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXTENSION.get(extension);
  if (!mime) return null;
  try {
    const data = await readFile(filePath);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

export function createCharacterAssetManager({ directory, store, dialog, validateImage }) {
  const assetDirectory = path.join(directory, "character-assets");

  const resolve = async () => {
    const config = sanitizeCharacterAssetConfig(store.get().characterAssets);
    const portraitSrc = config.portrait ? await toDataUrl(path.join(assetDirectory, config.portrait)) : null;
    const states = {};
    for (const state of CHARACTER_ASSET_STATES) {
      const fileName = config.states[state];
      states[state] = {
        src: fileName ? await toDataUrl(path.join(assetDirectory, fileName)) : null,
        fileName,
        customized: Boolean(fileName),
      };
    }
    return {
      portrait: { src: portraitSrc, fileName: config.portrait, customized: Boolean(config.portrait) },
      states,
    };
  };

  const importAsset = async ({ type, state } = {}) => {
    const stateKey = type === "state" ? normalizeCharacterAssetState(state) : null;
    if (type !== "portrait" && !stateKey) throw new Error("不支持的角色资产类型");
    const result = await dialog.showOpenDialog({
      title: type === "portrait" ? "选择 2D 立绘" : `选择 ${stateKey} 8-bit 状态图`,
      properties: ["openFile"],
      filters: [{ name: "角色图片", extensions: ["png", "webp", "jpg", "jpeg"] }],
    });
    if (result.canceled || result.filePaths.length !== 1) return { canceled: true, assets: await resolve() };

    const source = path.resolve(result.filePaths[0]);
    const extension = path.extname(source).toLowerCase();
    if (!MIME_BY_EXTENSION.has(extension)) throw new Error("仅支持 PNG、WebP 或 JPEG 图片");
    const sourceStat = await stat(source);
    if (!sourceStat.isFile() || sourceStat.size < 1 || sourceStat.size > MAX_ASSET_BYTES) throw new Error("图片为空或超过 12MB");
    if (validateImage && !validateImage(source)) throw new Error("图片无法读取或格式无效");

    await mkdir(assetDirectory, { recursive: true });
    const baseName = type === "portrait" ? "portrait" : stateKey;
    const fileName = `${baseName}${extension}`;
    const destination = path.join(assetDirectory, fileName);
    const temporary = `${destination}.tmp`;
    await copyFile(source, temporary);
    await rename(temporary, destination);

    const current = sanitizeCharacterAssetConfig(store.get().characterAssets);
    const previous = type === "portrait" ? current.portrait : current.states[stateKey];
    if (type === "portrait") current.portrait = fileName;
    else current.states[stateKey] = fileName;
    await store.patch({ characterAssets: current });
    if (previous && previous !== fileName) await rm(path.join(assetDirectory, previous), { force: true });
    return { canceled: false, assets: await resolve() };
  };

  const reset = async ({ type, state } = {}) => {
    const current = sanitizeCharacterAssetConfig(store.get().characterAssets);
    const stateKey = type === "state" ? normalizeCharacterAssetState(state) : null;
    if (type === "portrait") {
      if (current.portrait) await rm(path.join(assetDirectory, current.portrait), { force: true });
      current.portrait = null;
    } else if (type === "state" && stateKey) {
      if (current.states[stateKey]) await rm(path.join(assetDirectory, current.states[stateKey]), { force: true });
      current.states[stateKey] = null;
    } else if (type === "states") {
      for (const key of CHARACTER_ASSET_STATES) {
        if (current.states[key]) await rm(path.join(assetDirectory, current.states[key]), { force: true });
        current.states[key] = null;
      }
    } else {
      throw new Error("不支持的角色资产重置类型");
    }
    await store.patch({ characterAssets: current });
    return { assets: await resolve() };
  };

  return { resolve, importAsset, reset };
}
