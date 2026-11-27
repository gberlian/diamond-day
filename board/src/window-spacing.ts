/** Shared cooldown for manual controls and the automatic restarter; caller must hold pass.lock. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const WINDOW_GAP_MS = 60_000;
export function lastWindowAction(folder: string): { at: number; ray: string; action: string } | null {
  let latest: { at: number; ray: string; action: string } | null = null;
  try {
    const row = JSON.parse(readFileSync(path.join(folder, "window-action.json"), "utf8"));
    if (Number.isFinite(row.at)) latest = row;
  } catch {}
  // The old restarter already persisted restart timestamps in state.json.
  try {
    const row = JSON.parse(readFileSync(path.join(folder, "state.json"), "utf8"));
    if (Number.isFinite(row.lastAttemptAt) && (!latest || row.lastAttemptAt > latest.at))
      latest = { at: row.lastAttemptAt, ray: "restarter", action: "restart" };
  } catch {}
  return latest;
}
export function windowWait(folder: string, now = Date.now()): number {
  const last = lastWindowAction(folder);
  return last && now >= last.at ? Math.max(0, WINDOW_GAP_MS - (now - last.at)) : last ? WINDOW_GAP_MS : 0;
}
export function reserveWindowAction(folder: string, ray: string, action: string, now = Date.now()): number {
  const wait = windowWait(folder, now);
  if (wait) return wait;
  const target = path.join(folder, "window-action.json");
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ at: now, ray, action }));
  renameSync(temp, target);
  return 0;
}
