import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, screen, Tray } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./store.js";
import { createScribeToken, streamDeepSeek, synthesizeElevenV3 } from "./providers.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const smokeReportPath = process.env.AI_KANOJO_SMOKE_REPORT;
const restoreReportPath = process.env.AI_KANOJO_RESTORE_REPORT;
const duplicateProbePath = process.env.AI_KANOJO_DUPLICATE_PROBE;
if (smokeReportPath || restoreReportPath || duplicateProbePath) {
  app.setPath("userData", path.join(path.dirname(smokeReportPath || restoreReportPath || duplicateProbePath), "electron-smoke-user-data"));
}
const ownsSingleInstance = app.requestSingleInstanceLock();
if (!ownsSingleInstance) app.quit();
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
  const icon = nativeImage.createFromPath(path.join(root, "public", "avatar", "8bit", "states", "completed.png")).resize({ width: 28, height: 28 });
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
  ipcMain.handle("app:bootstrap", () => {
    const data = store.get();
    return {
      settings: data.settings,
      chat: data.chat,
      locked: data.locked,
      credentials: credentialStatus(),
    };
  });
  ipcMain.handle("settings:save", async (_event, settings) => {
    const sanitized = {
      demoMode: Boolean(settings.demoMode),
      deepseekModel: ["deepseek-v4-flash", "deepseek-v4-pro"].includes(settings.deepseekModel) ? settings.deepseekModel : "deepseek-v4-flash",
      voiceId: String(settings.voiceId || "").trim().slice(0, 160),
      microphoneId: String(settings.microphoneId || "").trim().slice(0, 512),
    };
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
  ipcMain.handle("chat:stream", async (event, { requestId, messages, model }) => {
    activeRequest?.abort();
    activeRequest = new AbortController();
    return streamDeepSeek({
      apiKey: decrypt("deepseek"),
      model,
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
      signal: activeRequest.signal,
    });
  });
  ipcMain.handle("providers:cancel", () => {
    activeRequest?.abort();
    activeRequest = null;
    return true;
  });
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
  await writeFile(path.join(smokeDirectory, "electron-idle.png"), (await window.webContents.capturePage()).toPNG());
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
        overlapsCodex: Boolean(avatarRect && codexRect && avatarRect.x < codexRect.right && avatarRect.right > codexRect.x && avatarRect.y < codexRect.bottom && avatarRect.bottom > codexRect.y),
      };
    })()
  `, true);
  await writeFile(path.join(smokeDirectory, "electron-awake.png"), (await window.webContents.capturePage()).toPNG());
  for (let attempt = 0; attempt < 50; attempt += 1) {
    renderer.beforeExternalStop = await window.webContents.executeJavaScript('document.querySelector(".state-speaking") !== null', true);
    if (renderer.beforeExternalStop) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await writeFile(path.join(smokeDirectory, "electron-working.png"), (await window.webContents.capturePage()).toPNG());
  window.webContents.send("audio:stop");
  await new Promise((resolve) => setTimeout(resolve, 80));
  renderer.afterExternalStop = await window.webContents.executeJavaScript('document.querySelector(".state-listening") !== null', true);
  window.webContents.send("window:locked-changed", true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  renderer.lockedApplied = await window.webContents.executeJavaScript('document.querySelector(".drag-surface.is-locked") !== null', true);
  window.webContents.send("window:locked-changed", false);
  renderer.utilityMenu = await window.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('[aria-label="打开更多控制"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const menu = document.querySelector('.utility-menu');
      const rect = menu?.getBoundingClientRect();
      return {
        visible: Boolean(menu),
        itemCount: menu?.querySelectorAll('button').length ?? 0,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()
  `, true);
  if (renderer.utilityMenu.rect) {
    const menuCenter = {
      x: renderer.utilityMenu.rect.x + renderer.utilityMenu.rect.width / 2,
      y: renderer.utilityMenu.rect.y + renderer.utilityMenu.rect.height / 2,
    };
    renderer.utilityMenu.hitTracked = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      renderer.utilityMenu.hitTracked = hitRegions.some((region) => pointInside(menuCenter, region));
      if (renderer.utilityMenu.hitTracked) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  await writeFile(path.join(smokeDirectory, "electron-menu.png"), (await window.webContents.capturePage()).toPNG());
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
  renderer.settingsVisible = await window.webContents.executeJavaScript(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return document.querySelector('[aria-label="设置与诊断"]') !== null;
    })()
  `, true);
  const image = await window.webContents.capturePage();
  await writeFile(path.join(smokeDirectory, "electron-smoke.png"), image.toPNG());
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
  app.quit();
}

app.whenReady().then(async () => {
  if (!ownsSingleInstance) return;
  store = new JsonStore(app.getPath("userData"));
  await store.load();
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
  dragSession = null;
  clearInterval(dragPollTimer);
  nativeMoveActive = false;
  clearTimeout(saveBoundsTimer);
  clearTimeout(nativeMoveEndTimer);
  clearInterval(hitTestTimer);
});
