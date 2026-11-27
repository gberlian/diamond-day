import { lstatSync } from "node:fs";
import { safeUnder } from "./docs-page.ts";
import { cardTabs, type CardTab } from "./card-modal.ts";
/** Projects view (owner 25 Nov, coordinator docs/goals/rpm-board/SPEC-project-page.md): every ray as a
 * project with its RPM, plan steps as kanban cards, and for each card the handoff jobs behind it. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { parseRpm, setStepMark, setStepProof, type Rpm, type Step } from "./rpm.ts";
import { makeRayCard, expandHandoff } from "./ray-goals-api.ts";
import { newestResume } from "./board.ts";
import type { InboxItem } from "./decisions.ts";
import { projectDocTree, type DocTree, listDocs } from "./docs-page.ts";
import { projectLibrary, type Library } from "./library.ts";
import { ledgerRay, type LedgerJob } from "./goals.ts";
import { proofLinks, readFloor, queueInfo } from "./project-arpe.ts";
import type { ReplyDiff } from "./reply-diffs.ts";
import { pickupPreview, type Card } from "./pickup.ts";

export const validRayName = (s: string) => /^[a-zA-Z0-9][\w.-]{0,63}$/.test(s);
const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };

export type SessionInfo = { session: "running" | "idle" | "stopped"; ago: number | null };
export type ProjectRow = { ray: string; name: string; vision: string; running: boolean; session: SessionInfo["session"];
  lastActivity: number; results: { id: string; title: string; done: number; total: number; now: boolean }[] };

export function projectRays(root: string): string[] { return projectNames(root); }

export function readRpm(root: string, ray: string): Rpm {
  const file = path.join(root, ray, "GOALS.md");
  const rpm = isFile(file) ? parseRpm(readFileSync(file, "utf8"), ray) : { name: ray, vision: "", purpose: "", roles: "", week: "", results: [] };
  if (!rpm.vision) {
    // Older rays without an RPM header: the README's first paragraph stands in for the vision line.
    try {
      const readme = readFileSync(path.join(root, ray, "README.md"), "utf8");
      rpm.vision = readme.split(/\r?\n\r?\n/).map((p) => p.trim()).find((p) => p && !/^[#|>`<-]/.test(p))?.replace(/\s+/g, " ").replace(/\*\*|`/g, "").slice(0, 240) ?? "";
    } catch {}
  }
  rpm.vision = rpm.vision.replace(/^(?:Ultimate\s+)?(?:Mission|Vision)\s*:\s*/i, "");
  return rpm;
}

export function listProjects(root: string, running: string[], sessions: Record<string, SessionInfo>, now = Date.now()): ProjectRow[] {
  const live = new Set(running.map((r) => r.toLowerCase()));
  const rows = projectRays(root).map((ray) => {
    const rpm = readRpm(root, ray);
    const s = sessions[ray];
    const resume = newestResume(ray, root);
    const files = Math.max(mtime(path.join(root, ray, "GOALS.md")), mtime(path.join(root, ray, "README.md")), resume ? mtime(resume) : 0);
    const lastActivity = Math.max(files, s?.ago != null ? now - s.ago : 0);
    return { ray, name: rpm.name, vision: rpm.vision, running: live.has(ray.toLowerCase()), session: s?.session ?? "stopped", lastActivity,
      results: rpm.results.map((r) => ({ id: r.id, title: r.title, done: r.steps.filter((x) => x.mark === "x").length, total: r.steps.length, now: r.steps.some((x) => x.mark === "~") })) };
  });
  const rank = (r: ProjectRow) => (r.session === "running" ? 0 : r.running ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || b.lastActivity - a.lastActivity);
}

const ACTIVE = new Set(["sending", "running", "waiting", "queued", "stale"]);
const STOP = new Set(["with", "from", "that", "this", "then", "into", "each", "they", "their", "have", "will", "until", "after", "before",
  "about", "more", "less", "only", "same", "than", "when", "where", "which", "while", "work", "done", "handoff", "session", "owner",
  "agent", "test", "tests", "make", "made", "next", "first", "file", "files"]);
