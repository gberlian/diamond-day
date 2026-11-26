/** GOALS.md is the ray's source of intent, not a live-session status feed. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type CheckState = "pass" | "fail" | "unknown" | "stale" | "manual" | "never";
export type Goal = {
  id: string;
  title: string;
  want: string;
  check: string;
  /** Dedicated indented machine-readable lines under Check, not prose or backticks. */
  checkDeclarations?: string[];
  research: string;
  now: string;
  next: string;
  /** RPM (owner 24 Nov): Result, Purpose and a Massive action Plan as '- [x] step' lines. */
  result?: string;
  purpose?: string;
  plan?: string;
  proofIssues?: string[];
  checkState: CheckState;
};
export type RayGoals = { ray: string; name: string; goals: Goal[] };
export type LedgerState = "failed" | "done-zip-missing" | "applied" | "superseded" |
  "unapplied-late" | "done" | "waiting" | "queued" | "dead" | "stale" | "sending" | "running";
export type LedgerJob = {
  name: string; state: LedgerState; queueDir: string; minutes: number;
  promptPreview: string | null; replyPreview: string | null;
  returnedFiles?: { path: string; relativePath: string; bytes: number }[];
  promptPath: string | null; replyPath: string | null;
  conversationUrl: string | null; appliedCommit: string | null;
  appliedCommitUrl: string | null; appliedTo: string | null;
  supersedeReason: string | null; failureReason: string | null;
  startedAt: string | null; finishedAt: string | null;
  testedConclusion?: string | null;
  queuePosition?: number;
  waitReason?: string;
  attachments?: unknown[];
};
export type GoalGroup = { goalId: string | null; jobs: LedgerJob[] };

function unquote(text: string): string {
  return text.replace(/\r/g, "").trim();
}

/** A badge reports an explicitly recorded check outcome, never an inferred truth. */
export function recordedCheck(now: string): CheckState {
  const records = now.split(/\n(?=(?:\s*[-*]\s*)?(?:Now\b|\*\*Now))/i).reverse();
  for (const record of records) {
    const checkAt = [...record.matchAll(/\bcheck\b/gi)].at(-1)?.index;
    if (checkAt == null) continue;
    const result = record.slice(checkAt);
    const explicit = [...result.matchAll(/\b(PASS(?:ES|ED)?|FAIL(?:S|ED)?)\b/gi)];
    if (explicit.length) {
      // An incomplete count (10/12 pass) is a failed check, even if most subchecks pass.
      const fractions = [...result.matchAll(/\b(\d+)\s*\/\s*(\d+)\s*(?:pass|ok)\b/gi)];
      if (fractions.some((x) => Number(x[1]) < Number(x[2]))) return "fail";
      return /^fail/i.test(explicit.at(-1)![1]!) ? "fail" : "pass";
    }
  }
  return "unknown";
}

