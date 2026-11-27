/** Fast, read-only previews for ordinary small text edits. Git remains the
 * authority for repository/HEAD discovery, blob contents and complex diffs. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const MAX_BYTES = 64 * 1024;
type Blob = { hash: string; mode: string; bytes: Buffer };
const blobs = new Map<string, Blob | null>();
const repos = new Map<string, string>();
const git = (repo: string, args: string[]) =>
  spawnSync("git", ["-C", process.platform === "win32" ? repo.replace(/\\/g, "/") : repo, ...args], { windowsHide: true, maxBuffer: 1024 * 1024 });
const normalized = (p: string) => {
  const real = realpathSync.native(p);
  return process.platform === "win32" ? real.toLowerCase() : real;
};
const hashPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Read normal loose refs directly, so repeated previews don't spawn rev-parse.
 * Unusual repositories (worktrees, reftable, packed refs) use the full Git path. */
function headOf(repo: string): string | null {
  try {
    const dir = path.join(repo, ".git");
    if (!statSync(dir).isDirectory()) return null;
    let head = readFileSync(path.join(dir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      if (!/^refs\/[\w./-]+$/.test(ref) || ref.split("/").includes("..")) return null;
      head = readFileSync(path.join(dir, ref), "utf8").trim();
    }
    if (!hashPattern.test(head)) return null;
    const identity = statSync(dir);
    const key = `${repo}\0${identity.dev}:${identity.ino}\0${head}`;
    if (repos.get(repo) !== key) {
      const top = git(repo, ["rev-parse", "--show-toplevel"]);
      const actual = git(repo, ["rev-parse", "--verify", "HEAD"]);
      if (top.status !== 0 || actual.status !== 0 ||
          normalized(top.stdout.toString().trim()) !== normalized(repo) ||
          actual.stdout.toString().trim() !== head) return null;
      // The fallback clone inherits global/system Git configuration. Do not
      // synthesize a patch when an explicit attributes file is configured.
      const attributes = git(repo, ["config", "--path", "--get", "core.attributesFile"]);
      if (attributes.status === 0 && attributes.stdout.toString().trim()) return null;
      if (repos.size >= 32) repos.delete(repos.keys().next().value!);
      repos.set(repo, key);
    }
    return head;
  } catch { return null; }
}

function blobAt(repo: string, head: string, rel: string): Blob | null {
  const key = `${repo}\0${head}\0${rel}`;
  if (blobs.has(key)) {
    const value = blobs.get(key)!;
    blobs.delete(key); blobs.set(key, value);
    return value;
  }
  let value: Blob | null = null;
  // Attributes may select a binary or custom diff driver; delegate those to Git.
  const parts = rel.split("/");
  const attrs = parts.map((_, i) => [...parts.slice(0, i), ".gitattributes"].join("/"));
  const tree = git(repo, ["--literal-pathspecs", "ls-tree", "-z", head, "--", rel, ...attrs]);
  const entries = tree.stdout?.toString().split("\0").filter(Boolean) ?? [];
  const match = entries.length === 1 && /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/.exec(entries[0]!);
  if (tree.status === 0 && match && match[3] === rel && hashPattern.test(match[2]!)) {
    const size = git(repo, ["cat-file", "-s", match[2]!]);
    if (size.status === 0 && Number(size.stdout.toString().trim()) <= MAX_BYTES) {
      const content = git(repo, ["cat-file", "blob", match[2]!]);
      if (content.status === 0) value = { mode: match[1]!, hash: match[2]!, bytes: content.stdout };
    }
  }
  blobs.set(key, value);
  while (blobs.size > 128) blobs.delete(blobs.keys().next().value!);
  return value;
}

function lines(bytes: Buffer): string[] | null {
  const text = bytes.toString("utf8");
  if (text.includes("\0") || text.includes("\r") || !Buffer.from(text).equals(bytes) ||
      (text.length && !text.endsWith("\n"))) return null;
  return text ? text.slice(0, -1).split("\n") : [];
}

/** A single contiguous edit with no shared interior lines has an unambiguous
 * unified hunk. More involved edits, binaries, modes and attributes fall back. */
function patch(rel: string, old: Blob, bytes: Buffer): string | null {
  if (old.bytes.equals(bytes)) return "";
  const a = lines(old.bytes), b = lines(bytes);
  if (!a || !b) return null;
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
      a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const removed = a.slice(prefix, a.length - suffix), added = b.slice(prefix, b.length - suffix);
  const gone = new Set(removed);
  if (added.some(line => gone.has(line))) return null;
  const start = Math.max(0, prefix - 3);
  const before = a.slice(start, prefix), after = a.slice(a.length - suffix, a.length - suffix + 3);
  const range = (length: number) => length === 1 ? String(start + 1) :
    `${length ? start + 1 : start},${length}`;
  const oldCount = before.length + removed.length + after.length;
  const newCount = before.length + added.length + after.length;
  const newHash = createHash(old.hash.length === 64 ? "sha256" : "sha1")
    .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  return [`diff --git a/${rel} b/${rel}`, `index ${old.hash}..${newHash} ${old.mode}`,
    `--- a/${rel}`, `+++ b/${rel}`, `@@ -${range(oldCount)} +${range(newCount)} @@`,
    ...before.map(line => " " + line), ...removed.map(line => "-" + line),
    ...added.map(line => "+" + line), ...after.map(line => " " + line), ""].join("\n");
}

export function fastOverlay(repo: string, files: { path: string; relativePath: string; bytes: number }[]): string | null {
  // Fall back for paths needing Git quoting or path/attribute interpretation.
  if (files.length > 100 || existsSync(path.join(repo, ".git", "info", "attributes")) ||
      existsSync(path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "git", "attributes"))) return null;
  const head = headOf(repo);
  if (!head) return null;
  const patches: string[] = [], seen = new Set<string>();
  try {
    for (const file of [...files].sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)) {
      const rel = file.relativePath.replace(/\\/g, "/");
      if (!/^[a-zA-Z0-9_.\/-]+$/.test(rel) ||
          rel.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git" || p === ".gitattributes") ||
          seen.has(rel) || file.bytes > MAX_BYTES || statSync(file.path).size > MAX_BYTES) return null;
      seen.add(rel);
      const old = blobAt(repo, head, rel);
      if (!old) return null;
      const text = patch(rel, old, readFileSync(file.path));
      if (text === null) return null;
      patches.push(text);
    }
    if (headOf(repo) !== head) return null;
    const text = patches.join("");
    return text.length > 3 * 1024 * 1024 ? null : text || "No difference from HEAD";
  } catch { return null; }
}
