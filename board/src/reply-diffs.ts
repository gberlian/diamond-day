// Per-reply diffs for replies that came back and are not applied yet (owner, 24 Nov: "i dont see
// workspace diff there still for those that came back"). The coordinator builds a branch reply/<job>
// per waiting reply and lists them in replies.json (bgrun ray-reply-diff, every 2 min):
// [{ ray, job, repo, branch, base, files, plus, minus, diffMd, link }]. This only reads that file.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export type ReplyDiff = { ray: string; job: string; repo: string | null; branch: string | null; base: string | null;
  files: number; plus: number; minus: number; diffMd: string | null; link: string | null };

export const repliesPath = (raysRoot: string) =>
  process.env.RAY_BOARD_REPLIES ?? path.join(raysRoot, "coordinator", "docs", "goals", "diamond", "replies.json");

let cache: { file: string; mtime: number; map: Map<string, ReplyDiff> } | null = null;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Array.isArray(v) ? v.length : 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The range-diff route takes a repo name or rays/<ray>; replies.json may hold full folder paths. */
export function shortRepo(repo: string | null): string | null {
  if (!repo) return null;
  const p = repo.replace(/\\/g, "/").replace(/\/+$/, "");
  const ray = p.match(/^[a-z]:\/rays\/([^/]+)$/i);
  if (ray) return `rays/${ray[1]}`;
  const code = p.match(/^[a-z]:\/code\/([^/]+)$/i);
  if (code) return code[1]!;
  return p;
}

/** Map "<ray>/<job>" → diff summary; empty when the file is missing or unreadable. */
export function replyDiffs(raysRoot: string): Map<string, ReplyDiff> {
  const file = repliesPath(raysRoot);
  let mtime = 0;
  try { mtime = statSync(file).mtimeMs; } catch { return new Map(); }
  if (cache && cache.file === file && cache.mtime === mtime) return cache.map;
  const map = new Map<string, ReplyDiff>();
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const rows: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.replies) ? raw.replies : [];
    for (const r of rows) {
      const ray = str(r?.ray), job = str(r?.job ?? r?.name);
      if (!ray || !job) continue;
      const d: ReplyDiff = { ray, job, repo: str(r.repo), branch: str(r.branch), base: str(r.base),
        files: num(r.files), plus: num(r.plus ?? r.added ?? r.adds), minus: num(r.minus ?? r.removed ?? r.dels),
        diffMd: str(r.diffMd), link: str(r.link ?? r.boardLink ?? r.board) };
      d.repo = shortRepo(d.repo);
      // The coordinator writes full local board URLs; keep only the path. Anything else
      // that is not a same-origin board link is dropped and rebuilt from repo/base/branch.
      if (d.link) d.link = d.link.replace(/^https?:\/\/(127\.0\.0\.1|localhost):5195(?=\/)/, "");
      if (d.link && !d.link.startsWith("/board/diff?")) d.link = null;
      if (!d.link && d.repo && d.base && d.branch)
        d.link = `/board/diff?repo=${encodeURIComponent(d.repo)}&base=${encodeURIComponent(d.base)}&head=${encodeURIComponent(d.branch)}`;
      map.set(`${ray.toLowerCase()}/${job}`, d);
    }
  } catch { /* half-written or invalid file: show nothing rather than wrong numbers */ }
  cache = { file, mtime, map };
  return map;
}

export const replyDiffLabel = (d: ReplyDiff) => `+${d.plus} −${d.minus} in ${d.files} file${d.files === 1 ? "" : "s"}`;
