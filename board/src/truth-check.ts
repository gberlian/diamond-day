#!/usr/bin/env bun
/** Independently corroborate board claims with the ray filesystem, keeper, and OS processes.
 * No imports are executed on CLI import; fixtures can exercise the exact comparison code.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadConfig, demoRoot, type BoardConfig } from "./config.ts";
import { parseCheckDeclaration } from "./checks.ts";
import { parseGoals } from "./goals.ts";
import { parseShelf, type ShelfSnapshot } from "./shelf-reader.ts";
import type { Overview } from "./board.ts";

const exec = promisify(execFile);
const VALID_RAY = /^[a-zA-Z0-9][\w.-]*$/;
const AUTOMATIC_AGE = 30 * 60_000;
const MANUAL_AGE = 24 * 60 * 60_000;
export type ProcessRow = { ProcessId?: number; Name?: string; CommandLine?: string; cmd?: string;
  cwd?: string; Cwd?: string; title?: string; Title?: string; MainWindowTitle?: string };
export type ProcessInventory = { rows: ProcessRow[]; error: string | null };
export type BoardCell = { ray: string; name?: string; goals?: Array<{ id: string; title: string;
  checkResult?: { kind?: string | null; at?: string | null } }>;
  activity?: { busy?: boolean; ago?: number | null }; session?: string;
  now?: string; shelf?: { running: number; queued: number; shelf: number } | null };
export type BoardSnapshot = { at?: number; cells: BoardCell[]; stopped?: Array<{ ray: string; goals?: BoardCell["goals"] }>;
  overview?: Pick<Overview, "todayUsd" | "calls" | "perRayUsd"> | null;
  shelf?: ShelfSnapshot | null };
export type Mismatch = { ray: string; field: string; board: string; truth: string; line: string };
export type TruthReport = { at: number; ok: boolean; source: "api" | "local" | "snapshot";
  mismatches: Mismatch[] };
export type TruthInputs = { raysRoot: string; now?: number; processes: ProcessInventory;
  /** Rays with a live interactive Claude session from Claude's own session files (preferred over the process list). */
  liveRays?: Set<string>;
  shelf: ShelfSnapshot; demo?: boolean; source?: TruthReport["source"];
  expectedRays?: string[]; serverError?: string | null };
const stringify = (v: unknown): string => v === undefined || v === null ? "missing" :
  typeof v === "string" ? v : JSON.stringify(v);
