/**
 * Best-effort ChatGPT-login Codex CALL meter, not an official token/quota API.
 * Every source is read-only. Service logs use fsreader's bounded, mtime-cached
 * slices; a second cache retains parsed event times across 5-second polls.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexLog } from "./fsreader.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIVE = 5 * HOUR;
const require = createRequire(import.meta.url);
export type CallerKind = "namer" | "feeder" | "cli" | "proxy";
export type CodexCaller = {
  name: string;
  kind: CallerKind;
  path: string;
  /** Feeder's local clock minutes EAST of UTC; omit to use the machine timezone. */
  utcOffsetMinutes?: number;
};
export type CodexEvent = { at: number; kind: "call" | "limit" };
export type CodexCallerUsage = {
  name: string; kind: CallerKind;
  oneHour: number; fiveHours: number; day: number; callsPerHour: number;
  firstAt: number | null; lastAt: number | null;
};
export type CodexUsage = {
  at: number;
  callers: CodexCallerUsage[];
  totals: { oneHour: number; fiveHours: number; day: number; callsPerHour: number };
  lastLimitAt: number | null;
  estimatedFiveHourCalls: number | null;
  projectedLimitAt: number | null;
  warning: boolean;
  warningAt: number | null;
};

const isLimit = (message: string) =>
  /you['\u2019]ve hit your usage limit|usage limit reached/i.test(message);
const validMs = (raw: string): number | null => {
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : null;
};

/** Completed namer passes are calls; failure lines are NOT counted as calls. */
export function parseNamer(text: string): CodexEvent[] {
  const out: CodexEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\S+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const at = validMs(match[1]!);
    if (at === null) continue;
    if (/^named \d+\/\d+ posts\b/.test(match[2]!)) out.push({ at, kind: "call" });
    if (isLimit(match[2]!)) out.push({ at, kind: "limit" });
  }
  return out;
}

/**
 * Infer date from log mtime's *local* day and clock, then walk backwards across
 * midnight. The last timestamped line is anchored to the latest possible day
 * no later than mtime. utcOffsetMinutes allows deterministic replay of remote
 * Windows logs without depending on the viewer's timezone.
 */
export function parseFeeder(
  text: string, mtimeMs: number, utcOffsetMinutes = -new Date(mtimeMs).getTimezoneOffset(),
): CodexEvent[] {
  type Line = { seconds: number; day: number; message: string };
  const lines: Line[] = [];
  let previous: number | null = null;
  let day = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d{2}):(\d{2}):(\d{2})\s+(.+)$/.exec(line);
    if (!match) continue;
    const hours = Number(match[1]), minutes = Number(match[2]), secs = Number(match[3]);
    if (hours > 23 || minutes > 59 || secs > 59) continue;
    const seconds = hours * 3600 + minutes * 60 + secs;
    if (previous !== null && seconds < previous) day++;
    lines.push({ seconds, day, message: match[4]! });
    previous = seconds;
  }
  if (!lines.length) return [];
  const offset = utcOffsetMinutes * 60_000;
  const anchor = new Date(mtimeMs + offset);
  const anchorSeconds = anchor.getUTCHours() * 3600 + anchor.getUTCMinutes() * 60 + anchor.getUTCSeconds();
  const last = lines[lines.length - 1]!;
  let base = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  if (last.seconds > anchorSeconds) base -= DAY;
  const out: CodexEvent[] = [];
  for (const line of lines) {
    const at = base + (line.day - last.day) * DAY + line.seconds * 1000 - offset;
    if (/^\s*(?:scripted|withdrawn|reject)\s+\S+:/i.test(line.message))
      out.push({ at, kind: "call" });
    if (isLimit(line.message)) out.push({ at, kind: "limit" });
  }
  return out;
}

/** One session_meta record = one CLI run, even when many token_count events follow. */
export function parseCliSession(text: string): CodexEvent[] {
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"session_meta"')) continue;
    let meta: any;
    try { meta = JSON.parse(line); } catch { continue; }
    if (meta.type !== "session_meta") continue;
    const p = meta.payload ?? {};
    const source = String(p.source ?? "");
    const origin = String(p.originator ?? "");
    // Omit SDK sessions produced by other tracked callers to avoid double-counting.
    if (source && source !== "cli" && !/^codex-(tui|exec|cli)$/.test(origin)) return [];
    if (origin && !/^codex-(tui|exec|cli)$/.test(origin) && source !== "cli") return [];
    const at = validMs(p.timestamp ?? meta.timestamp ?? "");
    return at === null ? [] : [{ at, kind: "call" }];
  }
  return [];
}

