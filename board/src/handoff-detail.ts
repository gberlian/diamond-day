/** On-demand authoritative keeper --job detail. Bounded LRU cache, keyed by job and file mtimes. */
import { execFile } from "node:child_process";
import { constants, existsSync, mkdirSync, openSync, closeSync, realpathSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { LedgerJob } from "./goals.ts";
import { overlayDiff } from "./diff-page.ts";
import type { BoardConfig } from "./config.ts";
const execute = promisify(execFile);
const JOB = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_CACHE = 50;
const MAX_TEXT = 8 * 1024 * 1024;
const cache = new Map<string, FullHandoff>();
const inflight = new Map<string, Promise<FullHandoff>>();
export type ReturnedFile = { path: string; relativePath: string; bytes: number };
export type FullHandoff = LedgerJob & { prompt: string | null; reply: string | null;
  returnedFiles: ReturnedFile[]; zipPath: string | null; zipExpected?: boolean;
  appliedMarkerPath: string | null; marker: string | null;
  overlayDiff: string | null; diffError: string | null; targetRepo: string | null;
  applyCommand: string | null; actionsEnabled: boolean; demo: boolean; attachments?: unknown[] };
export function clearHandoffDetailCache() { cache.clear(); inflight.clear(); }
export function detailCacheSize() { return cache.size; }
const within = (base: string, target: string) => {
  const rel = path.relative(base, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const statKey = (file: string) => {
  try { const st = statSync(file); return `${st.mtimeMs}:${st.size}`; } catch { return "missing"; }
};
/** Prevent a ledger record from choosing an unrelated queue (or a symlink outside this ray). */
export function verifiedQueue(root: string, ray: string, job: string, queueDir?: string): string {
  if (!JOB.test(ray) || !JOB.test(job)) throw Error("invalid ray or job");
  const expected = path.resolve(root, ray, ".docs", "chatgpt", "small");
  if (queueDir && path.resolve(queueDir) !== expected) throw Error("ledger queue is outside this ray");
  if (existsSync(expected) && !within(realpathSync(path.resolve(root, ray)), realpathSync(expected)))
    throw Error("unsafe queue symlink");
  return expected;
}
function existingPrompt(dir: string, name: string) {
  const q = path.join(dir, "queue");
  return ["", "running", "done", "failed"].map((f) => path.join(q, f, `${name}.txt`))
    .find((p) => existsSync(p)) ?? null;
}
function fingerprint(dir: string, name: string) {
  const archive = path.join(dir, `zip-${name}`);
  return [existingPrompt(dir, name), path.join(dir, `reply-${name}.md`), archive,
    path.join(archive, "files"), path.join(archive, ".applied")]
    .map((p) => p ? `${p}:${statKey(p)}` : "no-prompt").join("|");
}
function safeRead(base: string, file: unknown): string | null {
  if (typeof file !== "string") return null;
  try {
    const abs = realpathSync(file);
    if (!within(realpathSync(base), abs)) return null;
    const s = statSync(abs);
    if (!s.isFile() || s.size > MAX_TEXT) return null;
    return readFileSync(abs, "utf8");
  } catch { return null; }
}
function safeReturned(dir: string, name: string, list: unknown): ReturnedFile[] {
  const archive = path.join(dir, `zip-${name}`);
  const files = path.join(archive, "files");
  const result: ReturnedFile[] = [];
  const add = (p: string, relative: string) => {
    try {
      const file = realpathSync(p);
      if (!within(realpathSync(files), file)) return;
      const st = statSync(file);
      if (st.isFile() && result.length < 500) result.push({ path: file, relativePath: relative, bytes: st.size });
    } catch { /* missing or unsafe */ }
  };
  if (Array.isArray(list) && list.length) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.relativePath !== "string" || typeof row.path !== "string") continue;
      const rel = row.relativePath.replace(/\\/g, "/");
      if (rel.startsWith("/") || rel.split("/").includes("..")) continue;
      add(row.path, rel);
    }
  } else if (existsSync(files)) {
    const walk = (folder: string, depth: number) => {
      if (depth > 12 || result.length >= 500) return;
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const dest = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(dest, depth + 1);
        else if (entry.isFile()) add(dest, path.relative(files, dest).replace(/\\/g, "/"));
        if (result.length >= 500) break;
      }
    };
    walk(files, 0);
  }
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
function applyCommand(files: string, repo: string): string {
  if (process.platform === "win32") {
    const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    return `# PowerShell: review the diff before applying\nCopy-Item -Path ${quote(path.join(files, "*"))} -Destination ${quote(repo)} -Recurse -Force\nSet-Location -LiteralPath ${quote(repo)}\nbun test`;
  }
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `# POSIX shell: review the diff before applying\ncp -a ${quote(files + path.sep + ".")} ${quote(repo + path.sep)}\ncd ${quote(repo)} && bun test`;
}
export type DetailOptions = { demo?: boolean; keeperPath?: string; program?: string;
  executeJob?: (program: string, args: string[], timeoutMs: number) => Promise<string>;
  timeoutMs?: number };
