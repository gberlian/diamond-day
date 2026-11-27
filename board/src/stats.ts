/** Read-only fleet statistics. Heavy scans run in a worker (see StatsCache). */
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { gunzipSync } from "node:zlib";
import { parseKeeperLog, type KeeperEvent } from "./domain/handoffs.ts";

export const STATS_PRICES = Object.freeze({ model: "Claude Opus 5.5", readOn: "2026-11-27",
  perMillion: { input: 4, cacheWrite: 8, cacheRead: 0.20, output: 20 } });
export const STATS_TTL_MS = 60_000;
export type StatsOptions = { raysRoot: string; claudeProjectsDir: string; dataDir: string; now?: number; rayFilter?: string };
export type Usage = { calls: number; input: number; cacheRead: number; cacheWrite: number; output: number; thinking: number;
  tokens: number; avgContext: number | null; cost: number };
export type DailyUsage = Usage & { ray: string; day: string };
export type Outcome = "done" | "applied" | "superseded" | "failed" | "lost" | "running";
export type Handoff = { ray: string; job: string; launched: number | null; firstLaunch: number | null; finished: number | null;
  thinkingMs: number | null; thinkingSource: "keeper" | "reply-mtime" | "state" | null; thoughtLabel: string | null; thoughtMs: number | null; outcome: Outcome;
  zipBytes: number | null; replyPath: string | null; attempts: number | null; chatId: string | null;
  finishSource: "keeper" | "reply-mtime" | "state" | null };
export type Period = Usage & { handoffs: number; replies: number; applied: number; appliedPct: number | null;
  checks: number; checksPassed: number; checkPct: number | null };
export type RayStats = { ray: string; today: Period; sevenDays: Period; all: Period };
export type Stats = { generatedAt: number; today: string; days: string[]; prices: typeof STATS_PRICES;
  totals: { today: Period; sevenDays: Period; all: Period }; rays: RayStats[]; daily: DailyUsage[];
  handoffs: Handoff[]; diagnostics: { malformedLines: number; undatedMessages: number; unkeyedMessages: number; duplicateMessages: number; unreadable: string[] } };
