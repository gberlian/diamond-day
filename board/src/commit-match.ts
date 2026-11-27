// A reply counts as applied when a commit in the ray's repos names the job, even without a
// zip-<job>/.applied marker (24 Nov: gamedev merged big120/big122/big104/big100 as
// "Merge branch 'h-big120'" etc. and wrote no markers, so the board said "not applied").
// Reads each repo's recent subjects once a minute (one git call per repo), matches in memory.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readmeRepos } from "./git-reader.ts";

type Commit = { hash: string; subject: string; repo: string };
const cache = new Map<string, { at: number; commits: Commit[] }>();
const TTL_MS = 60_000;

function recentCommits(repo: string, now: number): Commit[] {
  const hit = cache.get(repo);
  if (hit && now - hit.at < TTL_MS) return hit.commits;
  let commits: Commit[] = [];
  try {
    const out = execFileSync("git", ["-C", repo, "log", "--exclude=refs/heads/reply/*", "--exclude=refs/heads/apply/*", "--all", "-n", "3000", "--format=%h%x09%s"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    commits = out.split("\n").filter(Boolean).map((l) => { const i = l.indexOf("\t"); return { hash: l.slice(0, i), subject: l.slice(i + 1), repo }; })
      .filter((c) => !/^(reply-diff:|handoff \S+ \(raw reply)/.test(c.subject)); // machine copies of a reply, not a merge
  } catch { /* not a repo or git missing: no evidence */ }
  cache.set(repo, { at: now, commits });
  return commits;
}

/** Words a commit may use for a job: the full name, and its numbered first token ("big120"). */
export function jobTokens(name: string): string[] {
  const n = name.toLowerCase();
  const head = /^([a-z]+\d+[a-z]?)(?:-|$)/.exec(n)?.[1];
  return head && head !== n ? [n, head] : [n];
}

export function commitNaming(name: string, commits: Commit[]): Commit | null {
  const words = jobTokens(name).map((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`));
  return commits.find((c) => words.some((w) => w.test(c.subject.toLowerCase()))) ?? null;
}

const OPEN = new Set(["done", "unapplied-late", "done-zip-missing"]);

/** Marks finished, unmarked jobs applied when a commit names them; leaves every other job as is. */
export function applyCommitEvidence<T extends { name: string; state: string; appliedCommit: string | null; appliedTo?: string | null }>(
  root: string, ray: string, jobs: T[], now = Date.now()): T[] {
  if (!jobs.some((j) => OPEN.has(j.state) && !j.appliedCommit)) return jobs;
  const readme = path.join(root, ray, "README.md");
  if (!existsSync(readme)) return jobs;
  const commits = readmeRepos(readFileSync(readme, "utf8")).filter((r) => existsSync(r)).flatMap((r) => recentCommits(r, now));
  if (!commits.length) return jobs;
  return jobs.map((j) => {
    if (!OPEN.has(j.state) || j.appliedCommit) return j;
    const c = commitNaming(j.name, commits);
    return c ? { ...j, state: "applied", appliedCommit: c.hash, appliedTo: c.repo, appliedBy: `commit "${c.subject.slice(0, 80)}"` } : j;
  });
}
