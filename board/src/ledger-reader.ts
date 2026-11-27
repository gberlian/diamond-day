/** Read-only view of the bridge's authoritative `ledger --json` output. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LedgerJob, LedgerState } from "./goals.ts";
const execute = promisify(execFile);
const TTL_MS = 30_000;
const STATES = new Set<LedgerState>(["failed", "done-zip-missing", "applied", "superseded", "unapplied-late", "done", "waiting", "queued", "dead", "stale", "sending", "running"]);
export type LedgerSnapshot = { jobs: LedgerJob[]; error: string | null };
type CacheEntry = { at: number; data: LedgerSnapshot };
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<LedgerSnapshot>>();
export const clearLedgerCache = () => { cache.clear(); pending.clear(); };
/** After a local rescue keep the last known job visible while the keeper refreshes. */
export const invalidateLedgerCache = () => {
  for (const entry of cache.values()) entry.at = Number.NEGATIVE_INFINITY;
};

/** Allow the checked-in fixture only when explicitly configured (never silently replace a failed keeper). */
export async function readLedger(root: string, now = Date.now(), configuredPath?: string): Promise<LedgerSnapshot> {
  const fixture = process.env.RAY_BOARD_LEDGER_FIXTURE || (configuredPath?.endsWith(".json") ? configuredPath : "");
  const program = process.env.BUN_BIN || "bun";
  const keeper = process.env.RAY_BOARD_KEEPER || (!configuredPath?.endsWith(".json") ? configuredPath : undefined);
  const key = [path.resolve(root), fixture, program, keeper].join("\0");
  const old = cache.get(key);
  if (old && now - old.at >= 0 && now - old.at < TTL_MS) return old.data;
  // The live ledger takes ~40 s over every queue (23 Nov): serve the last good read (or a
  // loading note) at once and refresh behind it, so /api/board never waits on the keeper.
  const background = !fixture && process.env.RAY_BOARD_LEDGER_WAIT !== "1";
  const quick = (): LedgerSnapshot => old ? old.data : { jobs: [], error: "ledger loading" };
  if (pending.has(key)) return background ? quick() : pending.get(key)!;
  const promise = (async (): Promise<LedgerSnapshot> => {
    try {
      if (!fixture && !keeper) throw new Error("set integrations.ledger.path or RAY_BOARD_KEEPER");
      const output = fixture
        ? readFileSync(fixture, "utf8")
        // --summary: 300-char previews, per-job stat cache in the bridge (~0.6 s warm vs ~40 s full).
        : (await execute(program, [keeper!, "ledger", "--all-queues", root, "--summary", "--json"], {
          timeout: 180_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
        })).stdout;
      const parsed: unknown = JSON.parse(output);
      if (!Array.isArray(parsed)) throw new Error("ledger JSON is not an array");
      const jobs = parsed.filter((j): j is LedgerJob => Boolean(j && typeof j === "object" &&
        typeof j.name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(j.name) &&
        typeof j.queueDir === "string" && STATES.has(j.state) &&
        typeof j.minutes === "number" && Number.isFinite(j.minutes) && j.minutes >= 0));
      const data = { jobs, error: null };
      cache.set(key, { at: now, data });
      return data;
    } catch (e) {
      // A failed read is visible on the board and retried on the next poll.
      const error = `ledger unavailable: ${e instanceof Error ? e.message : String(e)}`;
      return old ? { ...old.data, error } : { jobs: [], error };
    }
  })().finally(() => { pending.delete(key); });
  pending.set(key, promise);
  return background ? quick() : promise;
}