/** Parse a numbered goal and its optional field labels, with continuation lines intact. */
export function parseGoals(markdown: string, ray: string): RayGoals {
  const name = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() || ray;
  const goals: Goal[] = [];
  let goal: Goal | null = null;
  let field: "want" | "check" | "research" | "now" | "next" | "result" | "purpose" | "plan" | null = null;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^\s*##\s+(\d+)\s*[.)]\s*(.+?)\s*$/.exec(line);
    if (heading) {
      goal = { id: heading[1]!, title: heading[2]!, want: "", check: "", research: "", now: "", next: "", checkState: "unknown" };
      goals.push(goal);
      field = null;
      continue;
    }
    if (/^\s*#{1,3}\s/.test(line) || (!goal && line.trim())) { field = null; continue; }
    if (!goal) continue;
    // A machine-readable declaration is a Check continuation, not another Check label.
    if (field === "check" && /^\s+(?:[-*]\s+)?check:\s+\S/i.test(line)) {
      goal.checkDeclarations ??= [];
      goal.checkDeclarations.push(line.trim());
      goal.check += (goal.check ? "\n" : "") + line.trim();
      continue;
    }
    // Some rays write '- **Now (23 Nov):**', others write 'Now:' or '- Next —'.
    const labelled = /^\s*(?:[-*+]\s+)?(?:\*\*)?(Want|Check|Research|Now|Next|Result|Purpose|Plan)(?:\s*\(([^)]*)\))?(?:\*\*)?\s*(?::|\s+[-–—])\s*(.*)$/i.exec(line);
    if (labelled) {
      field = labelled[1]!.toLowerCase() as typeof field;
      const value = unquote(labelled[3] ?? "").replace(/^\*\*\s*/, "");
      const stamp = field === "now" ? labelled[2] : null;
      if (field && value) goal[field] = (goal[field] ?? "") + (goal[field] ? "\n" : "") + (stamp ? `(${stamp}) ` : "") + value;
      continue;
    }
    if (/^\s*(?:[-*+]\s+)?\*\*[a-z][^*]*\*\*\s*:/i.test(line)) { field = null; continue; }
    if (field && line.trim()) {
      // Preserve indented command lines; unrelated top-level paragraphs end the field.
      if (/^\s+/.test(line) || /^\s*[-*+]\s+/.test(line))
        goal[field] = (goal[field] ?? "") + (goal[field] ? "\n" : "") + line.trimEnd().trimStart();
      else field = null;
    }
  }
  for (const g of goals) {
    g.checkState = recordedCheck(g.now);
    const plan = (g.plan ?? "").split("\n");
    const missing = plan.filter((line, i) => /^[-*+]\s+\[x\]/i.test(line) && !/^proof:\s*\S/i.test(plan[i + 1] ?? "") && !(/^decision:\s*\S/i.test(plan[i + 1] ?? "") && /^proof:\s*\S/i.test(plan[i + 2] ?? "")));
    if (missing.length) {
      g.proofIssues = missing.map(line => "done without proof: " + line.replace(/^[-*+]\s+\[x\]\s*/i, ""));
      g.checkState = "fail";
    }
  }
  return { ray, name, goals };
}

export function readRayGoals(root: string, ray: string): RayGoals {
  if (!/^[a-zA-Z0-9][\w.-]*$/.test(ray)) throw new Error("invalid ray");
  const file = path.join(root, ray, "GOALS.md");
  try { return parseGoals(readFileSync(file, "utf8"), ray); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ray, name: ray, goals: [] }; throw e; }
}

/** Ray folders not in rays.txt: any folder with a GOALS.md or a README.md (older rays have no
 * GOALS.md yet, and the owner must be able to start them from the board too). */
export function stoppedRays(root: string, running: string[]): RayGoals[] {
  const live = new Set(running.map((x) => x.toLowerCase()));
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !live.has(e.name.toLowerCase()) && /^[a-zA-Z0-9][\w.-]*$/.test(e.name))
    .filter((e) => ["GOALS.md", "README.md"].some((f) => { try { return statSync(path.join(root, e.name, f)).isFile(); } catch { return false; } }))
    .map((e) => readRayGoals(root, e.name));
}

/** Ledger paths come from Windows on the real host; never use path.basename on them on Linux. */
export function ledgerRay(job: Pick<LedgerJob, "queueDir">): string | null {
  const parts = job.queueDir.replace(/\\/g, "/").split("/");
  const i = parts.findIndex((p) => p.toLowerCase() === ".docs");
  return i > 0 && parts[i + 1]?.toLowerCase() === "chatgpt" && parts[i + 2]?.toLowerCase() === "small"
    ? parts[i - 1]! : null;
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/).filter((x) => x.length >= 4 &&
    !["chatgpt", "handoff", "goal", "work", "test", "with", "from", "next", "this", "that", "done", "coordinator", "runecraft", "desktop", "health", "gta6"].includes(x));
}

