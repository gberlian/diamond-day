#!/usr/bin/env bun
/**
 * Explicit GOALS.md checks. No prose is executable: the only accepted declaration is
 * an indented `check: ...` continuation of the goal's Check field.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { readRayGoals, type Goal, type RayGoals } from "./goals.ts";
import { projectNames } from "./projects.ts";

export const CHECK_INTERVAL_MS = 10 * 60_000;
export const STALE_AFTER_MS = 24 * 60 * 60_000;
export const OUTPUT_BYTES = 2048;
export const HISTORY_LIMIT = 50;

export type CheckSpec =
  | { kind: "run"; argv: string[]; timeoutMs: number }
  | { kind: "http"; url: string; expectedStatus: number; timeoutMs: number }
  | { kind: "file"; file: string; maxAgeMs: number; timeoutMs: number }
  | { kind: "manual"; timeoutMs: number };
export type CheckLight = "pass" | "fail" | "stale" | "manual" | "never";
export type CheckRecord = {
  at: string; status: "pass" | "fail"; source: CheckSpec["kind"] | "report";
  output: string; lastLine: string; durationMs: number;
  exitCode?: number | null; timedOut?: boolean;
};
export type CheckResult = {
  state: CheckLight; kind: CheckSpec["kind"] | null;
  at: string | null; lastLine: string | null; output: string | null;
  durationMs: number | null; source: CheckRecord["source"] | null;
  running: boolean;
};
type History = { version: 1; attempts: Record<string, number>; goals: Record<string, CheckRecord[]> };
const emptyHistory = (): History => ({ version: 1, attempts: Object.create(null), goals: Object.create(null) });
const validRay = (s: string) => /^[a-zA-Z0-9][\w.-]*$/.test(s) && s.length <= 100;
const validGoal = (s: string) => /^\d{1,12}$/.test(s);
const keyFor = (ray: string, goal: string) => `${ray}/${goal}`;
const inside = (base: string, target: string) => {
  const rel = path.relative(base, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const tail = (text: string) => Buffer.from(text, "utf8").subarray(-OUTPUT_BYTES).toString("utf8");
const lastLine = (text: string) => text.trimEnd().split(/\r?\n/).at(-1)?.trim() || "(no output)";
const timeoutArg = (s: string): number | null => {
  const m = /^timeout=(\d{1,3})s$/.exec(s);
  const n = Number(m?.[1]);
  return m && n >= 1 && n <= 300 ? n * 1000 : null;
};

/** Whitespace-delimited argv with single/double quoted tokens; backslashes are literal except before quotes. */
export function tokenizeArgv(input: string): string[] | null {
  const out: string[] = [];
  let pos = 0;
  while (pos < input.length) {
    while (pos < input.length && /\s/.test(input[pos]!)) pos++;
    if (pos === input.length) break;
    let word = "", quote = "", started = false;
    while (pos < input.length) {
      const c = input[pos]!;
      if (!quote && /\s/.test(c)) break;
      started = true;
      if (c === "\\" && pos + 1 < input.length && input[pos + 1] === quote && quote) {
        word += quote; pos += 2; continue;
      }
      if (!quote && (c === "'" || c === '"')) { quote = c; pos++; continue; }
      if (quote && c === quote) { quote = ""; pos++; continue; }
      word += c; pos++;
    }
    if (quote || !started || /[\0\r\n]/.test(word)) return null;
    out.push(word);
  }
  return out;
}

