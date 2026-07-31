import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(".");
const outputDirectory = path.join(root, "design-qa");
const reportPath = path.join(outputDirectory, "electron-smoke.json");
const restoreReportPath = path.join(outputDirectory, "electron-restore-smoke.json");
const executable = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
await mkdir(outputDirectory, { recursive: true });
await rm(path.join(outputDirectory, "electron-smoke-user-data"), { recursive: true, force: true });

let duplicateProbe;
const code = await new Promise((resolve, reject) => {
  const child = spawn(executable, [root], {
    cwd: root,
    env: { ...process.env, AI_KANOJO_SMOKE_REPORT: reportPath },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("Electron smoke test timed out"));
  }, 20000);
  setTimeout(() => {
    duplicateProbe = new Promise((probeResolve, probeReject) => {
      const duplicate = spawn(executable, [root], {
        cwd: root,
        env: { ...process.env, AI_KANOJO_DUPLICATE_PROBE: reportPath },
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
  }, 700);
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
if (!report.window.dragHandle || report.window.dragHandle.height < 100) throw new Error("Electron full-rail drag surface is missing or too small");
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
  || !report.renderer.lockedApplied
  || !report.renderer.utilityMenu?.visible
  || report.renderer.utilityMenu.itemCount !== 4
  || !report.renderer.utilityMenu.hitTracked
  || !report.renderer.minimizeToggle?.restoreVisible
  || report.renderer.minimizeToggle.compactWidth > 130
  || report.renderer.minimizeToggle.compactHeight > 50
  || report.renderer.minimizeToggle.expandedWidth < 500
  || !report.renderer.settingsVisible
) {
  throw new Error(`Renderer smoke assertions failed: ${JSON.stringify(report.renderer)}`);
}

const restoreCode = await new Promise((resolve, reject) => {
  const child = spawn(executable, [root], {
    cwd: root,
    env: { ...process.env, AI_KANOJO_RESTORE_REPORT: restoreReportPath },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("Electron restore smoke test timed out"));
  }, 12000);
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
