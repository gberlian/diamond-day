/** Read keeper's read-only fleet shelf inventory without ever delaying a board request. */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
const execute = promisify(execFile);
const TTL = 15_000;
export type ShelfRow = { ray: string; running: number; queued: number; shelf: number; floor: number;
  live: number; light: "red" | "amber" | "green" };
export type ShelfSnapshot = { rays: Record<string, ShelfRow>; live: number; target: 15;
  error: string | null; ready: boolean };
const empty = (error: string | null): ShelfSnapshot => ({ rays: {}, live: 0, target: 15, error, ready: false });
const cache = new Map<string, { at: number; data: ShelfSnapshot }>();
const pending = new Map<string, Promise<ShelfSnapshot>>();
export function clearShelfCache() { cache.clear(); pending.clear(); }
export function shelfLight(running: number, queued: number, shelf: number, floor: number): ShelfRow["light"] {
  if (running + queued < floor && shelf === 0) return "red";
  if (shelf < 2) return "amber";
  return "green";
}
/** Names come from keeper's project field, not from filenames or fabricated counts. */
export function parseShelf(text: string): ShelfSnapshot {
  const rays: Record<string, ShelfRow> = Object.create(null);
  const lines = text.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*(.+?):\s*running=(\d+)\s+queued=(\d+)\s+shelf=(\d+)\s+floor=(\d+)\b/.exec(line);
    if (!match) continue;
    const ray = match[1]!.trim().replace(/\\/g, "/").split("/").at(-1)!;
    if (!/^[a-zA-Z0-9][\w.-]*$/.test(ray) || Object.hasOwn(rays, ray)) continue;
    const [running, queued, shelf, floor] = match.slice(2).map(Number);
    if (![running, queued, shelf, floor].every((n) => Number.isSafeInteger(n) && n >= 0)) continue;
    rays[ray] = { ray, running, queued, shelf, floor, live: running + queued,
      light: shelfLight(running, queued, shelf, floor) };
  }
  if (!Object.keys(rays).length && !/^shelf:\s*0 project\(s\)/m.test(text)) throw new Error("unrecognised keeper shelf output");
  return { rays, live: Object.values(rays).reduce((sum, row) => sum + row.live, 0), target: 15,
    error: null, ready: true };
}
/** fixtureFile is used only for demo/tests. A failed poll never silently turns into green. */
export async function readShelf(root: string, now = Date.now(), keeperPath?: string, fixtureFile?: string): Promise<ShelfSnapshot> {
  const program = process.env.BUN_BIN || "bun";
  const keeper = process.env.RAY_BOARD_KEEPER || keeperPath;
  const fixture = fixtureFile ?? process.env.RAY_BOARD_SHELF_FIXTURE;
  const key = [path.resolve(root), keeper, program, fixture].join("\0");
  const old = cache.get(key);
  if (old && now >= old.at && now - old.at < TTL) return old.data;
  if (pending.has(key)) return old?.data ?? empty("shelf loading");
  if (fixture) {
    try {
      const result = parseShelf(readFileSync(fixture, "utf8"));
      cache.set(key, { at: now, data: result });
      return result;
    } catch (e) { return empty(`shelf fixture unavailable: ${String(e)}`); }
  }
  const promise = (async () => {
    try {
      if (!fixture && (!keeper || keeper.endsWith(".json"))) throw Error("configure keeper for shelf inventory");
      const text = fixture ? readFileSync(fixture, "utf8") :
        (await execute(program, [keeper!, "shelf", "--all-queues", root], {
          timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        })).stdout;
      const result = parseShelf(text);
      cache.set(key, { at: now, data: result });
      return result;
    } catch (err) {
      const error = `shelf unavailable: ${err instanceof Error ? err.message : String(err)}`;
      const failed = old ? { ...old.data, error } : empty(error);
      cache.set(key, { at: now, data: failed });
      return failed;
    }
  })().finally(() => { pending.delete(key); });
  pending.set(key, promise);
  // Always background, including on the first access.
  return old?.data ?? empty("shelf loading");
}