const DEFAULT_CONFIG = fileURLToPath(new URL("../../codex-callers.json", import.meta.url));
const kinds = new Set<CallerKind>(["namer", "feeder", "cli", "proxy"]);
const expand = (s: string, parent: string) => {
  const raw = s === "~" ? os.homedir() :
    s.startsWith("~/") || s.startsWith("~\\") ? path.join(os.homedir(), s.slice(2)) : s;
  // Windows drive paths must not be prepended with a POSIX cwd when replaying.
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(parent, raw);
};

/** A JSON array of {name,kind,path,utcOffsetMinutes?}. Env overrides the path. */
export function loadCodexCallers(config = process.env.CODEX_CALLERS_CONFIG ?? DEFAULT_CONFIG): CodexCaller[] {
  if (!existsSync(config)) return [];
  const data: unknown = JSON.parse(readFileSync(config, "utf8"));
  if (!Array.isArray(data)) throw new Error("codex-callers.json must be an array");
  const seen = new Set<string>();
  return data.map((row: any) => {
    if (typeof row?.name !== "string" || !/^[\w.-]+$/.test(row.name) ||
        !kinds.has(row.kind) || typeof row.path !== "string" || !row.path ||
        (row.utcOffsetMinutes !== undefined &&
          (!Number.isInteger(row.utcOffsetMinutes) || Math.abs(row.utcOffsetMinutes) > 840)) ||
        seen.has(row.name)) throw new Error("invalid or duplicate Codex caller configuration");
    seen.add(row.name);
    return {
      name: row.name, kind: row.kind as CallerKind,
      path: expand(row.path, path.dirname(path.resolve(config))),
      ...(row.utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes: row.utcOffsetMinutes }),
    };
  });
}

const parsedCache = new Map<string, { mtime: number; size: number; events: CodexEvent[] }>();
export function clearCodexUsageCache(): void { parsedCache.clear(); }
function serviceEvents(caller: CodexCaller): CodexEvent[] {
  const snapshot = codexLog(caller.path);
  if (!snapshot) { parsedCache.delete(`${caller.kind}|${caller.path}`); return []; }
  const key = `${caller.kind}|${caller.path}|${caller.utcOffsetMinutes ?? "local"}`;
  const cached = parsedCache.get(key);
  if (cached && cached.mtime === snapshot.mtimeMs && cached.size === snapshot.size) return cached.events;
  const events = caller.kind === "namer" ? parseNamer(snapshot.text) :
    parseFeeder(snapshot.text, snapshot.mtimeMs, caller.utcOffsetMinutes);
  if (parsedCache.size >= 40) parsedCache.delete(parsedCache.keys().next().value!);
  parsedCache.set(key, { mtime: snapshot.mtimeMs, size: snapshot.size, events });
  return events;
}

