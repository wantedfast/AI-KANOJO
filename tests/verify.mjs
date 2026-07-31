import { spawnSync } from "node:child_process";

const commands = [
  ["node", ["--check", "electron/main.js"]],
  ["node", ["--check", "electron/preload.cjs"]],
  ["node", ["--check", "electron/providers.js"]],
  ["node", ["--check", "electron/store.js"]],
  ["npm", ["test"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "test:electron"]],
  ["npm", ["run", "test:sites"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status || 1);
}
