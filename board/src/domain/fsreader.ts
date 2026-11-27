/**
 * Disk-only, read-only interpretation of bridge/keeper.ts and bridge/recover-dead.ts.
 * All functions receive their root/clock explicitly. No mkdir, rename, writes or process calls.
 */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.ts";
import type { Job, JobDetail, JobState, Keeper, Ray } from "./model.ts";

export type DomainContext = { root: string; now: number };
export const DEFAULT_ROOT = loadConfig().raysRoot;
export const context = (
  root = loadConfig().raysRoot,
  now = Number(process.env.RAYS_NOW ?? Date.now()),
): DomainContext => ({ root, now });

export class MissingEntity extends Error {
  constructor(message: string) { super(message); this.name = "MissingEntity"; }
}

const safeText = (file: string): string | null => {
  try { return readFileSync(file, "utf8"); } catch { return null; }
};

// Keeper logs are recent-history indexes; job logs can contain large stack traces.
// Only bounded, complete lines are decoded. A tiny prefix preserves the chat ID
// generally written at the start of per-job logs; the tail preserves its outcome.
// This avoids the previous O(total log bytes) full-file reads for every request.
export const KEEPER_TAIL_BYTES = 384 * 1024;
export const JOB_TAIL_BYTES = 8 * 1024;
const JOB_PREFIX_BYTES = 1024;
const MAX_CACHED_BYTES = 48 * 1024 * 1024;
const MAX_CACHED_FILES = 4000;
type Slice = { text: string; mtimeMs: number; size: number; analysis?: { last: string | null; chat: string | null; candidate: { chat: string } | null } };
const sliceCache = new Map<string, Slice>();
let cachedBytes = 0;

const cutFirstLine = (buffer: Buffer, truncated: boolean): string => {
  if (!truncated) return buffer.toString("utf8");
  const newline = buffer.indexOf(10);
  return newline < 0 ? "" : buffer.subarray(newline + 1).toString("utf8");
};
const cutLastLine = (buffer: Buffer, truncated: boolean): string => {
  if (!truncated) return buffer.toString("utf8");
  const newline = buffer.lastIndexOf(10);
  return newline < 0 ? "" : buffer.subarray(0, newline + 1).toString("utf8");
};

/** Cache is process-wide and invalidated by stat mtime + size, including in Bun. */
function readSlice(file: string, limit: number, prefixBytes = 0): Slice | null {
  let fd: number | null = null;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return null;
    const key = `${file}|${limit}|${prefixBytes}`;
    const old = sliceCache.get(key);
    if (old && old.mtimeMs === stat.mtimeMs && old.size === stat.size) {
      sliceCache.delete(key);
      sliceCache.set(key, old);
      return old;
    }
    fd = openSync(file, "r");
    const actual = fstatSync(fd);
    const length = Math.min(actual.size, limit);
    const offset = actual.size - length;
    const tail = Buffer.allocUnsafe(length);
    let got = 0;
    while (got < length) {
      const n = readSync(fd, tail, got, length - got, offset + got);
      if (!n) break;
      got += n;
    }
    const tailText = cutFirstLine(tail.subarray(0, got), offset > 0);
    let headText = "";
    if (prefixBytes && offset > 0) {
      const headLength = Math.min(prefixBytes, offset);
      const head = Buffer.allocUnsafe(headLength);
      const n = readSync(fd, head, 0, headLength, 0);
      headText = cutLastLine(head.subarray(0, n), n < actual.size);
    }
    const value = { text: headText + tailText, mtimeMs: actual.mtimeMs, size: actual.size };
    if (old) { cachedBytes -= Buffer.byteLength(old.text); sliceCache.delete(key); }
    sliceCache.set(key, value);
    cachedBytes += Buffer.byteLength(value.text);
    while (sliceCache.size > MAX_CACHED_FILES || cachedBytes > MAX_CACHED_BYTES) {
      const oldest = sliceCache.keys().next().value as string | undefined;
      if (!oldest) break;
      cachedBytes -= Buffer.byteLength(sliceCache.get(oldest)!.text);
      sliceCache.delete(oldest);
    }
    return value;
  } catch { return null; }
  finally { if (fd !== null) closeSync(fd); }
}
export function clearLogCache(): void { sliceCache.clear(); cachedBytes = 0; jobsMemo.clear(); }
/** Each listing stats and reads ~4 small files per job; on NTFS 1,350 jobs cost ~150 ms even with warm slices.
 * The board polls every 5 s, so one ray's job list is reused for JOBS_MEMO_MS (default 2 s; 0 turns it off). */
