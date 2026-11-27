// Automatic ray handovers. Persist intent before effects; never replace a working session
// without a fresh successor acknowledgement (except explicit idle cache parking).
// Commands: bun src/restarter.ts run|once|status|handover|confirm|ready|hold|request [ray] [reason].
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { RAYS_DIR, rays as allRays } from "./board.ts";
import { transcriptFile } from "./sources/transcripts.ts";
import { windowsHandover, type HandoverWindows, type WindowSnapshot } from "./handover-windows.ts";
import { loadConfig } from "./config.ts";
import type { Restart } from "./restart-log.ts";
import { restarts } from "./restart-log.ts";
import { lastWindowAction, reserveWindowAction } from "./window-spacing.ts";
import { validateRay } from "./ray-launcher.ts";
export { restarts, lastRestart } from "./restart-log.ts";

export const HOME = process.env.RAY_RESTARTS_DIR ?? path.join(homedir(), ".ray-restarts");
const home = () => process.env.RAY_RESTARTS_DIR ?? HOME;
const sessionsDir = () => process.env.CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
const raysDir = () => process.env.RAYS_ROOT ?? RAYS_DIR;
const file = (ray: string, name: string) => path.join(raysDir(), ray, name);
const HOLD_MS = 3 * 3_600_000;
const QUIET_MS = 60_000;
const SPACING_MS = 90_000;
const RECOVERY_MS = 240_000;
const CACHE_TTL_MS = 60 * 60_000;
const UNPARK_GAP_MS = 10 * 60_000;
const UNPARK_LIMIT_PER_MINUTE = 2;
const rayName = (ray: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ray);
const sleep = (ms: number) => typeof Bun !== "undefined" ? Bun.sleep(ms)
  : new Promise<void>((resolve) => setTimeout(resolve, ms));

export type Config = {
  rays: string[] | "all"; ctxMax: number; idleMin: number; idleNoReadyMin: number; confirmTimeoutMin: number;
  cooldownMin: number; maxRestartsPerRayPerDay: number;
};
export const DEFAULTS: Config = {
  rays: "all", ctxMax: 400_000, // owner 26 Nov 19:25: "i think we can raise context to 400k" (was 200k earlier that day)
  idleMin: 45, idleNoReadyMin: 60, confirmTimeoutMin: 15,
  cooldownMin: 120, maxRestartsPerRayPerDay: 6,
};
type Phase = "watching" | "asked" | "working-before-handover" | "opening-successor" | "awaiting-confirm" | "closing-old" | "done" | "failed" | "reopening" | "parking" | "parked" | "unparking";
export type RayState = {
  phase: Phase; reason?: string; askedAt?: number; requestStamp?: string;
  beforeSession?: string; waited?: "ready" | "timeout"; attemptAt?: number;
  lastRestartAt?: number; retryPending?: boolean; noSessionLogged?: boolean;
  blocked?: string;
  handover?: Attempt;
  error?: string;
  /** Failure cleanup must finish before either session is released. */
  cleaned?: boolean;
  finishedAt?: number;
  confirmedAt?: number;
  launchReserved?: boolean;
  /** Cache guard asks park; manual/context/news requests use acknowledged handover. */
  mode?: "park" | "restart";
  parkedAt?: number; resumeNote?: string | null; parkedSession?: string;
  lastUnparkAt?: number; pendingUnpark?: string;
};
type Prepared = { oldSession: string; requestStamp: string; note: string; preparedAt: number };
type Attempt = Prepared & { successorId: string; window: WindowSnapshot; openedAt: number };
type Confirmation = { successorId: string; note: string; summary: string; at: number };
type StoredState = {
  rays: Record<string, RayState>; lastAttemptAt?: number;
  /** Attempt timestamps, including interrupted attempts; used across process restarts. */
  unparkTimes?: number[];
};
export type ReopenResult = { ok: boolean; newSession?: string; error?: string };
export type CloseResult = { ok: boolean; error?: string };
export type Dependencies = {
  clock?: () => number;
  /** Production reads the exact live session transcript; fixtures may inject a context reader. */
  context?: (ray: string, now: number) => Promise<number | null> | number | null;
  /** Deprecated: never invoked for a new handover. */
  reopen?: (ray: string, oldSession: string | null) => Promise<ReopenResult>;
  handoverWindows?: HandoverWindows;
  /** Park a checked idle session without opening another terminal. */
  close?: (ray: string, sessionId: string) => Promise<CloseResult>;
  /** Open a new terminal with -Fresh, never -Reopen. */
  open?: (ray: string) => Promise<ReopenResult>;
};
export type Seen = {
  ray: string; ctx: number | null; idleMin: number | null; session: string;
  status: string; phase: Phase; news: number; action: string;
  parkedAt?: number; pendingUnpark?: string; oldSession?: string; successorSession?: string;
};

export function config(): Config {
  try {
    const raw = JSON.parse(readFileSync(path.join(home(), "config.json"), "utf8"));
    const cfg = { ...DEFAULTS, ...raw } as Config;
    if (!Number.isFinite(cfg.idleMin) || cfg.idleMin <= 0 || cfg.idleMin >= 60)
      throw new Error("idleMin must be > 0 and < 60 (prompt-cache TTL)");
    for (const name of ["idleNoReadyMin", "confirmTimeoutMin"] as const)
      if (!Number.isFinite(cfg[name]) || cfg[name] <= 0) throw new Error(`${name} must be positive`);
    delete (cfg as any).readyTimeoutMin;
    return cfg;
  } catch (e) {
    if (existsSync(path.join(home(), "config.json"))) throw e;
    return { ...DEFAULTS };
  }
}
function loadState(): StoredState {
  try {
    const raw = JSON.parse(readFileSync(path.join(home(), "state.json"), "utf8"));
    if (raw && raw.rays && typeof raw.rays === "object") return raw as StoredState;
    // Upgrade the original flat {ray: {phase,...}} format without losing an asked request.
    return { rays: raw && typeof raw === "object" ? raw : {} };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { rays: {} };
    throw new Error(`cannot read restart state: ${String(error)}`);
  }
}
function saveState(s: StoredState) {
  mkdirSync(home(), { recursive: true });
  const target = path.join(home(), "state.json");
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(s, null, 2));
  renameSync(temp, target);
}
function log(row: Restart) {
  mkdirSync(home(), { recursive: true });
  const target = path.join(home(), "log.jsonl");
  // Isolate a torn trailing record from the next append after a crash.
  let prefix = "";
  if (existsSync(target)) { const bytes = readFileSync(target); if (bytes.length && bytes.at(-1) !== 10) prefix = "\n"; }
  appendFileSync(target, prefix + JSON.stringify(row) + "\n");
}
function countToday(ray: string, now: number): number {
  const day = Math.floor(now / 86_400_000);
  return restarts(100_000).filter((r) => r.ray === ray && r.at <= now
    && Math.floor(r.at / 86_400_000) === day && r.attempted !== false
    && !/^(global window spacing|unsafe or missing|invalid ray)/.test(String((r as any).error ?? ""))
    && (!r.action || r.action === "restart")).length;
}
function lockPass(): (() => void) | null {
  const folder = path.join(home(), "pass.lock");
  mkdirSync(home(), { recursive: true });
  try { mkdirSync(folder); }
  catch {
    // A crash must not permanently disable the service. Only remove a demonstrably dead owner.
    try {
      const owner = JSON.parse(readFileSync(path.join(folder, "owner.json"), "utf8"));
      let alive = false;
      try { process.kill(owner.pid, 0); alive = true; } catch (e: any) { alive = e?.code === "EPERM"; }
      if (alive || Date.now() - owner.at < 10_000) return null;
      rmSync(folder, { recursive: true, force: true });
      mkdirSync(folder);
    } catch {
      // A crash between mkdir and writing owner.json must not wedge the service.
      try {
        if (existsSync(path.join(folder, "owner.json")) || Date.now() - statSync(folder).mtimeMs < 60_000) return null;
        rmSync(folder, { recursive: true }); mkdirSync(folder);
      } catch { return null; }
    }
  }
  writeFileSync(path.join(folder, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now(), source: "restarter", ray: "auto", action: "pass" }));
  return () => rmSync(folder, { recursive: true, force: true });
}

