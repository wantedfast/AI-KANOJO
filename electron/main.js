import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, Tray } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./store.js";
import { createScribeToken, streamDeepSeek, synthesizeElevenV3 } from "./providers.js";
import { importDesktopCredentials } from "./credential-import.js";
import { ElevenAgentsService } from "./elevenagents-service.js";
import { toSafeElevenAgentsError } from "../shared/elevenagents-contracts.js";
import { VOICE_MODE_REALTIME, normalizeVoiceMode } from "../shared/model-contracts.js";
import { createCharacterAssetManager } from "./character-assets.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const runtimeIconDirectory = app.isPackaged
  ? path.join(process.resourcesPath, "assets", "icons")
  : path.join(root, "assets", "icons");
const appIconPath = path.join(runtimeIconDirectory, "app-icon-256.png");
const trayIconPath = path.join(runtimeIconDirectory, "tray-icon-32.png");
const smokeReportPath = process.env.AI_KANOJO_SMOKE_REPORT;
const restoreReportPath = process.env.AI_KANOJO_RESTORE_REPORT;
const duplicateProbePath = process.env.AI_KANOJO_DUPLICATE_PROBE;
const smokeWorkspacePath = process.env.AI_KANOJO_SMOKE_WORKSPACE;
app.setAppUserModelId("com.aikanojo.desktop");
if (smokeReportPath || restoreReportPath || duplicateProbePath) {
  app.setPath("userData", smokeWorkspacePath || path.join(path.dirname(smokeReportPath || restoreReportPath || duplicateProbePath), "electron-smoke-user-data"));
}
const ownsSingleInstance = app.requestSingleInstanceLock();
if (duplicateProbePath) process.exit(ownsSingleInstance ? 2 : 0);
else if (!ownsSingleInstance) app.quit();
let window;
let tray;
let store;
let activeRequest;
let saveBoundsTimer;
let hitTestTimer;
let hitRegions = [];
let mouseEventsIgnored = false;
let dragSession = null;
let dragPollTimer;
let nativeMoveActive = false;
let nativeMoveEndTimer;
let elevenAgentsService;
let characterAssetManager;

const safeElevenAgentsCall = async (operation) => {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: toSafeElevenAgentsError(error) };
  }
};

const pointInside = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

const refreshMousePassthrough = () => {
  if (!window || window.isDestroyed() || !window.isVisible()) return;
  if (dragSession || nativeMoveActive) {
    if (mouseEventsIgnored) {
      mouseEventsIgnored = false;
      window.setIgnoreMouseEvents(false);
    }
    return;
  }
  const bounds = window.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const localPoint = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  const shouldIgnore = !hitRegions.some((region) => pointInside(localPoint, region));
  if (shouldIgnore === mouseEventsIgnored) return;
  mouseEventsIgnored = shouldIgnore;
  window.setIgnoreMouseEvents(shouldIgnore, { forward: true });
};

const validDragPoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);

const startWindowDrag = (point) => {
  if (!window || window.isDestroyed() || store.get().locked || !validDragPoint(point)) return false;
  clearTimeout(saveBoundsTimer);
  dragSession = { pointer: { x: point.x, y: point.y }, bounds: window.getBounds() };
  mouseEventsIgnored = false;
  window.setIgnoreMouseEvents(false);
  clearInterval(dragPollTimer);
  dragPollTimer = setInterval(() => moveWindowDrag(screen.getCursorScreenPoint()), 16);
  return true;
};

const moveWindowDrag = (point) => {
  if (!dragSession || !validDragPoint(point) || !window || window.isDestroyed()) return false;
  const candidate = clampBounds({
    ...dragSession.bounds,
    x: dragSession.bounds.x + Math.round(point.x - dragSession.pointer.x),
    y: dragSession.bounds.y + Math.round(point.y - dragSession.pointer.y),
  });
  window.setPosition(candidate.x, candidate.y);
  return true;
};

const endWindowDrag = async () => {
  if (!dragSession) return false;
  dragSession = null;
  clearInterval(dragPollTimer);
  dragPollTimer = null;
  clearTimeout(saveBoundsTimer);
  if (window && !window.isDestroyed()) await store.patch({ window: window.getBounds() });
  refreshMousePassthrough();
  return true;
};