const JOBS_MEMO_MS = Number(process.env.RAY_BOARD_JOBS_MEMO_MS ?? 2000);
const jobsMemo = new Map<string, { at: number; jobs: Job[] }>();
export const keeperLog = (file: string): Slice | null => readSlice(file, KEEPER_TAIL_BYTES);
export const jobLog = (file: string): Slice | null => readSlice(file, JOB_TAIL_BYTES, JOB_PREFIX_BYTES);
/** Bounded, mtime/size-cached Codex service logs and CLI session slices. */
export const codexLog = (file: string, tailBytes = 8 * 1024 * 1024, prefixBytes = 0) =>
  readSlice(file, tailBytes, prefixBytes);


const entries = (dir: string): string[] => {
  try { return readdirSync(dir); } catch { return []; }
};
const mtime = (file: string): number | null => {
  try { return statSync(file).mtimeMs; } catch { return null; }
};
const age = (now: number, since: number | null): number | null =>
  since === null ? null : Math.max(0, Math.round(now - since));
const lines = (text: string | null): string[] => text ? text.trimEnd().split(/\r?\n/) : [];

export const queueDir = (root: string, ray: string) =>
  path.join(root, ray, ".docs", "chatgpt", "small");

const validName = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s);
export function rayNames(root: string): string[] {
  const text = safeText(path.join(root, "rays.txt"));
  const listed = text === null
    ? entries(root).filter((n) => validName(n) && existsSync(path.join(queueDir(root, n), "queue")))
    : text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  return [...new Set(listed.filter(validName))];
}
export const queueNames = (dir: string): string[] =>
  entries(dir).filter((f) => f.endsWith(".txt") && validName(f.slice(0, -4)))
    .map((f) => f.slice(0, -4)).sort();

export const lastLines = (text: string | null, count = 20) => lines(text).slice(-count);

/** EXACT recover-dead.ts classifier: running + UUID chat line + no reply line + error/Bun banner LAST line. */
export function deadLog(text: string | null): { chat: string } | null {
  if (!text) return null;
  const chat = /^chat: ([0-9a-f-]{36})$/m.exec(text)?.[1];
  const last = lines(text).at(-1) ?? "";
  return chat && !/^reply /m.test(text) && /error|Bun v/i.test(last) ? { chat } : null;
}

function chatId(log: string | null, reply: string | null): string | null {
  const sources = [log, reply];
  for (const text of sources) {
    if (!text) continue;
    const matches = [
      ...text.matchAll(/(?:chatgpt\.com|chat\.openai\.com)\/(?:g\/[^\s/]+\/)?c\/([\w-]{8,})/gi),
      ...text.matchAll(/\b(?:chat[ _-]?id|conversation[ _-]?id)\s*[:=]?\s*([\w-]{8,})/gi),
      ...text.matchAll(/(?:^|\n)\s*(?:chat|conversation)\s*[:=]\s*([\w-]{8,})/gi),
    ];
    const value = matches.sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0]?.[1];
    if (value) return value.toLowerCase();
  }
  return null;
}

function logAnalysis(slice: Slice) {
  if (!slice.analysis) slice.analysis = {
    last: lines(slice.text).at(-1) ?? null,
    chat: chatId(slice.text, null),
    candidate: deadLog(slice.text),
  };
  return slice.analysis;
}