const tokens = (s: string) => [...new Set(String(s ?? "").toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];

export type JobCard = { name: string; state: string; minutes: number; promptPreview: string | null; replyPreview: string | null;
  conversationUrl: string | null; appliedCommit: string | null; appliedTo: string | null; supersedeReason: string | null;
  replyDiff: { label: string; link: string | null } | null; startedAt: string | null; finishedAt: string | null;
  failureReason: string | null; images: string[]; queuePosition?: number | null; waitReason?: string | null; queuePositionEstimated?: boolean;
  /** How the job reached this card: the step names it, its prompt tags this result ('goal: N'), or shared words only. */
  link?: "named" | "tagged" | "words" };
export type Column = "planned" | "running" | "done";
/** Why a card sits where it does: an applied job, an active job, a failed job, or only its checkbox. */
export type CardCause = { kind: "applied" | "active" | "failed"; job: string; reason: string | null; explicit?: boolean } | null;

/** The result number a job's prompt tags in its first lines ('goal: 3', 'Goal: #3 Title'), if any. */
export function taggedResult(promptPreview: string | null): string | null {
  for (const line of String(promptPreview ?? "").split(/\r?\n/).slice(0, 12)) {
    const m = /^\s*(?:[-*]\s*)?(?:goal|result)\s*:\s*#?(\d+)\b/i.exec(line);
    if (m) return m[1]!;
  }
  return null;
}
/** Outcome steps (a measured or lived result, not a piece of work) are ticked by people, never by a job. */
export const outcomeStep = (text: string) =>
  /\b(?:a (?:full )?(?:day|week|month|round)\b|for (?:a |one )?(?:full )?(?:day|week|month)|stays? (?:above|below|under)|no (?:\w+ ){0,2}(?:errors?|crash(?:es)?|misplaced)|tested\b|measures?\b|says? it|green on|wants? another|people (?:share|come back))/i.test(text);
export type StepCard = Step & { column: Column; cause: CardCause; jobs: JobCard[]; proofLinks?: ReturnType<typeof proofLinks>; modalTabs?: CardTab[]; missingProof?: boolean; decisionItem?: InboxItem; pickedUpAt?: string };
export type ProjectResult = Rpm["results"][number] & { cards: StepCard[] };
export type ProjectDetail = Omit<Rpm, "results"> & { ray: string; running: boolean; session: SessionInfo;
  results: ProjectResult[]; docs: { label: string; href: string }[]; docTree: DocTree[]; library: Library; decisionInbox: InboxItem[]; editEnabled: boolean; ledgerError: string | null; floor?: number | null; activeJobs?: number; queuedJobs?: number; nextCard: Card | null; pickupStatus: string | null };

/** Score how well a job matches a step: distinctive words of its name weigh most (the ray's own name
 * never counts), then words from the first lines of its request. 100 = the step names the job. */
export function stepScore(step: Pick<Step, "raw">, job: Pick<LedgerJob, "name" | "promptPreview">, ray = ""): number {
  const text = step.raw.toLowerCase();
  if (text.includes(job.name.toLowerCase())) return 100;
  const own = new Set(tokens(ray));
  const stepWords = new Set(tokens(step.raw).filter((w) => !own.has(w)));
  const nameHits = tokens(job.name).filter((w) => !own.has(w) && (stepWords.has(w) || stepWords.has(w + "s") || stepWords.has(w.replace(/s$/, "")))).length;
  const promptHits = tokens(String(job.promptPreview ?? "").split(/\r?\n/).slice(0, 8).join(" ")).filter((w) => !own.has(w) && stepWords.has(w)).length;
  return nameHits >= 1 ? nameHits * 3 + promptHits : promptHits >= 4 ? promptHits : 0;
}

/** Images a job returned, as rays-root-relative paths for /board/doc-asset (at most 12). */
export function jobImages(root: string, ray: string, job: string): string[] {
  const base = path.join(root, ray, ".docs", "chatgpt", "small", `zip-${job}`);
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || out.length >= 12) return;
    let entries: import("node:fs").Dirent[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= 12) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(png|jpe?g|gif|webp)$/i.test(e.name)) out.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(base, 0);
  return out;
}

function appliedMarker(root: string, ray: string, job: string): string | null {
  try {
    const t = readFileSync(path.join(root, ray, ".docs", "chatgpt", "small", `zip-${job}`, ".applied"), "utf8").trim();
    return /^[0-9a-f]{7,40}\b/i.exec(t)?.[0] ?? null;
  } catch { return null; }
}

function jobCard(root: string, ray: string, j: LedgerJob & { replyDiff?: ReplyDiff }): JobCard {
  const d = j.replyDiff;
  return { name: j.name, state: j.state, minutes: j.minutes, promptPreview: j.promptPreview, replyPreview: j.replyPreview,
    conversationUrl: j.conversationUrl && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\/c\/[\w-]+\/?$/.test(j.conversationUrl) ? j.conversationUrl : null,
    appliedCommit: j.appliedCommit ?? appliedMarker(root, ray, j.name), appliedTo: j.appliedTo, supersedeReason: j.supersedeReason,
    replyDiff: d ? { label: `+${d.plus} −${d.minus} in ${d.files} file${d.files === 1 ? "" : "s"}`, link: d.link } : null,
    startedAt: j.startedAt, finishedAt: j.finishedAt, failureReason: j.failureReason, images: jobImages(root, ray, j.name) };
}

