/** Per-ray read-only endpoint and safe expansion of a ledger handoff's original files. */
import { replyDiffs } from "./reply-diffs.ts";
import { renderDiffPage } from "./diff-page.ts";
import { applyCommitEvidence } from "./commit-match.ts";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { readRayGoals, ledgerRay, groupHandoffs, type LedgerJob } from "./goals.ts";
import { readLedger } from "./ledger-reader.ts";
import { loadConfig } from "./config.ts";
import type { CheckService } from "./checks.ts";
const valid = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s);
const noStore = { "cache-control": "no-store" };

function safeJobText(base: string, target: string | null, fallback: string | null): string | null {
  if (!target) return fallback;
  try {
    const resolved = realpathSync(target);
    const parent = realpathSync(base);
    const rel = path.relative(parent, resolved);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return fallback;
    const st = statSync(resolved);
    if (!st.isFile()) return fallback;
    if (st.size > 2 * 1024 * 1024) return `${fallback ?? ""}\n[File exceeds 2 MiB; preview only]`;
    return readFileSync(resolved, "utf8");
  } catch { return fallback; }
}

export function expandHandoff(root: string, ray: string, job: LedgerJob) {
  const base = path.join(root, ray, ".docs", "chatgpt", "small");
  // The bridge's --summary carries previews only, no paths: find the files by the queue layout.
  const exists = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
  const promptPath = job.promptPath ?? (valid(job.name)
    ? ["", "running", "done", "failed"].map((f) => path.join(base, "queue", f, `${job.name}.txt`)).find(exists) ?? null
    : null);
  const replyPath = job.replyPath ?? (valid(job.name) ? path.join(base, `reply-${job.name}.md`) : null);
  return {
    ...job,
    prompt: safeJobText(path.join(base, "queue"), promptPath, job.promptPreview),
    reply: safeJobText(base, replyPath, job.replyPreview),
  };
}

export type CardSnapshot = { ray: string; name: string; goals: ReturnType<typeof readRayGoals>["goals"];
  groups: ReturnType<typeof groupHandoffs>; ledgerError: string | null };
export function makeRayCard(root: string, ray: string, jobs: LedgerJob[], error: string | null = null): CardSnapshot {
  const goals = readRayGoals(root, ray);
  const own = jobs.filter((j) => ledgerRay(j)?.toLowerCase() === ray.toLowerCase());
  const diffs = replyDiffs(root);
  const withDiffs = applyCommitEvidence(root, ray, own).map((j) => {
    const d = j.state === "applied" ? undefined : diffs.get(`${ray.toLowerCase()}/${j.name}`);
    return d ? { ...j, replyDiff: d } : j;
  });
  return { ...goals, groups: groupHandoffs(goals.goals, withDiffs), ledgerError: error };
}

/** Returns null for unrelated paths, and a Response for every /api/board/rays and /board/diff route. */
export async function handleRayGoalsApi(
  req: Request, root: string, running: string[], liveCard?: (ray: string) => Promise<object>, checks?: CheckService,
): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;
  const route = /^\/api\/board\/rays\/([^/]+)(?:\/handoffs\/([^/]+))?$/.exec(p);
  const diff = p === "/board/diff";
  if (!route && !diff) return null;
  if (req.method !== "GET") return Response.json({ error: "GET required" }, { status: 405, headers: { ...noStore, allow: "GET" } });
  let ray: string, jobName: string | null;
  try {
    ray = diff ? url.searchParams.get("ray") ?? "" : decodeURIComponent(route![1]!);
    jobName = diff ? url.searchParams.get("job") ?? "" : route?.[2] ? decodeURIComponent(route[2]) : null;
  } catch { return Response.json({ error: "invalid encoding" }, { status: 400, headers: noStore }); }
  if (diff && !jobName) return Response.json({ error: "job required" }, { status: 400, headers: noStore });
  if (!valid(ray) || (jobName !== null && !valid(jobName))) return Response.json({ error: "invalid ray or job" }, { status: 400 });
  if (!running.includes(ray)) return Response.json({ error: "ray not running" }, { status: 404 });
  const config = loadConfig();
  const ledger = config.integrations.ledger.enabled || process.env.RAY_BOARD_LEDGER_FIXTURE
    ? await readLedger(root, Date.now(), config.integrations.ledger.path)
    : { jobs: [], error: null };
  const card = makeRayCard(root, ray, ledger.jobs, ledger.error);
  if (checks) card.goals = checks.decorate(card).goals;
  if (!jobName) return Response.json({ ...(liveCard ? await liveCard(ray) : {}), ...card }, { headers: noStore });
  const job = card.groups.flatMap((g) => g.jobs).find((j) => j.name === jobName);
  if (!job) return Response.json({ error: "handoff not found" }, { status: 404, headers: noStore });
  if (diff) {
    if (job.state !== "applied" || !job.appliedCommit) return new Response("Not applied", { status: 404, headers: noStore });
    // One readable renderer for every diff: the commit view (src/diff-view.ts).
    const u = new URL(`http://board/board/diff?hash=${encodeURIComponent(job.appliedCommit)}&ray=${encodeURIComponent(ray)}`);
    return renderDiffPage(u, root);
  }
  return Response.json(expandHandoff(root, ray, job), { headers: noStore });
}