export function keeperFailures(text: string | null): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const line of lines(text)) {
    // Keeper emits "failed NAME: reason" and "failed NAME (retry limit ...)".
    const m = /(?:^|\s)failed ([a-zA-Z0-9][\w.-]*)(?::\s*(.+)|\s+(\(.+\)))\s*$/.exec(line);
    if (m) reasons.set(m[1]!, (m[2] ?? m[3] ?? "").trim());
  }
  return reasons;
}

export function readJobsForRay(ctx: DomainContext, ray: string): Job[] {
  if (JOBS_MEMO_MS <= 0) return scanJobsForRay(ctx, ray);
  const key = `${ctx.root}|${ray}`, hit = jobsMemo.get(key), now = Date.now();
  if (hit && now - hit.at < JOBS_MEMO_MS) return hit.jobs;
  const jobs = scanJobsForRay(ctx, ray);
  jobsMemo.set(key, { at: now, jobs });
  return jobs;
}
function scanJobsForRay(ctx: DomainContext, ray: string): Job[] {
  const base = queueDir(ctx.root, ray);
  const q = path.join(base, "queue");
  // Index once per ray; probing ~8 nonexistent sidecars per job is costly on NTFS.
  const baseFiles = new Set(entries(base));
  const qFiles = new Set(entries(q));
  const failure = keeperFailures(baseFiles.has("keeper.log") ? keeperLog(path.join(base, "keeper.log"))?.text ?? null : null);
  const results: Job[] = [];
  const dirs: { state: JobState; dir: string; files: string[] }[] = [
    { state: "queued", dir: q, files: [...qFiles] },
    ...(["running", "done", "failed", "cancelled"] as const).map((state) => ({
      state, dir: path.join(q, state), files: entries(path.join(q, state)),
    })),
  ];
  for (const { state, dir, files } of dirs) {
    const dirFiles = new Set(files);
    const names = files.filter((f) => f.endsWith(".txt") && validName(f.slice(0, -4)))
      .map((f) => f.slice(0, -4)).sort();
    for (const name of names) {
      const promptPath = path.join(dir, `${name}.txt`);
      const logFile = path.join(base, `log-${name}.txt`);
      const replyFile = path.join(base, `reply-${name}.md`);
      const hasLog = baseFiles.has(`log-${name}.txt`);
      const hasReply = baseFiles.has(`reply-${name}.md`);
      const logSnapshot = hasLog ? jobLog(logFile) : null;
      const log = logSnapshot?.text ?? null;
      const logFacts = logSnapshot ? logAnalysis(logSnapshot) : null;
      const triesRaw = qFiles.has(`${name}.tries`) ? Number(safeText(path.join(q, `${name}.tries`))?.trim()) : 0;
      const tries = Number.isFinite(triesRaw) ? Math.max(0, Math.floor(triesRaw)) : 0;
      const attachments = qFiles.has(`${name}.attach`)
        ? safeText(path.join(q, `${name}.attach`))?.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) ?? [] : [];
      const start = mtime(promptPath), lastLog = hasLog ? mtime(logFile) : null;
      const replyPath = hasReply ? replyFile : null;
      const zipDir = baseFiles.has(`zip-${name}`) || qFiles.has(`${name}.zip`) ||
        (state !== "queued" && dirFiles.has(`${name}.zip`))
        ? path.join(base, `zip-${name}`) : null;
      const priorityRaw = qFiles.has(`${name}.prio`) ? Number(safeText(path.join(q, `${name}.prio`))?.trim()) : null;
      const priority = state === "queued" ? (priorityRaw !== null && Number.isFinite(priorityRaw) ? priorityRaw : start) : null;
      // Full scan only for a possible dead job: a middle-of-file reply line
      // must not accidentally be ignored by the bounded slices.
      const candidate = state === "running" ? logFacts?.candidate : null;
      const dead = candidate ? deadLog(safeText(logFile)) : null;
      const effectiveState = dead ? "dead" : state;
      const lastLogLine = logFacts?.last ?? null;
      const reason = state === "failed"
        ? failure.get(name) ?? (/^failed:\s*(.+)$/i.exec(lastLogLine ?? "")?.[1] ?? lastLogLine)
        : null;
      // The keeper refuses to identify a new attempt using an older log/reply.
      const currentLog = lastLog !== null && (start === null || lastLog >= start) ? log : null;
      const fromLog = currentLog ? logFacts?.chat ?? null : null;
      const replyMtime = !fromLog && hasReply ? mtime(replyFile) : null;
      const currentReply = !fromLog && hasReply && replyMtime !== null && (start === null || replyMtime >= start)
        ? safeText(replyFile) : null;
      results.push({
        name, ray, state: effectiveState, promptPath,
        chatId: dead?.chat ?? fromLog ?? chatId(null, currentReply),
        tries, priority, attachments, replyPath, zipDir,
        ageMs: age(ctx.now, start),
        idleMs: age(ctx.now, Math.max(start ?? 0, lastLog ?? 0) || null),
        lastLogLine, failureReason: reason,
        logPath: log === null ? null : logFile,
      });
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state));
}

