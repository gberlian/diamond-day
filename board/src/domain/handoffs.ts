/**
 * Read-only handoff history reconstructed from keeper.log (clock only), queue
 * prompts, and bounded job-log slices. All clock and root inputs are injected.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { deadLog, ensureRay, jobLog, keeperLog, queueDir, rayNames, type DomainContext } from "./fsreader.ts";
import type { JobTimeline, OccupancyPoint, Throughput, ThroughputRow, TooEasyJob } from "./model.ts";

export type KeeperEvent = {
  at: number;
  kind: "launched" | "done" | "failed" | "writing" | "heartbeat";
  name?: string;
  reason?: string;
  running?: number;
  queued?: number;
};

/**
 * All HH:MM:SS lines participate in rollover inference, including restarts,
 * reloaded, QUEUE EMPTY and other messages. Any strict clock regression means
 * midnight, never a new keeper session. The last line's date is the latest
 * local calendar date no later than the file mtime (or injected clock when
 * mtime lies in the future). Walk backwards through inferred day indices.
 */
export function parseKeeperLog(text: string, anchorMs: number): KeeperEvent[] {
  const parsed: { day: number; seconds: number; message: string }[] = [];
  let previous: number | null = null;
  let day = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d\d):(\d\d):(\d\d)\s+(.+)$/.exec(line);
    if (!match) continue;
    const h = Number(match[1]), m = Number(match[2]), s = Number(match[3]);
    if (h > 23 || m > 59 || s > 59) continue;
    const seconds = h * 3600 + m * 60 + s;
    if (previous !== null && seconds < previous) day++;
    parsed.push({ day, seconds, message: match[4]! });
    previous = seconds;
  }
  if (!parsed.length) return [];
  const base = new Date(anchorMs);
  const last = parsed[parsed.length - 1]!;
  const anchorSeconds = base.getHours() * 3600 + base.getMinutes() * 60 + base.getSeconds();
  base.setHours(0, 0, 0, 0);
  if (last.seconds > anchorSeconds) base.setDate(base.getDate() - 1);
  const dayStarts = new Map<number, number>();
  const events: KeeperEvent[] = [];
  for (const row of parsed) {
    let start = dayStarts.get(row.day);
    if (start === undefined) {
      const local = new Date(base);
      local.setDate(local.getDate() + row.day - last.day);
      start = local.getTime();
      dayStarts.set(row.day, start);
    }
    const localTime = new Date(start);
    localTime.setHours(Math.floor(row.seconds / 3600), Math.floor(row.seconds % 3600 / 60),
      row.seconds % 60, 0);
    const at = localTime.getTime();
    const message = row.message;
    const launch = /^launched ([a-zA-Z0-9][\w.-]*)(?:\s|$)/.exec(message);
    const done = /^done ([a-zA-Z0-9][\w.-]*)(?:\s|$)/.exec(message);
    const failed = /^failed ([a-zA-Z0-9][\w.-]*)(?::\s*(.*)|\s+(\(.*\)))?\s*$/.exec(message);
    const writing = /^still writing ([a-zA-Z0-9][\w.-]*)(?:\s|$)/.exec(message);
    const beat = /^HEARTBEAT running=(\d+) queued=(\d+)(?:\s|$)/.exec(message);
    if (launch) events.push({ at, kind: "launched", name: launch[1] });
    else if (done) events.push({ at, kind: "done", name: done[1] });
    else if (failed) events.push({ at, kind: "failed", name: failed[1], reason: failed[2] ?? failed[3] });
    else if (writing) events.push({ at, kind: "writing", name: writing[1] });
    else if (beat) events.push({ at, kind: "heartbeat", running: Number(beat[1]), queued: Number(beat[2]) });
  }
  return events;
}

const eventCache = new Map<string, {
  mtimeMs: number | null; size: number; anchor: number; events: KeeperEvent[];
}>();
export function clearKeeperEventCache(): void { eventCache.clear(); metaMemo.clear(); }

