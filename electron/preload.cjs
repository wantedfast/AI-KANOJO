const { contextBridge, ipcRenderer } = require("electron");

const streamReply = async (payload, onDelta) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = `chat:delta:${requestId}`;
  const listener = (_event, delta) => onDelta?.(delta);
  ipcRenderer.on(channel, listener);
  try {
    return await ipcRenderer.invoke("chat:stream", { ...payload, requestId });
  } finally {
    ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld("kanojo", {
  isDesktop: true,
  getBootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  saveChat: (chat) => ipcRenderer.invoke("chat:save", chat),
  saveCredentials: (credentials) => ipcRenderer.invoke("credentials:save", credentials),
  getScribeToken: () => ipcRenderer.invoke("scribe:token"),
  streamReply,
  synthesize: (payload) => ipcRenderer.invoke("eleven:synthesize", payload),
  cancelActive: () => ipcRenderer.invoke("providers:cancel"),
  setLocked: (locked) => ipcRenderer.invoke("window:set-locked", locked),
  startWindowDrag: (point) => ipcRenderer.send("window:drag-start", point),
  moveWindowDrag: (point) => ipcRenderer.send("window:drag-move", point),
  endWindowDrag: () => ipcRenderer.send("window:drag-end"),
  onAudioStop: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("audio:stop", listener);
    return () => ipcRenderer.removeListener("audio:stop", listener);
  },
  onLockedChanged: (callback) => {
    const listener = (_event, locked) => callback(Boolean(locked));
    ipcRenderer.on("window:locked-changed", listener);
    return () => ipcRenderer.removeListener("window:locked-changed", listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("ui:open-settings", listener);
    return () => ipcRenderer.removeListener("ui:open-settings", listener);
  },
});

window.addEventListener("DOMContentLoaded", () => {
  const hitSelector = "button,input,select,form,.status-rail,.drag-surface:not(.is-locked),.glass-panel,.portrait-button,.utility-menu";
  let frame = 0;
  const publishHitRegions = () => {
    frame = 0;
    const regions = Array.from(document.querySelectorAll(hitSelector)).flatMap((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none" || rect.width < 1 || rect.height < 1) return [];
      return [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
    });
    ipcRenderer.send("window:set-hit-regions", regions);
  };
  const schedulePublish = () => {
    if (!frame) frame = requestAnimationFrame(publishHitRegions);
  };
  new ResizeObserver(schedulePublish).observe(document.documentElement);
  new MutationObserver(schedulePublish).observe(document.body, { attributes: true, childList: true, subtree: true });
  schedulePublish();
});