const FAILED = new Set(["failed", "dead", "done-zip-missing"]);
const when = (j: Pick<JobCard, "state" | "startedAt" | "finishedAt">) => {
  const t = Math.max(Date.parse(j.startedAt ?? "") || 0, Date.parse(j.finishedAt ?? "") || 0);
  // A job still waiting for its first send has no times yet: it is the newest thing on the card.
  return t || (ACTIVE.has(j.state) ? Number.MAX_SAFE_INTEGER : 0);
};

/** A card's column from its linked jobs (owner 25 Nov: cards stuck in running after their job was applied
 * or failed). Any applied job -> done; else the newest job decides: active -> running, failed/dead/zip
 * missing -> planned with a failure; otherwise the checkbox. A ticked [x] stays done. */
export function deriveCard(mark: Step["mark"], jobs: Pick<JobCard, "name" | "state" | "appliedCommit" | "startedAt" | "finishedAt" | "failureReason" | "link">[]):
  { column: Column; cause: CardCause } {
  const byMark: Column = mark === "x" ? "done" : mark === "~" ? "running" : "planned";
  const isApplied = (j: (typeof jobs)[number]) => j.state === "applied" || Boolean(j.appliedCommit && j.state !== "superseded");
  const explicit = (j: (typeof jobs)[number]) => j.link === "named" || j.link === "tagged";
  const applied = jobs.find((j) => isApplied(j) && explicit(j)) ?? jobs.find(isApplied);
  if (applied) return { column: "done", cause: { kind: "applied", job: applied.name, reason: applied.appliedCommit, explicit: explicit(applied) } };
  if (mark === "x" || !jobs.length) return { column: byMark, cause: null };
  const latest = jobs.reduce((a, b) => (when(b) > when(a) ? b : a));
  if (ACTIVE.has(latest.state)) return { column: "running", cause: { kind: "active", job: latest.name, reason: null, explicit: explicit(latest) } };
  if (FAILED.has(latest.state)) return { column: "planned",
    cause: { kind: "failed", job: latest.name, reason: latest.failureReason || (latest.state === "done-zip-missing" ? "zip-missing" : latest.state) } };
  return { column: byMark, cause: null };
}

export type MarkChange = { ray: string; result: string; index: number; step: string; from: Step["mark"]; to: Step["mark"]; why: string };
/** Write the derived columns back into GOALS.md text: tick [x] where a job was applied, set [~] where a
 * job is active (unless the current [~] has its own active job), and keep one [~] per result by moving
 * it only when a linked job actually runs; the Stop hook offers the next unchecked step. Only explicit links write (the step names the job, or its prompt
 * tags this result as 'goal: N'); word-overlap matches show on the card but never write, and outcome
 * steps are never ticked by a job. Pure; returns the new text and changes. */
export function syncMarks(md: string, ray: string, results: Pick<ProjectResult, "id" | "cards">[]): { md: string; changes: MarkChange[] } {
  const changes: MarkChange[] = [];
  const marksOf = (text: string, id: string) => parseRpm(text, ray).results.find((r) => r.id === id)?.steps ?? [];
  for (const r of results) {
    const before = marksOf(md, r.id);
    if (before.length !== r.cards.length || before.some((s, i) => s.raw !== r.cards[i]!.raw)) continue; // file moved on: next tick
    const why = new Map<number, string>();
    for (const c of r.cards) if (c.cause?.kind === "applied" && c.cause.explicit && !c.shared && !outcomeStep(c.raw) && before[c.index]!.mark !== "x") {
      md = setStepMark(md, r.id, c.index, "x");
      if (!before[c.index]!.proof && c.cause.reason && /^[0-9a-f]{7,40}$/i.test(c.cause.reason))
        md = setStepProof(md, r.id, c.index, `[commit ${c.cause.reason}]`);
      why.set(c.index, `${c.cause.job} applied ${c.cause.reason ?? ""}`.trim());
    }
    let now = marksOf(md, r.id);
    const tilde = now.findIndex((s) => s.mark === "~");
    const active = r.cards.filter((c) => c.cause?.kind === "active" && c.cause.explicit && now[c.index]!.mark === " ");
    if (active.length && (tilde < 0 || (!r.cards[tilde]?.pickedUpAt && r.cards[tilde]?.cause?.kind !== "active"))) {
      const c = active[0]!;
      md = setStepMark(md, r.id, c.index, "~"); why.set(c.index, `${c.cause!.job} ${r.cards[c.index]!.jobs.find((j) => j.name === c.cause!.job)?.state ?? "active"}`);
      if (tilde >= 0) why.set(tilde, `[~] moved to step ${c.index + 1}`);
    }
    now = marksOf(md, r.id);
    for (const s of now) if (s.mark !== before[s.index]!.mark)
      changes.push({ ray, result: r.id, index: s.index, step: s.text, from: before[s.index]!.mark, to: s.mark, why: why.get(s.index) ?? "" });
  }
  return { md, changes };
}