export function readJob(ctx: DomainContext, ray: string, name: string): JobDetail {
  const job = readJobsForRay(ctx, ray).find((x) => x.name === name);
  if (!job) throw new MissingEntity(`Job ${ray}/${name} not found`);
  const base = queueDir(ctx.root, ray);
  const reply = job.replyPath ? safeText(job.replyPath) : null;
  const log = jobLog(path.join(base, `log-${name}.txt`))?.text ?? null;
  return { ...job, replyHead: reply?.slice(0, 4096) ?? null, logTail: lastLines(log) };
}

export function readKeeper(ctx: DomainContext, ray: string, jobs?: Job[]): Keeper {
  const base = queueDir(ctx.root, ray);
  const q = path.join(base, "queue");
  let beat: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(safeText(path.join(base, "keeper.heartbeat")) ?? "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) beat = v as Record<string, unknown>;
  } catch {}
  const at = typeof beat.at === "string" && Number.isFinite(Date.parse(beat.at)) ? beat.at : null;
  const heartbeatAgeMs = at ? age(ctx.now, Date.parse(at)) : null;
  const fresh = heartbeatAgeMs !== null && heartbeatAgeMs <= 10 * 60_000;
  const pidFile = Number(safeText(path.join(base, "keeper.pid"))?.trim() ?? NaN);
  const rawPid = typeof beat.pid === "number" ? beat.pid : pidFile;
  const pid = Number.isSafeInteger(rawPid) && rawPid > 0 ? rawPid : null;
  const heartbeatRunning = typeof beat.running === "number" &&
    Number.isSafeInteger(beat.running) && beat.running >= 0 ? beat.running : null;
  const queued = jobs?.filter((j) => j.state === "queued").length ?? queueNames(q).length;
  const running = jobs?.filter((j) => j.state === "running" || j.state === "dead").length
    ?? queueNames(path.join(q, "running")).length;
  return {
    ray, pid, version: typeof beat.version === "string" ? beat.version : null,
    heartbeatAt: at, heartbeatAgeMs, phase: typeof beat.phase === "string" ? beat.phase : null,
    heartbeatRunning, running, queued, fresh, stale: !fresh,
  };
}

export function readRay(ctx: DomainContext, ray: string, jobs?: Job[]): Ray {
  const all = jobs ?? readJobsForRay(ctx, ray);
  return {
    name: ray, path: path.join(ctx.root, ray), queueDir: queueDir(ctx.root, ray),
    counts: {
      queued: all.filter((j) => j.state === "queued").length,
      running: all.filter((j) => j.state === "running" || j.state === "dead").length,
      done: all.filter((j) => j.state === "done").length,
      failed: all.filter((j) => j.state === "failed").length,
      cancelled: all.filter((j) => j.state === "cancelled").length,
      dead: all.filter((j) => j.state === "dead").length,
    },
    keeper: readKeeper(ctx, ray, all),
  };
}

export function ensureRay(ctx: DomainContext, ray: string): void {
  if (!rayNames(ctx.root).includes(ray)) throw new MissingEntity(`Ray ${ray} not found`);
}
