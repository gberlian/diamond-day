// Collects one cell per ray: its Next list and open tracker lines, its handoff queue, what its live Claude
// session is doing, and how much of the 5h limit that session used since the owner's last message.
// Everything is read from files (ray folders, keeper queues, Claude transcripts) and the proxy's database,
// read-only. Row ages live in memory; tracker reorders require user action.
import { parseTracker, rowAges } from "./tracker.ts";
import { keeperHealth, type KeeperHealth } from "./keeper-health.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadConfig, type BoardConfig } from "./config.ts";
import { rayNames } from "./domain/fsreader.ts";
import { transcriptSource, transcriptFile } from "./sources/transcripts.ts";
import { handoffSource } from "./sources/handoffs.ts";
import { proxySource, readBoardUsage } from "./sources/usage-proxy.ts";
import { diskSource } from "./sources/disk-status.ts";
import { restarterSource } from "./sources/restarter.ts";
import { codexSource } from "./sources/codex-gate.ts";
import type { CodexUsage } from "./domain/codex-usage.ts";
import type { BudgetSnapshot } from "./domain/codex-gate.ts";
import type { Job, Ray, Session } from "./domain/model.ts";
import { handoffResults, type HandoffResult } from "./handoff-results.ts";
import { readDiskStatus } from "./disk-status.ts";
import { makeRayCard, type CardSnapshot } from "./ray-goals-api.ts";
import { readLedger } from "./ledger-reader.ts";
import { readShelf, type ShelfSnapshot } from "./shelf-reader.ts";
import { demoRoot } from "./config.ts";
import { stoppedRays, type RayGoals } from "./goals.ts";
import type { DiskStatus } from "./disk-status.ts";
import type { CheckService } from "./checks.ts";

export const RAYS_DIR = loadConfig().raysRoot;
export const raysRoot = () => loadConfig().raysRoot;
const BUSY_MS = 30_000;

export type Cell = {
  ray: string;
  next: string[];
  /** First Now bullet of the latest resume, for a visible, independently checkable card claim. */
  now: string | null;
  session: "running" | "idle" | "stopped";
  tracker: { id: string; text: string; full?: string; latest?: string; next?: string; status: string; ageMs?: number }[];
  handoffs: { running: string[]; queued: string[]; done: string[]; low: boolean; results: HandoffResult[] };
  activity: Pick<Session, "busy" | "line" | "ago">;
  usage: Pick<Session, "since" | "ctx" | "fivePct">;
  /** Minutes the session's prompt cache stays warm (1 h TTL after its last API call); 0 = cold, null = no call seen. */
  cacheLeftMin: number | null;
  restart: { at: number; ok: boolean; reason: string } | null;
};

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const clean = (s: string) => s.replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

export function rays(): string[] {
  return rayNames(raysRoot());
}

/** Items of the "## Next" section of a resume note (numbered or bulleted lines, continuation lines joined). */
export function nextItems(markdown: string, max = 6): string[] {
  const m = markdown.match(/^##\s+Next\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return [];
  const items: string[] = [];
  for (const line of m[1]!.split(/\r?\n/)) {
    if (/^\s*(\d+\.|[-*])\s+/.test(line) && !/^\s{2,}/.test(line)) items.push(line.replace(/^\s*(\d+\.|[-*])\s+/, ""));
    else if (line.trim() && items.length && /^\s+/.test(line)) items[items.length - 1] += " " + line.trim();
  }
  return items.map((s) => short(clean(s), 160)).filter(Boolean).slice(0, max);
}

export function newestResume(ray: string, root = raysRoot()): string | null {
  const dir = path.join(root, ray, "plans");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-resume\.md$/.test(f)).sort();
  return files.length ? path.join(dir, files.at(-1)!) : null;
}

/** Open tracker rows for a ray: | # | Date | Owner sent | Ray | Status | Latest | Next | */
export function trackerRows(markdown: string, ray: string, max = 12): Cell["tracker"] {
  const out: Cell["tracker"] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length < 5 || !/^\d+$/.test(c[0]!)) continue;
    // Only the first ray named owns the line; later mentions ("webstack (+ solana for diadem)") are context.
    const owner = c[3]!.toLowerCase().match(/[a-z][\w-]*/)?.[0] ?? "";
    const status = c[4]!.toLowerCase().replace(/\*/g, "");
    if (owner !== ray.toLowerCase() || /^(done|dropped)/.test(status)) continue;
    // full/latest/next feed the hover popover: the line itself is cut to fit the cell.
    out.push({ id: c[0]!, text: short(clean(c[2]!), 110), full: clean(c[2]!), latest: clean(c[5] ?? ""), next: clean(c[6] ?? ""), status });
  }
  // Table order is the owner's priority (dragged on /board): the top row is done first.
  return out.slice(0, max);
}

export function handoffs(ray: string, now = Date.now(), config: BoardConfig = loadConfig()): Cell["handoffs"] {
  return handoffSource.read(config, ray, now) ?? { running: [], queued: [], done: [], low: false, results: [] };
}

/** The active session transcript is looked up under the configured Claude directory. */
export function liveTranscript(ray: string) { return transcriptFile(loadConfig(), ray); }

