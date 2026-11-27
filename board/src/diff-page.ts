/** Proof for an applied handoff: the commit's diff, with changed images shown before and after.
 * GET /board/diff?hash=<commit>[&ray=<folder>]   finds the repo that holds the commit (the ray's folder first,
 * then the configured code root), renders `git show --stat --patch` and <img> pairs for changed images.
 * GET /board/blob?repo=<name>&rev=<commit or commit^>&path=<file>   serves one image from git. */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadConfig } from "./config.ts";
import { parseUnifiedDiff, renderDiffHtml } from "./diff-view.ts";

const codeRoot = () => loadConfig().codeRoot;
const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const gitPath = (dir: string) => process.platform === "win32" ? dir.replace(/\\/g, "/") : dir;
const git = (dir: string, args: string[], binary = false) =>
  spawnSync("git", ["-C", gitPath(dir), ...args], { encoding: binary ? "buffer" : "utf8", maxBuffer: 1 << 27, windowsHide: true });
const okHash = (h: string) => /^[0-9a-f]{6,40}$/i.test(h);

function repos(raysRoot: string, ray: string): string[] {
  const out: string[] = [];
  if (ray && /^[\w-]+$/.test(ray)) {
    out.push(join(raysRoot, ray));
    // The ray's own repos (its README table) first: scanning every repo under the code root is slow.
    try {
      const md = readFileSync(join(raysRoot, ray, "README.md"), "utf8");
      for (const r of [...readmeRepos(md), ...readmeRepoNames(md).map((n) => join(codeRoot(), n))]) if (existsSync(join(r, ".git")) || existsSync(r)) out.push(r);
    } catch { /* no README: fall through to the code root */ }
  }
  for (const d of (existsSync(codeRoot()) ? readdirSync(codeRoot(), { withFileTypes: true }) : [])) if (d.isDirectory() && existsSync(join(codeRoot(), d.name, ".git"))) out.push(join(codeRoot(), d.name));
  return out;
}

function findRepo(hash: string, raysRoot: string, ray: string): string | null {
  for (const dir of repos(raysRoot, ray)) if (git(dir, ["cat-file", "-e", `${hash}^{commit}`]).status === 0) return dir;
  return null;
}

