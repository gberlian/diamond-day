/** RPM GOALS.md (owner 24 Nov): a header (Ultimate Vision, Ultimate Purpose, Roles, Week of) and
 * numbered results, each with Result, Purpose and a Plan of '  - [x]/[~]/[ ]' steps. This module
 * parses that shape and makes small, scoped text edits to it; everything else in the file is kept. */
import { parseGoals } from "./goals.ts";
import { parseAssignment } from "./pickup.ts";

export type Mark = " " | "x" | "~";
export type Step = { index: number; mark: Mark; must: boolean; text: string; who: string | null; dur: string | null; owners: string[]; duration: string | null; shared: boolean; raw: string; proof?: string; proofs: string[]; decision?: string };
export type RpmResult = { id: string; title: string; result: string; purpose: string; now: string; steps: Step[] };
export type Rpm = { name: string; vision: string; purpose: string; roles: string; week: string; results: RpmResult[] };
export type HeaderKey = "vision" | "purpose" | "roles";
export type ResultKey = "title" | "result" | "purpose" | "now";

const HEADER_LABEL: Record<HeaderKey, RegExp> = {
  vision: /^\s*\*\*(?:Ultimate\s+)?Vision:\*\*\s*(.*)$/i,
  purpose: /^\s*\*\*(?:Ultimate\s+)?Purpose:\*\*\s*(.*)$/i,
  roles: /^\s*\*\*Roles:\*\*\s*(.*)$/i,
};
const HEADER_WRITE: Record<HeaderKey, string> = { vision: "**Ultimate Vision:**", purpose: "**Ultimate Purpose:**", roles: "**Roles:**" };
const STEP = /^(\s+[-*+]\s+)\[( |x|X|~)\]\s?(.*)$/;
const NUMBERED = /^##\s+(\d+)\s*[.)]\s*(.*?)\s*$/;
const oneLine = (s: string) => String(s ?? "").replace(/\r/g, "").replace(/\s*\n\s*/g, " ").replace(/\0/g, "").trim();

/** Keep the original scalar who/dur/proof fields for existing consumers; expose all assignments and proofs too. */
export function parseStep(raw: string, index: number, mark: Mark): Step {
  let text = raw.trim();
  const must = /^\*/.test(text);
  if (must) text = text.replace(/^\*\s*/, "");
  const assignment = parseAssignment(text);
  const times = assignment.durations.flatMap(d => [...d.matchAll(/\b(\d+(?:\.\d+)?\s*(?:min|m|h|d|w))\b|\bdone\b/gi)].map(m => m[0].replace(/\s+/g, "")));
  return { index, mark, must, text: assignment.text, who: assignment.owners[0] ?? null,
    dur: times.length ? [...new Set(times)].join("+") : null, owners: assignment.owners,
    duration: assignment.durations.join(" + ") || null, shared: assignment.shared, raw: raw.trim(), proofs: [] };
}

type Lines = { lines: string[]; eol: string };
const split = (md: string): Lines => ({ lines: md.split(/\r?\n/), eol: md.includes("\r\n") ? "\r\n" : "\n" });
const join = (l: Lines) => l.lines.join(l.eol);

