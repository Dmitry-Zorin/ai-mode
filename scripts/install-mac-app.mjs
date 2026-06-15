import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Skipping macOS app install on non-macOS platform.");
  process.exit(0);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appName = "AI Mode.app";
const sourceApp = path.join(
  rootDir,
  "packages/desktop/src-tauri/target/release/bundle/macos",
  appName,
);
const targetApp = path.join("/Applications", appName);

if (!existsSync(sourceApp)) {
  throw new Error(`Built app bundle not found: ${sourceApp}`);
}

await mkdir("/Applications", { recursive: true });
await rm(targetApp, { recursive: true, force: true });
await rename(sourceApp, targetApp);

console.log(`Moved ${appName} to ${targetApp}`);
