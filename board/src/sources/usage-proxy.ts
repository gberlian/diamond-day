import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { BoardConfig } from "../config.ts";
import type { Overview } from "../board.ts";
import type { Source } from "./types.ts";
const blank = (): Overview => ({ fivePct: null, fiveReset: null, sevenPct: null, sevenReset: null,
  todayUsd: 0, calls: 0, errorsHour: 0, live: 0, perRayUsd: {} });
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
/** Price table in $ per million tokens, keyed by model prefix (prompt-proxy's prices.json shape).
 *  Looked up next to the proxy's data folder unless the integration names one. */
export function loadPrices(file: string | undefined): Record<string, Price> {
  const out: Record<string, Price> = {};
  if (!file || !existsSync(file)) return out;
  try {
    for (const [model, p] of Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, any>)) {
      const input = Number(p?.input), output = Number(p?.output);
      if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
      out[model] = { input, output, cacheRead: Number(p.cache_read ?? input * 0.1), cacheWrite: Number(p.cache_write ?? input * 1.25) };
    }
  } catch { /* unreadable table: costs stay 0 */ }
  return out;
}
export function rowCost(row: any, prices: Record<string, Price>): number {
  const stored = Number(row.cost_usd ?? row.total_cost_usd ?? 0) || 0;
  if (stored) return stored;
  const model = String(row.model ?? "");
  let best = "";
  for (const prefix of Object.keys(prices)) if (model.startsWith(prefix) && prefix.length > best.length) best = prefix;
  if (!best) return 0;
  const p = prices[best]!;
  const n = (k: string) => Number(row[k] ?? 0) || 0;
  return (n("input_uncached") * p.input + n("cache_read") * p.cacheRead + n("cache_write") * p.cacheWrite + n("output_tokens") * p.output) / 1e6;
}
export const proxySource: Source<Overview> = {
  async read(config) {
    const setting = config.integrations.usageProxy;
    if (!setting.enabled) return null;
    if (setting.url) {
      try {
        const response = await fetch(setting.url, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) return null;
        const data: any = await response.json();
        return data && typeof data === "object" && Number.isFinite(data.calls) ? { ...blank(), ...data } : null;
      } catch { return null; }
    }
    const file = setting.path;
    if (!file || !existsSync(file)) return null;
    try {
      const db = process.versions.bun
        ? new (await import("bun:sqlite")).Database(file, { readonly: true })
        : new (await import("node:sqlite")).DatabaseSync(file, { readOnly: true });
      const query = (sql: string) => "query" in db ? db.query(sql) : db.prepare(sql);
      try {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const rows = query("select * from requests where started_at >= ?").all(start.getTime()) as any[];
        const overview = blank();
        const prices = loadPrices((setting as any).prices ?? path.join(path.dirname(path.dirname(file)), "prices.json"));
        overview.calls = rows.length;
        for (const row of rows) {
          const usd = rowCost(row, prices);
          overview.todayUsd += usd;
          if (row.started_at >= Date.now() - 3600000 && (row.state === "error" || row.status >= 400)) overview.errorsHour++;
          if (row.state === "pending" && row.started_at >= Date.now() - 900000) overview.live++;
          if (usd && typeof row.project_path === "string") {
            const relative = path.relative(config.raysRoot, row.project_path);
            const ray = relative.split(path.sep)[0];
            if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && ray)
              overview.perRayUsd[ray] = (overview.perRayUsd[ray] ?? 0) + usd;
          }
        }
        try {
          const header = query(`select res_headers h from bodies where res_headers like '%unified-5h-utilization%' order by request_id desc limit 1`).get() as {h:string}|null;
          if (header?.h) {
            const h = JSON.parse(header.h);
            const p = (key: string) => h[key] == null ? null : Number(h[key]);
            overview.fivePct = p("anthropic-ratelimit-unified-5h-utilization") == null ? null : p("anthropic-ratelimit-unified-5h-utilization")! * 100;
            overview.sevenPct = p("anthropic-ratelimit-unified-7d-utilization") == null ? null : p("anthropic-ratelimit-unified-7d-utilization")! * 100;
            overview.fiveReset = p("anthropic-ratelimit-unified-5h-reset") == null ? null : p("anthropic-ratelimit-unified-5h-reset")! * 1000;
            overview.sevenReset = p("anthropic-ratelimit-unified-7d-reset") == null ? null : p("anthropic-ratelimit-unified-7d-reset")! * 1000;
          }
        } catch {}
        return overview;
      } finally { db.close(); }
    } catch { return null; }
  },
};

/** The board never waits for local SQLite I/O. A worker owns the entire synchronous
 * open/query/close cycle; the next poll gets the most recent completed snapshot.
 * Direct callers of proxySource.read still get a fresh result. */
function workerRead(config: BoardConfig): Promise<Overview | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./usage-proxy-worker.ts", import.meta.url), { workerData: config });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`usage worker exited before returning (${code})`)));
  });
}
type Snapshot = { value: Overview | null; at: number; pending: boolean };
export class UsageSnapshotCache {
  private entries = new Map<string, Snapshot>();
  private read: typeof workerRead;
  private clock: () => number;
  constructor(read = workerRead, clock = Date.now) { this.read = read; this.clock = clock; }
  get(config: BoardConfig): Overview | null {
    const setting = config.integrations.usageProxy;
    if (!setting.enabled || !setting.path || setting.url) return null;
    const key = JSON.stringify([config.raysRoot, setting]);
    let entry = this.entries.get(key);
    if (!entry) {
      // Do not evict in-flight reads: that would allow duplicate workers.
      if (this.entries.size >= 16) {
        const idle = [...this.entries].find(([, v]) => !v.pending);
        if (!idle) return null;
        this.entries.delete(idle[0]);
      }
      entry = { value: null, at: -Infinity, pending: false };
      this.entries.set(key, entry);
    }
    if (!entry.pending && this.clock() - entry.at >= 2000) {
      const target = entry;
      const captured = structuredClone(config);
      target.pending = true;
      // Even starting the worker is outside the current board collection.
      setImmediate(() => {
        Promise.resolve().then(() => this.read(captured)).then(
          value => { target.value = value; },
          () => { target.value = null; },
        ).finally(() => { target.at = this.clock(); target.pending = false; });
      });
    }
    return entry.value;
  }
}
const usageSnapshots = new UsageSnapshotCache();
export function readBoardUsage(config: BoardConfig): Overview | null | Promise<Overview | null> {
  return config.integrations.usageProxy.url ? proxySource.read(config) : usageSnapshots.get(config);
}