function utcDayPaths(now: number): string[] {
  const dates = new Set<string>();
  for (const base of [new Date(now), new Date(now - new Date(now).getTimezoneOffset() * 60_000)]) {
    for (let i = -2; i <= 1; i++) {
      const d = new Date(base.getTime() + i * DAY);
      dates.add(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`);
    }
  }
  return [...dates];
}
const listFiles = (dir: string): string[] => {
  try { return readdirSync(dir).filter((name) => name.endsWith(".jsonl") && name.startsWith("rollout-")); }
  catch { return []; }
};

function cliEvents(dir: string, now: number): CodexEvent[] {
  // Support both flat fixtures and ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
  const dirs = new Set([dir, ...utcDayPaths(now).map((d) => path.join(dir, d))]);
  const out: CodexEvent[] = [];
  for (const parent of dirs) for (const name of listFiles(parent)) {
    const file = path.join(parent, name);
    const snapshot = codexLog(file, 16 * 1024, 8 * 1024);
    if (snapshot) out.push(...parseCliSession(snapshot.text));
  }
  return out;
}

/** SQLite reader intentionally opens read-only and never modifies proxy.sqlite. */
function proxyEvents(dbPath: string, since: number, now: number): CodexEvent[] {
  if (!existsSync(dbPath)) return [];
  let db: any;
  try {
    db = process.versions.bun
      ? new (require("bun:sqlite").Database)(dbPath, { readonly: true })
      : new (require("node:sqlite").DatabaseSync)(dbPath, { readOnly: true });
    const sql = "SELECT started_at FROM requests WHERE upstream = 'chatgpt' AND started_at >= ? AND started_at <= ? ORDER BY started_at";
    const rows = process.versions.bun ? db.query(sql).all(since, now) : db.prepare(sql).all(since, now);
    return rows.map((r: any) => ({ at: Number(r.started_at), kind: "call" as const }))
      .filter((r: CodexEvent) => Number.isFinite(r.at));
  } catch { return []; }
  finally { try { db?.close(); } catch {} }
}

export function estimateLimitAt(
  now: number, callsInFiveHours: number, callsPerHour: number, observedCapacity: number | null,
): number | null {
  if (observedCapacity === null || observedCapacity < 1) return null;
  if (!Number.isFinite(callsPerHour) || callsPerHour <= 0) return null;
  if (callsInFiveHours >= observedCapacity) return now;
  return now + (observedCapacity - callsInFiveHours) / callsPerHour * HOUR;
}
export function limitWarning(now: number, projected: number | null, lastHit: number | null): boolean {
  return (lastHit !== null && lastHit <= now && now - lastHit < FIVE) ||
    (projected !== null && projected < now + 2 * HOUR);
}
const tally = (times: number[], now: number) => ({
  oneHour: times.filter((t) => t > now - HOUR && t <= now).length,
  fiveHours: times.filter((t) => t > now - FIVE && t <= now).length,
  day: times.filter((t) => t > now - DAY && t <= now).length,
});
const ends = (times: number[]) => {
  let firstAt: number | null = null, lastAt: number | null = null;
  for (const t of times) {
    if (firstAt === null || t < firstAt) firstAt = t;
    if (lastAt === null || t > lastAt) lastAt = t;
  }
  return { firstAt, lastAt };
};

/** All callers share one login and therefore one provisional five-hour estimate. */
export function codexUsageAt(now: number, callers = loadCodexCallers()): CodexUsage {
  const events: { caller: CodexCaller; events: CodexEvent[] }[] = [];
  // Read logs first: the most recent limit determines the proxy history horizon.
  for (const caller of callers) if (caller.kind !== "proxy") {
    events.push({ caller, events: caller.kind === "cli" ? cliEvents(caller.path, now) : serviceEvents(caller) });
  }
  let lastLimitAt: number | null = null;
  for (const item of events) for (const event of item.events)
    if (event.kind === "limit" && event.at <= now && (lastLimitAt === null || event.at > lastLimitAt))
      lastLimitAt = event.at;
  for (const caller of callers) if (caller.kind === "proxy")
    events.push({ caller, events: proxyEvents(caller.path, Math.min(now - DAY, (lastLimitAt ?? now) - FIVE), now) });
  const allTimes: number[] = [];
  const calibrationTimes: number[] = [];
  const results: CodexCallerUsage[] = events.map(({ caller, events: entries }) => {
    const times = entries.filter((e) => e.kind === "call" && e.at <= now && e.at > now - DAY).map((e) => e.at);
    allTimes.push(...times);
    if (lastLimitAt !== null)
      for (const e of entries) if (e.kind === "call" && e.at < lastLimitAt && e.at > lastLimitAt - FIVE)
        calibrationTimes.push(e.at);
    const counts = tally(times, now);
    return { name: caller.name, kind: caller.kind, ...counts,
      callsPerHour: counts.oneHour, ...ends(times) };
  });
  const totals = { ...tally(allTimes, now), callsPerHour: 0 };
  totals.callsPerHour = totals.oneHour;
  const observed = lastLimitAt === null ? null : calibrationTimes.length;
  const estimatedFiveHourCalls = observed && observed > 0 ? observed : null;
  const projectedLimitAt = estimateLimitAt(now, totals.fiveHours, totals.callsPerHour, estimatedFiveHourCalls);
  const warning = limitWarning(now, projectedLimitAt, lastLimitAt);
  const warningAt = warning
    ? lastLimitAt !== null && now - lastLimitAt < FIVE ? lastLimitAt : projectedLimitAt
    : null;
  // Preserve config order even though proxy rows are fetched after log markers.
  results.sort((a, b) => callers.findIndex((c) => c.name === a.name) - callers.findIndex((c) => c.name === b.name));
  return { at: now, callers: results, totals, lastLimitAt,
    estimatedFiveHourCalls, projectedLimitAt, warning, warningAt };
}

/** Counts preceding each distinct observed limit hit for median gate calibration.
 * Repeated messages within five minutes share one exhausted-window event.
 */
export function codexLimitSamplesAt(
  now: number, callers = loadCodexCallers(),
): { at: number; calls: number }[] {
  const all: CodexEvent[] = [];
  for (const caller of callers) {
    const entries = caller.kind === "cli" ? cliEvents(caller.path, now) :
      caller.kind === "proxy" ? proxyEvents(caller.path, now - 2 * DAY, now) : serviceEvents(caller);
    all.push(...entries.filter((e) => e.at <= now && e.at > now - DAY));
  }
  const hits = all.filter((e) => e.kind === "limit").map((e) => e.at).sort((a, b) => a - b);
  const unique: number[] = [];
  for (const t of hits) if (!unique.length || t - unique[unique.length - 1]! > 5 * 60_000)
    unique.push(t);
  return unique.map((at) => ({
    at, calls: all.filter((e) => e.kind === "call" && e.at < at && e.at > at - FIVE).length,
  }));
}