type Diagnostics = Stats["diagnostics"];
type Counts = Pick<Usage, "calls" | "input" | "cacheRead" | "cacheWrite" | "output" | "thinking">;
const empty = (): Counts => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0 });
const keys = Object.keys(empty()) as (keyof Counts)[];
const add = (a: Counts, b: Counts) => { for (const k of keys) a[k] += b[k]; };
const usage = (c: Counts): Usage => {
  const context = c.input + c.cacheRead + c.cacheWrite, p = STATS_PRICES.perMillion;
  return { ...c, tokens: context + c.output, avgContext: c.calls ? context / c.calls : null,
    cost: (c.input * p.input + c.cacheRead * p.cacheRead + c.cacheWrite * p.cacheWrite + c.output * p.output) / 1e6 };
};
const diagnostics = (): Diagnostics => ({ malformedLines: 0, undatedMessages: 0, unkeyedMessages: 0, duplicateMessages: 0, unreadable: [] });
const valid = (s: string) => /^[A-Za-z0-9][\w.-]*$/.test(s);
const num = (n: unknown): number => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
const epoch = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : typeof x === "string" ? Date.parse(x) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 8.64e15 ? n : null;
};
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function recentDays(now: number): string[] {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 6 + i); return localDay(d.getTime()); });
}
async function optional<T>(fn: () => Promise<T>, fallback: T, file: string, d: Diagnostics): Promise<T> {
  try { return await fn(); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT" && (e as NodeJS.ErrnoException).code !== "ENOTDIR") d.unreadable.push(file);
    return fallback;
  }
}
const names = (dir: string, d: Diagnostics) => optional(() => readdir(dir), [], dir, d);
const text = (file: string, d: Diagnostics) => optional(() => readFile(file, "utf8"), "", file, d);
const info = (file: string, d: Diagnostics) => optional(() => stat(file), null, file, d);
async function json(file: string, d: Diagnostics): Promise<any> {
  const s = await text(file, d); if (!s) return null;
  try { return JSON.parse(s); } catch { d.unreadable.push(file); return null; }
}
/** Bounded chunks, not readFile/split of a complete transcript. Only the current line is retained. */
export async function* lines(file: string): AsyncGenerator<string> {
  let tail = "";
  for await (const chunk of createReadStream(file, { encoding: "utf8", highWaterMark: 256 * 1024 })) {
    const s = tail + chunk;
    let start = 0, end: number;
    while ((end = s.indexOf("\n", start)) !== -1) { yield s.slice(start, end); start = end + 1; }
    tail = s.slice(start);
  }
  if (tail) yield tail;
}
/** One seen set per ray across all sessions. Missing IDs are counted, but cannot be deduplicated. */
export async function collectTranscript(file: string, buckets: Map<string, Counts>, seen: Set<string>, d: Diagnostics, now = Date.now()): Promise<void> {
  try {
    for await (const line of lines(file)) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { d.malformedLines++; continue; }
      const m = e?.message, u = m?.usage;
      if (e?.type !== "assistant" || !u || typeof u !== "object") continue;
      const at = epoch(e.timestamp);
      if (at === null) { d.undatedMessages++; continue; }
      if (at > now) continue;
      if (typeof e.requestId === "string" && e.requestId && typeof m.id === "string" && m.id) {
        const id = JSON.stringify([e.requestId, m.id]);
        if (seen.has(id)) { d.duplicateMessages++; continue; }
        seen.add(id);
      } else d.unkeyedMessages++;
      const day = localDay(at), c = buckets.get(day) ?? empty();
      add(c, { calls: 1, input: num(u.input_tokens), cacheRead: num(u.cache_read_input_tokens),
        cacheWrite: num(u.cache_creation_input_tokens), output: num(u.output_tokens), thinking: num(u.output_tokens_details?.thinking_tokens) });
      buckets.set(day, c);
    }
  } catch { d.unreadable.push(file); }
}
/** Each rotated file is anchored to its own mtime. Merge chronologically, so a launch
 * in an older file can match a done in the current file, including across midnight. */