/** Exactly one well-formed declaration; malformed and ambiguous declarations are inert. */
export function parseCheckDeclaration(checkField: string): CheckSpec | null {
  const declarations = checkField.split(/\r?\n/).map((line) =>
    /^\s*(?:[-*]\s+)?check:\s*(.*?)\s*$/i.exec(line)?.[1]).filter((x): x is string => x !== undefined);
  if (declarations.length !== 1) return null;
  const tokens = tokenizeArgv(declarations[0]!);
  if (!tokens?.length) return null;
  const kind = tokens.shift()!.toLowerCase();
  let timeoutMs = 60_000;
  if (tokens.at(-1)?.startsWith("timeout=")) {
    const value = timeoutArg(tokens.pop()!);
    if (!value) return null;
    timeoutMs = value;
  }
  if (tokens.some((x) => x.startsWith("timeout="))) return null;
  if (kind === "manual" && !tokens.length && timeoutMs === 60_000) return { kind: "manual", timeoutMs };
  if (kind === "run" && tokens.length >= 1 && tokens[0] &&
    !tokens.some((x) => /[\r\n\0]/.test(x)) && !tokens[0].startsWith("-"))
    return { kind: "run", argv: tokens, timeoutMs };
  if (kind === "http" && tokens.length === 3 && tokens[0]!.toUpperCase() === "GET") {
    try {
      const url = new URL(tokens[1]!);
      const expectedStatus = Number(tokens[2]);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
        !url.hash && /^\d{3}$/.test(tokens[2]!) && expectedStatus >= 100 && expectedStatus <= 599)
        return { kind: "http", url: url.toString(), expectedStatus, timeoutMs };
    } catch {}
  }
  if ((kind === "file" || kind === "file-age") && tokens.length === 3 && tokens[1] === "younger") {
    const file = tokens[0]!;
    const age = /^(\d+)([mhd])$/.exec(tokens[2]!);
    const n = Number(age?.[1]);
    const maxAgeMs = n * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[age?.[2] as "m" | "h" | "d"] || 0);
    if (age && n > 0 && Number.isSafeInteger(maxAgeMs) && file && !path.isAbsolute(file) &&
      !path.win32.isAbsolute(file) && !file.includes("\0") && !file.split(/[\\/]/).includes(".."))
      return { kind: "file", file, maxAgeMs, timeoutMs };
  }
  return null;
}

function rayFolder(root: string, ray: string): string {
  if (!validRay(ray)) throw new CheckError(400, "invalid_ray");
  let parent: string, folder: string;
  try { parent = realpathSync(root); folder = realpathSync(path.join(root, ray)); }
  catch { throw new CheckError(404, "ray_not_found"); }
  if (!inside(parent, folder) || folder !== path.join(parent, ray) || !statSync(folder).isDirectory()) throw new CheckError(400, "ray_outside_root");
  return folder;
}
function boundedFile(folder: string, rel: string): string {
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || rel.split(/[\\/]/).includes(".."))
    throw Error("file path escapes ray");
  const full = path.resolve(folder, rel);
  if (!inside(folder, full)) throw Error("file path escapes ray");
  const real = realpathSync(full);
  if (!inside(folder, real)) throw Error("file path escapes ray");
  return real;
}
export class CheckError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message); this.status = status; this.retryAfterMs = retryAfterMs;
  }
}
function record(status: "pass" | "fail", source: CheckRecord["source"], output: string,
  started: number, extra: Partial<CheckRecord> = {}): CheckRecord {
  const clipped = tail(output);
  return { at: new Date().toISOString(), status, source,
    output: clipped, lastLine: lastLine(clipped), durationMs: Math.max(0, Date.now() - started), ...extra };
}

async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // The shell is never used for command invocation or for termination.
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch { try { child.kill("SIGKILL"); } catch {} }
  }
  try { child.kill("SIGKILL"); } catch {}
}

