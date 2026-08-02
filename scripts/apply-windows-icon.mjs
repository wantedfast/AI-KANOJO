import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const iconPath = path.join(root, "assets", "icons", "app-icon.ico");
export default async function applyWindowsIcon(context) {
  if (context.electronPlatformName !== "win32") return;
  const executable = path.join(context.appOutDir, `${packageJson.build.productName}.exe`);
  await rcedit(executable, {
    icon: iconPath,
    "file-version": packageJson.version,
    "product-version": packageJson.version,
    "version-string": {
      ProductName: packageJson.build.productName,
      FileDescription: "AI-KANOJO Desktop Companion",
      CompanyName: "AI-KANOJO",
      OriginalFilename: path.basename(executable),
    },
  });
  console.log(`Applied AI-KANOJO icon to ${path.relative(root, executable)}`);
}
