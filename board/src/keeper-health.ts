// Which ray keepers are alive, from each queue's keeper.heartbeat ({"at": ISO, "pid": n}).
// bgrun can't tell: after a code reload a keeper runs outside bgrun, so bgrun shows it
// stopped while it works, and nothing restarts it when it dies (23 Nov: 5 of 9 died in a
// low-memory crash and stayed down). A heartbeat is written every 5 min; 12 min = one missed beat.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type KeeperHealth = { ray: string; alive: boolean; ageMs: number | null; pid: number | null };
export const STALE_MS = 12 * 60_000;

export function keeperHealth(root: string, rays: string[], now = Date.now()): KeeperHealth[] {
  return rays.flatMap((ray) => {
    const q = join(root, ray, ".docs", "chatgpt", "small");
    if (!existsSync(q)) return []; // a ray without a handoff queue has no keeper to watch
    const f = join(q, "keeper.heartbeat");
    let at = NaN, pid: number | null = null;
    try { const j = JSON.parse(readFileSync(f, "utf8")); at = Date.parse(j.at); pid = Number(j.pid) || null; } catch {}
    if (!Number.isFinite(at)) { try { at = statSync(f).mtimeMs; } catch {} }
    const ageMs = Number.isFinite(at) ? Math.max(0, now - at) : null;
    return [{ ray, alive: ageMs !== null && ageMs < STALE_MS, ageMs, pid }];
  });
}
