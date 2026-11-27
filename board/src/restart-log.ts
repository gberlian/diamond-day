// Read-only restart history, kept separate to avoid a circular board/restarter import.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type Restart = {
  at: number; ray: string; reason: string; ctx: number | null; idleMin: number | null;
  waited: "ready" | "timeout" | "manual"; ok: boolean; newSession?: string;
  oldSession?: string; handoverId?: string; prepareWaitMs?: number; confirmWaitMs?: number; totalWaitMs?: number; summary?: string;
  error?: string; attempted?: boolean; // false for "no session" diagnostic, not a restart attempt
  action?: "start" | "stop" | "restart"; hwnd?: string | null; steps?: unknown[];
};
export const restartsHome = () => process.env.RAY_RESTARTS_DIR ?? path.join(homedir(), ".ray-restarts");
export function restarts(limit = 200, folder = restartsHome()): Restart[] {
  try {
    const lines = readFileSync(path.join(folder, "log.jsonl"), "utf8")
      .split(/\r?\n/).filter(Boolean);
    const rows: Restart[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        const row = JSON.parse(line);
        if (typeof row.at === "number" && typeof row.ray === "string" && typeof row.ok === "boolean")
          rows.push(row);
      } catch {} // A crash may leave a partial trailing line; retain earlier complete entries.
    }
    return rows;
  } catch { return []; }
}
export function lastRestart(ray: string, folder = restartsHome()): Restart | null {
  return restarts(200, folder).filter((r) => r.ray === ray && r.attempted !== false && (!r.action || r.action === "restart")).at(-1) ?? null;
}