const clampBounds = (bounds) => {
  const proposed = {
    x: Number.isFinite(bounds?.x) ? bounds.x : 0,
    y: Number.isFinite(bounds?.y) ? bounds.y : 0,
    width: Number.isFinite(bounds?.width) ? bounds.width : 1040,
    height: Number.isFinite(bounds?.height) ? bounds.height : 620,
  };
  const display = screen.getDisplayMatching(proposed);
  const area = display.workArea;
  const width = Math.min(proposed.width, area.width);
  const height = Math.min(proposed.height, area.height);
  // The visible capsule lives near the bottom of a tall transparent window.
  // Keep the capsule on-screen, but allow the transparent portrait area to
  // extend above the work area so an upward drag can actually move the UI.
  const capsuleTopFromBottom = 124;
  const capsuleBottomInset = 28;
  const minimumY = area.y - Math.max(0, height - capsuleTopFromBottom);
  const maximumY = area.y + area.height - Math.max(1, height - capsuleBottomInset);
  const defaultY = maximumY - 24;
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(Number.isFinite(bounds?.x) ? bounds.x : area.x + Math.round((area.width - width) / 2), area.x + area.width - width)),
    y: Math.max(minimumY, Math.min(Number.isFinite(bounds?.y) ? bounds.y : defaultY, maximumY)),
  };
};

const decrypt = (name) => {
  const encoded = store.get().secrets[name];
  if (!encoded) return "";
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法解密凭据");
  return safeStorage.decryptString(Buffer.from(encoded, "base64"));
};

const credentialStatus = () => {
  const secrets = store.get().secrets;
  return { deepseek: Boolean(secrets.deepseek), elevenlabs: Boolean(secrets.elevenlabs) };
};

async function createWindow() {
  const persisted = store.get().window ?? {};
  const saved = { ...persisted, width: 1040, height: 620 };
  window = new BrowserWindow({
    ...clampBounds(saved),
    icon: appIconPath,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true);
  window.setIgnoreMouseEvents(false);
  mouseEventsIgnored = false;
  window.on("will-move", () => {
    nativeMoveActive = true;
    clearTimeout(saveBoundsTimer);
    clearTimeout(nativeMoveEndTimer);
    if (mouseEventsIgnored) {
      mouseEventsIgnored = false;
      window.setIgnoreMouseEvents(false);
    }
  });
  window.on("move", () => {
    if (dragSession) return;
    nativeMoveActive = true;
    clearTimeout(saveBoundsTimer);
    clearTimeout(nativeMoveEndTimer);
    nativeMoveEndTimer = setTimeout(async () => {
      nativeMoveActive = false;
      await store.patch({ window: window.getBounds() });
      refreshMousePassthrough();
    }, 320);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(root, "dist", "client", "index.html"));
  hitTestTimer = setInterval(refreshMousePassthrough, 32);
}

function createTray() {
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16, quality: "best" });
  tray = new Tray(icon);
  tray.setToolTip("AI-KANOJO · 罗照月");
  const refresh = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: window?.isVisible() ? "隐藏照月" : "显示照月", click: () => window?.isVisible() ? window.hide() : window.show() },
    { label: store.get().locked ? "解锁位置" : "锁定位置", click: async () => {
      const locked = !store.get().locked;
      await store.patch({ locked });
      window.webContents.send("window:locked-changed", locked);
      refresh();
    } },
    { label: "打开设置", click: () => { window.show(); window.webContents.send("ui:open-settings"); } },
    { label: "停止语音", click: () => { activeRequest?.abort(); window.webContents.send("audio:stop"); } },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
  refresh();
  tray.on("click", () => window?.isVisible() ? window.hide() : window.show());
}