/** Newest live interactive session in this ray, ignoring dead registry PIDs. */
export function liveSession(ray: string, dir = sessionsDir(), id?: string): { pid: number; sessionId: string; status: string } | null {
  const want = path.resolve(raysDir(), ray).toLowerCase();
  let best: { pid: number; sessionId: string; status: string; updatedAt: number } | null = null;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const s = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
        if (path.resolve(String(s.cwd ?? "")).toLowerCase() !== want || s.kind !== "interactive" || typeof s.sessionId !== "string" || !s.sessionId || (id && s.sessionId !== id)) continue;
        if (typeof s.pid !== "number" || !Number.isInteger(s.pid) || s.pid <= 0) continue;
        try { process.kill(s.pid, 0); } catch (error: any) { if (error?.code !== "EPERM") continue; }
        if (!best || (s.updatedAt ?? 0) > best.updatedAt)
          best = { pid: s.pid, sessionId: String(s.sessionId ?? ""), status: s.status ?? "", updatedAt: s.updatedAt ?? 0 };
      } catch {}
    }
  } catch {}
  return best?.sessionId ? { pid: best.pid, sessionId: best.sessionId, status: best.status } : null;
}

/** Keeper events after the transcript's last activity; keeper lines have UTC HH:MM:SS. */
export function keeperNewsSince(ray: string, since: number, now = Date.now()): string[] {
  const keeperLog = file(ray, ".docs/chatgpt/small/keeper.log");
  let text = "";
  try {
    const stat = statSync(keeperLog);
    if (stat.mtimeMs < since) return [];
    const buffer = readFileSync(keeperLog);
    text = buffer.subarray(Math.max(0, buffer.length - 64 * 1024)).toString("utf8");
  } catch { return []; }
  const out: string[] = [];
  let idleBeats = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = /^(\d\d):(\d\d):(\d\d) /.exec(line);
    if (!t) continue;
    const d = new Date(now);
    d.setUTCHours(+t[1]!, +t[2]!, +t[3]!, 0);
    let at = d.getTime();
    if (at > now + 60_000) at -= 86_400_000;
    if (/HEARTBEAT running=0 queued=0\b/.test(line)) idleBeats++;
    else if (/HEARTBEAT/.test(line)) idleBeats = 0;
    if (at <= since) continue;
    if (/\b(done|failed)\b|QUEUE EMPTY/.test(line)
      || (idleBeats >= 6 && /HEARTBEAT/.test(line))) out.push(line.trim());
  }
  return out;
}
/** An open-ended busy mark (<raysRoot>/<ray>/.busy): no prepare note and no restart until `free`. Holds expire. */
export function busyReason(ray: string): string | null {
  try { return readFileSync(file(ray, ".busy"), "utf8").trim() || "busy"; } catch { return null; }
}
export function holdActive(ray: string, now = Date.now()): boolean {
  if (busyReason(ray) !== null) return true;
  try { return now - statSync(file(ray, ".no-restart")).mtimeMs < HOLD_MS; }
  catch { return false; }
}
function stamp(ray: string): string | null {
  try {
    const s = statSync(file(ray, ".restart-request"));
    // Request content helps distinguish rapid replacements on filesystems with coarse mtimes.
    return `${s.mtimeMs}:${s.size}:${readFileSync(file(ray, ".restart-request"), "utf8")}`;
  } catch { return null; }
}
function requestAt(ray: string): number | null {
  try { return statSync(file(ray, ".restart-request")).mtimeMs; } catch { return null; }
}
function readyAt(ray: string): number | null {
  try { return statSync(file(ray, ".restart-ready")).mtimeMs; } catch { return null; }
}
function resumeNote(ray: string): string | null {
  try {
    const folder = file(ray, "plans");
    const latest = readdirSync(folder).filter((name) => /^\d{4}-\d{2}-\d{2}-resume\.md$/.test(name)).sort().at(-1);
    return latest ? path.join(folder, latest) : null;
  } catch { return null; }
}
function resumeAt(ray: string): number | null {
  try {
    const folder = file(ray, "plans");
    const latest = readdirSync(folder).filter((name) => /^\d{4}-\d{2}-\d{2}-resume\.md$/.test(name)).sort().at(-1);
    return latest ? statSync(path.join(folder, latest)).mtimeMs : null;
  } catch { return null; }
}
export function request(ray: string, why: string, now = Date.now()) {
  if (!rayName(ray) || !existsSync(file(ray, ""))) throw new Error(`unknown ray: ${ray}`);
  if (existsSync(file(ray, ".restart-gate.json"))) throw new Error("handover already prepared; wait for its outcome");
  const live = liveSession(ray);
  const transcript = live ? transcriptFile(loadConfig(), ray, live.sessionId) : null;
  if (live && !transcript)
    throw new Error(`refusing restart request for ${ray}: cannot prove the prompt cache is warm`);
  if (live && transcript && now - transcript.mtime >= CACHE_TTL_MS)
    throw new Error(`refusing restart request for ${ray}: prompt cache expired; park without waking`);
  const claim = file(ray, ".restart-request.claim");
  // The Stop hook uses this same atomic claim. Never remove .sent while another
  // hook is reading an old request or publishing its delivery marker.
  let fd: number | null = null;
  for (let i = 0; i < 50 && fd === null; i++) {
    try { fd = openSync(claim, "wx"); }
    catch {
      try {
        if (Date.now() - statSync(claim).mtimeMs > 60_000) rmSync(claim, { force: true });
      } catch {}
      // CLI requests are synchronous; bounded wait for a concurrent Stop hook.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  if (fd === null) throw new Error(`restart-request busy for ${ray}; retry on next pass`);
  const temp = file(ray, `.restart-request.${process.pid}.tmp`);
  try {
    const before = requestAt(ray) ?? -Infinity;
    const time = Math.max(now, before + 2);
    // Publish the complete contents and final mtime in a single rename so the
    // hook cannot observe an intermediate timestamp and deliver it twice.
    writeFileSync(temp, why);
    utimesSync(temp, time / 1000, time / 1000);
    renameSync(temp, file(ray, ".restart-request"));
    for (const name of [".restart-ready", ".restart-request.sent"])
      rmSync(file(ray, name), { force: true });
  } finally {
    rmSync(temp, { force: true });
    closeSync(fd);
    rmSync(claim, { force: true });
  }
}
export function ready(ray: string, now = Date.now()) {
  if (!rayName(ray) || !existsSync(file(ray, ""))) throw new Error(`unknown ray: ${ray}`);
  writeFileSync(file(ray, ".restart-ready"), new Date(now).toISOString());
  utimesSync(file(ray, ".restart-ready"), now / 1000, now / 1000);
  rmSync(file(ray, ".no-restart"), { force: true });
}
export function hold(ray: string, now = Date.now()) {
  if (!rayName(ray) || !existsSync(file(ray, ""))) throw new Error(`unknown ray: ${ray}`);
  writeFileSync(file(ray, ".no-restart"), new Date(now).toISOString());
  utimesSync(file(ray, ".no-restart"), now / 1000, now / 1000);
}
const gateName = ".restart-gate.json";
const confirmName = ".restart-confirm.json";
function readMarker<T>(ray: string, name: string): T | null {
  try { return JSON.parse(readFileSync(file(ray, name), "utf8")) as T; }
  catch (error: any) { if (error?.code === "ENOENT") return null; throw error; }
}
function writeMarker(ray: string, name: string, value: unknown) {
  const temp = file(ray, `${name}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(value)); renameSync(temp, file(ray, name));
}
function prepared(ray: string) { return readMarker<Prepared>(ray, gateName); }
function guardedCommand<T>(fn: () => T): T {
  const unlock = lockPass();
  if (!unlock) throw new Error("restarter is running a pass; retry this command");
  try { return fn(); } finally { unlock(); }
}
/** The old session has finished writing. Gate the Stop hook before any successor can start. */
export function handover(ray: string, now = Date.now()) {
  return guardedCommand(() => {
    const st = loadState().rays[ray];
    if (!st || !["asked", "working-before-handover"].includes(st.phase) || !st.beforeSession)
      throw new Error("no pending restart request");
    const req = stamp(ray), at = requestAt(ray), note = resumeNote(ray);
    if (!req || req !== st.requestStamp || at === null || !note || statSync(note).mtimeMs <= at)
      throw new Error("write the newest resume note after the current request first");
    if (!liveSession(ray, sessionsDir(), st.beforeSession) || liveSession(ray)?.sessionId !== st.beforeSession)
      throw new Error("old session is no longer the live session");
    if (busyReason(ray)) throw new Error("ray is busy-marked; free it before handover");
    const existing = prepared(ray);
    if (existing && (existing.oldSession !== st.beforeSession || existing.requestStamp !== req || existing.note !== note))
      throw new Error("different handover already prepared");
    if (!existing) writeMarker(ray, gateName, { oldSession: st.beforeSession, requestStamp: req, note, preparedAt: now });
    // Cache guard deliberately parks rather than starting a second cold session.
    ready(ray, now);
  });
}
function validConfirmation(ray: string, a: Attempt, c: Confirmation | null, now: number, timeoutMin: number): c is Confirmation {
  return !!c && c.successorId === a.successorId && c.successorId !== a.oldSession &&
    typeof c.summary === "string" && !!c.summary.trim() && !/[\r\n]/.test(c.summary) &&
    Number.isFinite(c.at) && c.at >= a.openedAt && c.at <= now && c.at <= a.openedAt + timeoutMin * 60_000 &&
    c.note === a.note && resumeNote(ray) === a.note && existsSync(a.note) && statSync(a.note).isFile() &&
    !!liveSession(ray, sessionsDir(), a.successorId);
}
export function confirm(ray: string, id: string, note: string, summary: string, now = Date.now()) {
  return guardedCommand(() => {
    const st = loadState().rays[ray], a = st?.handover;
    if (!a || !st.launchReserved || !["opening-successor", "awaiting-confirm", "closing-old"].includes(st.phase))
      throw new Error("no active successor attempt");
    const c: Confirmation = { successorId: id, note: path.resolve(file(ray, ""), note), summary: summary.trim(), at: now };
    const previous = readMarker<Confirmation>(ray, confirmName), timeout = config().confirmTimeoutMin;
    if (validConfirmation(ray, a, previous, now, timeout) && previous.successorId === c.successorId && previous.note === c.note && previous.summary === c.summary) return;
    if (!validConfirmation(ray, a, c, now, timeout))
      throw new Error("confirmation rejected: expected live successor ID, current resume note, and nonempty one-line summary before deadline");
    if (!validConfirmation(ray, a, previous, now, timeout)) writeMarker(ray, confirmName, c);
  });
}
function clearFiles(ray: string) {
  for (const name of [".restart-request", ".restart-request.sent", ".restart-ready", ".no-restart", confirmName, gateName])
    rmSync(file(ray, name), { force: true });
}

function safeOpener(script: string) {
  try { return readFileSync(script, "utf8").includes("# ray-board-handle-safe-v1") &&
    existsSync(path.join(path.dirname(script), "ray-window-close.ahk")); } catch { return false; }
}


/** Once parked, only actual work (not idle heartbeat notifications) can start a ray. */
function workSince(ray: string, parkedAt: number, now: number): string | null {
  const keeper = keeperNewsSince(ray, parkedAt, now).find((line) => /\b(done|failed)\b|QUEUE EMPTY/.test(line));
  if (keeper) return `keeper: ${keeper.slice(0, 120)}`;
  const plans = file(ray, "plans");
  const pending: string[] = [plans];
  while (pending.length) {
    const folder = pending.pop()!;
    try {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const filename = path.join(folder, entry.name);
        if (entry.isDirectory()) pending.push(filename);
        else if (entry.isFile() && statSync(filename).mtimeMs > parkedAt)
          return `plans: ${path.relative(plans, filename)}`;
      }
    } catch {} // An absent plans directory is not work.
  }
  if (stamp(ray)) return "restart-request";
  // CheckService persists this file under the board dataDir, not under .ray-restarts.
  try {
    const history = JSON.parse(readFileSync(path.join(loadConfig().dataDir, "checks-history.json"), "utf8"));
    const goals = history?.goals;
    if (goals && typeof goals === "object") for (const [key, records] of Object.entries(goals)) {
      if (!key.startsWith(`${ray}/`) || !Array.isArray(records)) continue;
      const rows = records.filter((r: any) => r && Number.isFinite(Date.parse(r.at)))
        .sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));
      const latest = rows.at(-1);
      if (!latest || latest.status !== "fail" || Date.parse(latest.at) <= parkedAt) continue;
      const previous = rows.filter((r: any) => Date.parse(r.at) <= parkedAt).at(-1);
      if (!previous || previous.status !== "fail")
        return `goal check FAIL: ${key.slice(ray.length + 1)}`;
      // A pass after parking followed by a fail is a new transition too.
      if (rows.some((r: any) => Date.parse(r.at) > parkedAt && r.status === "pass"))
        return `goal check FAIL: ${key.slice(ray.length + 1)}`;
    }
  } catch {} // Missing/unreadable optional history is not work.
  return null;
}

/** Park only the exact window handle, after the existing idle / transcript guards. */
async function realClose(ray: string, oldSession: string): Promise<CloseResult> {
  try { validateRay(raysDir(), ray); } catch { return { ok: false, error: "invalid ray" }; }
  const safe = safeToReopen(ray, oldSession, Date.now());
  if (safe) return { ok: false, error: safe };
  const hwndFile = path.join(raysDir(), ".windows", `${ray}.hwnd`);
  let hwnd = "";
  try { hwnd = readFileSync(hwndFile, "utf8").trim(); } catch {}
  if (!/^[1-9]\d*$/.test(hwnd)) return { ok: false, error: "missing exact window handle" };
  const wait = reserveWindowAction(home(), ray, "park");
  if (wait) return { ok: false, error: `global window spacing: ${Math.ceil(wait / 1000)}s` };
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "ray-window-close.ahk");
  const ahk = process.env.RAY_BOARD_AUTOHOTKEY_BIN ??
    path.join(process.env.ProgramFiles ?? "C:/Program Files", "AutoHotkey", "v2", "AutoHotkey64.exe");
  const close = spawnSync(ahk, [helper, ray, hwnd, hwndFile], { encoding: "utf8", timeout: 30_000 });
  if (close.error || close.status !== 0) {
    const current = liveSession(ray, sessionsDir(), oldSession);
    const exact = path.join(path.dirname(helper), "handover-window.ahk");
    const fallback = spawnSync(ahk, [exact, "close", ray, hwnd, String(current?.pid ?? 0), "old", hwndFile],
      { encoding: "utf8", timeout: 60_000 });
    if (fallback.error || fallback.status !== 0)
      return { ok: false, error: `exact window close failed: ${String(fallback.error ?? fallback.stderr ?? fallback.status).slice(0, 200)}` };
  }
  return liveSession(ray, sessionsDir(), oldSession)
    ? { ok: false, error: "session still registered after window close" } : { ok: true };
}

async function realOpen(ray: string): Promise<ReopenResult> {
  try { validateRay(raysDir(), ray); } catch { return { ok: false, error: "invalid ray" }; }
  const script = path.join(raysDir(), "open-ray.ps1");
  if (!safeOpener(script)) return { ok: false, error: "unsafe or missing open-ray.ps1" };
  if (liveSession(ray)) return { ok: false, error: "ray already has a live session; -Fresh would be skipped" };
  const wait = reserveWindowAction(home(), ray, "start");
  if (wait) return { ok: false, error: `global window spacing: ${Math.ceil(wait / 1000)}s` };
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", script, ray, "-Fresh", "-NoGrid"],
    { encoding: "utf8", timeout: 120_000 });
  if (r.error || r.status !== 0)
    return { ok: false, error: String(r.error ?? r.stderr ?? r.stdout ?? `exit ${r.status}`).slice(0, 300) };
  for (let i = 0; i < 45; i++) {
    await sleep(2_000);
    const session = liveSession(ray);
    if (session) return { ok: true, newSession: session.sessionId };
  }
  return { ok: false, error: "no fresh session registered within 90 s" };
}

/** Read only the live session's usage: a failed successor's newer transcript is not the old ray's cache. */
function contextFromTranscript(filename?: string): number | null {
  if (!filename) return null;
  try {
    const lines = readFileSync(filename, "utf8").slice(-512 * 1024).split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line), usage = entry?.message?.usage ?? entry?.usage;
        if (usage && typeof usage === "object") return ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]
          .reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
        if (Number.isFinite(entry?.contextTokens)) return entry.contextTokens;
      } catch {} // truncated or partial JSONL line
    }
  } catch {} // transcript disappeared
  return null;
}
function transcriptQuiet(ray: string, sessionId: string, now: number): string | null {
  const t = transcriptFile(loadConfig(), ray, sessionId);
  if (!t) return "no transcript for live session";
  try {
    if (now - statSync(t.file).mtimeMs < QUIET_MS) return "transcript changed within 60 s";
  } catch { return "transcript disappeared"; }
  return null;
}
function safeToReopen(ray: string, sessionId: string, now: number): string | null {
  if (holdActive(ray, now)) return "hold: money/deploy in progress";
  const s = liveSession(ray);
  if (!s || s.sessionId !== sessionId) return "live session disappeared or changed";
  if (s.status !== "idle") return `session ${s.status || "unknown"} (not idle)`;
  return transcriptQuiet(ray, sessionId, now);
}
function finish(state: StoredState, ray: string, st: RayState, row: Restart) {
  // Crash window: the log may already be appended while state.json still says reopening.
  // Recovery must not count/log the same destructive attempt twice.
  if (!restarts(100_000).some((r) => r.ray === ray && r.at === row.at && r.attempted !== false))
    log(row);
  state.rays[ray] = {
    // 26 Nov: an attempt refused before any window action (spacing, opener) must not start the 2 h cooldown;
    // the coordinator sat at 700-800k context for hours because a spacing refusal counted as a restart.
    phase: "watching", lastRestartAt: !row.ok && /^(global window spacing|unsafe or missing|invalid ray)/.test(row.error ?? "") ? st.lastRestartAt : row.at,
    retryPending: !row.ok && !row.newSession, blocked: !row.ok && row.newSession ? row.error : undefined,
  };
  if (row.ok) clearFiles(ray);
}
function noSession(state: StoredState, ray: string, st: RayState, now: number,
  ctx: number | null, idleMin: number | null) {
  if (st.noSessionLogged) return;
  log({ at: now, ray, reason: st.reason ?? "no live session", ctx, idleMin,
    waited: "manual", ok: false, error: "no session", attempted: false });
  state.rays[ray] = { ...st, noSessionLogged: true };
}

const activeHandover = (st: RayState) => !!st.handover && ["opening-successor", "awaiting-confirm", "closing-old", "failed", "done"].includes(st.phase);
function failedToday(ray: string, now: number) {
  return restarts(100_000).filter(r => r.ray === ray && r.handoverId && !r.ok &&
    Math.floor(r.at / 86_400_000) === Math.floor(now / 86_400_000)).length;
}
function handoverCap(ray: string, now: number, cfg: Config) {
  return countToday(ray, now) >= cfg.maxRestartsPerRayPerDay || failedToday(ray, now) >= 3;
}
/** Each effect is idempotent for its persisted attempt ID; never infer confirmation from registry alone. */
async function advanceHandover(state: StoredState, ray: string, st: RayState, cfg: Config, now: number,
  ctx: number | null, idleMin: number | null, dryRun: boolean, windows: HandoverWindows): Promise<string> {
  let a = st.handover!;
  const put = (next: RayState) => { state.rays[ray] = next; saveState(state); st = next; };
  const deadline = () => a.openedAt + cfg.confirmTimeoutMin * 60_000;
  const old = () => liveSession(ray, sessionsDir(), a.oldSession);
  const successor = () => liveSession(ray, sessionsDir(), a.successorId);
  const proof = () => readMarker<Confirmation>(ray, confirmName);
  const valid = () => validConfirmation(ray, a, proof(), now, cfg.confirmTimeoutMin);
  const result = async (fn: () => Promise<CloseResult>): Promise<CloseResult> => {
    try { return await fn(); } catch (e) { return { ok: false, error: String(e).slice(0, 300) }; }
  };
  const fail = (error: string) => {
    put({ ...st, phase: "failed", error, cleaned: false, finishedAt: now });
    return `handover failed: ${error}; successor cleanup pending`;
  };
  const finishLog = (ok: boolean) => {
    writeMarker(ray, ".restart-outcome.json", { oldSession: a.oldSession, successorId: a.successorId, preparedAt: a.preparedAt, ok });
    if (!restarts(100_000).some(r => r.handoverId === a.successorId)) log({
      at: a.openedAt, ray, reason: st.reason ?? "handover", ctx, idleMin, waited: "ready", ok,
      attempted: true, oldSession: a.oldSession, newSession: a.successorId, handoverId: a.successorId,
      prepareWaitMs: a.preparedAt - (st.askedAt ?? a.preparedAt),
      confirmWaitMs: (st.confirmedAt ?? st.finishedAt ?? now) - a.openedAt,
      totalWaitMs: (st.finishedAt ?? now) - (st.askedAt ?? a.preparedAt),
      summary: proof()?.summary, error: ok ? undefined : st.error,
    });
  };
  if (st.phase === "done" || (st.phase === "failed" && st.cleaned)) {
    if (!dryRun) {
      finishLog(st.phase === "done");
      if (existsSync(file(ray, gateName))) clearFiles(ray); // gate removed LAST
      if (st.phase === "done" || (idleMin !== null && idleMin >= cfg.idleMin) || now - (st.finishedAt ?? now) >= cfg.cooldownMin * 60_000)
        put({ phase: "watching", lastRestartAt: st.finishedAt, lastUnparkAt: st.lastUnparkAt });
    }
    return st.phase === "failed" ? `failed: ${st.error}; ${handoverCap(ray, now, cfg) ? "daily cap" : "cooldown"}` : "handover done";
  }
  if (dryRun) return `${st.phase}: ${a.oldSession} -> ${a.successorId}${st.error ? ` (${st.error})` : ""}`;
  if (st.phase === "failed") {
    // Once a confirmed close has actually removed the old session, never kill its replacement.
    if (!old()) return "failed: old session absent; manual recovery required (successor retained)";
    const closed = await result(() => windows.close(ray, a, "successor", successor()?.pid));
    if (!closed.ok || successor()) return `failed: successor cleanup not verified: ${closed.error ?? "still registered"}`;
    put({ ...st, cleaned: true, finishedAt: now });
    finishLog(false); clearFiles(ray);
    return `failed: ${st.error}; successor closed, old retained`;
  }
  // A crash after committing the attempt but before updating the Stop-hook gate is harmless.
  const g = prepared(ray);
  if (!g || g.oldSession !== a.oldSession || g.requestStamp !== a.requestStamp)
    return "handover blocked: prepared gate missing or changed; manual recovery required";
  if (st.phase === "opening-successor") {
    writeMarker(ray, gateName, { ...g, successorId: a.successorId });
    if (!old()) return fail("old session disappeared before successor confirmation");
    if (!st.launchReserved) {
      if (old()?.pid !== a.window.pid) return fail("old session PID changed before opening");
      const guard = safeToReopen(ray, a.oldSession, now);
      if (guard) return `opening-successor: ${guard}`;
    }
    if (st.launchReserved && now >= deadline() && !valid()) return fail("successor confirmation timed out");
    const last = Math.max(state.lastAttemptAt ?? 0, lastWindowAction(home())?.at ?? 0);
    if (now - last < SPACING_MS) return "opening-successor: global 90 s spacing";
    // Reserve the actual effect, not merely preparation. Recovery invocations also respect spacing.
    if (!st.launchReserved) a = { ...a, openedAt: now };
    state.lastAttemptAt = now;
    put({ ...st, handover: a, launchReserved: true, attemptAt: a.openedAt });
    const opened = await result(() => windows.open(ray, a));
    if (!opened.ok) return `opening-successor: ${opened.error ?? "window not registered yet"}`;
    put({ ...st, phase: "awaiting-confirm" });
    return "awaiting-confirm: successor window registered";
  }
  if (st.phase === "awaiting-confirm") {
    if (valid()) {
      put({ ...st, phase: "closing-old", confirmedAt: proof()!.at });
      return "closing-old: confirmation accepted";
    }
    if (now >= deadline()) return fail("successor confirmation timed out");
    if (!old()) return fail("old session disappeared before confirmation");
    return "awaiting-confirm: waiting for live successor acknowledgement";
  }
  if (st.phase === "closing-old") {
    if (!valid()) {
      if (!old()) return "closing-old blocked: confirmation or successor lost after old exited; manual recovery required";
      return fail("successor confirmation no longer valid before close");
    }
    // Validate the successor's exact registered window before touching the old one.
    const verified = await result(() => windows.verify(ray, a, successor()!.pid));
    if (!verified.ok) return `closing-old: successor window not verified: ${verified.error ?? "unknown"}`;
    if (!valid()) return "closing-old: successor disappeared during verification";
    const currentOld = old();
    if (currentOld && (currentOld.status !== "idle" || holdActive(ray, now))) return "closing-old: old session not idle or on hold";
    const oldTranscript = transcriptFile(loadConfig(), ray, a.oldSession);
    if (currentOld && (!oldTranscript || now - oldTranscript.mtime < QUIET_MS)) return "closing-old: old transcript not quiet";
    const closed = await result(() => windows.close(ray, a, "old", currentOld?.pid));
    if (!closed.ok || old()) return `closing-old: old close not verified: ${closed.error ?? "still registered"}`;
    if (!valid()) return "closing-old: successor disappeared after close; manual recovery required";
    const promoted = await result(() => windows.promote(ray, a, successor()!.pid));
    if (!promoted.ok) return `closing-old: promotion pending: ${promoted.error ?? "unknown"}`;
    put({ ...st, phase: "done", finishedAt: now, lastRestartAt: now });
    finishLog(true); clearFiles(ray);
    return "handover done: confirmed successor promoted";
  }
  return "invalid handover phase";
}

/** One full pass. The injected clock, context reader, closer and openers never bypass real guards. */
export async function pass(dryRun = false, options: Dependencies | number = {}): Promise<Seen[]> {
  const deps: Dependencies = typeof options === "number" ? { clock: () => options } : options;
  const now = deps.clock?.() ?? Date.now();
  const cfg = config();
  const list = cfg.rays === "all" ? allRays() : cfg.rays;
  let state = loadState();
  const seen: Seen[] = [];
  const unlock = dryRun ? () => {} : lockPass();
  if (!unlock) return list.map((ray) => ({
    ray, ctx: null, idleMin: null, session: "-", status: "unknown",
    phase: state.rays[ray]?.phase ?? "watching", news: 0, action: "another restarter pass is running",
  }));
  let attemptedThisPass = false;
  const unparkTimes: number[] = [];
  try {
    if (!dryRun) state = loadState();
    unparkTimes.push(...(state.unparkTimes ?? []).filter((t) => Number.isFinite(t) && now - t < UNPARK_GAP_MS && t <= now));
    for (const ray of list) {
      if (!rayName(ray) || !existsSync(file(ray, ""))) {
        seen.push({ ray, ctx: null, idleMin: null, session: "-", status: "none",
          phase: "watching", news: 0, action: "invalid or missing ray directory" });
        continue;
      }
      let st: RayState = state.rays[ray] ?? { phase: "watching" };
      const busy = busyReason(ray);
      if (busy !== null && !activeHandover(st) && !prepared(ray)) {
        // A busy marker exempts a live ray. Do not discard a parked record.
        if (!dryRun && st.phase !== "watching" && st.phase !== "parked" && st.phase !== "unparking") {
          st = state.rays[ray] = { phase: "watching", lastRestartAt: st.lastRestartAt,
            lastUnparkAt: st.lastUnparkAt };
          for (const f of [".restart-request", ".restart-request.sent", ".restart-ready"])
            rmSync(file(ray, f), { force: true });
        }
        seen.push({ ray, ctx: null, idleMin: null, session: "-", status: "busy-mark",
          phase: st.phase, news: 0, action: `busy: ${busy}`, parkedAt: st.parkedAt });
        continue;
      }
      const session = liveSession(ray);
      const transcript = session ? transcriptFile(loadConfig(), ray, session.sessionId) : null;
      const ctx = deps.context ? await deps.context(ray, now) : contextFromTranscript(transcript?.file);
      // Only a transcript belonging to the live session is used as cache age evidence.
      const idleMs = transcript && session && transcript.session === session.sessionId
        ? Math.max(0, now - transcript.mtime) : null;
      const idleMin = idleMs === null ? null : Math.floor(idleMs / 60_000);
      const news = transcript ? keeperNewsSince(ray, transcript.mtime, now) : [];
      const reqStamp = stamp(ray);
      const expired = idleMs !== null && idleMs >= CACHE_TTL_MS;
      const cacheDue = idleMs !== null && idleMs >= cfg.idleMin * 60_000;
      let action = "watching; no trigger";
      let pendingForStatus: string | undefined;
      if (session && st.noSessionLogged) st = { ...st, noSessionLogged: false };

      // The state is committed *before* any destructive close/open so recovery cannot repeat it.
      const park = async (mode: "ready" | "timeout" | "expired", prior: RayState) => {
        if (!session) { action = "park refused: no live session"; return; }
        // 26 Nov: parking closed coordinator and healy overnight, then every unpark failed on the
        // opener check, so both stayed dead for hours. Never close a session we cannot reopen.
        if (!dryRun && !deps.reopen && !deps.close && !safeOpener(path.join(raysDir(), "open-ray.ps1"))) {
          action = "park refused: open-ray.ps1 is not the safe opener, so the session could not be reopened"; return;
        }
        const refused = safeToReopen(ray, session.sessionId, now);
        if (refused) { action = `park refused: ${refused}`; return; }
        action = `park (${mode})`;
        if (dryRun) return;
        const lastGuard = safeToReopen(ray, session.sessionId, deps.clock?.() ?? Date.now());
        if (lastGuard) { action = `park refused: ${lastGuard}`; return; }
        if (mode === "expired") for (const marker of [".restart-request", ".restart-request.sent"])
          rmSync(file(ray, marker), { force: true });
        const before = state.rays[ray];
        const parking: RayState = { ...prior, phase: "parking", beforeSession: session.sessionId,
          waited: mode === "expired" ? "timeout" : mode, attemptAt: now,
          resumeNote: resumeNote(ray), parkedSession: session.sessionId };
        state.rays[ray] = parking;
        saveState(state);
        const boundaryGuard = safeToReopen(ray, session.sessionId, deps.clock?.() ?? Date.now());
        if (boundaryGuard) {
          state.rays[ray] = before ?? prior;
          saveState(state);
          action = `park refused: ${boundaryGuard}`;
          return;
        }
        let res: CloseResult;
        try { res = await (deps.close ?? realClose)(ray, session.sessionId); }
        catch (error) { res = { ok: false, error: String(error).slice(0, 300) }; }
        if (res.ok) {
          state.rays[ray] = { phase: "parked", parkedAt: now, resumeNote: parking.resumeNote,
            parkedSession: session.sessionId, lastRestartAt: prior.lastRestartAt,
            lastUnparkAt: prior.lastUnparkAt };
          clearFiles(ray);
          action = `park (${mode}) ok`;
        } else if (res.error?.startsWith("global window spacing")) {
          state.rays[ray] = before ?? prior;
          action = `park deferred: ${res.error}`;
        } else {
          // Do not claim a parked window when the adapter reported a failure.
          state.rays[ray] = { ...parking, blocked: res.error ?? "close failed" };
          action = `park (${mode}) FAILED: ${res.error ?? "close failed"}`;
        }
      };

      if (activeHandover(st)) {
        action = await advanceHandover(state, ray, st, cfg, now, ctx, idleMin, dryRun, deps.handoverWindows ?? windowsHandover(raysDir()));
      } else if (st.phase === "parking") {
        if (!session) {
          action = "recovered park after session exited (window not independently verified)";
          if (!dryRun) {
            state.rays[ray] = { phase: "parked", parkedAt: st.attemptAt ?? now,
              resumeNote: st.resumeNote ?? null, parkedSession: st.parkedSession ?? st.beforeSession,
              lastUnparkAt: st.lastUnparkAt, lastRestartAt: st.lastRestartAt };
            clearFiles(ray);
          }
        } else if (session.sessionId !== st.beforeSession) {
          action = "parking interrupted by a different live session; watching";
          if (!dryRun) state.rays[ray] = { phase: "watching", lastUnparkAt: st.lastUnparkAt };
        } else if (st.blocked) action = `park requires intervention: ${st.blocked}`;
        else if (now - (st.attemptAt ?? now) < RECOVERY_MS)
          action = "recovering park; will not close twice";
        else action = "park requires intervention: previous close has not completed";
      } else if (st.phase === "unparking") {
        if (session && session.sessionId !== st.parkedSession) {
          action = "recovered completed unpark (no duplicate open)";
          if (!dryRun) {
            state.rays[ray] = { phase: "watching", lastUnparkAt: st.lastUnparkAt,
              lastRestartAt: st.lastRestartAt };
            clearFiles(ray);
          }
        } else if (now - (st.attemptAt ?? now) < RECOVERY_MS)
          action = "recovering unpark; will not open twice";
        else {
          action = "unpark attempt not verified; parked (10 min retry limit)";
          if (!dryRun) state.rays[ray] = { ...st, phase: "parked", pendingUnpark: st.pendingUnpark };
        }
      } else if (st.phase === "parked") {
        if (session) {
          // A ray opened outside the restarter must never be opened a second time.
          action = "ray opened externally; watching";
          if (!dryRun) state.rays[ray] = { phase: "watching", lastUnparkAt: st.lastUnparkAt,
            lastRestartAt: st.lastRestartAt };
        } else {
          const reason = workSince(ray, st.parkedAt ?? now, now);
          pendingForStatus = reason ?? undefined;
          const perRayLimited = st.lastUnparkAt !== undefined && now - st.lastUnparkAt < UNPARK_GAP_MS;
          const minute = Math.floor(now / 60_000);
          const minuteCount = unparkTimes.filter((t) => Math.floor(t / 60_000) === minute).length;
          if (!reason) action = `parked since ${new Date(st.parkedAt ?? now).toISOString()}; no work`;
          else if (holdActive(ray, now)) action = `parked; pending unpark: ${reason}; hold`;
          else if (perRayLimited) action = `parked; pending unpark: ${reason}; per-ray 10 min spacing`;
          else if (minuteCount >= UNPARK_LIMIT_PER_MINUTE)
            action = `parked; pending unpark: ${reason}; global 2 unpark/min limit`;
          else {
            action = `unpark: ${reason}`;
            unparkTimes.push(now); // Dry-run simulates quota for later rays but writes nothing.
            if (!dryRun) {
              const pending: RayState = { ...st, phase: "unparking", attemptAt: now,
                lastUnparkAt: now, pendingUnpark: reason };
              state.rays[ray] = pending;
              state.unparkTimes = unparkTimes;
              saveState(state);
              // No -Reopen: a parked ray must have no live session at the destructive boundary.
              if (liveSession(ray)) {
                state.rays[ray] = { ...pending, phase: "parked" };
                action = "unpark refused: a live session appeared";
              } else {
                let res: ReopenResult;
                try { res = await (deps.open ?? realOpen)(ray); }
                catch (error) { res = { ok: false, error: String(error).slice(0, 300) }; }
                const current = liveSession(ray);
                if (res.ok && (!current || current.sessionId === st.parkedSession))
                  res = { ok: false, error: "opener returned success without a fresh registered session" };
                if (current && current.sessionId !== st.parkedSession)
                  res = { ...res, newSession: current.sessionId };
                if (res.ok) {
                  state.rays[ray] = { phase: "watching", lastUnparkAt: now, lastRestartAt: st.lastRestartAt };
                  clearFiles(ray);
                  action += ` ok -> ${res.newSession}`;
                } else {
                  state.rays[ray] = { ...pending, phase: "parked" };
                  action += ` FAILED: ${res.error ?? "open failed"}`;
                }
              }
            }
          }
          if (!dryRun) {
            const newSt = state.rays[ray] ?? st;
            if (newSt.phase === "parked") state.rays[ray] = { ...newSt, pendingUnpark: reason ?? undefined };
          }
        }
      } else if (st.phase === "reopening") {
        const current = liveSession(ray);
        if (current && current.sessionId !== st.beforeSession) {
          action = "recovered completed reopen (no duplicate reopen)";
          if (!dryRun) finish(state, ray, st, {
            at: st.attemptAt ?? now, ray, reason: st.reason ?? "", ctx, idleMin,
            waited: st.waited ?? "timeout", ok: true, newSession: current.sessionId, attempted: true,
          });
        } else if (now - (st.attemptAt ?? now) < RECOVERY_MS) {
          action = "recovering previous reopen; will not reopen twice";
        } else {
          action = "previous reopen failed to verify; cooling down";
          if (!dryRun) finish(state, ray, st, {
            at: st.attemptAt ?? now, ray, reason: st.reason ?? "", ctx, idleMin,
            waited: st.waited ?? "timeout", ok: false,
            error: "interrupted reopen: no new session", attempted: true,
          });
        }
      } else if (!session) {
        action = "no session (restart refused)";
        if (!dryRun) noSession(state, ray, st, now, ctx, idleMin);
      } else if (st.phase === "watching") {
        if (st.blocked) action = `manual intervention required: ${st.blocked}`;
        else if (holdActive(ray, now)) action = "hold: money/deploy in progress";
        else if (idleMs === null) action = "watching; no transcript for live session";
        else if (session.status !== "idle" && (expired || cacheDue || (!reqStamp && (ctx === null || ctx < cfg.ctxMax)))) action = `watching; session ${session.status || "unknown"} (not idle)`;
        else if (expired) {
          // Never wake a cold session. Only park once its transcript has been idle long enough.
          if (idleMs! >= cfg.idleNoReadyMin * 60_000) await park("expired", st);
          else action = "watching; cold cache, waiting for idle threshold";
        } else if (cacheDue) {
          action = "ask (cache-guard)";
          if (!dryRun) {
            if (!reqStamp || !readFileSync(file(ray, ".restart-request"), "utf8").startsWith("cache-guard:"))
              request(ray, "cache-guard: save state and park before prompt cache expires", now);
            state.rays[ray] = { phase: "working-before-handover", mode: "park", reason: "cache-guard",
              askedAt: requestAt(ray) ?? now, requestStamp: stamp(ray) ?? undefined,
              beforeSession: session.sessionId, lastUnparkAt: st.lastUnparkAt,
              lastRestartAt: st.lastRestartAt };
            saveState(state);
          }
        } else {
          const pause = existsSync(path.join(raysDir(), "WAKE-PAUSED"));
          const automaticContext = ctx !== null && ctx >= cfg.ctxMax;
          const automaticIdle = idleMin !== null && idleMin >= cfg.idleMin && news.length > 0;
          const reason = reqStamp ? readFileSync(file(ray, ".restart-request"), "utf8").trim() || "manual request"
            : automaticContext ? `context ${Math.round(ctx! / 1000)}k over ${Math.round(cfg.ctxMax / 1000)}k`
            : automaticIdle ? `idle ${idleMin} min with keeper news` : "";
          if (!reason) action = "watching; no trigger";
          else if (handoverCap(ray, now, cfg))
            action = `daily cap: ${cfg.maxRestartsPerRayPerDay} attempts (UTC day)`;
          else if (st.lastRestartAt !== undefined && now - st.lastRestartAt < cfg.cooldownMin * 60_000)
            action = `cooldown: ${Math.ceil((cfg.cooldownMin * 60_000 - (now - st.lastRestartAt)) / 60_000)} min`;
          else if (!reqStamp && !automaticContext && pause && automaticIdle)
            action = "WAKE-PAUSED: idle trigger disabled";
          else {
            action = `ask: ${reason}`;
            if (!dryRun) {
              if (!reqStamp || st.retryPending) request(ray, reason, now);
              state.rays[ray] = { phase: "working-before-handover", mode: "restart", reason, askedAt: requestAt(ray) ?? now,
                requestStamp: stamp(ray) ?? undefined, beforeSession: session.sessionId,
                lastUnparkAt: st.lastUnparkAt, lastRestartAt: st.lastRestartAt };
              saveState(state);
            }
          }
        }
      } else if (st.phase === "asked" || st.phase === "working-before-handover") {
        const g = prepared(ray);
        if (session.sessionId !== st.beforeSession) {
          action = "session was replaced externally; restart cancelled";
          if (!dryRun && !g) { clearFiles(ray); state.rays[ray] = { phase: "watching", lastRestartAt: st.lastRestartAt, lastUnparkAt: st.lastUnparkAt }; }
          else if (g) action = "handover blocked: prepared old session changed; manual recovery required";
        } else if (!reqStamp) {
          action = g ? "handover blocked: prepared request removed; manual recovery required" : "restart request removed; returning to watch";
          if (!dryRun && !g) state.rays[ray] = { phase: "watching", lastRestartAt: st.lastRestartAt, lastUnparkAt: st.lastUnparkAt };
        } else if (reqStamp !== st.requestStamp) {
          action = "request replaced; waiting for a new handover";
          if (!dryRun && !g) state.rays[ray] = { ...st, phase: "working-before-handover", reason: readFileSync(file(ray, ".restart-request"), "utf8").trim(), askedAt: now, requestStamp: reqStamp };
        } else if (holdActive(ray, now)) action = "hold: money/deploy in progress";
        else {
          const at = requestAt(ray), marker = readyAt(ray), note = resumeNote(ray);
          const updated = at !== null && note !== null && statSync(note).mtimeMs > at;
          const acknowledged = !!g && g.oldSession === session.sessionId && g.requestStamp === reqStamp && g.note === note && updated;
          const parkReady = st.mode === "park" && updated && marker !== null && at !== null && marker >= at;
          if (parkReady) await park("ready", st);
          else if (!g && expired && idleMs! >= cfg.idleNoReadyMin * 60_000) await park("expired", st);
          else if (!acknowledged) action = "working-before-handover: waiting for handover (no forced restart)";
          else if (st.mode === "park") await park("ready", st);
          else if (handoverCap(ray, now, cfg)) action = "daily cap: handover attempts or retries exhausted";
          else {
            const guard = safeToReopen(ray, session.sessionId, now);
            const last = Math.max(state.lastAttemptAt ?? 0, lastWindowAction(home())?.at ?? 0);
            if (guard) action = `handover refused: ${guard}`;
            else if (attemptedThisPass || now - last < SPACING_MS) action = "handover refused: global 90 s spacing";
            else if (dryRun) action = "opening-successor: ready to start";
            else {
              const windows = deps.handoverWindows ?? windowsHandover(raysDir());
              try {
                const window = await windows.capture(ray, session.pid);
                const boundary = safeToReopen(ray, session.sessionId, deps.clock?.() ?? Date.now());
                if (boundary) action = `handover refused: ${boundary}`;
                else {
                  const a: Attempt = { ...g!, window, successorId: randomUUID(), openedAt: now };
                  attemptedThisPass = true;
                  state.rays[ray] = { ...st, phase: "opening-successor", handover: a, attemptAt: now };
                  saveState(state); // commit identity, handle, rect and reservation BEFORE opening
                  action = "opening-successor: attempt persisted";
                }
              } catch (e) { action = `handover refused: ${String(e).slice(0, 300)}`; }
            }
          }
        }
      }
      const currentState = state.rays[ray] ?? st;
      seen.push({ ray, ctx, idleMin, session: session?.sessionId.slice(0, 8) ?? "-",
        status: session?.status ?? "none", phase: currentState.phase === "asked" ? "working-before-handover" : currentState.phase,
        oldSession: currentState.handover?.oldSession ?? currentState.beforeSession,
        successorSession: currentState.handover?.successorId,
        parkedAt: currentState.parkedAt,
        pendingUnpark: pendingForStatus ?? currentState.pendingUnpark,
        news: news.length, action });
    }
    if (!dryRun) {
      state.unparkTimes = unparkTimes;
      saveState(state);
    }
  } finally { unlock(); }
  return seen;
}

if (import.meta.main) {
  const [cmd, ray, ...rest] = process.argv.slice(2);
  const dryRun = process.argv.includes("--dry-run");
  const known = (name?: string) => {
    if (!name || !rayName(name) || !existsSync(file(name, ""))) {
      console.error(`unknown ray: ${name}`);
      process.exit(2);
    }
    return name;
  };
  if (cmd === "handover") {
    handover(known(ray)); console.log(`handover prepared: ${ray}; end your turn and do nothing else until the restarter releases you`);
  } else if (cmd === "confirm") {
    const [id, note, ...summary] = rest;
    if (!id || !note || !summary.length) throw new Error("usage: confirm <ray> <session-id> <resume-note-path> <one-line summary>");
    confirm(known(ray), id, note, summary.join(" "));
    console.log("confirmation recorded; do not start work until the old window closes and the Stop hook releases you");
  } else if (cmd === "ready") { ready(known(ray)); console.log(`ready: ${ray} (note must have changed since request)`); }
  else if (cmd === "busy") { writeFileSync(file(known(ray), ".busy"), rest.join(" ") || "busy"); console.log(`busy: ${ray} is exempt from restarts until \`restarter.ts free ${ray}\``); }
  else if (cmd === "free") { rmSync(file(known(ray), ".busy"), { force: true }); console.log(`free: ${ray} is watched again`); }
  else if (cmd === "hold") { hold(known(ray)); console.log(`hold: ${ray}, up to 3 h`); }
  else if (cmd === "request") {
    guardedCommand(() => request(known(ray), rest.join(" ") || "manual request")); console.log(`requested: ${ray}`);
  } else if (cmd === "status" || cmd === "once") {
    console.table(await pass(cmd === "status" || dryRun));
  } else if (cmd === "run") {
    console.log(`ray-restarter: ${JSON.stringify(config())}${dryRun ? " (dry run)" : ""}`);
    for (;;) {
      try {
        for (const s of await pass(dryRun)) if (s.action !== "watching; no trigger")
          console.log(`${new Date().toISOString()} ${s.ray}: ${s.action}`);
      } catch (error) { console.error(`${new Date().toISOString()} pass failed: ${String(error).slice(0, 300)}`); }
      await sleep(60_000);
    }
  } else {
    console.error("usage: bun src/restarter.ts run|once|status [--dry-run] | handover|ready|hold|request <ray> | confirm <ray> <session-id> <note> <summary>");
    process.exit(2);
  }
}