/** Spawn argv directly, always with ray cwd and a tree-wide deadline. */
export async function executeCheck(spec: CheckSpec, folder: string, now = Date.now()): Promise<CheckRecord> {
  const started = Date.now();
  if (spec.kind === "manual") throw new CheckError(409, "manual_check");
  if (spec.kind === "file") {
    try {
      const st = statSync(boundedFile(realpathSync(folder), spec.file));
      const age = now - st.mtimeMs;
      // NTFS mtimes can land a few ms after Date.now(): allow 2 s of clock skew.
      const ok = st.isFile() && age >= -2000 && age < spec.maxAgeMs;
      return record(ok ? "pass" : "fail", "file",
        `${spec.file}: ${ok ? "fresh" : "too old"} (${Math.round(age / 1000)}s; max ${Math.round(spec.maxAgeMs / 1000)}s)`, started);
    } catch (e) { return record("fail", "file", `file check failed: ${String(e)}`, started); }
  }
  if (spec.kind === "http") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), spec.timeoutMs);
    let bytes = Buffer.alloc(0);
    try {
      const response = await fetch(spec.url, { method: "GET", signal: controller.signal,
        redirect: "manual", cache: "no-store" });
      const reader = response.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            bytes = Buffer.concat([bytes, Buffer.from(result.value)]).subarray(-OUTPUT_BYTES);
          }
        } finally { reader.releaseLock(); }
      }
      const ok = response.status === spec.expectedStatus;
      return record(ok ? "pass" : "fail", "http",
        `HTTP ${response.status} (expected ${spec.expectedStatus})${bytes.length ? "\n" + bytes.toString("utf8") : ""}`, started);
    } catch (e) {
      const timedOut = controller.signal.aborted;
      return record("fail", "http", timedOut ? `timeout after ${spec.timeoutMs}ms` : `HTTP error: ${String(e)}`,
        started, { timedOut });
    } finally { clearTimeout(timer); }
  }
  let bytes = Buffer.alloc(0), timedOut = false, spawnError: string | null = null;
  const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
    cwd: folder, shell: false, windowsHide: true, detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer | string) => {
    bytes = Buffer.concat([bytes, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]).subarray(-OUTPUT_BYTES);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const done = new Promise<number | null>((resolve) => {
    child.once("error", (e) => { spawnError = String(e); });
    child.once("close", (code) => resolve(code));
  });
  const timer = setTimeout(() => { timedOut = true; void killTree(child); }, spec.timeoutMs);
  try {
    const exitCode = await done;
    const prefix = timedOut ? `timeout after ${spec.timeoutMs}ms` :
      spawnError ? `spawn failed: ${spawnError}` : `exit ${exitCode ?? "signal"}`;
    const output = `${prefix}${bytes.length ? "\n" + bytes.toString("utf8") : ""}`;
    return record(!timedOut && !spawnError && exitCode === 0 ? "pass" : "fail", "run", output, started,
      { exitCode, timedOut });
  } finally { clearTimeout(timer); }
}

