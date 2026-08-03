import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(".");
const outputDirectory = path.join(root, "design-qa");
const smokeRunId = `${process.pid}-${Date.now()}`;
const smokeWorkspacePath = path.join(outputDirectory, "electron-smoke-user-data", smokeRunId);
const reportPath = path.join(smokeWorkspacePath, "electron-smoke.json");
const restoreReportPath = path.join(smokeWorkspacePath, "electron-restore-smoke.json");
const executable = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
await mkdir(smokeWorkspacePath, { recursive: true });
await rm(reportPath, { force: true });
await rm(restoreReportPath, { force: true });

let duplicateProbe;
const code = await new Promise((resolve, reject) => {
  const child = spawn(executable, [root], {
    cwd: root,
    env: { ...process.env, AI_KANOJO_SMOKE_REPORT: reportPath, AI_KANOJO_SMOKE_WORKSPACE: smokeWorkspacePath },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("Electron smoke test timed out"));
  }, 35000);
  duplicateProbe = (async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await readFile(reportPath, "utf8");
        break;
      } catch {
        await new Promise((readyResolve) => setTimeout(readyResolve, 50));
      }
    }
    return new Promise((probeResolve, probeReject) => {
      const duplicate = spawn(executable, [root], {
        cwd: root,
        env: { ...process.env, AI_KANOJO_DUPLICATE_PROBE: reportPath, AI_KANOJO_SMOKE_WORKSPACE: smokeWorkspacePath },
        stdio: ["ignore", "inherit", "inherit"],
      });
      const duplicateTimeout = setTimeout(() => {
        duplicate.kill();
        probeReject(new Error("Second Electron instance did not exit after the single-instance lock"));
      }, 5000);
      duplicate.on("error", probeReject);
      duplicate.on("exit", (exitCode) => {
        clearTimeout(duplicateTimeout);
        probeResolve(exitCode);
      });
    });
  })();
  child.on("error", reject);
  child.on("exit", (exitCode) => {
    clearTimeout(timeout);
    resolve(exitCode);
  });
});

if (code !== 0) throw new Error(`Electron smoke process exited with code ${code}`);
if (!duplicateProbe || await duplicateProbe !== 0) throw new Error("Electron single-instance probe failed");
const report = JSON.parse(await readFile(reportPath, "utf8"));
if (!report.window.alwaysOnTop) throw new Error("Electron window was not always-on-top");
if (!report.window.dragHandle || report.window.dragHandle.height < 80) throw new Error("Electron full-rail drag surface is missing or too small");
if (report.window.movementRoom.left + report.window.movementRoom.right < 200) throw new Error("Electron window does not preserve 200px of horizontal movement room");
if (!report.window.dragRegionTracked || report.window.hitRegionCount < 1) throw new Error("Electron main process is not tracking the drag hit region");
if (!report.window.manualDragApi) throw new Error("Electron manual drag API is not exposed through preload");
if (!report.window.dragReady) throw new Error(`Electron drag hit-testing or movement room is invalid: ${JSON.stringify(report.window)}`);
if (Math.abs(report.window.movedBy.x) < 50) throw new Error("Electron window bounds could not move by at least 50px");
if (report.window.movedBy.y > -50) throw new Error("Electron window could not be dragged upward by at least 50px");
if (report.window.persistedAfterDrag.x !== report.window.moved.x || report.window.persistedAfterDrag.y !== report.window.moved.y) {
  throw new Error("Electron did not persist the final drag position exactly");
}
if (
  !report.renderer.beforeIdle
  || !report.renderer.afterListening
  || !report.renderer.beforeExternalStop
  || !report.renderer.afterExternalStop
  || !report.renderer.resleepAvatar?.idle
  || !report.renderer.resleepAvatar.portraitHidden
  || !report.renderer.resleepAvatar.src?.endsWith("idle.png")
  || Math.abs(report.renderer.resleepAvatar.longEdge - 160) > 1
  || !report.renderer.lockedApplied
  || !report.renderer.voiceRail?.present
  || !report.renderer.voiceRail.featureControlsHidden
  || !report.renderer.voiceRail.runtimeAvatarHidden
  || !report.renderer.voiceRail.orderCorrect
  || report.renderer.voiceRail.overlapsCodex
  || report.renderer.portrait?.rect?.width > 230
  || report.renderer.portrait?.rect?.x + report.renderer.portrait?.rect?.width < report.window.visualBounds.rail.x
  || !report.renderer.windowControls?.visible
  || report.renderer.windowControls.itemCount !== 3
  || report.renderer.windowControls.closeColor !== "rgb(255, 95, 87)"
  || report.renderer.windowControls.minimizeColor !== "rgb(254, 188, 46)"
  || !report.renderer.windowControls.vertical
  || report.renderer.windowControls.visibleGap < 6
  || report.renderer.windowControls.visibleGap > 12
  || report.renderer.windowControls.closeCursor !== "pointer"
  || report.renderer.windowControls.minimizeCursor !== "pointer"
  || report.renderer.windowControls.closeTooltip !== "关闭程序"
  || report.renderer.windowControls.minimizeTooltip !== "缩小悬浮窗"
  || report.renderer.windowControls.closeTitle !== "关闭程序"
  || report.renderer.windowControls.minimizeTitle !== "缩小悬浮窗"
  || !report.renderer.windowControls.hitTracked
  || !report.renderer.textChatInput?.present
  || !report.renderer.textChatInput.panelPresent
  || !report.renderer.textChatInput.hitTracked
  || !report.renderer.minimizeToggle?.restoreVisible
  || Math.abs(report.renderer.minimizeToggle.compactWidth - 160) > 1
  || report.renderer.minimizeToggle.compactHeight > 50
  || Math.abs(report.renderer.minimizeToggle.expandedWidth - 520) > 1
  || !report.renderer.settingsVisible
  || !report.renderer.settingsLayout?.aligned
  || report.renderer.settingsLayout.fieldCount !== 3
  || !report.renderer.settingsLayout.voiceTabVisible
  || !report.renderer.settingsLayout.characterTabVisible
  || !report.renderer.settingsLayout.assetManagerVisible
  || report.renderer.settingsLayout.assetImportActionCount !== 5
) {
  throw new Error(`Renderer smoke assertions failed: ${JSON.stringify(report.renderer)}`);
}

const restoreCode = await new Promise((resolve, reject) => {
  const child = spawn(executable, [root], {
    cwd: root,
    env: { ...process.env, AI_KANOJO_RESTORE_REPORT: restoreReportPath, AI_KANOJO_SMOKE_WORKSPACE: smokeWorkspacePath },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("Electron restore smoke test timed out"));
  }, 20000);
  child.on("error", reject);
  child.on("exit", (exitCode) => {
    clearTimeout(timeout);
    resolve(exitCode);
  });
});
if (restoreCode !== 0) throw new Error(`Electron restore process exited with code ${restoreCode}`);
const restoreReport = JSON.parse(await readFile(restoreReportPath, "utf8"));
if (Math.abs(restoreReport.restored.x - report.window.moved.x) > 2 || Math.abs(restoreReport.restored.y - report.window.moved.y) > 2) {
  throw new Error(`Electron restored the wrong window position: ${JSON.stringify({ expected: report.window.moved, actual: restoreReport.restored })}`);
}
console.log(JSON.stringify({ ...report, restore: restoreReport }, null, 2));