/** One write-back pass for a ray: derive its cards, rewrite GOALS.md only when a mark changes. */
export function syncProject(root: string, ray: string, jobs: LedgerJob[]): MarkChange[] {
  const detail = projectDetail(root, ray, [], undefined, jobs, null, false);
  const file = path.join(root, ray, "GOALS.md");
  if (!isFile(file)) return [];
  let changes: MarkChange[] = [];
  const { changes: planned } = syncMarks(readFileSync(file, "utf8"), ray, detail.results);
  if (!planned.length) return [];
  writeGoals(root, ray, (md) => { const out = syncMarks(md, ray, detail.results); changes = out.changes; return out.md; });
  return changes;
}

export function projectDetail(root: string, ray: string, running: string[], session: SessionInfo | undefined,
  jobs: LedgerJob[], ledgerError: string | null, editEnabled: boolean, fleetLimit: number | null = null, effectiveFloor: number | null = null, decisions: InboxItem[] = [], privateEnabled = false): ProjectDetail {
  const rpm = readRpm(root, ray);
  const preview = privateEnabled ? pickupPreview(path.join(root, ray), { root }) : {picked:[],nextCard:null,pickupStatus:null};
  const card = makeRayCard(root, ray, jobs, ledgerError);
  const own = jobs.filter(j => ledgerRay(j)?.toLowerCase() === ray.toLowerCase());
  const floor = privateEnabled ? readFloor(root, ray) ?? effectiveFloor : null;
  const activeJobs = own.filter(j => ["sending", "running", "waiting"].includes(j.state)).length;
  const queuedJobs = own.filter(j => j.state === "queued").length;
  const results: ProjectResult[] = rpm.results.map((r) => ({ ...r,
    cards: r.steps.map((s): StepCard => ({ ...s, column: s.mark === "x" ? "done" : s.mark === "~" ? "running" : "planned", cause: null, jobs: [] })) }));
  // Each job goes to one card at most: its best-scoring step. A job its result already claims needs one
  // shared word; a job no result claims needs two distinctive name words (or one plus its request).
  for (const group of card.groups) for (const j of group.jobs) {
    let best: StepCard | null = null, score = 0;
    for (const r of results) {
      if (group.goalId && r.id !== group.goalId) continue;
      for (const c of r.cards) { const v = stepScore(c, j, ray); if (v > score) { score = v; best = c; } }
    }
    if (best && score >= (group.goalId ? 1 : 6)) {
      const owner = results.find((r) => r.cards.includes(best!))!;
      best.jobs.push({ ...jobCard(root, ray, j), ...queueInfo(j, own, floor, jobs, fleetLimit, {root, ray}), link: score >= 100 ? "named" : taggedResult(j.promptPreview) === owner.id ? "tagged" : "words" });
    }
  }
  for (const r of results) for (const c of r.cards) {
    Object.assign(c, deriveCard(c.mark, c.jobs));
    // An applied handoff proves the agent part, not completion of the owner part.
    if (c.shared && c.mark !== "x" && c.column === "done") c.column = c.mark === "~" ? "running" : "planned";
    c.proofLinks = proofLinks(ray, c.proof, root);
    c.modalTabs = cardTabs(ray, c.proofs, root);
    if (c.decision) c.decisionItem = decisions.find(d => d.ray === ray && d.id === c.decision);
    c.missingProof = c.mark === "x" && !c.proof;
    const picked = preview.picked.find(p => p.card.result === r.id && p.card.index === c.index && p.card.raw === c.raw);
    if (picked) c.pickedUpAt = picked.at;
  }
  const rel = (...p: string[]) => [ray, ...p].join("/");
  const doc = (label: string, r: string) => ({ label, href: `/board/doc?path=${encodeURIComponent(r)}` });
  const docs: { label: string; href: string }[] = [];
  if (isFile(path.join(root, ray, "README.md"))) docs.push(doc("README", rel("README.md")));
  if (isFile(path.join(root, ray, "GOALS.md"))) docs.push(doc("GOALS", rel("GOALS.md")));
  const resume = newestResume(ray, root);
  if (resume) docs.push(doc("Resume", rel("plans", path.basename(resume))));
  const listed = listDocs(root, ray);
  if (listed.decisions.length) docs.push({ label: `Decisions (${listed.decisions.length})`, href: `/board/docs?ray=${encodeURIComponent(ray)}` });
  if (listed.goals.length + listed.changes.length) docs.push({ label: "Docs", href: `/board/docs?ray=${encodeURIComponent(ray)}` });
  for (const b of listed.books) docs.push(doc("Books: " + b.rel.split("/").pop()!, b.rel));
  const live = running.some((r) => r.toLowerCase() === ray.toLowerCase());
  // Owner 26 Nov: a Handoffs tab "so we can figure out which one missed or failed".
  const handoffs = own.map(j => ({ name: j.name, state: j.state, minutes: j.minutes ?? null, startedAt: j.startedAt ?? null,
      finishedAt: j.finishedAt ?? null, failureReason: j.failureReason ?? null,
      applied: j.appliedCommit ?? appliedMarker(root, ray, j.name) ?? null, supersede: j.supersedeReason ?? null }))
    .sort((x, y) => String(y.finishedAt ?? y.startedAt ?? "").localeCompare(String(x.finishedAt ?? x.startedAt ?? ""))).slice(0, 150);
  return { ...rpm, ray, handoffs, running: live, session: session ?? { session: "stopped", ago: null }, results, docs, docTree: projectDocTree(root, ray), library: projectLibrary(root, ray), decisionInbox: decisions.filter(d => d.ray === ray), editEnabled, ledgerError, floor, activeJobs, queuedJobs, nextCard: preview.nextCard, pickupStatus: preview.pickupStatus };
}