/** Synchronous atomic read/modify/write, serialized with the CLI and other board processes. */
export class CheckService {
  private active = 0;
  private waiters: (() => void)[] = [];
  private pending = new Map<string, Promise<CheckRecord>>();
  private historyPath: string;
  private demo: boolean;
  readonly raysRoot: string;
  readonly dataDir: string;
  private clock: () => number;
  constructor(raysRoot: string, dataDir: string, clock: () => number = Date.now, demo = false) {
    this.raysRoot = raysRoot; this.dataDir = dataDir; this.clock = clock;
    this.historyPath = path.join(dataDir, "checks-history.json");
    this.demo = demo;
  }
  private read(): History {
    if (this.demo) {
      const h = emptyHistory();
      const seeded: [string, string, CheckRecord["status"], number, string][] = [
        ["atlas", "1", "pass", 1 * 60_000, "exit 0"],
        ["atlas", "2", "fail", 2 * 60_000, "exit 3"],
        ["beacon", "1", "pass", 26 * 3_600_000, "volunteer review completed"],
        ["copper", "2", "fail", 4 * 60_000, "poster not yet exported"],
        ["delta", "1", "pass", 4 * 60_000, "HTTP 200 (expected 200)"],
      ];
      for (const [ray, goal, status, ago, line] of seeded) {
        const key = keyFor(ray, goal);
        h.goals[key] = [{ at: new Date(this.clock() - ago).toISOString(),
          status, source: ray === "beacon" ? "report" : ray === "delta" ? "http" : ray === "copper" ? "file" : "run",
          output: line, lastLine: line, durationMs: 12 }];
        h.attempts[key] = this.clock() - ago;
      }
      return h;
    }
    if (!existsSync(this.historyPath)) return emptyHistory();
    const raw = JSON.parse(readFileSync(this.historyPath, "utf8"));
    if (raw?.version !== 1 || typeof raw.goals !== "object" || !raw.goals ||
      typeof raw.attempts !== "object" || !raw.attempts) throw Error("invalid checks-history.json");
    return raw as History;
  }
  private mutate(update: (h: History) => void) {
    if (this.demo) throw new CheckError(403, "demo_read_only");
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const lock = this.historyPath + ".lock";
    let handle: number | undefined;
    const begun = Date.now();
    while (handle === undefined) {
      try { handle = openSync(lock, "wx", 0o600); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try { if (Date.now() - statSync(lock).mtimeMs > 120_000) unlinkSync(lock); } catch {}
        if (Date.now() - begun > 5000) throw new CheckError(503, "history_locked");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
    }
    try {
      const h = this.read();
      update(h);
      const tmp = `${this.historyPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      try { writeFileSync(tmp, JSON.stringify(h, null, 2) + "\n", { mode: 0o600 }); renameSync(tmp, this.historyPath); }
      finally { rmSync(tmp, { force: true }); }
    } finally { closeSync(handle); rmSync(lock, { force: true }); }
  }
  history(ray: string, goal: string): CheckRecord[] {
    if (!validRay(ray) || !validGoal(goal)) return [];
    return this.read().goals[keyFor(ray, goal)] ?? [];
  }
  light(ray: string, goal: Goal): CheckResult {
    const spec = parseCheckDeclaration(goal.checkDeclarations?.join("\n") ?? "");
    const key = keyFor(ray, goal.id);
    const h = this.read();
    const latest = h.goals[key]?.at(-1);
    const state: CheckLight = !spec ? "never" : !latest ? spec.kind === "manual" ? "manual" : "never" :
      this.clock() - Date.parse(latest.at) >= STALE_AFTER_MS ? "stale" : latest.status;
    return {
      state, kind: spec?.kind ?? null, at: latest?.at ?? null, lastLine: latest?.lastLine ?? null,
      output: latest?.output ?? null, durationMs: latest?.durationMs ?? null,
      source: latest?.source ?? null, running: this.pending.has(key),
    };
  }
  decorate(goals: RayGoals): RayGoals {
    return { ...goals, goals: goals.goals.map((g) => {
      const checkResult = this.light(goals.ray, g);
      if (g.proofIssues?.length) {
        const proof = g.proofIssues.join("\n");
        return { ...g, checkState: "fail" as const, checkResult: { ...checkResult, state: "fail" as const,
          lastLine: g.proofIssues[0]!, output: [checkResult.output, proof].filter(Boolean).join("\n") } };
      }
      return { ...g, checkState: checkResult.state, checkResult };
    }) };
  }
  private goal(ray: string, id: string) {
    const folder = rayFolder(this.raysRoot, ray);
    if (!validGoal(id)) throw new CheckError(400, "invalid_goal");
    try {
      const goalsFile = realpathSync(path.join(folder, "GOALS.md"));
      if (!inside(folder, goalsFile) || !statSync(goalsFile).isFile())
        throw new CheckError(400, "goals_outside_ray");
    } catch (e) {
      if (e instanceof CheckError) throw e;
      throw new CheckError(404, "goals_not_found");
    }
    const goal = readRayGoals(this.raysRoot, ray).goals.find((g) => g.id === id);
    if (!goal) throw new CheckError(404, "goal_not_found");
    return goal;
  }
  report(ray: string, id: string, status: "pass" | "fail", note: string): CheckRecord {
    const goal = this.goal(ray, id);
    if (parseCheckDeclaration(goal.checkDeclarations?.join("\n") ?? "")?.kind !== "manual")
      throw new CheckError(409, "not_manual");
    if (!["pass", "fail"].includes(status) || typeof note !== "string" || !note.trim() || Buffer.byteLength(note) > OUTPUT_BYTES)
      throw new CheckError(400, "invalid_report");
    const result = record(status, "report", note, Date.now());
    this.mutate((h) => {
      const key = keyFor(ray, id);
      h.goals[key] = [...(h.goals[key] ?? []), result].slice(-HISTORY_LIMIT);
    });
    return result;
  }
  private async slot(): Promise<() => void> {
    if (this.active >= 2) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    // The released permit is transferred directly to a waiter; never exceed two.
    return () => {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    };
  }
  private async runTask(ray: string, id: string, spec: CheckSpec): Promise<CheckRecord> {
    const release = await this.slot();
    try {
      const key = keyFor(ray, id), now = this.clock();
      this.mutate((h) => {
        const prior = h.attempts[key] ?? 0;
        if (now - prior < CHECK_INTERVAL_MS)
          throw new CheckError(429, "check_cooldown", CHECK_INTERVAL_MS - (now - prior));
        h.attempts[key] = now;
      });
      const folder = rayFolder(this.raysRoot, ray);
      let result: CheckRecord;
      try { result = await executeCheck(spec, folder, now); }
      catch (e) { result = record("fail", spec.kind, `check error: ${String(e)}`, Date.now()); }
      this.mutate((h) => {
        h.goals[key] = [...(h.goals[key] ?? []), result].slice(-HISTORY_LIMIT);
      });
      return result;
    } finally { release(); }
  }
  run(ray: string, id: string): Promise<CheckRecord> {
    const goal = this.goal(ray, id);
    const spec = parseCheckDeclaration(goal.checkDeclarations?.join("\n") ?? "");
    if (!spec) throw new CheckError(404, "check_not_declared");
    if (spec.kind === "manual") throw new CheckError(409, "manual_check");
    if (this.demo) throw new CheckError(403, "demo_read_only");
    const key = keyFor(ray, id), inflight = this.pending.get(key);
    if (inflight) return inflight;
    const prior = this.read().attempts[key] ?? 0;
    if (this.clock() - prior < CHECK_INTERVAL_MS)
      throw new CheckError(429, "check_cooldown", CHECK_INTERVAL_MS - (this.clock() - prior));
    const task = this.runTask(ray, id, spec);
    this.pending.set(key, task);
    void task.finally(() => this.pending.delete(key)).catch(() => {});
    return task;
  }
  schedule(): void {
    if (this.demo) return;
    for (const ray of projectNames(this.raysRoot)) {
      let goals: Goal[];
      try { goals = readRayGoals(this.raysRoot, ray).goals; } catch { continue; }
      for (const goal of goals) {
        const spec = parseCheckDeclaration(goal.checkDeclarations?.join("\n") ?? "");
        if (!spec || spec.kind === "manual" || this.pending.has(keyFor(ray, goal.id))) continue;
        const attempted = this.read().attempts[keyFor(ray, goal.id)] ?? 0;
        if (this.clock() - attempted >= CHECK_INTERVAL_MS) {
          try { void this.run(ray, goal.id).catch(() => {}); } catch {}
        }
      }
    }
  }
}

export async function handleChecksApi(req: Request, url: URL, service: CheckService): Promise<Response | null> {
  if (url.pathname !== "/api/checks/run") return null;
  if (req.method !== "POST") return Response.json({ error: "POST_required" }, { status: 405, headers: { allow: "POST" } });
  // A malicious cross-site form must not trigger a local machine command.
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || (site && site !== "same-origin" && site !== "none"))
    return Response.json({ error: "cross_origin" }, { status: 403 });
  const ray = url.searchParams.get("ray") ?? "";
  const goal = url.searchParams.get("goal") ?? "";
  if (!validRay(ray) || !validGoal(goal)) return Response.json({ error: "invalid_ray_or_goal" }, { status: 400 });
  try {
    const result = await service.run(ray, goal);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof CheckError ? e.status : 500;
    const headers = { "cache-control": "no-store", ...(e instanceof CheckError && e.retryAfterMs ?
      { "retry-after": String(Math.ceil(e.retryAfterMs / 1000)) } : {}) };
    return Response.json({ error: e instanceof CheckError ? e.message : "check_failed" }, { status, headers });
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [action, ray, goal, status, ...note] = process.argv.slice(2);
  if (action !== "report" || !ray || !goal || !["pass", "fail"].includes(status ?? "") || !note.length) {
    process.stderr.write('Usage: bun src/checks.ts report <ray> <goal> pass|fail "note"\n');
    process.exitCode = 2;
  } else {
    try {
      const config = loadConfig();
      const saved = new CheckService(config.raysRoot, config.dataDir,
        Date.now, process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true")
        .report(ray, goal, status as "pass" | "fail", note.join(" "));
      process.stdout.write(`${saved.status.toUpperCase()} ${ray}/${goal} ${saved.at}: ${saved.lastLine}\n`);
    } catch (e) {
      process.stderr.write(`report failed: ${String(e)}\n`);
      process.exitCode = 1;
    }
  }
}
