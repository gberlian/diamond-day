/**
 * Compact /board handoff results. Physical queue membership and failure reasons
 * come from fsreader; keeperEvents supplies launch and terminal timestamps.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { keeperEvents } from "./domain/handoffs.ts";
import { queueDir, readJobsForRay, type DomainContext } from "./domain/fsreader.ts";
import type { Job } from "./domain/model.ts";

export type HandoffResult = {
  name: string;
  state: "running" | "done" | "failed";
  minutesRunning: number | null;
  estimatedRunning: boolean;
  finishedAt: number | null;
  applied: boolean | null;
  overdue: boolean;
  reason: string | null;
  reply: boolean;
  zip: boolean;
};

const stat = (file: string) => {
  try { return statSync(file); } catch { return null; }
};
const isFile = (file: string) => stat(file)?.isFile() ?? false;
const isDir = (file: string) => stat(file)?.isDirectory() ?? false;

/** The newest *-resume.md, by mtime (filename breaks ties), not an older plan. */
function latestResume(root: string, ray: string): string {
  const dir = path.join(root, ray, "plans");
  let best: { file: string; time: number } | null = null;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith("-resume.md")) continue;
      const file = path.join(dir, name);
      const info = stat(file);
      if (!info?.isFile()) continue;
      if (!best || info.mtimeMs > best.time || (info.mtimeMs === best.time && file > best.file))
        best = { file, time: info.mtimeMs };
    }
  } catch {}
  if (!best) return "";
  try { return readFileSync(best.file, "utf8"); } catch { return ""; }
}

function noteApplies(note: string, name: string): boolean {
  // A job must be named on the same line as an affirmative applied/merged mark.
  // Name boundaries prevent job-12 from matching job-123.
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(^|[^a-zA-Z0-9._-])${quoted}(?![a-zA-Z0-9._-])`, "i");
  return note.split(/\r?\n/).some((line) =>
    named.test(line) && /\b(applied|merged)\b/i.test(line) &&
    !/\b(?:not|never)\s+(?:yet\s+)?(?:applied|merged)\b/i.test(line));
}

function markerApplies(base: string, name: string): boolean {
  const file = path.join(base, `zip-${name}`, ".applied");
  if (!isFile(file)) return false;
  try { return Boolean(readFileSync(file, "utf8").split(/\r?\n/, 1)[0]?.trim()); }
  catch { return false; }
}

export function handoffResults(ctx: DomainContext, ray: string, jobs = readJobsForRay(ctx, ray)): HandoffResult[] {
  const base = queueDir(ctx.root, ray);
  const note = latestResume(ctx.root, ray);
  const latest = new Map<string, { launched: number | null; terminal: number | null; kind: string | null; reason: string | null }>();
  for (const event of keeperEvents(ctx, ray)) {
    if (!event.name) continue;
    const old = latest.get(event.name) ?? { launched: null, terminal: null, kind: null, reason: null };
    if (event.kind === "launched") {
      old.launched = event.at;
      old.terminal = null;
      old.kind = "running";
      old.reason = null;
    } else if (event.kind === "done" || event.kind === "failed") {
      old.terminal = event.at;
      old.kind = event.kind;
      old.reason = event.reason ?? null;
    }
    latest.set(event.name, old);
  }
  const entries = jobs.filter((j) => ["running", "dead", "done", "failed"].includes(j.state))
    .map((j) => {
      const state: HandoffResult["state"] = j.state === "done" ? "done" :
        j.state === "failed" ? "failed" : "running";
      const event = latest.get(j.name);
      const launched = event?.launched ?? (j.ageMs === null ? null : ctx.now - j.ageMs);
      const estimatedRunning = event?.launched == null;
      const finishedAt = event?.kind === state && state !== "running" ? event.terminal : null;
      const zip = isDir(path.join(base, `zip-${j.name}`));
      const applied = state === "running" ? null : (markerApplies(base, j.name) || noteApplies(note, j.name));
      const sortAt = finishedAt ?? stat(j.promptPath)?.mtimeMs ?? 0;
      const result: HandoffResult = {
        name: j.name, state,
        minutesRunning: state === "running" && launched !== null
          ? Math.max(0, Math.floor((ctx.now - launched) / 60_000)) : null,
        estimatedRunning: state === "running" && estimatedRunning,
        finishedAt, applied,
        overdue: state === "done" && !applied && finishedAt !== null && ctx.now - finishedAt >= 6 * 3_600_000,
        reason: state === "failed" ? (j.failureReason ?? event?.reason ?? null) : null,
        reply: Boolean(j.replyPath && isFile(j.replyPath)),
        zip,
      };
      return { result, sortAt };
    });

  const recent = (state: HandoffResult["state"], count: number) => entries
    .filter((e) => e.result.state === state)
    .sort((a, b) => b.sortAt - a.sortAt || a.result.name.localeCompare(b.result.name))
    .slice(0, count).map((e) => e.result);
  return [...recent("running", Infinity), ...recent("done", 3), ...recent("failed", 3)];
}