export function keeperEvents(ctx: DomainContext, ray: string): KeeperEvent[] {
  const file = path.join(queueDir(ctx.root, ray), "keeper.log");
  const snapshot = keeperLog(file);
  // Guard injected test clocks against a freshly created fixture's future mtime.
  const anchor = Math.min(snapshot?.mtimeMs ?? ctx.now, ctx.now);
  const cached = eventCache.get(file);
  if (cached && cached.mtimeMs === snapshot?.mtimeMs &&
      cached.size === snapshot?.size && cached.anchor === anchor) return cached.events;
  const events = parseKeeperLog(snapshot?.text ?? "", anchor);
  if (eventCache.size >= 128) eventCache.delete(eventCache.keys().next().value!);
  eventCache.set(file, { mtimeMs: snapshot?.mtimeMs ?? null, size: snapshot?.size ?? 0, anchor, events });
  return events;
}

const entries = (dir: string): string[] => {
  try { return readdirSync(dir); } catch { return []; }
};
const stat = (file: string): { mtimeMs: number; size: number } | null => {
  try { const s = statSync(file); return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null; }
  catch { return null; }
};
const validName = (name: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
type Metadata = { state: string; queuedAt: number | null; promptBytes: number | null; tries: number;
  replyBytes: number | null; zipPresent: boolean; logName: string | null };

/** Same reason and window as fsreader's jobs memo: per-job stats and reads are slow on NTFS. */
const META_MEMO_MS = Number(process.env.RAY_BOARD_JOBS_MEMO_MS ?? 2000);
const metaMemo = new Map<string, { at: number; meta: Map<string, Metadata> }>();
function jobMetadata(ctx: DomainContext, ray: string, only?: string): Map<string, Metadata> {
  if (only !== undefined || META_MEMO_MS <= 0) return scanMetadata(ctx, ray, only);
  const key = `${ctx.root}|${ray}`, hit = metaMemo.get(key), now = Date.now();
  if (hit && now - hit.at < META_MEMO_MS) return hit.meta;
  const meta = scanMetadata(ctx, ray);
  metaMemo.set(key, { at: now, meta });
  return meta;
}
function scanMetadata(ctx: DomainContext, ray: string, only?: string): Map<string, Metadata> {
  const base = queueDir(ctx.root, ray);
  const q = path.join(base, "queue");
  const baseFiles = new Set(entries(base));
  const queueFiles = new Set(entries(q));
  const results = new Map<string, Metadata>();
  for (const state of ["queued", "running", "done", "failed", "cancelled"] as const) {
    const dir = state === "queued" ? q : path.join(q, state);
    const filenames = entries(dir);
    const set = new Set(filenames);
    for (const file of filenames) {
      if (!file.endsWith(".txt")) continue;
      const name = file.slice(0, -4);
      if (!validName(name) || (only !== undefined && only !== name)) continue;
      const prompt = stat(path.join(dir, file));
      // Sidecars are tiny. Invalid/partial values never generate negative tries.
      let raw = 0;
      if (queueFiles.has(`${name}.tries`)) {
        try { raw = Number(readFileSync(path.join(q, `${name}.tries`), "utf8").trim()); }
        catch {}
      }
      const reply = baseFiles.has(`reply-${name}.md`) ? stat(path.join(base, `reply-${name}.md`)) : null;
      const info: Metadata = {
        state, queuedAt: prompt?.mtimeMs ?? null, promptBytes: prompt?.size ?? null,
        tries: Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0,
        replyBytes: reply?.size ?? null,
        zipPresent: baseFiles.has(`zip-${name}`) || queueFiles.has(`${name}.zip`) || set.has(`${name}.zip`),
        logName: baseFiles.has(`log-${name}.txt`) ? path.join(base, `log-${name}.txt`) : null,
      };
      // A real prompt's physical state always wins if an orphaned duplicate exists.
      results.set(name, info);
    }
  }
  // Keeper rotation or cleanup can leave logs/replies without a live queue
  // prompt. Retain those names in jobTimeline with nullable queue metadata.
  for (const entry of baseFiles) {
    const match = /^(?:log-(.+)\.txt|reply-(.+)\.md)$/.exec(entry);
    const name = match?.[1] ?? match?.[2];
    if (!name || !validName(name) || results.has(name) || (only !== undefined && only !== name)) continue;
    const reply = baseFiles.has(`reply-${name}.md`) ? stat(path.join(base, `reply-${name}.md`)) : null;
    results.set(name, {
      state: "unknown", queuedAt: null, promptBytes: null, tries: 0,
      replyBytes: reply?.size ?? null,
      zipPresent: baseFiles.has(`zip-${name}`) || queueFiles.has(`${name}.zip`),
      logName: baseFiles.has(`log-${name}.txt`) ? path.join(base, `log-${name}.txt`) : null,
    });
  }
  return results;
}

const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
const minutes = (start: number | null, end: number | null): number | null =>
  start === null || end === null || end < start ? null : Math.round((end - start) / 60000 * 1000) / 1000;

const groups = (events: KeeperEvent[]) => {
  const map = new Map<string, KeeperEvent[]>();
  for (const e of events) if (e.name) {
    if (!map.has(e.name)) map.set(e.name, []);
    map.get(e.name)!.push(e);
  }
  return map;
};

/** Latest launch / terminal event, with physical metadata when it still exists. */
export function timelinesForRay(ctx: DomainContext, ray: string, only?: string, withLog = true): JobTimeline[] {
  const grouped = groups(keeperEvents(ctx, ray));
  const metadata = jobMetadata(ctx, ray, only);
  const names = new Set([...metadata.keys(), ...grouped.keys()].filter((n) => only === undefined || n === only));
  const result: JobTimeline[] = [];
  for (const name of names) {
    const info = metadata.get(name);
    const events = grouped.get(name) ?? [];
    let launch: number | null = null;
    let terminal: KeeperEvent | null = null;
    let launches = 0;
    let latestKind: KeeperEvent["kind"] | null = null;
    for (const event of events) {
      if (event.kind === "launched") {
        launches++;
        launch = event.at;
        terminal = null;
        latestKind = "launched";
      } else if (event.kind === "done" || event.kind === "failed") {
        terminal = event;
        latestKind = event.kind;
      } else if (event.kind === "writing" && latestKind !== "done" && latestKind !== "failed") {
        latestKind = "writing";
      }
    }
    const doneAt = terminal?.kind === "done" ? terminal.at : null;
    const failedAt = terminal?.kind === "failed" ? terminal.at : null;
    const end = doneAt ?? failedAt;
    const snapshot = withLog && info?.logName ? jobLog(info.logName) : null;
    const logText = snapshot && (info?.queuedAt === null || info?.queuedAt === undefined ||
      snapshot.mtimeMs >= info.queuedAt) ? snapshot.text : null;
    const suspectedDead = info?.state === "running" && logText ? deadLog(logText) : null;
    // A reply may be in the omitted middle; confirm before declaring dead.
    let confirmedDead = false;
    if (suspectedDead && info?.logName) {
      try { confirmedDead = Boolean(deadLog(readFileSync(info.logName, "utf8"))); } catch {}
    }
    // The reply file size is the only reliable bytes value: "reply N" in the
    // keeper's job log counts characters, not UTF-8 bytes.
    result.push({
      ray, name, queuedAt: iso(info?.queuedAt ?? null), launchedAt: iso(launch),
      doneAt: iso(doneAt), failedAt: iso(failedAt), thinkMinutes: minutes(launch, end),
      tries: Math.max(launches, info?.tries ?? 0),
      replyBytes: info?.replyBytes ?? null,
      zipPresent: (info?.zipPresent ?? false) || Boolean(logText && /^zip \d+ bytes\b/m.test(logText)),
      promptBytes: info?.promptBytes ?? null,
      outcome: latestKind === "done" || latestKind === "failed" ? latestKind
        : confirmedDead ? "dead"
        : latestKind === "launched" || latestKind === "writing" ? "running"
        : (info?.state ?? "unknown") as JobTimeline["outcome"],
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

const percentile = (samples: number[], p: number): number | null => {
  if (!samples.length) return null;
  const values = [...samples].sort((a, b) => a - b);
  if (p === 0.5 && values.length % 2 === 0) {
    return Math.round((values[values.length / 2 - 1]! + values[values.length / 2]!) / 2 * 1000) / 1000;
  }
  return values[Math.max(0, Math.ceil(values.length * p) - 1)]!;
};

function occupancy(events: KeeperEvent[], now: number, hours: number): OccupancyPoint[] {
  const from = now - hours * 3_600_000;
  const first = Math.ceil(from / 600_000) * 600_000;
  const beats = events.filter((event) => event.kind === "heartbeat" && event.at <= now);
  const points: OccupancyPoint[] = [];
  let j = 0;
  let beat: KeeperEvent | null = null;
  for (let at = first; at <= now; at += 600_000) {
    while (j < beats.length && beats[j]!.at <= at) beat = beats[j++]!;
    // A heartbeat is an observation, not proof of continued occupancy if
    // the keeper stopped reporting. Expire samples after 15 minutes.
    const running = beat && at - beat.at <= 15 * 60_000 ? beat.running ?? null : null;
    points.push({ at: new Date(at).toISOString(), running });
  }
  return points;
}

function perRay(ctx: DomainContext, ray: string, hours: number): ThroughputRow {
  const from = ctx.now - hours * 3_600_000;
  const events = keeperEvents(ctx, ray);
  let launched = 0, done = 0, failed = 0;
  const lastLaunch = new Map<string, number>();
  const think: number[] = [];
  for (const event of events) {
    if (event.kind === "launched" && event.name) {
      lastLaunch.set(event.name, event.at);
      if (event.at >= from && event.at <= ctx.now) launched++;
    } else if ((event.kind === "done" || event.kind === "failed") && event.name) {
      if (event.at < from || event.at > ctx.now) continue;
      if (event.kind === "done") done++; else failed++;
      const start = lastLaunch.get(event.name);
      const elapsed = start === undefined ? null : minutes(start, event.at);
      if (elapsed !== null) think.push(elapsed);
    }
  }
  return { ray, launched, done, failed,
    medianThinkMinutes: percentile(think, 0.5), p90ThinkMinutes: percentile(think, 0.9),
    jobsPerHour: Math.round((done + failed) / hours * 1000) / 1000,
    occupancy: occupancy(events, ctx.now, hours) };
}

export function throughput(ctx: DomainContext, hours: number): Throughput {
  const byRay = rayNames(ctx.root).map((ray) => perRay(ctx, ray, hours));
  // Calculate machine percentiles over individual completed-job durations, not
  // percentiles of ray medians (which would bias quieter rays).
  const from = ctx.now - hours * 3_600_000;
  const allThink: number[] = [];
  for (const ray of byRay) {
    const starts = new Map<string, number>();
    for (const event of keeperEvents(ctx, ray.ray)) {
      if (event.kind === "launched" && event.name) starts.set(event.name, event.at);
      else if ((event.kind === "done" || event.kind === "failed") && event.name &&
          event.at >= from && event.at <= ctx.now) {
        const start = starts.get(event.name);
        const elapsed = start === undefined ? null : minutes(start, event.at);
        if (elapsed !== null) allThink.push(elapsed);
      }
    }
  }
  const timestamps = byRay[0]?.occupancy.map((p) => p.at) ?? occupancy([], ctx.now, hours).map((p) => p.at);
  const machineOccupancy = timestamps.map((at, index) => {
    const observed = byRay.map((r) => r.occupancy[index]?.running).filter((n): n is number => n != null);
    return { at, running: observed.length ? observed.reduce((a, b) => a + b, 0) : null };
  });
  const launched = byRay.reduce((a, r) => a + r.launched, 0);
  const done = byRay.reduce((a, r) => a + r.done, 0);
  const failed = byRay.reduce((a, r) => a + r.failed, 0);
  return { hours, machine: { launched, done, failed,
    medianThinkMinutes: percentile(allThink, 0.5), p90ThinkMinutes: percentile(allThink, 0.9),
    jobsPerHour: Math.round((done + failed) / hours * 1000) / 1000,
    occupancy: machineOccupancy }, byRay };
}

export function tooEasy(ctx: DomainContext, hours: number): TooEasyJob[] {
  const from = ctx.now - hours * 3_600_000;
  const results: TooEasyJob[] = [];
  for (const ray of rayNames(ctx.root)) {
    for (const job of timelinesForRay(ctx, ray, undefined, false)) {
      if (job.outcome !== "done" || job.thinkMinutes === null || job.thinkMinutes >= 10 ||
          !job.doneAt || Date.parse(job.doneAt) < from || Date.parse(job.doneAt) > ctx.now) continue;
      results.push({ ray, name: job.name, launchedAt: job.launchedAt!,
        doneAt: job.doneAt, thinkMinutes: job.thinkMinutes, promptBytes: job.promptBytes });
    }
  }
  return results.sort((a, b) => b.doneAt.localeCompare(a.doneAt) ||
    a.ray.localeCompare(b.ray) || a.name.localeCompare(b.name));
}