function installIpc() {
  ipcMain.handle("app:bootstrap", async () => {
    const data = store.get();
    return {
      settings: data.settings,
      chat: data.chat,
      locked: data.locked,
      credentials: credentialStatus(),
      smokeMode: Boolean(smokeReportPath),
      conversationBackend: elevenAgentsService.getStatus(),
      characterAssets: await characterAssetManager.resolve(),
    };
  });
  ipcMain.handle("assets:import", (_event, payload = {}) => characterAssetManager.importAsset(payload));
  ipcMain.handle("assets:reset", (_event, payload = {}) => characterAssetManager.reset(payload));
  ipcMain.handle("settings:save", async (_event, settings) => {
    const sanitized = {
      voiceId: String(settings.voiceId || "").trim().slice(0, 160),
      microphoneId: String(settings.microphoneId || "").trim().slice(0, 512),
      voiceMode: normalizeVoiceMode(settings.voiceMode, settings.ttsModelId) || VOICE_MODE_REALTIME,
    };
    const currentVoiceId = String(store.get().settings?.voiceId || "").trim();
    if (sanitized.voiceId !== currentVoiceId) {
      await elevenAgentsService.setVoiceId({
        voiceId: sanitized.voiceId,
        signal: AbortSignal.timeout(20_000),
      });
    }
    await store.patch({ settings: sanitized });
    return sanitized;
  });
  ipcMain.handle("chat:save", async (_event, chat) => {
    const safeChat = Array.isArray(chat) ? chat.slice(-100).map(({ id, role, content, createdAt }) => ({
      id: String(id),
      role: role === "user" ? "user" : "assistant",
      content: String(content).slice(0, 12000),
      createdAt: Number(createdAt) || Date.now(),
    })) : [];
    await store.patch({ chat: safeChat });
    return true;
  });
  ipcMain.handle("credentials:save", async (_event, credentials) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统凭据保护当前不可用，未保存任何 Key");
    const secrets = { ...store.get().secrets };
    for (const name of ["deepseek", "elevenlabs"]) {
      const value = String(credentials[name] || "").trim();
      if (value) secrets[name] = safeStorage.encryptString(value).toString("base64");
    }
    await store.patch({ secrets });
    return credentialStatus();
  });
  ipcMain.handle("scribe:token", async () => {
    activeRequest?.abort();
    activeRequest = new AbortController();
    return createScribeToken(decrypt("elevenlabs"), activeRequest.signal);
  });
  ipcMain.handle("chat:stream", async (event, { requestId, messages }) => {
    activeRequest?.abort();
    activeRequest = new AbortController();
    return streamDeepSeek({
      apiKey: decrypt("deepseek"),
      messages,
      signal: activeRequest.signal,
      onDelta: (delta) => event.sender.send(`chat:delta:${requestId}`, delta),
    });
  });
  ipcMain.handle("eleven:synthesize", async (_event, payload) => {
    activeRequest?.abort();
    activeRequest = new AbortController();
    return synthesizeElevenV3({
      apiKey: decrypt("elevenlabs"),
      voiceId: payload.voiceId,
      text: payload.text,
      modelId: payload.modelId,
      signal: activeRequest.signal,
    });
  });
  ipcMain.handle("providers:cancel", () => {
    activeRequest?.abort();
    activeRequest = null;
    return true;
  });
  ipcMain.handle("conversation:backend-status", () => elevenAgentsService.getStatus());
  ipcMain.handle("voices:list", () => safeElevenAgentsCall(() => elevenAgentsService.listVoices({ signal: AbortSignal.timeout(20_000) })));
  ipcMain.handle("conversation:configure-agent", (_event, payload = {}) => safeElevenAgentsCall(() => elevenAgentsService.configureAgent({
    agentId: payload.agentId,
    signal: AbortSignal.timeout(20_000),
  })));
  ipcMain.handle("conversation:validate-agent", (_event, payload = {}) => safeElevenAgentsCall(() => elevenAgentsService.validate({ agentId: payload.agentId })));
  ipcMain.handle("conversation:save-agent-id", (_event, payload = {}) => safeElevenAgentsCall(() => elevenAgentsService.saveAgentId({ agentId: payload.agentId })));
  ipcMain.handle("conversation:create-credential", (_event, payload = {}) => safeElevenAgentsCall(() => elevenAgentsService.createCredential({
    requestId: payload.requestId,
  })));
  ipcMain.handle("conversation:cancel-request", (_event, payload = {}) => safeElevenAgentsCall(() => elevenAgentsService.cancel({ requestId: payload.requestId })));
  ipcMain.handle("window:set-locked", async (_event, locked) => {
    if (locked) await endWindowDrag();
    await store.patch({ locked: Boolean(locked) });
    return Boolean(locked);
  });
  ipcMain.on("window:drag-start", (_event, point) => startWindowDrag(point));
  ipcMain.on("window:drag-move", (_event, point) => moveWindowDrag(point));
  ipcMain.on("window:drag-end", () => { void endWindowDrag(); });
  ipcMain.on("app:quit", () => app.quit());
  ipcMain.on("window:set-hit-regions", (_event, regions) => {
    hitRegions = Array.isArray(regions) ? regions
      .filter((region) => [region?.x, region?.y, region?.width, region?.height].every(Number.isFinite))
      .slice(0, 64) : [];
    refreshMousePassthrough();
  });
}