function mismatch(rows: Mismatch[], ray: string, field: string, board: unknown, truth: unknown) {
  const b = stringify(board), t = stringify(truth);
  rows.push({ ray, field, board: b, truth: t,
    line: `${ray}: ${field}: board says ${b}, truth is ${t}` });
}
/** Normalise presentation markup without losing the first 80 characters of actual content. */
export function normaliseNow(s: string): string {
  return s.replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ").trim();
}
export function firstResumeNow(markdown: string): string | null {
  const section = /^##\s+Now\b[^\n]*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(markdown)?.[1];
  const first = section?.split(/\r?\n/).find((l) => /^\s*[-*+]\s+\S/.test(l));
  return first ? normaliseNow(first.replace(/^\s*[-*+]\s+/, "")) : null;
}
function latestResume(root: string, ray: string): string | null {
  const plans = path.join(root, ray, "plans");
  try {
    const files = readdirSync(plans).filter(f => /^\d{4}-\d\d-\d\d-resume\.md$/.test(f)).sort();
    if (files.length) return readFileSync(path.join(plans, files.at(-1)!), "utf8");
  } catch {}
  // The fixture corpus contains only the newest resume head, not the full plans tree.
  try { return readFileSync(path.join(root, ray, "resume-head.md"), "utf8"); } catch { return null; }
}
/** Directory validation, never string splitting: a Windows volume prefix is not a ray. */
export function realRays(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(e => (e.isDirectory() || e.isSymbolicLink()) && VALID_RAY.test(e.name))
      .map(e => e.name)
      .filter(name => existsSync(path.join(root, name, "GOALS.md")))
      .sort();
  } catch { return []; }
}
export function listedRays(root: string): string[] {
  try { return [...new Set(readFileSync(path.join(root, "rays.txt"), "utf8")
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#") && VALID_RAY.test(s)))]; }
  catch { return []; }
}
function rayFromLocation(value: string, root: string): string | null {
  const normal = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const v = normal(value), base = normal(root);
  if (!v || !base || !(v === base || v.startsWith(base + "/"))) return null;
  const part = v.slice(base.length).replace(/^\//, "").split("/")[0];
  return part && VALID_RAY.test(part) ? part : null;
}
/** Bare root-folder references, and non-Claude services, are not session evidence. */
export function sessionRays(rows: ProcessRow[], root: string): { rays: Set<string>; unattributed: number } {
  const rays = new Set<string>();
  let unattributed = 0;
  for (const row of rows) {
    const cmd = String(row.CommandLine ?? row.cmd ?? "");
    if (!/\bclaude(?:\.exe)?\b/i.test(String(row.Name ?? "") + " " + cmd) ||
      !/(?:^|[\\/\s"'])claude(?:\.exe)?(?:[\s"']|$)/i.test(String(row.Name ?? "") + " " + cmd)) continue;
    const explicit = [row.cwd, row.Cwd, row.title, row.Title, row.MainWindowTitle].filter((x): x is string => typeof x === "string");
    // Only an explicitly named cwd/title or a --cwd/--working-directory argument proves ownership.
    const flag = /--(?:cwd|working-directory)(?:=|\s+)["']?([^\s"']+)/i.exec(cmd)?.[1];
    if (flag) explicit.push(flag);
    const directTitle = [row.title, row.Title, row.MainWindowTitle]
      .filter((v): v is string => typeof v === "string")
      .map(v => /^(?:claude\s*[-:|]\s*)?([a-zA-Z0-9][\w.-]*)$/i.exec(v.trim())?.[1]?.toLowerCase())
      .find(v => v && realRays(root).some(r => r.toLowerCase() === v));
    const found = explicit.map(v => rayFromLocation(v, root)).find(Boolean) ?? directTitle;
    if (found) rays.add(found);
    else unattributed++;
  }
  return { rays, unattributed };
}
function boardSession(c: BoardCell): string {
  return c.session ?? (c.activity?.busy ? "running" : c.activity?.ago == null ? "stopped" : "idle");
}
/** The board's snapshot and the fresh read are taken moments apart while jobs move between
 *  running, queued and shelved: a difference of one per count is motion, not a lie. */
function shelfDiffers(a: { running: number; queued: number; shelf: number } | null | undefined,
  b: { running: number; queued: number; shelf: number } | null | undefined): boolean {
  if (!a || !b) return Boolean(a) !== Boolean(b);
  return Math.abs(a.running - b.running) > 1 || Math.abs(a.queued - b.queued) > 1 || Math.abs(a.shelf - b.shelf) > 1;
}
function shelfCounts(row: { running: number; queued: number; shelf: number } | null | undefined): string {
  return row ? `${row.running}/${row.queued}/${row.shelf}` : "missing";
}
export function compareBoardSnapshot(snapshot: BoardSnapshot, input: TruthInputs): TruthReport {
  const now = input.now ?? Date.now(), out: Mismatch[] = [];
  const rayNames = realRays(input.raysRoot), real = new Set(rayNames.map(r => r.toLowerCase()));
  const listed = input.expectedRays ?? listedRays(input.raysRoot);
  const claimed = new Map<string, BoardCell>();
  const stopped = new Map<string, BoardCell>();
  for (const c of snapshot.stopped ?? []) {
    // A stopped older project folder without GOALS.md is a true stopped card (28 Nov: 10 such false alarms).
    if (!real.has(String(c.ray).toLowerCase()) && !existsSync(path.join(input.raysRoot, String(c.ray))))
      mismatch(out, String(c.ray), "ray", "stopped card", "no ray directory");
    if (stopped.has(c.ray.toLowerCase())) mismatch(out, c.ray, "ray", "duplicate stopped card", "one card");
    stopped.set(c.ray.toLowerCase(), { ...c, session: "stopped" });
  }
  for (const c of snapshot.cells ?? []) {
    if (!real.has(String(c.ray).toLowerCase())) mismatch(out, String(c.ray), "ray", "present", "no GOALS.md ray directory");
    if (claimed.has(c.ray.toLowerCase())) mismatch(out, c.ray, "ray", "duplicate card", "one card");
    if (stopped.has(c.ray.toLowerCase())) mismatch(out, c.ray, "ray", "both live and stopped", "one state");
    claimed.set(c.ray.toLowerCase(), c);
  }
  if (!rayNames.length && !input.demo) mismatch(out, "board", "rays root", input.raysRoot, "no ray directories found");
  for (const ray of rayNames) {
    const liveCard = claimed.get(ray.toLowerCase());
    const card = liveCard ?? stopped.get(ray.toLowerCase());
    if (!card) { mismatch(out, ray, "card", "missing", "ray folder exists"); continue; }
    const md = readFileSync(path.join(input.raysRoot, ray, "GOALS.md"), "utf8");
    const goals = parseGoals(md, ray).goals, got = card.goals ?? [];
    if (got.length !== goals.length) mismatch(out, ray, "goals.count", got.length, goals.length);
    for (const goal of goals) {
      const cg = got.find(g => g.id === goal.id);
      if (!cg) { mismatch(out, ray, `goals.${goal.id}`, "missing", goal.title); continue; }
      if (cg.title !== goal.title) mismatch(out, ray, `goals.${goal.id}.title`, cg.title, goal.title);
      if (input.demo) continue; // Deliberately seeded historical demo checks, not a live SLA.
      const spec = parseCheckDeclaration(goal.checkDeclarations?.join("\n") ?? "");
      if (!spec) continue;
      // The board runs automatic checks only for projects listed in rays.txt; a stopped project's last result stays as it was.
      if (!liveCard && !listed.some(r => r.toLowerCase() === ray.toLowerCase())) continue;
      if (cg.checkResult?.kind !== spec.kind)
        mismatch(out, ray, `goals.${goal.id}.check.kind`, cg.checkResult?.kind, spec.kind);
      const maxAge = spec.kind === "manual" ? MANUAL_AGE : AUTOMATIC_AGE;
      const when = cg.checkResult?.at ? Date.parse(cg.checkResult.at) : NaN;
      const age = now - when;
      if (!Number.isFinite(when) || age < -120_000 || age >= maxAge)
        mismatch(out, ray, `goals.${goal.id}.check.age`, cg.checkResult?.at ?? "never", `< ${Math.round(maxAge / 60_000)} min`);
    }
    const resume = latestResume(input.raysRoot, ray);
    const expected = resume ? firstResumeNow(resume) : null;
    if (card.now !== undefined && !expected && !input.demo && liveCard) mismatch(out, ray, "now", card.now, "first Now bullet unavailable");
    // A card may cut the Now line (and the cut may end on a space): compare the shared 80-char prefix, trimmed.
    if (card.now !== undefined && expected && liveCard && (!card.now || !expected.slice(0, 80).trim().startsWith(normaliseNow(card.now).slice(0, 80).trim()) ||
      normaliseNow(card.now).length < Math.min(expected.length, 80) - 2))
      mismatch(out, ray, "now", card.now, expected.slice(0, 80));
  }
  if (!input.demo) {
    if (input.processes.error) mismatch(out, "board", "processes", "unverified", input.processes.error);
    else {
      const sessions = input.liveRays ? { rays: input.liveRays, unattributed: 0 } : sessionRays(input.processes.rows, input.raysRoot);
      for (const ray of new Set([...rayNames, ...listed])) {
        const c = claimed.get(ray.toLowerCase()) ?? stopped.get(ray.toLowerCase());
        const live = sessions.rays.has(ray.toLowerCase());
        const state = c ? boardSession(c) : "missing";
        if (live && state === "stopped") mismatch(out, ray, "session", state, "claude process running");
        if (!live && sessions.unattributed) continue; // Windows hides other processes' cwd: unknown, not a mismatch.
        if (!live && state !== "stopped") mismatch(out, ray, "session", state,
          sessions.unattributed ? `no attributable claude process (${sessions.unattributed} unidentified)` : "stopped");
        if (listed.includes(ray) && !live) mismatch(out, ray, "rays.txt", "listed as running",
          sessions.unattributed ? "session not identifiable" : "no claude process");
      }
    }
  }
  if (!input.demo) {
    if (!input.shelf.ready || input.shelf.error) mismatch(out, "board", "keeper shelf",
      snapshot.shelf?.ready ? `ready (${snapshot.shelf.live} live)` : snapshot.shelf?.error ?? "unavailable",
      input.shelf.error || "fresh shelf unavailable");
    else {
      for (const ray of rayNames) {
        const c = claimed.get(ray.toLowerCase());
        if (!c) continue;
        const actual = input.shelf.rays[ray] ?? Object.values(input.shelf.rays).find(r => r.ray.toLowerCase() === ray.toLowerCase());
        if (shelfDiffers(c.shelf, actual))
          mismatch(out, ray, "shelf.running/queued/shelf", shelfCounts(c.shelf), shelfCounts(actual));
      }
      const derived = Object.values(input.shelf.rays).reduce((sum, s) => sum + s.running + s.queued, 0);
      if (Math.abs((snapshot.shelf?.live ?? -99) - derived) > 2) mismatch(out, "board", "shelf.live", snapshot.shelf?.live, derived);
      if (Math.abs(input.shelf.live - derived) > 2) mismatch(out, "keeper", "shelf.live", input.shelf.live, derived);
    }
  }
  if (!input.demo) {
    const ov = snapshot.overview;
    if (!ov) mismatch(out, "board", "cost", "unavailable", "usage overview required");
    else {
      if (ov.calls > 0 && !(ov.todayUsd > 0)) mismatch(out, "board", "cost.todayUsd", ov.todayUsd, "prices missing (calls > 0)");
      for (const key of Object.keys(ov.perRayUsd ?? {}))
        if (!real.has(key.toLowerCase()) && !existsSync(path.join(input.raysRoot, key))) mismatch(out, key, "cost.perRayUsd", "present", "no real ray folder");
    }
  }
  if (input.serverError) mismatch(out, "board", "api", "unavailable", `server down (${input.serverError}); used in-process cells`);
  return { at: now, ok: !out.length, source: input.source ?? "api", mismatches: out };
}
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
export async function listProcesses(): Promise<ProcessInventory> {
  try {
    if (process.platform === "win32") {
      // A failed CIM query is not permission to report that every ray stopped.
      const ps = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^claude(\\.exe)?$'} | ForEach-Object { $p=$_; $title=''; try {$title=(Get-Process -Id $p.ProcessId -ErrorAction Stop).MainWindowTitle} catch {}; [pscustomobject]@{ProcessId=$p.ProcessId;Name=$p.Name;CommandLine=$p.CommandLine;MainWindowTitle=$title} } | ConvertTo-Json -Compress";
      const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps],
        { timeout: 12_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      const data: unknown = stdout.trim() ? JSON.parse(stdout) : [];
      return { rows: (Array.isArray(data) ? data : [data]) as ProcessRow[], error: null };
    }
    const { stdout } = await exec("ps", ["-eo", "pid=,comm=,args="], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    const rows: ProcessRow[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!match || !/(^|\/)claude(?:\.exe)?$/i.test(match[2]!)) continue;
      let cwd: string | undefined;
      try { cwd = readlinkSync(`/proc/${match[1]}/cwd`); } catch {}
      rows.push({ ProcessId: Number(match[1]), Name: match[2], cmd: match[3], cwd });
    }
    return { rows, error: null };
  } catch (e) { return { rows: [], error: `process list unavailable: ${errText(e)}` }; }
}
export async function freshShelf(root: string, config: BoardConfig, fixture?: string): Promise<ShelfSnapshot> {
  try {
    if (fixture) return parseShelf(readFileSync(fixture, "utf8"));
    if (process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true")
      return parseShelf(readFileSync(path.join(demoRoot, "shelf.txt"), "utf8"));
    const keeper = process.env.RAY_BOARD_KEEPER ?? config.integrations.ledger.path;
    if (!keeper || !/\.tsx?$/.test(keeper)) throw new Error("keeper.ts path not configured");
    const { stdout } = await exec(process.env.BUN_BIN || "bun", [keeper, "shelf", "--all-queues", root],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return parseShelf(stdout);
  } catch (e) { return { rays: {}, live: 0, target: 15, ready: false, error: `shelf unavailable: ${errText(e)}` }; }
}
export async function inspectTruth(snapshot: BoardSnapshot, config: BoardConfig,
  extras: { processes?: ProcessInventory; shelf?: ShelfSnapshot; now?: number; demo?: boolean;
    source?: TruthReport["source"]; serverError?: string | null } = {}): Promise<TruthReport> {
  const demo = extras.demo ?? (process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true");
  const [processes, shelf] = await Promise.all([
    extras.processes ? Promise.resolve(extras.processes) : demo ? Promise.resolve({ rows: [], error: null }) : listProcesses(),
    extras.shelf ? Promise.resolve(extras.shelf) : freshShelf(config.raysRoot, config),
  ]);
  let liveRays: Set<string> | undefined;
  if (!demo && !extras.processes) {
    // Claude writes one session file per live session with its folder; the process list hides folders on Windows.
    const { liveSession } = await import("./restarter.ts");
    const names = existsSync(config.raysRoot) ? readdirSync(config.raysRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    const prev = process.env.RAYS_ROOT; process.env.RAYS_ROOT = config.raysRoot;
    try { liveRays = new Set(names.filter((n) => liveSession(n)).map((n) => n.toLowerCase())); }
    finally { if (prev === undefined) delete process.env.RAYS_ROOT; else process.env.RAYS_ROOT = prev; }
  }
  return compareBoardSnapshot(snapshot, { raysRoot: config.raysRoot, now: extras.now, processes, shelf,
    demo, source: extras.source, serverError: extras.serverError, liveRays });
}
export type CliOptions = { board?: string; raysRoot?: string; json?: boolean; snapshot?: string;
  processes?: string; shelfFile?: string; now?: number; demo?: boolean };
export function parseArgs(args: string[]): CliOptions {
  const out: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json" || arg === "--demo") { (out as any)[arg.slice(2)] = true; continue; }
    if (!["--board", "--rays-root", "--snapshot", "--processes", "--shelf-file", "--now"].includes(arg) || !args[i + 1])
      throw new Error(`unknown or missing argument: ${arg}`);
    const aliases: Record<string, string> = { "--rays-root": "raysRoot", "--shelf-file": "shelfFile" };
    (out as Record<string, unknown>)[aliases[arg] ?? arg.slice(2)] = args[++i];
  }
  if (out.now !== undefined) { out.now = Number(out.now); if (!Number.isFinite(out.now)) throw new Error("invalid --now"); }
  return out;
}
export async function runTruthCli(options: CliOptions): Promise<TruthReport> {
  const previous = process.env.RAY_BOARD_DEMO;
  if (options.demo) process.env.RAY_BOARD_DEMO = "1";
  try {
    const config = loadConfig();
    if (options.raysRoot) config.raysRoot = path.resolve(options.raysRoot);
    const processes = options.processes ?
      { rows: JSON.parse(readFileSync(options.processes, "utf8")) as ProcessRow[], error: null } : undefined;
    const shelf = options.shelfFile ? await freshShelf(config.raysRoot, config, options.shelfFile) : undefined;
    let snapshot: BoardSnapshot, source: TruthReport["source"] = "api";
    let serverError: string | null = null;
    if (options.snapshot) { snapshot = JSON.parse(readFileSync(options.snapshot, "utf8")); source = "snapshot"; }
    else {
      try {
        const url = new URL(options.board ?? `http://${config.host}:${config.port}/api/board`);
        if (url.pathname === "/board") url.pathname = "/api/board";
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        snapshot = await response.json() as BoardSnapshot;
        if (!Array.isArray(snapshot.cells)) throw new Error("invalid API cells");
      } catch (e) {
        serverError = errText(e); source = "local";
        const { board } = await import("./board.ts");
        const { CheckService } = await import("./checks.ts");
        snapshot = await board(config, new CheckService(config.raysRoot, config.dataDir, Date.now, !!options.demo));
      }
    }
    return await inspectTruth(snapshot!, config, { processes, shelf, now: options.now, source,
      demo: options.demo, serverError });
  } finally { if (options.demo) {
    if (previous === undefined) delete process.env.RAY_BOARD_DEMO;
    else process.env.RAY_BOARD_DEMO = previous;
  } }
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const opts = parseArgs(args), report = await runTruthCli(opts);
    if (opts.json) process.stdout.write(JSON.stringify(report) + "\n");
    else if (report.mismatches.length) process.stdout.write(report.mismatches.map(m => m.line).join("\n") + "\n");
    return report.ok ? 0 : 1;
  } catch (e) {
    const msg = `board: error: board says available, truth is ${errText(e)}`;
    if (args.includes("--json")) process.stdout.write(JSON.stringify({ at: Date.now(), ok: false, source: "local",
      mismatches: [{ ray: "board", field: "error", board: "available", truth: errText(e), line: msg }] }) + "\n");
    else process.stderr.write(msg + "\n");
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main();