/** Last tool call (name and its description/command/path) or last assistant text in a transcript tail. */
export function lastActivity(jsonl: string): string {
  const lines = jsonl.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!l.includes('"type":"assistant"')) continue;
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    const parts = Array.isArray(e?.message?.content) ? e.message.content : [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j];
      if (p?.type === "tool_use") {
        const inp = p.input ?? {};
        const what = inp.description ?? inp.prompt ?? inp.command ?? inp.file_path ?? inp.pattern ?? inp.url ?? "";
        return clean(`${p.name}${what ? ": " + String(what) : ""}`).slice(0, 2048);
      }
      if (p?.type === "text" && String(p.text ?? "").trim()) return clean(String(p.text)).slice(0, 2048);
    }
  }
  return "";
}

export async function cell(ray: string, now = Date.now(), config: BoardConfig = loadConfig()): Promise<Cell> {
  const resume = newestResume(ray, config.raysRoot);
  const next = resume ? nextItems(readFileSync(resume, "utf8")) : [];
  const trackerFile = path.join(config.raysRoot, "TRACKER.md");
  const trackerMd = existsSync(trackerFile) ? readFileSync(trackerFile, "utf8") : "";
  const ages = trackerMd ? rowAges(config.raysRoot, parseTracker(trackerMd), now) : new Map<string, number>();
  const tracker = trackerRows(trackerMd, ray).map((t) => ({ ...t, ageMs: ages.get(t.id) }));
  const transcript = await transcriptSource.read(config, ray, now);
  const note = resume ? readFileSync(resume, "utf8") : "";
  const nowLine = /^##\s+Now\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(note)?.[1]?.split(/\r?\n/).find(l => /^\s*[-*+]\s+\S/.test(l));
  const firstNow = nowLine ? clean(nowLine.replace(/^\s*[-*+]\s+/, "")).slice(0, 80) : null;
  const session = transcript?.activity.busy ? "running" : transcript?.activity.ago != null ? "idle" : "stopped";
  return { ray, next, now: firstNow, session, tracker, handoffs: handoffs(ray, now, config),
    activity: transcript?.activity ?? { busy: false, line: "", ago: null },
    usage: transcript?.usage ?? { since: "", ctx: null, fivePct: null },
    cacheLeftMin: null, restart: await restarterSource.read(config, ray) };
}

export type Overview = {
  fivePct: number | null; fiveReset: number | null; sevenPct: number | null; sevenReset: number | null;
  todayUsd: number; calls: number; errorsHour: number; live: number; perRayUsd: Record<string, number>;
  perRayUsage?: Record<string, { since?: string; ctx?: number | null; cacheLeftMin?: number | null }>;
};

/** Usage summaries are opt-in; missing integrations return null without network calls. */
export async function overview(dbPath?: string): Promise<Overview | null> {
  const config = loadConfig();
  if (dbPath) config.integrations.usageProxy = { enabled: true, path: dbPath };
  return proxySource.read(config);
}

export async function board(config: BoardConfig = loadConfig(), checks?: CheckService): Promise<{
  at: number; cells: (Cell & CardSnapshot)[]; stopped: RayGoals[];
  overview: Overview | null; codex: CodexUsage | null; gate: BudgetSnapshot | null;
  disk: DiskStatus | null; keepers: KeeperHealth[]; openEnabled: boolean;
  shelf: ShelfSnapshot; actionsEnabled: boolean; editEnabled: boolean;
}> {
  const now = Date.now();
  const running = rayNames(config.raysRoot);
  const demo = process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true";
  const [liveCells, led, ov, codexData, disk, shelf] = await Promise.all([
    Promise.all(running.map((r) => cell(r, now, config))),
    config.integrations.ledger.enabled || process.env.RAY_BOARD_LEDGER_FIXTURE
      ? readLedger(config.raysRoot, now, config.integrations.ledger.path) : Promise.resolve({ jobs: [], error: null }),
    readBoardUsage(config), codexSource.read(config), diskSource.read(config),
    demo ? readShelf(config.raysRoot, now, undefined, path.join(demoRoot, "shelf.txt")) :
      (config.integrations.ledger.enabled ? readShelf(config.raysRoot, now, config.integrations.ledger.path) :
        Promise.resolve({ rays: {}, live: 0, target: 15 as const, ready: false, error: "shelf disabled" })),
  ]);
  if (ov?.perRayUsage) for (const card of liveCells) {
    const info = ov.perRayUsage[card.ray];
    if (!info) continue;
    if (typeof info.since === "string") card.usage.since = info.since;
    if (typeof info.ctx === "number" && Number.isFinite(info.ctx)) card.usage.ctx = info.ctx;
    if (typeof info.cacheLeftMin === "number" && Number.isFinite(info.cacheLeftMin)) card.cacheLeftMin = info.cacheLeftMin;
  }
  const cells = liveCells.map((c) => {
    const card = makeRayCard(config.raysRoot, c.ray, led.jobs, led.error);
    return { ...c, ...card, shelf: shelf.rays[c.ray] ?? Object.values(shelf.rays).find(s => s.ray.toLowerCase() === c.ray.toLowerCase()) ?? null,
      ...(checks ? { goals: checks.decorate(card).goals } : {}) };
  });
  let keepers: KeeperHealth[] = [];
  if (config.integrations.handoffQueues.enabled) {
    try { keepers = keeperHealth(config.raysRoot, running, now); } catch {}
  }
  return { at: now, cells, stopped: stoppedRays(config.raysRoot, running).map((r) => checks ? checks.decorate(r) : r),
    overview: ov, codex: codexData?.codex ?? null, gate: codexData?.gate ?? null,
    disk, keepers, shelf, editEnabled: config.actions && !demo || Boolean(demo && process.env.RAY_BOARD_CLICK_FIXTURE_ROOT),
    actionsEnabled: config.actions && !demo, openEnabled: config.integrations.openWith !== "off" };
}