async function runSmokeCheck(reportPath) {
  const smokeDirectory = path.dirname(reportPath);
  const smokeImagePath = (name) => path.join(app.getPath("userData"), `${name}.png`);
  await window.webContents.executeJavaScript(`Promise.all(Array.from(document.images).map((image) => image.complete ? true : image.decode().catch(() => false)))`, true);
  const initial = window.getBounds();
  const display = screen.getDisplayMatching(initial);
  const dragHandle = await window.webContents.executeJavaScript(`
    (() => {
      const element = document.querySelector('.drag-surface:not(.is-locked)');
      const rect = element?.getBoundingClientRect();
      if (!rect) return null;
      const x = Math.round(rect.x + 56);
      const y = Math.round(rect.y + 18);
      const hit = document.elementFromPoint(x, y);
      const controlsNoDrag = Array.from(element.querySelectorAll('button')).every((button) => getComputedStyle(button).webkitAppRegion === 'no-drag');
      return { x, y, width: rect.width, height: rect.height, hitClass: hit?.className || hit?.tagName || "", hitWithinDrag: hit?.closest('.drag-surface') === element, appRegion: getComputedStyle(element).webkitAppRegion, controlsNoDrag };
    })()
  `, true);
  const manualDragApi = await window.webContents.executeJavaScript(`
    ["startWindowDrag", "moveWindowDrag", "endWindowDrag", "quitApp"].every((name) => typeof window.kanojo?.[name] === "function")
  `, true);
  const visualBounds = await window.webContents.executeJavaScript(`
    (() => {
      const pick = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      };
      return { rail: pick('.status-rail'), topLine: pick('.rail-topline'), mainLine: pick('.rail-mainline'), avatarButton: pick('.avatar-button'), avatarImage: pick('.avatar-button img') };
    })()
  `, true);
  if (!dragHandle) throw new Error("No active window drag surface found");
  const dragRegionTracked = hitRegions.some((region) => pointInside({ x: dragHandle.x, y: dragHandle.y }, region));
  const area = display.workArea;
  const movementRoom = {
    left: initial.x - area.x,
    right: area.x + area.width - (initial.x + initial.width),
    up: initial.y - area.y,
    down: area.y + area.height - (initial.y + initial.height),
  };
  const dragReady = dragHandle.appRegion === "no-drag"
    && manualDragApi
    && dragHandle.hitWithinDrag
    && dragHandle.controlsNoDrag
    && dragHandle.height >= 32
    && dragRegionTracked
    && movementRoom.left + movementRoom.right >= 200;
  const dragDelta = movementRoom.right >= 64 ? 64 : -64;
  startWindowDrag({ x: initial.x + dragHandle.x, y: initial.y + dragHandle.y });
  moveWindowDrag({ x: initial.x + dragHandle.x + dragDelta, y: initial.y + dragHandle.y - 64 });
  await endWindowDrag();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const moved = window.getBounds();
  const persistedAfterDrag = store.get().window;
  await writeFile(smokeImagePath("electron-idle"), (await window.webContents.capturePage()).toPNG());
  const renderer = await window.webContents.executeJavaScript(`
    (async () => {
      const avatar = document.querySelector(".avatar-button");
      const beforeIdle = document.querySelector(".state-idle") !== null;
      avatar.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const afterListening = document.querySelector(".state-listening") !== null;
      return { beforeIdle, afterListening };
    })()
  `, true);
  await new Promise((resolve) => setTimeout(resolve, 280));
  renderer.portrait = await window.webContents.executeJavaScript(`
    (() => {
      const image = document.querySelector('.portrait-button img');
      const rect = image?.getBoundingClientRect();
      return image ? { complete: image.complete, naturalWidth: image.naturalWidth, src: image.src, rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : null;
    })()
  `, true);
  renderer.runtimeAvatar = await window.webContents.executeJavaScript(`
    (() => {
      const slot = document.querySelector('.runtime-avatar-slot');
      const avatar = slot?.querySelector('img');
      const features = document.querySelector('.icon-feature-group');
      const codex = document.querySelector('.codex-status');
      const rect = (element) => {
        const value = element?.getBoundingClientRect();
        return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
      };
      const avatarRect = rect(avatar);
      const codexRect = rect(codex);
      return {
        slotPresent: Boolean(slot),
        orderCorrect: Boolean(features && slot && codex && (features.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING) && (slot.compareDocumentPosition(codex) & Node.DOCUMENT_POSITION_FOLLOWING)),
        avatarRect,
        codexRect,
        longEdge: avatarRect ? Math.max(avatarRect.width, avatarRect.height) : null,
        overlapsCodex: Boolean(avatarRect && codexRect && avatarRect.x < codexRect.right && avatarRect.right > codexRect.x && avatarRect.y < codexRect.bottom && avatarRect.bottom > codexRect.y),
      };
    })()
  `, true);
  await writeFile(smokeImagePath("electron-awake"), (await window.webContents.capturePage()).toPNG());
  for (let attempt = 0; attempt < 50; attempt += 1) {
    renderer.beforeExternalStop = await window.webContents.executeJavaScript('document.querySelector(".state-speaking") !== null', true);
    if (renderer.beforeExternalStop) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await writeFile(smokeImagePath("electron-working"), (await window.webContents.capturePage()).toPNG());
  window.webContents.send("audio:stop");
  await new Promise((resolve) => setTimeout(resolve, 80));
  renderer.afterExternalStop = await window.webContents.executeJavaScript('document.querySelector(".state-listening") !== null', true);
  renderer.resleepAvatar = await window.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('.feature-companion')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const image = document.querySelector('.runtime-avatar-slot img');
      const rect = image?.getBoundingClientRect();
      return {
        idle: document.querySelector('.state-idle.is-awake') !== null,
        portraitHidden: document.querySelector('.portrait-button') === null,
        src: image?.getAttribute('src') ?? null,
        longEdge: rect ? Math.max(rect.width, rect.height) : null,
      };
    })()
  `, true);
  window.webContents.send("window:locked-changed", true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  renderer.lockedApplied = await window.webContents.executeJavaScript('document.querySelector(".drag-surface.is-locked") !== null', true);
  window.webContents.send("window:locked-changed", false);
  renderer.windowControls = await window.webContents.executeJavaScript(`
    (() => {
      const controls = document.querySelector('.window-traffic-lights');
      const close = document.querySelector('.traffic-light-close');
      const minimize = document.querySelector('.traffic-light-minimize');
      const rect = controls?.getBoundingClientRect();
      const closeDot = close?.querySelector('span')?.getBoundingClientRect();
      const minimizeDot = minimize?.querySelector('span')?.getBoundingClientRect();
      const color = (selector) => getComputedStyle(document.querySelector(selector + ' span')).backgroundColor;
      return {
        visible: Boolean(controls),
        itemCount: controls?.querySelectorAll('button').length ?? 0,
        closeColor: close ? color('.traffic-light-close') : null,
        minimizeColor: minimize ? color('.traffic-light-minimize') : null,
        closeCursor: close ? getComputedStyle(close).cursor : null,
        minimizeCursor: minimize ? getComputedStyle(minimize).cursor : null,
        closeTooltip: close?.dataset.tooltip ?? null,
        minimizeTooltip: minimize?.dataset.tooltip ?? null,
        closeTitle: close?.title ?? null,
        minimizeTitle: minimize?.title ?? null,
        vertical: Boolean(closeDot && minimizeDot && Math.abs(closeDot.x - minimizeDot.x) < 1),
        visibleGap: closeDot && minimizeDot ? minimizeDot.y - closeDot.bottom : null,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()
  `, true);
  if (renderer.windowControls.rect) {
    const controlsCenter = {
      x: renderer.windowControls.rect.x + renderer.windowControls.rect.width / 2,
      y: renderer.windowControls.rect.y + renderer.windowControls.rect.height / 2,
    };
    renderer.windowControls.hitTracked = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      renderer.windowControls.hitTracked = hitRegions.some((region) => pointInside(controlsCenter, region));
      if (renderer.windowControls.hitTracked) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  renderer.textChatInput = await window.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('[aria-label="打开文字聊天"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const input = document.querySelector('[aria-label="输入聊天消息"]');
      const panel = input?.closest('.conversation-panel');
      const rect = input?.getBoundingClientRect();
      return {
        present: Boolean(input),
        panelPresent: Boolean(panel),
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()
  `, true);
  if (renderer.textChatInput.rect) {
    const inputCenter = {
      x: renderer.textChatInput.rect.x + renderer.textChatInput.rect.width / 2,
      y: renderer.textChatInput.rect.y + renderer.textChatInput.rect.height / 2,
    };
    renderer.textChatInput.hitTracked = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      renderer.textChatInput.hitTracked = hitRegions.some((region) => pointInside(inputCenter, region));
      if (renderer.textChatInput.hitTracked) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭文字聊天"]')?.click()`, true);
  await writeFile(smokeImagePath("electron-menu"), (await window.webContents.capturePage()).toPNG());
  renderer.minimizeToggle = await window.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('[aria-label="缩小悬浮窗"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const compact = document.querySelector('.status-rail')?.getBoundingClientRect();
      const restore = document.querySelector('[aria-label="展开悬浮窗"]');
      restore?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const expanded = document.querySelector('.status-rail')?.getBoundingClientRect();
      return { compactWidth: compact?.width, compactHeight: compact?.height, restoreVisible: Boolean(restore), expandedWidth: expanded?.width };
    })()
  `, true);
  window.webContents.send("ui:open-settings");
  renderer.settingsLayout = await window.webContents.executeJavaScript(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const panel = document.querySelector('[aria-label="设置与诊断"]');
      const selects = Array.from(panel?.querySelectorAll('.settings-grid select') || []).map((select) => {
        const rect = select.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      });
      const assetManager = panel?.querySelector('.character-assets-manager');
      return {
        visible: Boolean(panel),
        fieldCount: selects.length,
        assetManagerVisible: Boolean(assetManager),
        assetImportActionCount: assetManager?.querySelectorAll('button[aria-label^="替换"]').length || 0,
        aligned: selects.length === 3
          && selects.every((select) => Math.abs(select.top - selects[0].top) <= 1 && Math.abs(select.height - selects[0].height) <= 1),
        selects,
      };
    })()
  `, true);
  renderer.settingsVisible = renderer.settingsLayout.visible;
  const image = await window.webContents.capturePage();
  await writeFile(smokeImagePath("electron-smoke"), image.toPNG());
  await writeFile(reportPath, `${JSON.stringify({
    window: {
      alwaysOnTop: window.isAlwaysOnTop(),
      dragHandle,
      visualBounds,
      hitRegionCount: hitRegions.length,
      dragRegionTracked,
      manualDragApi,
      dragReady,
      movementRoom,
      initial,
      moved,
      movedBy: { x: moved.x - initial.x, y: moved.y - initial.y },
      persistedAfterDrag,
    },
    renderer,
  }, null, 2)}\n`, "utf8");
  // Keep the smoke-test primary instance alive long enough for the
  // single-instance probe to contend for the lock deterministically.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  app.quit();
}

