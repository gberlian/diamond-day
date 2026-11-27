/** Local ARPE job operations and read-only artifact discovery. */
import path from "node:path";
import { closeSync, openSync, readSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { BoardConfig } from "./config.ts";
import type { LedgerJob } from "./goals.ts";
import { writeGuard, editingEnabled } from "./goal-write.ts";
import { verifiedQueue, clearHandoffDetailCache } from "./handoff-detail.ts";
import { invalidateLedgerCache } from "./ledger-reader.ts";
const execute = promisify(execFile);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const safeName = (s: string) => /^[a-zA-Z0-9][\w.-]{0,127}$/.test(s);
const within = (a: string, b: string) => {
  const r = path.relative(a, b);
  return !!r && r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r);
};
export function safeArtifact(root: string, ray: string, relative: string): string | null {
  if (!safeName(ray) || !relative || relative.includes("\\") || relative.includes("\0") ||
      relative.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git" || p.includes(":"))) return null;
  try {
    const base = realpathSync(path.join(root, ray));
    const target = realpathSync(path.join(base, relative));
    if (!within(realpathSync(root), base) || !within(base, target) || path.relative(base, target).split(path.sep).some(p => p.toLowerCase() === ".git") || !statSync(target).isFile()) return null;
    return target;
  } catch { return null; }
}
export const artifactHref = (ray: string, relative: string) =>
  /\.(png|jpe?g|gif|webp|svg)$/i.test(relative) ? `/board/doc-asset?path=${encodeURIComponent(ray + "/" + relative)}` :
  /\.(md|markdown)$/i.test(relative) ? `/board/doc?path=${encodeURIComponent(ray + "/" + relative)}` :
  `/api/board/project/${encodeURIComponent(ray)}/artifact?path=${encodeURIComponent(relative)}`;
export function proofLinks(ray: string, proof: string | undefined, root?: string) {
  const text = proof ?? "";
  const out = [...text.matchAll(/\[([^\]\r\n]+)\]\(([^)\r\n]+)\)|\[commit ([0-9a-f]{7,40})\]/gi)].flatMap(m => {
    if (m[3]) return [{ label: "commit " + m[3], href: `/board/diff?ray=${encodeURIComponent(ray)}&hash=${m[3]}` }];
    const rel = m[2]!.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || rel.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git" || p.includes(":"))) return [];
    return [{ label: m[1]!, href: artifactHref(ray, rel) }];
  });
  if (!root) return out;
  // 26 Nov (owner): "Proof docs/...pdf -- where am i supposed to find it": bare ray-relative paths and an
  // unbracketed "commit abc1234" become links too, but a path only when the file really exists in the ray.
  const seen = new Set(out.map(l => l.href));
  const add = (l: { label: string; href: string }) => { if (!seen.has(l.href)) { seen.add(l.href); out.push(l); } };
  const bare = text.replace(/\[[^\]\r\n]+\]\([^)\r\n]+\)/g, " ");
  for (const m of bare.matchAll(/(?:^|[\s(`'"])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)*\.[A-Za-z0-9]{1,5})(?=$|[\s),;`'"]|\.(?:\s|$))/g)) {
    const rel = m[1]!.replace(/^\.\//, "");
    if (safeArtifact(root, ray, rel)) add({ label: rel, href: artifactHref(ray, rel) });
  }
  for (const m of bare.matchAll(/\bcommit ([0-9a-f]{7,40})\b/gi))
    add({ label: "commit " + m[1], href: `/board/diff?ray=${encodeURIComponent(ray)}&hash=${m[1]}` });
  return out;
}
/** Shown inside the board (card modal); everything else downloads. */
const INLINE: Record<string, string> = { pdf: "application/pdf", txt: "text/plain; charset=utf-8", log: "text/plain; charset=utf-8",
  json: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8" };
export function artifactResponse(root: string, ray: string, relative: string): Response {
  const target = safeArtifact(root, ray, relative);
  if (!target) return json({ error: "artifact not found" }, 404);
  if (statSync(target).size > 64 * 1024 * 1024) return json({ error: "artifact exceeds 64 MiB" }, 413);
  const inline = INLINE[path.extname(target).slice(1).toLowerCase()];
  return new Response(readFileSync(target), { headers: { "content-type": inline ?? "application/octet-stream",
    "content-disposition": (inline ? "inline" : "attachment") + "; filename*=UTF-8\'\'" + encodeURIComponent(path.basename(target)), "x-content-type-options": "nosniff", "cache-control": "no-store" } });
}
export function returnedArtifacts(root: string, ray: string, job: string) {
  if (!safeName(job) || !safeName(ray)) return [];
  const prefix = `.docs/chatgpt/small/zip-${job}`;
  const out: { label: string; href: string; path: string; relativePath: string; bytes: number }[] = [];
  const walk = (relative: string, depth: number) => {
    if (depth > 15 || out.length >= 500) return;
    const dir = path.join(root, ray, relative);
    try {
      if (!within(realpathSync(path.join(root, ray)), realpathSync(dir))) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= 500) break;
        if (e.isSymbolicLink() || e.name === ".git" || e.name === "node_modules") continue;
        const rel = relative + "/" + e.name;
        if (e.isDirectory()) walk(rel, depth + 1);
        else if (e.isFile()) {
          const abs = safeArtifact(root, ray, rel);
          if (abs) out.push({ label: rel.slice(prefix.length + 1), href: artifactHref(ray, rel), path: abs,
            relativePath: rel.slice((prefix + "/files/").length), bytes: statSync(abs).size });
        }
      }
    } catch {}
  };
  walk(prefix + "/files", 0);
  return out.sort((a,b) => a.label.localeCompare(b.label));
}
export function readFloor(root: string, ray: string): number | null {
  try {
    const file = safeArtifact(root, ray, ".docs/chatgpt/small/next/floor.json");
    if (!file) return null;
    const v = JSON.parse(readFileSync(file, "utf8"));
    const floor = typeof v === "number" ? v : v.floor;
    return validLimit(floor) ? floor : null;
  } catch { return null; }
}
export const validLimit = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10;
export const validFleetLimit = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 40;
function atomic(file: string, text: string) {
  const temp = file + "." + randomUUID() + ".tmp";
  try { writeFileSync(temp, text, { flag: "wx" }); renameSync(temp, file); }
  finally { rmSync(temp, { force: true }); }
}
export function writeFloor(root: string, ray: string, floor: number) {
  if (!validLimit(floor) || !safeName(ray)) throw Error("jobs at once must be 1–10");
  const base = realpathSync(path.join(root, ray));
  if (!within(realpathSync(root), base)) throw Error("unsafe ray");
  let dir = base;
  for (const segment of [".docs", "chatgpt", "small", "next"]) {
    dir = path.join(dir, segment);
    if (!existsSync(dir)) mkdirSync(dir);
    if (lstatSync(dir).isSymbolicLink() || !within(base, realpathSync(dir))) throw Error("unsafe queue");
  }
  const file = path.join(dir, "floor.json");
  let previous: any = {};
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw Error("unsafe floor");
    previous = JSON.parse(readFileSync(file, "utf8"));
    if (typeof previous !== "number" && (!previous || typeof previous !== "object" || Array.isArray(previous))) throw Error("invalid floor config");
  }
  atomic(file, JSON.stringify(typeof previous === "number" ? floor : { ...previous, floor }, null, 2) + "\n");
}
const keeperPath = (config: BoardConfig) => process.env.RAY_BOARD_KEEPER ||
  (config.integrations.ledger.path?.endsWith(".json") ? undefined : config.integrations.ledger.path) ||
  path.join(config.codeRoot, "chatgpt-bridge", "files", "keeper.ts");
export function fleetConfig(config: BoardConfig) {
  return path.join(path.dirname(path.dirname(keeperPath(config))), ".config.toml");
}
const tabsPattern = /^([ \t]*KEEPER_MAX_TABS[ \t]*=[ \t]*)(["']?)(\d+)\2([ \t]*(?:#[^\r\n]*)?)(\r?)$/m;
export function readFleetLimit(config: BoardConfig): number | null {
  try { const n = Number(tabsPattern.exec(readFileSync(fleetConfig(config), "utf8"))?.[3]); return validFleetLimit(n) ? n : null; }
  catch { return null; }
}
export function replaceFleetLimit(text: string, n: number): string {
  if (!validFleetLimit(n) || !tabsPattern.test(text)) throw Error("KEEPER_MAX_TABS setting missing or invalid");
  return text.replace(tabsPattern, (_, prefix, quote, _old, tail, cr) => prefix + quote + n + quote + tail + cr);
}
/** Keeper queue sidecars: .attach is newline-separated; .prio overrides prompt mtime. */
export function queueAttachments(root: string, ray: string, job: string): string[] {
  if (!safeName(job)) return [];
  for (const state of ["", "running/", "done/", "failed/"]) {
    const file = safeArtifact(root, ray, `.docs/chatgpt/small/queue/${state}${job}.attach`);
    try {
      if (!file || statSync(file).size > 128 * 1024) continue;
      return readFileSync(file, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch { /* file moved with job */ }
  }
  return [];
}
function queuedPriority(root: string, ray: string, name: string): number | null {
  const dir = ".docs/chatgpt/small/queue/";
  try {
    const prio = safeArtifact(root, ray, dir + name + ".prio");
    if (prio && statSync(prio).size <= 128) {
      const text = readFileSync(prio, "utf8").trim();
      if (text && Number.isFinite(Number(text))) return Number(text);
    }
    const file = safeArtifact(root, ray, dir + name + ".txt");
    return file ? statSync(file).mtimeMs : null;
  } catch { return null; }
}
export function queueInfo(job: LedgerJob, own: LedgerJob[], floor: number | null, all: LedgerJob[] = own, max: number | null = null,
  queue?: {root: string; ray: string}) {
  if (job.state !== "queued") return { queuePosition: null, waitReason: null, queuePositionEstimated: false };
  const waiting = own.filter(j => j.state === "queued");
  if (queue) {
    const priorities = new Map(waiting.map(j => [j.name, queuedPriority(queue.root, queue.ray, j.name)]));
    waiting.sort((a,b) => (priorities.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (priorities.get(b.name) ?? Number.MAX_SAFE_INTEGER));
  }
  const active = (j: LedgerJob) => ["running","sending","waiting"].includes(j.state);
  const running = own.filter(active).length;
  const reason = job.waitReason || job.failureReason || (queue && keeperWaitReason(queue.root, queue.ray)) || (max !== null && all.filter(active).length >= max
    ? "Machine tabs full (estimated from ledger)" : floor !== null && running >= floor
    ? "Ray floor reached; fair share / MAX_PER may limit launches (estimated)"
    : "Exact reason unavailable; may be fair share, MAX_PER, 90 s launch spacing or worker busy");
  const authoritative = Number.isInteger(job.queuePosition) && job.queuePosition! > 0;
  return { queuePosition: authoritative ? job.queuePosition! : (waiting.findIndex(j => j.name === job.name) + 1 || null),
    waitReason: reason, queuePositionEstimated: !authoritative };
}
/** The keeper's own last word on why nothing launches (owner 26 Nov: "Exact reason unavailable" read as a shrug). */
export function keeperWaitReason(root: string, ray: string): string | null {
  try {
    const log = path.join(root, ray, ".docs/chatgpt/small/keeper.log");
    const size = statSync(log).size, fd = openSync(log, "r"), buf = Buffer.alloc(Math.min(size, 8192));
    readSync(fd, buf, 0, buf.length, size - buf.length); closeSync(fd);
    const lines = buf.toString("utf8").trim().split(/\r?\n/).reverse();
    const age = (l: string) => { const m = /^(\d\d):(\d\d):(\d\d)/.exec(l); if (!m) return Infinity;
      // keeper.log stamps are UTC clock times
      const d = new Date(); d.setUTCHours(+m[1]!, +m[2]!, +m[3]!, 0); const diff = Math.abs(Date.now() - d.getTime());
      return Math.min(diff, Math.abs(diff - 86_400_000)); };
    for (const l of lines.slice(0, 40)) {
      if (age(l) > 10 * 60_000) break;
      let m = /TABS FULL: (\d+) visible chats.*\(max (\d+)\)/.exec(l);
      if (m) return `All ChatGPT tabs are busy (${m[1]} of ${m[2]}); it starts when one frees`;
      if (/BRAKE|rate.?limit|chat-load/i.test(l)) return "ChatGPT asked us to slow down; launches resume when the pause ends";
      if (/spacing|90 s/i.test(l)) return "Launches are spaced 90 seconds apart; it is next in line";
      if (/fair share|MAX_PER/i.test(l)) return "Other projects get their fair turn first";
    }
  } catch {}
  return null;
}
export function localJobGuard(req: Request, config: BoardConfig, remoteAddress?: string): Response | null {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (! [[127,0,0,1].join("."),"::1",("::ffff:" + [127,0,0,1].join("."))].includes(remoteAddress ?? "") || !editingEnabled(config) ||
      ["1","true"].includes(process.env.RAY_BOARD_DEMO ?? "")) return json({ error: "local only or disabled" }, 403);
  const denied = writeGuard(req, config, true);
  if (denied) return denied;
  if (req.headers.get("origin") !== new URL(req.url).origin) return json({ error: "same origin required" }, 403);
  return null;
}
type Runner = (program: string, args: string[]) => Promise<unknown>;
const run: Runner = (program, args) => execute(program, args, { timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
const rescuing = new Set<string>();
export async function rescueJob(req: Request, config: BoardConfig, remote: string | undefined, ray: string, job: LedgerJob, runner: Runner = run) {
  const denied = localJobGuard(req, config, remote); if (denied) return denied;
  if (job.state !== "done-zip-missing") return json({ error: "job is not missing its zip" }, 409);
  let dir: string;
  try {
    dir = verifiedQueue(config.raysRoot, ray, job.name, job.queueDir);
    if (!within(realpathSync(config.raysRoot), realpathSync(path.join(config.raysRoot, ray))) || !existsSync(dir)) throw Error("unsafe or missing queue");
  } catch { return json({ error: "unsafe or missing queue" }, 400); }
  const key = dir + "\0" + job.name;
  if (rescuing.has(key)) return json({ error: "rescue already running" }, 409);
  rescuing.add(key);
  try {
    await runner(process.env.BUN_BIN || "bun", [keeperPath(config), "rescue-zips", "--dir", dir, "--job", job.name]);
    clearHandoffDetailCache(); invalidateLedgerCache();
    return json({ ok: true, message: "Keeper rescue completed; check returned artifacts and diff." });
  } catch { return json({ error: "keeper rescue failed; inspect keeper log" }, 502); }
  finally { rescuing.delete(key); }
}
let fleetBusy = false;
export async function setFleetLimit(config: BoardConfig, n: number, runner: Runner = run) {
  if (fleetBusy) throw Error("fleet restart already running");
  fleetBusy = true;
  try {
    const file = fleetConfig(config);
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw Error("unsafe fleet config");
    atomic(file, replaceFleetLimit(readFileSync(file, "utf8"), n));
    await runner(process.env.RAY_BOARD_BGRUN || "bgrun", ["--restart", "ray-fleet-keeper"]);
  } finally { fleetBusy = false; }
}