/** Full request and reply for the card panel (bounded). */
export function jobTexts(root: string, ray: string, job: LedgerJob) {
  const x = expandHandoff(root, ray, job);
  return { prompt: x.prompt, reply: x.reply };
}

/** Create <project root>/<name> with README.md and GOALS.md; refuses an existing folder. */
export function createProject(root: string, name: string, files: { goals: string; readme: string }): string {
  if (!validRayName(name)) throw new Error("invalid name");
  const dir = path.join(root, name);
  if (existsSync(dir)) throw new Error("exists");
  const realRoot = realpathSync(root);
  mkdirSync(dir);
  if (path.relative(realRoot, realpathSync(dir)).includes("..")) throw new Error("unsafe");
  writeFileSync(path.join(dir, "GOALS.md"), files.goals, { flag: "wx" });
  writeFileSync(path.join(dir, "README.md"), files.readme, { flag: "wx" });
  return dir;
}

/** Atomic GOALS.md rewrite under the rays root (last write wins). */
export function writeGoals(root: string, ray: string, edit: (md: string) => string): void {
  if (!validRayName(ray)) throw new Error("invalid ray");
  const file = path.join(root, ray, "GOALS.md");
  const realRoot = realpathSync(root), target = realpathSync(file);
  const rel = path.relative(realRoot, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !statSync(target).isFile()) throw new Error("unsafe GOALS.md path");
  const updated = edit(readFileSync(target, "utf8"));
  const temp = target + "." + process.pid + ".tmp";
  try { writeFileSync(temp, updated, { flag: "wx" }); renameSync(temp, target); }
  finally { rmSync(temp, { force: true }); }
}

export const validName = (name: string) => /^[a-z][a-z0-9-]{0,63}$/.test(name) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9]|tools|templates|docs|plans|decisions|insights|handoffs)$/.test(name);
export function projectNames(root: string): string[] {
  try { return readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory() && validName(e.name) && safeGoals(root,e.name)).map(e=>e.name).sort(); } catch { return []; }
}
function safeGoals(root:string, name:string): string|null {
  if (!validName(name)) return null;
  const p=safeUnder(root,`${name}/GOALS.md`);
  try { return p && !lstatSync(path.join(root,name)).isSymbolicLink() && !lstatSync(path.join(root,name,"GOALS.md")).isSymbolicLink() && lstatSync(p).isFile() && statSync(p).size < 4*1024*1024 ? p : null; } catch { return null; }
}