async function keeperHistory(base: string, now: number, d: Diagnostics): Promise<KeeperEvent[]> {
  const events: KeeperEvent[] = [];
  for (const name of (await names(base, d)).filter(n => /^keeper(?:\.log(?:[.-].+)?|[.-].+\.log)$/i.test(n))) {
    const file = path.join(base, name), st = await info(file, d);
    if (!st?.isFile()) continue;
    let raw: string;
    if (name.endsWith(".gz")) {
      try { raw = gunzipSync(await readFile(file)).toString("utf8"); } catch { d.unreadable.push(file); continue; }
    } else raw = await text(file, d);
    // Keep the done/zip-verified evidence that the board's general parser doesn't expose.
    const verified = new Set<string>();
    for (const m of raw.matchAll(/^(\d\d:\d\d:\d\d)\s+done ([A-Za-z0-9][\w.-]*)\s+\(zip verified\)/gm)) verified.add(`${m[1]} ${m[2]}`);
    for (const e of parseKeeperLog(raw, Math.min(st.mtimeMs, now))) {
      if (!e.name) continue;
      const t = new Date(e.at), clock = [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
      if (e.kind === "done" && verified.has(`${clock} ${e.name}`)) e.reason = "zip verified";
      events.push(e);
    }
  }
  const unique = new Map(events.map(e => [JSON.stringify([e.at, e.kind, e.name]), e]));
  return [...unique.values()].sort((a, b) => a.at - b.at || Number(b.kind === "launched") - Number(a.kind === "launched"));
}
export function parseThought(reply: string): { label: string; ms: number } | null {
  const m = /\bThought for\s+((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[ ,]*)+)/i.exec(reply);
  if (!m) return null;
  let ms = 0;
  for (const part of m[1]!.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)) ms += Number(part[1]) * ({ h: 3600000, m: 60000, s: 1000 }[part[2]!.toLowerCase()]!);
  return { label: `Thought for ${m[1]!.trim().replace(/,$/, "")}`, ms };
}
async function zipInfo(base: string, job: string, dirs: string[], jobLog: string, d: Diagnostics): Promise<{bytes: number | null; present: boolean}> {
  const archive = path.join(base, `zip-${job}`);
  const candidates = [path.join(base, `zip-${job}.zip`), ...dirs.map(dir => path.join(dir, `${job}.zip`)),
    ...(await names(archive, d)).filter(n => /\.zip$/i.test(n)).sort().map(n => path.join(archive, n))];
  for (const file of candidates) { const st = await info(file, d); if (st?.isFile()) return {bytes: st.size, present: true}; }
  const sizes = [...jobLog.matchAll(/^zip (\d+) bytes\b/gm)];
  return {bytes: sizes.length ? Number(sizes.at(-1)![1]) : null, present: !!(await info(archive, d))?.isDirectory()};
}
export async function collectHandoffs(root: string, ray: string, now: number, d: Diagnostics): Promise<Handoff[]> {
  const base = path.join(root, ray, ".docs", "chatgpt", "small"), q = path.join(base, "queue");
  const dirs = [q, ...["running", "done", "failed", "cancelled"].map(n => path.join(q, n))];
  const jobs = new Map<string, { events: KeeperEvent[]; stateFile?: string; physical?: string }>();
  const get = (job: string) => { if (!jobs.has(job)) jobs.set(job, { events: [] }); return jobs.get(job)!; };
  for (const e of await keeperHistory(base, now, d)) if (e.name) get(e.name).events.push(e);
  for (const n of await names(base, d)) {
    const job = /^(?:reply-(.+)\.md|log-(.+)\.txt|zip-(.+?)(?:\.zip)?)$/.exec(n)?.slice(1).find(Boolean);
    if (job && valid(job)) get(job);
  }
  for (const dir of dirs) for (const n of await names(dir, d)) {
    const m = /^(.+)\.(state\.json|txt|zip)$/.exec(n);
    if (!m || !valid(m[1]!)) continue;
    const j = get(m[1]!);
    if (m[2] === "state.json" && !j.stateFile) j.stateFile = path.join(dir, n);
    if (m[2] === "txt") j.physical = dir === q ? "queued" : path.basename(dir);
  }
  const result: Handoff[] = [];
  for (const [job, meta] of jobs) {
    const state = meta.stateFile ? await json(meta.stateFile, d) : null;
    let launched: number | null = null, firstLaunch: number | null = null, terminal: KeeperEvent | null = null, launches = 0;
    for (const e of meta.events) {
      if (e.kind === "launched") { launched = e.at; firstLaunch ??= e.at; terminal = null; launches++; }
      else if (e.kind === "done" || e.kind === "failed") terminal = e;
    }
    const stateLaunch = epoch(state?.launchAt);
    // Keeper clock has second precision; prefer exact state time for the same launch.
    if (stateLaunch !== null && stateLaunch <= now && (launched === null || stateLaunch >= launched)) {
      if (terminal && stateLaunch > terminal.at + 999) terminal = null;
      launched = stateLaunch;
    }
    firstLaunch = epoch(state?.firstLaunchAt) ?? firstLaunch ?? launched;
    const replyFile = path.join(base, `reply-${job}.md`), replyStat = await info(replyFile, d);
    const hasReply = !!replyStat?.isFile(), reply = hasReply ? await text(replyFile, d) : "";
    const marker = (await text(path.join(base, `zip-${job}`, ".applied"), d)).trim();
    const jobLog = await text(path.join(base, `log-${job}.txt`), d);
    const {bytes: zipBytes, present: zipPresent} = await zipInfo(base, job, dirs, jobLog, d);
    const phase = String(state?.phase ?? meta.physical ?? "").toLowerCase();
    const done = terminal?.kind === "done" || /^(done(?:-.*)?|applied|superseded|unapplied-late)$/.test(phase) || !!marker || (hasReply && !terminal && !phase);
    const zipExpected = state?.zipExpected === true || terminal?.reason === "zip verified";
    let outcome: Outcome;
    if (/^superseded\s*:/i.test(marker)) outcome = "superseded";
    else if (/^[0-9a-f]{7,64}\b/i.test(marker)) outcome = "applied";
    else if (terminal?.kind === "failed" || /fail|cancel/.test(phase)) outcome = "failed";
    else if (/lost|dead|stale|zip-missing/.test(phase) || (done && (!hasReply || (zipExpected && !zipPresent)))) outcome = "lost";
    else if (done) outcome = "done";
    else if (launched !== null || phase === "running") outcome = "running";
    else continue; // queued-only jobs have not been handed off
    let finished = terminal?.at ?? null;
    let finishSource: Handoff["finishSource"] = terminal ? "keeper" : null;
    const explicit = epoch(state?.finishedAt ?? state?.doneAt);
    if (finished === null && explicit !== null && explicit <= now) { finished = explicit; finishSource = "state"; }
    if (finished === null && done && hasReply && replyStat.mtimeMs <= now) { finished = replyStat.mtimeMs; finishSource = "reply-mtime"; }
    // A failed zip download can still have a completed reply. Do not mistake the
    // failure timestamp or a queue deadline for a reply completion.
    let replyDone = done && terminal?.kind !== "failed" ? finished : null;
    let thinkingSource: Handoff["thinkingSource"] = replyDone === null ? null : finishSource;
    if (replyDone === null && outcome === "failed" && hasReply && replyStat.mtimeMs <= now &&
      (finished === null || replyStat.mtimeMs <= finished + 999)) {
      replyDone = replyStat.mtimeMs; thinkingSource = "reply-mtime";
    }
    const thinkingMs = replyDone !== null && launched !== null && replyDone + 999 >= launched
      ? Math.max(0, replyDone - launched) : null;
    if (thinkingMs === null) thinkingSource = null;
    const thought = parseThought(reply);
    result.push({ ray, job, launched, firstLaunch, finished, thinkingMs, thinkingSource, thoughtLabel: thought?.label ?? null, thoughtMs: thought?.ms ?? null,
      outcome, zipBytes, replyPath: hasReply ? `${ray}/.docs/chatgpt/small/reply-${job}.md` : null,
      attempts: Math.max(num(state?.attempts), launches) || null, chatId: typeof state?.chatId === "string" ? state.chatId : null, finishSource });
  }
  return result;
}
export type HandoffSort = "ray" | "job" | "launched" | "finished" | "thinkingMs" | "thoughtMs" | "outcome" | "zipBytes" | "attempts";
export function sortHandoffs(rows: Handoff[], key: HandoffSort = "thinkingMs", direction: "asc" | "desc" = "desc"): Handoff[] {
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null || y == null) return x == null && y == null ? a.ray.localeCompare(b.ray) || a.job.localeCompare(b.job) : x == null ? 1 : -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * (direction === "asc" ? 1 : -1)
      || a.ray.localeCompare(b.ray) || a.job.localeCompare(b.job);
  });
}
type Check = { ray: string; at: number; pass: boolean };
function period(daily: DailyUsage[], jobs: Handoff[], checks: Check[], match: (day: string) => boolean): Period {
  const c = empty(); for (const row of daily) if (match(row.day)) add(c, row);
  const h = jobs.filter(j => { const at = j.finished ?? j.launched; return at === null ? match("") : match(localDay(at)); });
  const replies = h.filter(j => j.replyPath || j.outcome === "applied" || j.outcome === "superseded").length;
  const applied = h.filter(j => j.outcome === "applied").length;
  const ch = checks.filter(x => match(localDay(x.at))), checksPassed = ch.filter(x => x.pass).length;
  return { ...usage(c), handoffs: h.length, replies, applied, appliedPct: replies ? 100 * applied / replies : null,
    checks: ch.length, checksPassed, checkPct: ch.length ? 100 * checksPassed / ch.length : null };
}
export async function collectStats(options: StatsOptions): Promise<Stats> {
  const now = options.now ?? Date.now(), today = localDay(now), days = recentDays(now), d = diagnostics();
  const root = options.raysRoot;
  const listed = (await text(path.join(root, "rays.txt"), d)).split(/\r?\n/).map(s => s.trim()).filter(valid);
  const rays = new Set(listed);
  for (const entry of await names(root, d)) if (valid(entry) && ((await info(path.join(root, entry, "GOALS.md"), d))?.isFile() ||
    (await info(path.join(root, entry, ".docs", "chatgpt", "small"), d))?.isDirectory())) rays.add(entry);
  const history = await json(path.join(options.dataDir, "checks-history.json"), d), checks: Check[] = [];
  for (const [key, records] of Object.entries(history?.goals ?? {})) {
    const ray = key.split("/")[0]!; if (!valid(ray) || !Array.isArray(records)) continue;
    rays.add(ray);
    for (const r of records) { const at = epoch(r?.at); if (at !== null && at <= now && (r.status === "pass" || r.status === "fail")) checks.push({ ray, at, pass: r.status === "pass" }); }
  }
  const daily: DailyUsage[] = [], handoffs: Handoff[] = [], perRay: RayStats[] = [];
  const dayMatch = (day: string) => day === today, weekMatch = (day: string) => days.includes(day), all = () => true;
  const periods = (du: DailyUsage[], h: Handoff[], c: Check[]) => ({ today: period(du, h, c, dayMatch), sevenDays: period(du, h, c, weekMatch), all: period(du, h, c, all) });
  for (const ray of [...rays].sort((a, b) => a.localeCompare(b))) {
    if (options.rayFilter && ray !== options.rayFilter) continue;
    const folders = new Set([path.join(root, ray).replace(/[:\\/]/g, "-"), `C--Rays-${ray}`]);
    const buckets = new Map<string, Counts>(), seen = new Set<string>();
    for (const folder of folders) {
      const dir = path.join(options.claudeProjectsDir, folder);
      for (const file of (await names(dir, d)).filter(n => n.endsWith(".jsonl")).sort()) await collectTranscript(path.join(dir, file), buckets, seen, d, now);
    }
    const du = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({ ray, day, ...usage(counts) }));
    const jobs = await collectHandoffs(root, ray, now, d);
    daily.push(...du); handoffs.push(...jobs); perRay.push({ ray, ...periods(du, jobs, checks.filter(c => c.ray === ray)) });
  }
  return { generatedAt: now, today, days, prices: STATS_PRICES, totals: periods(daily, handoffs, checks.filter(c => !options.rayFilter || c.ray === options.rayFilter)),
    rays: perRay, daily, handoffs: sortHandoffs(handoffs), diagnostics: d };
}
export type StatsPayload = { json: string; html: string };
/** The worker also serializes and renders, keeping CPU-heavy work off the HTTP event loop. */
export function buildStatsPayload(options: StatsOptions): Promise<StatsPayload> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./stats-worker.ts", import.meta.url), { workerData: options });
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`stats worker exited before returning (${code})`)));
  });
}
export class StatsCache {
  private value: { at: number; payload: StatsPayload } | null = null;
  private pending: Promise<StatsPayload> | null = null;
  private options: StatsOptions;
  private build: typeof buildStatsPayload;
  private clock: () => number;
  constructor(options: StatsOptions, build = buildStatsPayload, clock = Date.now) { this.options = options; this.build = build; this.clock = clock; }
  get(): Promise<StatsPayload> {
    if (this.value && this.clock() - this.value.at < STATS_TTL_MS) return Promise.resolve(this.value.payload);
    if (!this.pending) this.pending = this.build(this.options).then(payload => {
      this.value = { at: this.clock(), payload }; return payload;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