/** Line ranges [start, end) of each numbered result; a section ends at the next # or ## heading. */
function sections(lines: string[]): { id: string; start: number; end: number }[] {
  const out: { id: string; start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = NUMBERED.exec(lines[i]!);
    if (h) { if (out.length && out.at(-1)!.end < 0) out.at(-1)!.end = i; out.push({ id: h[1]!, start: i, end: -1 }); continue; }
    if (/^#{1,2}\s/.test(lines[i]!) && out.length && out.at(-1)!.end < 0) out.at(-1)!.end = i;
  }
  if (out.length && out.at(-1)!.end < 0) out.at(-1)!.end = lines.length;
  return out;
}
const metadata = /^\s+(proof|decision):\s*(\S.*)$/i;
const decisionId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
function metadataEnd(lines: string[], line: number): number {
  let end = line + 1;
  while (metadata.test(lines[end] ?? "")) end++;
  return end;
}
function stepLines(lines: string[], s: { start: number; end: number }): number[] {
  const out: number[] = [];
  for (let i = s.start + 1; i < s.end; i++) if (STEP.test(lines[i]!)) out.push(i);
  return out;
}

export function parseRpm(md: string, ray: string): Rpm {
  const goals = parseGoals(md, ray);
  const { lines } = split(md);
  const first = lines.findIndex((l) => /^##\s/.test(l));
  const head = first < 0 ? lines : lines.slice(0, first);
  const header = (k: HeaderKey) => oneLine(head.map((l) => HEADER_LABEL[k].exec(l)?.[1]).find((x) => x != null) ?? "");
  const week = oneLine(head.map((l) => /^\s*\*\*Week of ([^*]+):\*\*\s*(.*)$/i.exec(l)).filter(Boolean).map((m) => `${m![1]}: ${m![2]}`)[0] ?? "");
  const secs = sections(lines);
  const results = goals.goals.map((g) => {
    const s = secs.find((x) => x.id === g.id);
    const steps = s ? stepLines(lines, s).map((i, n) => {
      const m = STEP.exec(lines[i]!)!;
      const step = parseStep(m[3]!, n, (m[2]!.toLowerCase() as Mark));
      for (let j = i + 1; j < metadataEnd(lines, i); j++) {
        const [, key, value] = metadata.exec(lines[j]!)!;
        if (key!.toLowerCase() === "proof") {
          step.proofs.push(value!.trim());
          step.proof = step.proofs.join("\n");
        }
        if (key!.toLowerCase() === "decision" && decisionId.test(value!.trim())) step.decision = value!.trim();
      }
      return step;
    }) : [];
    return { id: g.id, title: g.title, result: oneLine(g.result ?? g.want ?? ""), purpose: oneLine(g.purpose ?? ""), now: oneLine(g.now ?? ""), steps };
  });
  return { name: goals.name, vision: header("vision"), purpose: header("purpose"), roles: header("roles"), week, results };
}

function findSection(l: Lines, id: string) {
  const s = sections(l.lines).find((x) => x.id === id);
  if (!s) throw new EditError("result not found", 404);
  return s;
}
export class EditError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

export function setHeader(md: string, key: HeaderKey, value: string): string {
  const l = split(md);
  const first = l.lines.findIndex((x) => /^##\s/.test(x));
  const stop = first < 0 ? l.lines.length : first;
  const at = l.lines.slice(0, stop).findIndex((x) => HEADER_LABEL[key].test(x));
  const line = `${HEADER_WRITE[key]} ${oneLine(value)}`;
  if (at >= 0) { l.lines[at] = line; return join(l); }
  // Missing: after the other header labels, else after the # title.
  let insert = 0;
  for (let i = 0; i < stop; i++) if (/^#\s/.test(l.lines[i]!) || Object.values(HEADER_LABEL).some((r) => r.test(l.lines[i]!))) insert = i + 1;
  l.lines.splice(insert, 0, line);
  return join(l);
}

/** Replace one labelled field ('- **Result:** ...') with its indented continuation lines. */
function fieldRange(lines: string[], s: { start: number; end: number }, label: string): [number, number] | null {
  const re = new RegExp(`^\\s*(?:[-*+]\\s+)?\\*\\*${label}(?:\\s*\\([^)]*\\))?:\\*\\*`, "i");
  for (let i = s.start + 1; i < s.end; i++) {
    if (!re.test(lines[i]!)) continue;
    let j = i + 1;
    // Continuation: indented, non-step lines (a Plan's steps belong to Plan, which we never rewrite).
    while (j < s.end && /^\s+\S/.test(lines[j]!) && !STEP.test(lines[j]!) && !/^\s+check:/i.test(lines[j]!) && label !== "Plan") j++;
    return [i, j];
  }
  return null;
}
export function setResultField(md: string, id: string, key: ResultKey, value: string): string {
  const l = split(md);
  const s = findSection(l, id);
  const v = oneLine(value);
  if (key === "title") {
    if (!v) throw new EditError("title required");
    l.lines[s.start] = `## ${id}. ${v}`;
    return join(l);
  }
  const label = key[0]!.toUpperCase() + key.slice(1);
  const range = fieldRange(l.lines, s, label);
  const line = `- **${label}:** ${v}`;
  if (range) { l.lines.splice(range[0], range[1] - range[0], line); return join(l); }
  // Missing field: Result right under the heading, Purpose after Result, Now at the end of the section.
  let at = s.start + 1;
  if (key === "purpose") { const r = fieldRange(l.lines, s, "Result"); if (r) at = r[1]; }
  if (key === "now") { at = s.end; while (at > s.start + 1 && !l.lines[at - 1]!.trim()) at--; }
  l.lines.splice(at, 0, line);
  return join(l);
}

function stepAt(l: Lines, id: string, index: number) {
  const s = findSection(l, id);
  const all = stepLines(l.lines, s);
  const line = all[index];
  if (line == null) throw new EditError("step not found", 404);
  return { s, all, line };
}
/** New raw text after the checkbox; empty text deletes the step. */
export function setStepText(md: string, id: string, index: number, raw: string): string {
  const l = split(md);
  const { line } = stepAt(l, id, index);
  const v = oneLine(raw);
  if (!v) { l.lines.splice(line, metadataEnd(l.lines, line) - line); return join(l); }
  const m = STEP.exec(l.lines[line]!)!;
  l.lines[line] = `${m[1]}[${m[2]}] ${v}`;
  return join(l);
}
/** Move a card between columns; the plan keeps exactly one [~], so the old one returns to [ ]. */
export function setStepMark(md: string, id: string, index: number, mark: Mark): string {
  if (![" ", "x", "~"].includes(mark)) throw new EditError("bad mark");
  const l = split(md);
  const { all, line } = stepAt(l, id, index);
  if (mark === "~") for (const i of all) {
    const m = STEP.exec(l.lines[i]!)!;
    if (i !== line && m[2] === "~") l.lines[i] = `${m[1]}[ ] ${m[3]}`;
  }
  const m = STEP.exec(l.lines[line]!)!;
  l.lines[line] = `${m[1]}[${mark}] ${m[3]}`;
  return join(l);
}
export function setStepProof(md: string, id: string, index: number, proof: string): string {
  const l = split(md);
  const { line } = stepAt(l, id, index);
  const value = "    proof: " + oneLine(proof);
  const at = l.lines.slice(line + 1, metadataEnd(l.lines, line)).findIndex(x => /^\s+proof:/i.test(x));
  if (at >= 0) l.lines[line + 1 + at] = value;
  else l.lines.splice(line + 1, 0, value);
  return join(l);
}
/** Match a unique card by its visible text prefix; never silently replace a link. */
export function linkStepDecision(md: string, prefix: string, decision: string): string {
  if (!prefix.trim() || !decisionId.test(decision)) throw new EditError("invalid card prefix or decision id");
  const matches = parseRpm(md, "").results.flatMap(r => r.steps.filter(c => c.text.startsWith(prefix.trim())).map(c => ({ r, c })));
  if (matches.length !== 1) throw new EditError(matches.length ? "ambiguous card prefix" : "card not found");
  const { r, c } = matches[0]!;
  const l = split(md), { line } = stepAt(l, r.id, c.index);
  if (l.lines.slice(line + 1, metadataEnd(l.lines, line)).some(x => /^\s+decision:/i.test(x)))
    throw new EditError("card already has a decision");
  l.lines.splice(metadataEnd(l.lines, line), 0, "    decision: " + decision);
  return join(l);
}
export function addStep(md: string, id: string, raw: string, mark: Mark = " "): string {
  const v = oneLine(raw);
  if (!v) throw new EditError("step text required");
  const l = split(md);
  const s = findSection(l, id);
  const all = stepLines(l.lines, s);
  const indent = all.length ? STEP.exec(l.lines[all.at(-1)!]!)![1]! : "  - ";
  const line = `${indent}[${mark}] ${v}`;
  if (all.length) { const at = metadataEnd(l.lines, all.at(-1)!); l.lines.splice(at, 0, line); return join(l); }
  const plan = fieldRange(l.lines, s, "Plan");
  if (plan) { l.lines.splice(plan[0] + 1, 0, line); return join(l); }
  const after = fieldRange(l.lines, s, "Purpose") ?? fieldRange(l.lines, s, "Result");
  l.lines.splice(after ? after[1] : s.start + 1, 0, "- **Plan:**", line);
  return join(l);
}
export function addResult(md: string, title: string): string {
  const v = oneLine(title);
  if (!v) throw new EditError("title required");
  const l = split(md);
  const secs = sections(l.lines);
  const n = secs.reduce((a, s) => Math.max(a, Number(s.id)), 0) + 1;
  const block = [`## ${n}. ${v}`, "- **Result:** ", "- **Purpose:** ", "- **Plan:**", "  - [~] First step (session, 1h)", "- **Now:** ", ""];
  let at = secs.length ? secs.at(-1)!.end : l.lines.length;
  while (at > 0 && !l.lines[at - 1]!.trim()) at--;
  l.lines.splice(at, 0, "", ...block);
  return join(l).replace(/\n{3,}/g, "\n\n");
}
/** Reorder results by id and renumber them 1..N; text between results moves with the result above it. */
export function reorderResults(md: string, ids: string[]): string {
  const l = split(md);
  const secs = sections(l.lines);
  if (!secs.length) throw new EditError("no results");
  if (ids.length !== secs.length || new Set(ids).size !== ids.length || !ids.every((id) => secs.some((s) => s.id === id)))
    throw new EditError("ids must list every result once");
  // Blocks: each result runs to the next result's heading (the last one to its own end).
  const blocks = secs.map((s, i) => ({ id: s.id, lines: l.lines.slice(s.start, i + 1 < secs.length ? secs[i + 1]!.start : s.end) }));
  for (const b of blocks) { while (b.lines.length && !b.lines.at(-1)!.trim()) b.lines.pop(); b.lines.push(""); }
  const ordered = ids.map((id, n) => {
    const b = blocks.find((x) => x.id === id)!;
    const lines = [...b.lines];
    lines[0] = lines[0]!.replace(NUMBERED, (_m, _id, title) => `## ${n + 1}. ${title}`);
    return lines;
  }).flat();
  const before = l.lines.slice(0, secs[0]!.start), after = l.lines.slice(secs.at(-1)!.end);
  l.lines = [...before, ...ordered, ...after];
  return join(l).replace(/(\r?\n){3,}$/, l.eol);
}

/** README and GOALS for a new ray: the RPM header and one empty result. */
export function newProjectFiles(name: string, vision: string, purpose: string, roles: string, today = new Date()) {
  const title = oneLine(name);
  const week = today.toISOString().slice(0, 10);
  const goals = [`# ${title}`, "", `**Ultimate Vision:** ${oneLine(vision)}`, `**Ultimate Purpose:** ${oneLine(purpose)}`,
    `**Roles:** ${oneLine(roles)}`, `**Week of ${week}:** done: ; crossed off: ; carried over: `, "",
    "Plan legend: `*` marks a must (without it the result fails); each step ends with who does it (session, sub-agent, handoff, owner) and roughly how long.",
    "", "## 1. First result", "- **Result:** ", "- **Purpose:** ", "- **Plan:**", "  - [~] * First step (session, 1h)",
    "- **Check:** ", "  check: manual", "- **Now:** just started.", ""].join("\n");
  const readme = [`# ${title}`, "", oneLine(vision), "", "## Repos", "", "| Repo | What |", "|---|---|", "", "## Where things stand", "", "Just started.", ""].join("\n");
  return { goals, readme };
}