app.whenReady().then(async () => {
  if (!ownsSingleInstance) return;
  store = new JsonStore(app.getPath("userData"));
  await store.load();
  characterAssetManager = createCharacterAssetManager({
    directory: app.getPath("userData"),
    store,
    dialog,
    validateImage: (filePath) => !nativeImage.createFromPath(filePath).isEmpty(),
  });
  elevenAgentsService = new ElevenAgentsService({ store, getApiKey: () => decrypt("elevenlabs") });
  if (!smokeReportPath && !restoreReportPath && !duplicateProbePath) {
    await importDesktopCredentials({
      store,
      safeStorage,
      filePath: path.join(app.getPath("desktop"), "DS and ElevenLabs.txt"),
    });
    const data = store.get();
    if (data.secrets?.elevenlabs && data.elevenAgents?.agentId && !elevenAgentsService.getStatus().configured) {
      await safeElevenAgentsCall(() => elevenAgentsService.configureAgent({ signal: AbortSignal.timeout(20_000) }));
    }
  }
  installIpc();
  await createWindow();
  if (restoreReportPath) {
    await writeFile(restoreReportPath, `${JSON.stringify({ restored: window.getBounds() }, null, 2)}\n`, "utf8");
    app.quit();
    return;
  }
  if (smokeReportPath) {
    await runSmokeCheck(smokeReportPath);
    return;
  }
  createTray();
});

app.on("second-instance", () => {
  if (!window || window.isDestroyed()) return;
  window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.on("window-all-closed", (event) => event.preventDefault());
app.on("before-quit", () => {
  activeRequest?.abort();
  elevenAgentsService?.abortAll();
  dragSession = null;
  clearInterval(dragPollTimer);
  nativeMoveActive = false;
  clearTimeout(saveBoundsTimer);
  clearTimeout(nativeMoveEndTimer);
  clearInterval(hitTestTimer);
});