/** Explicit job-name references win; fuzzy matches require two distinctive words. */
export function goalForJob(job: Pick<LedgerJob, "name">, goals: Goal[]): string | null {
  const key = job.name.toLowerCase();
  const ranked = goals.map((goal) => {
    const title = goal.title.toLowerCase();
    const next = goal.next.toLowerCase();
    const now = goal.now.toLowerCase();
    if (next.includes(key)) return { goal, rank: 1000 };
    if (title.includes(key)) return { goal, rank: 900 };
    if (now.includes(key)) return { goal, rank: 800 };
    const w = [...new Set(words(key))];
    const nextMatches = w.filter((t) => next.includes(t)).length;
    const titleMatches = w.filter((t) => title.includes(t)).length;
    const rank = nextMatches * 4 + titleMatches * 3;
    return { goal, rank: (nextMatches + titleMatches >= 2 && w.length >= 2) ? rank : 0 };
  }).sort((a, b) => b.rank - a.rank);
  return ranked[0]?.rank ? ranked[0].goal.id : null;
}

/** Only explicit goal tags in the first prompt lines, then literal job-name mentions in Now/Next.
 * Older fuzzy keyword matching remains available through goalForJob, but is not evidence of service. */
export function goalForHandoff(job: Pick<LedgerJob, "name" | "promptPreview">, goals: Goal[]): string | null {
  const lines = String(job.promptPreview ?? "").replace(/\r/g, "").split("\n").slice(0, 12);
  const tag = lines.map(line => /^\s*(?:[-*]\s*)?goal\s*:\s*(.+?)\s*$/i.exec(line)?.[1])
    .find(Boolean)?.trim().replace(/^#/, "");
  if (tag) {
    const id = /^(\d+)(?:[.)\s]|$)/.exec(tag)?.[1];
    const direct = goals.find(g => g.id === id || g.title.toLowerCase() === tag.toLowerCase());
    if (direct) return direct.id;
    // An explicit unknown tag is not a fuzzy match to an unrelated goal.
    return null;
  }
  const name = job.name.toLowerCase();
  const full = goals.find(g => g.next.toLowerCase().includes(name) || g.now.toLowerCase().includes(name));
  if (full) return full.id;
  // The goal's own slug in the job name ("gamedev-stock-2-good-performance-and-ping-i3").
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const bySlug = goals.find(g => slug(g.title).length >= 4 && name.includes(slug(g.title)));
  if (bySlug) return bySlug.id;
  // Now/Next cite jobs by their short id ("fix B-key building (big120)"): the name's first token
  // as a whole word, when it carries a number (so "fix" or "gamedev" never match).
  const head = /^([a-z]+\d+[a-z]?)(?:-|$)/.exec(name)?.[1];
  if (head) {
    const word = new RegExp(`(^|[^a-z0-9])${head}([^a-z0-9]|$)`);
    const hit = goals.find(g => word.test(g.next.toLowerCase()) || word.test(g.now.toLowerCase()));
    if (hit) return hit.id;
  }
  return null;
}

export function groupHandoffs(goals: Goal[], jobs: LedgerJob[]): GoalGroup[] {
  const groups = goals.map((g) => ({ goalId: g.id, jobs: [] as LedgerJob[] }));
  const other: GoalGroup = { goalId: null, jobs: [] };
  for (const job of jobs) {
    const id = goalForHandoff(job, goals);
    (groups.find((g) => g.goalId === id) ?? other).jobs.push(job);
  }
  const order: Record<string, number> = { sending: 0, running: 1, waiting: 2, queued: 3, stale: 4, dead: 5, failed: 6, "done-zip-missing": 7, "unapplied-late": 8, done: 9, applied: 10, superseded: 11 };
  for (const group of [...groups, other]) group.jobs.sort((a, b) => (order[a.state] ?? 99) - (order[b.state] ?? 99) || a.name.localeCompare(b.name));
  return other.jobs.length ? [...groups, other] : groups;
}