/** Does not run on the board poll; called only after a handoff is clicked. */
export async function loadHandoffDetail(root: string, ray: string, job: LedgerJob,
  config: BoardConfig, opts: DetailOptions = {}): Promise<FullHandoff> {
  const demo = opts.demo ?? (process.env.RAY_BOARD_DEMO === "1" || process.env.RAY_BOARD_DEMO === "true");
  const dir = verifiedQueue(root, ray, job.name, demo ? undefined : job.queueDir);
  const key = `${dir}\0${job.name}\0${fingerprint(dir, job.name)}\0${demo}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const processing = inflight.get(key);
  if (processing) return processing;
  const task = (async () => {
    if (!demo && !opts.keeperPath && !process.env.RAY_BOARD_KEEPER && !config.integrations.ledger.path)
      throw Error("keeper not configured");
    let full: Record<string, any>;
    if (demo) {
      full = { ...job };
    } else {
      const runner = opts.executeJob ?? (async (program: string, args: string[], timeout: number) =>
        (await execute(program, args, { timeout, maxBuffer: 24 * 1024 * 1024, windowsHide: true })).stdout);
      const keeper = opts.keeperPath ?? process.env.RAY_BOARD_KEEPER ?? config.integrations.ledger.path!;
      if (keeper.endsWith(".json")) throw Error("keeper command not configured");
      let json: unknown;
      try { json = JSON.parse(await runner(opts.program ?? process.env.BUN_BIN ?? "bun",
        [keeper, "ledger", "--job", job.name, "--dir", dir, "--json"], opts.timeoutMs ?? 30_000)); }
      catch (err) { throw Error(`keeper --job failed: ${err instanceof Error ? err.message : String(err)}`); }
      if (!json || typeof json !== "object" || Array.isArray(json)) throw Error("keeper --job did not return a record");
      full = json as Record<string, any>;
      if (full.name !== job.name || path.resolve(String(full.queueDir || "")) !== dir)
        throw Error("keeper returned the wrong job or queue");
    }
    const prompt = demo ? (safeRead(path.join(dir, "queue"), existingPrompt(dir, job.name)) ?? job.promptPreview) :
      safeRead(path.join(dir, "queue"), full.promptPath);
    const reply = demo ? (safeRead(dir, path.join(dir, `reply-${job.name}.md`)) ?? job.replyPreview) :
      safeRead(dir, full.replyPath);
    const returnedFiles = demo ? [] : safeReturned(dir, job.name, full.returnedFiles);
    const markerPath = path.join(dir, `zip-${job.name}`, ".applied");
    const marker = demo ? job.state === "superseded" ? `superseded: ${job.supersedeReason ?? "fictional"}` : job.appliedCommit :
      safeRead(dir, markerPath)?.trim() || null;
    const diff = demo ? { text: null, repo: null, error: "Demo: no repository overlay" } :
      await overlayDiff(root, ray, returnedFiles, config.codeRoot);
    const filesDir = path.join(dir, `zip-${job.name}`, "files");
    const detail: FullHandoff = { ...job, ...full, prompt, reply, returnedFiles,
      zipPath: demo ? null : typeof full.zipPath === "string" ? full.zipPath : null,
      appliedMarkerPath: demo ? null : markerPath, marker, overlayDiff: diff.text,
      diffError: diff.error, targetRepo: diff.repo,
      applyCommand: !demo && diff.repo && returnedFiles.length ? applyCommand(filesDir, diff.repo) : null,
      actionsEnabled: config.actions === true && !demo, demo };
    cache.set(key, detail);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    return detail;
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
export function writeOff(root: string, ray: string, job: string, reason: string, queueDir?: string): string {
  const dir = verifiedQueue(root, ray, job, queueDir);
  const why = reason.trim();
  if (!why || why.length > 2000 || /[\r\n\x00-\x1f]/.test(why)) throw Error("reason must be 1–2000 characters on one line");
  const archive = path.join(dir, `zip-${job}`);
  if (existsSync(archive) && !within(realpathSync(dir), realpathSync(archive))) throw Error("unsafe archive symlink");
  mkdirSync(archive, { recursive: true });
  const marker = path.join(archive, ".applied");
  let fd: number;
  // Exclusive creation: never overwrite a commit or another user's write-off.
  fd = openSync(marker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
  try { writeFileSync(fd, `superseded: ${why}\n`); }
  finally { closeSync(fd); }
  clearHandoffDetailCache();
  return marker;
}