export function renderDiffPage(url: URL, raysRoot: string): Response {
  const hash = (url.searchParams.get("hash") ?? "").trim();
  if (!okHash(hash)) return new Response("bad hash", { status: 400 });
  const ray = url.searchParams.get("ray") ?? "", repo = url.searchParams.get("repo");
  if (repo && (!/^[\w.-]+$/.test(repo) || repo === "." || repo === "..")) return new Response("bad repo", { status: 400 });
  const candidates = repo ? repos(raysRoot, ray).filter(d => d.replace(/\\/g, "/").split("/").pop() === repo) : [];
  const dir = repo ? candidates.find(d => existsSync(join(d, ".git")) && git(d, ["cat-file", "-e", `${hash}^{commit}`]).status === 0) : findRepo(hash, raysRoot, ray);
  if (!dir) return new Response(`commit ${esc(hash)} not found in the ray or in configured code root`, { status: 404 });
  const name = dir.replace(/\\/g, "/").split("/").pop()!;
  const head = git(dir, ["show", "-s", "--format=%h%n%an%n%ad%n%B", "--date=format-local:%d.%m.%Y %H:%M", hash]).stdout as string;
  const [h, author, date, ...msg] = head.split("\n");
  const files = (git(dir, ["show", "--diff-merges=first-parent", "--format=", "--name-status", hash]).stdout as string).split("\n").filter(Boolean)
    .map((l) => { const [st, ...p] = l.split("\t"); return { st: st!, path: p[p.length - 1]! }; });
  const imgs = files.filter((f) => IMG.test(f.path)).map((f) => {
    const src = (rev: string) => `/board/blob?repo=${encodeURIComponent(name)}&rev=${encodeURIComponent(rev)}&path=${encodeURIComponent(f.path)}`;
    const before = f.st.startsWith("A") ? "<div class=none>new</div>" : `<img src="${src(hash + "^")}">`;
    const after = f.st.startsWith("D") ? "<div class=none>deleted</div>" : `<img src="${src(hash)}">`;
    return `<figure><figcaption>${esc(f.path)}</figcaption><div class=pair>${before}${after}</div></figure>`;
  }).join("");
  const patch = git(dir, ["show", "--diff-merges=first-parent", "--format=", "--patch", "--no-color", "-U3", hash]).stdout as string;
  const parsed = parseUnifiedDiff(patch.length > 8_000_000 ? patch.slice(0, 8_000_000) : patch);
  const html = renderDiffHtml({ title: `${name} · ${h}`, meta: [`${author} · ${date}`], message: msg.join("\n").trim(),
    extraHtml: imgs ? `<h2>Images, before and after</h2>${imgs}` : "", files: parsed, raw: patch.slice(0, 2_000_000),
    note: patch.length > 8_000_000 ? "Diff cut at 8 MB." : undefined });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** A branch against its base, three-dot (what the branch adds since it left base):
 * GET /board/diff?repo=<name under the code root>&base=<ref>&head=<ref>, e.g. head=apply/big120-input-bugs. */
const okRef = (r: string) => /^[\w][\w./-]{0,200}$/.test(r) && !r.includes("..") && !r.endsWith(".lock") && !r.includes("//");
export function renderRangeDiff(url: URL): Response {
  const repo = url.searchParams.get("repo") ?? "", base = url.searchParams.get("base") ?? "", headRef = url.searchParams.get("head") ?? "";
  // repo=<name> is under the code root; repo=rays/<ray> is a ray folder that is its own git repo.
  const rayRepo = /^rays\/([\w.-]+)$/.exec(repo)?.[1];
  if ((!rayRepo && !/^[\w.-]+$/.test(repo)) || [".", ".."].includes(rayRepo ?? repo) || !okRef(base) || !okRef(headRef)) return new Response("bad repo or ref", { status: 400 });
  const dir = rayRepo ? join(loadConfig().raysRoot, rayRepo) : join(codeRoot(), repo);
  if (!existsSync(join(dir, ".git"))) return new Response("repo not found", { status: 404 });
  for (const r of [base, headRef]) if (git(dir, ["rev-parse", "--verify", "--quiet", `${r}^{commit}`]).status !== 0) return new Response(`ref ${esc(r)} not found`, { status: 404 });
  const patch = git(dir, ["diff", "--no-color", "-U3", `${base}...${headRef}`]).stdout as string;
  const log = (git(dir, ["log", "--format=%h %s", `${base}..${headRef}`, "-n", "20"]).stdout as string).trim();
  const html = renderDiffHtml({ title: `${repo} · ${headRef}`, meta: [`against ${base}`], message: log, files: parseUnifiedDiff(patch) });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function serveBlob(url: URL): Response {
  const repo = url.searchParams.get("repo") ?? "", rev = url.searchParams.get("rev") ?? "", path = url.searchParams.get("path") ?? "";
  if (!/^[\w.-]+$/.test(repo) || !/^[0-9a-f]{6,40}\^?$/i.test(rev) || !IMG.test(path) || path.includes("..")) return new Response("bad request", { status: 400 });
  const dir = join(codeRoot(), repo);
  const r = git(dir, ["show", `${rev}:${path}`], true);
  if (r.status !== 0) return new Response("not found", { status: 404 });
  const ext = path.split(".").pop()!.toLowerCase();
  const type = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return new Response(r.stdout as Buffer, { headers: { "content-type": type, "cache-control": "max-age=86400" } });
}

/** An unapplied overlay preview: compare extracted files to the target repo's HEAD without
 * touching its index or worktree. The applied-commit page above remains unchanged. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { readmeRepos, readmeRepoNames } from "./git-reader.ts";
import { fastOverlay } from "./overlay-fast.ts";
export type OverlayDiff = { repo: string | null; text: string | null; error: string | null };
const safeRel = (s: string) => !!s && !pathIsAbsolute(s) && !s.replace(/\\/g, "/").split("/").some(p => p === ".." || p === "." || !p || p.toLowerCase() === ".git" || /[:\x00-\x1f]/.test(p));
const pathIsAbsolute = (s: string) => /^([a-z]:[\\/]|[\\/])/.test(s);
export async function overlayDiff(root: string, ray: string,
  files: { path: string; relativePath: string; bytes: number }[], configuredCodeRoot: string): Promise<OverlayDiff> {
  if (!/^[a-zA-Z0-9][\w.-]*$/.test(ray)) return { repo: null, text: null, error: "invalid ray" };
  if (!files.length) return { repo: null, text: null, error: "No extracted returned files to diff" };
  let readme = "";
  try { readme = readFileSync(join(root, ray, "README.md"), "utf8"); } catch {}
  const candidates = [...new Set([...readmeRepos(readme),
    ...readmeRepoNames(readme).map(name => join(configuredCodeRoot, name)),
    join(configuredCodeRoot, ray), join(root, ray)])];
  // A single explicit repository needs no per-file scoring. For common small
  // text edits reuse immutable HEAD blobs rather than clone and populate an index.
  const direct = [...new Set(candidates.flatMap(dir => {
    try {
      const real = realpathSync.native(dir);
      return existsSync(join(real, ".git")) ? [real] : [];
    } catch { return []; }
  }))];
  if (direct.length === 1) {
    const text = fastOverlay(direct[0]!, files);
    if (text !== null) return { repo: direct[0]!, text, error: null };
  }
  // rev-parse inside a subdirectory can accidentally resolve an ancestor repository.
  const repositories = [...new Set(candidates.flatMap(dir => {
    try {
      const real = realpathSync.native(dir);
      const top = git(real, ["rev-parse", "--show-toplevel"]).stdout?.toString().trim();
      const norm = (p: string) => { const native = realpathSync.native(p).replace(/\\/g, "/"); return process.platform === "win32" ? native.toLowerCase() : native; }; // git prints C:/..., realpath C:\...
      return top && norm(top) === norm(real) ? [real] : [];
    } catch { return []; }
  }))];
  if (!repositories.length) return { repo: null, text: null, error: "Target repository not found (configure codeRoot or ray README repository table)" };
  // If multiple repos are listed, prefer the one tracking the most returned paths at HEAD.
  const matches = repositories.map(repo => ({ repo, score: files.reduce((n, f) => n +
    (safeRel(f.relativePath) && git(repo, ["cat-file", "-e", `HEAD:${f.relativePath.replace(/\\/g, "/")}`]).status === 0 ? 1 : 0), 0) }));
  matches.sort((a, b) => b.score - a.score);
  if (matches.length > 1 && matches[0]!.score === matches[1]!.score)
    return { repo: null, text: null, error: "Ambiguous target repositories; specify one in the ray README" };
  const repo = matches[0]!.repo;
  const scratch = mkdtempSync(join(tmpdir(), "ray-overlay-diff-"));
  const worktree = join(scratch, "worktree");
  const notes: string[] = [];
  try {
    // An independent temporary worktree with a private index/object store. Sharing the
    // original objects avoids a full copy; no checkout, hooks, filters, or writes to the source repo.
    const clone = git(scratch, ["clone", "--shared", "--no-checkout", "--quiet", "--", gitPath(repo), "worktree"]);
    if (clone.status !== 0) throw Error("could not create isolated worktree");
    const head = git(repo, ["rev-parse", "--verify", "HEAD"]).stdout?.toString().trim() ?? "";
    if (!okHash(head) || git(worktree, ["read-tree", head]).status !== 0) throw Error("could not load target HEAD");
    for (const file of files.slice(0, 100)) {
      const rel = file.relativePath.replace(/\\/g, "/");
      if (!safeRel(rel)) { notes.push(`Unsafe path omitted: ${rel}`); continue; }
      if (file.bytes > 2 * 1024 * 1024) { notes.push(`File ${rel}: too large for inline diff (${file.bytes} B)`); continue; }
      const dest = join(worktree, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(file.path));
      // Hash the exact returned bytes without invoking .gitattributes clean filters.
      const hash = git(worktree, ["hash-object", "-w", "--no-filters", "--", gitPath(dest)]).stdout?.toString().trim() ?? "";
      if (!okHash(hash)) throw Error(`could not hash ${rel}`);
      const old = git(worktree, ["--literal-pathspecs", "ls-files", "--stage", "--", rel]).stdout?.toString() ?? "";
      const mode = /^100755 /.test(old) ? "100755" : "100644";
      if (git(worktree, ["update-index", "--add", "--cacheinfo", `${mode},${hash},${rel}`]).status !== 0)
        throw Error(`could not overlay ${rel}`);
    }
    if (files.length > 100) notes.push(`[${files.length - 100} additional files omitted]`);
    const patch = git(worktree, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "-U3", head]);
    if (patch.status !== 0) throw Error("could not diff temporary worktree");
    const text = patch.stdout?.toString() ?? "";
    if (text.length > 3 * 1024 * 1024) notes.push("Diff truncated at 3 MiB");
    return { repo, text: [text.slice(0, 3 * 1024 * 1024) || "No difference from HEAD", ...notes].join("\n"), error: null };
  } catch (e) {
    return { repo, text: null, error: `Overlay diff failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
