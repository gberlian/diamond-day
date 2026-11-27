import { spawn } from "node:child_process";
import type { Integrations } from "../config.ts";
import type { OpenKind } from "../open-handoff.ts";
/** Never invoke a shell or accept a path from the HTTP caller; containment is checked upstream. */
function spawnViewer(command: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [file], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
export async function launchOpen(kind: OpenKind, file: string, mode: Integrations["openWith"]): Promise<void> {
  if (mode === "off") throw new Error("open action is disabled");
  const system = process.platform === "win32" ? "explorer.exe" :
    process.platform === "darwin" ? "open" : "xdg-open";
  if (mode === "md-aio" && kind === "reply") {
    try { await spawnViewer("md-aio", file); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await spawnViewer(system, file);
}
