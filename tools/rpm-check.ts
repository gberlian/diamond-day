#!/usr/bin/env bun
/**
 * rpm-check: score a ray's GOALS.md against the testable rules of the RPM method
 * (docs/goals/rpm/METHOD.md, section 6). No dependencies.
 *
 *   bun tools/rpm-check.ts <ray folder | GOALS.md> [--json] [--today YYYY-MM-DD]
 *
 * Exit 0 when every HARD rule passes (soft rules only lower the score), 1 otherwise, 2 on usage error.
 *
 * Conventions this checker expects (all stay parseable by ray-board's goals.ts and page.html):
 * - Category header before the first `## N.` goal, one line each:
 *     **Ultimate Vision:** ...   **Ultimate Purpose:** ...   **Roles:** A, B, C
 * - Weekly review, a dated line in the header (or a `## Week of` section after the goals):
 *     **Week of 2026-11-24:** done: ...; crossed off: ...; carried over: ...
 * - Must (METHOD: "asterisk any actions that are 'musts'"): a `*` right after the checkbox:
 *     - [ ] * Owner approves the series (owner, 20m)
 * - Leverage and duration (METHOD's L and D columns): a trailing parenthesis on the step,
 *   naming session, sub-agent, handoff or owner, and a duration like 20m, 3h, 1d, 1w.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RuleResult = {
  rule: string;        // short id, e.g. "R6-plan-size"
  title: string;
  hard: boolean;
  goal: string | null; // goal number, null for file-level rules
  pass: boolean;
  line: number | null; // 1-based line in GOALS.md
  detail: string;
};
export type Report = {
  file: string;
  goals: number;
  passed: number;
  total: number;
  pct: number;
  hardFailures: number;
  ok: boolean;
  results: RuleResult[];
};

type Step = { line: number; state: " " | "x" | "~"; text: string; must: boolean; who: string | null; minutes: number | null };
type Field = { value: string; line: number };
type GoalBlock = {
  id: string; title: string; line: number;
  fields: Partial<Record<"result" | "purpose" | "plan" | "check" | "now", Field>>;
  order: string[];
  checkDecls: { text: string; line: number }[];
  steps: Step[];
};

const LABEL = /^\s*(?:[-*+]\s+)?(?:\*\*)?(Want|Check|Research|Now|Next|Result|Purpose|Plan)(?:\s*\(([^)]*)\))?(?:\*\*)?\s*(?::|\s+[-–—])\s*(.*)$/i;
const STEP = /^\s*[-*+]\s*\[( |x|X|~)\]\s*(.*)$/;
const CHECK_DECL = /^\s+(?:[-*]\s+)?check:\s+\S/i;
const CHECK_GRAMMAR = /^check:\s+(?:run\s+\S+.*|http\s+GET\s+https?:\/\/\S+\s+[1-5]\d\d(?:\s+timeout=\d+s)?|(?:file|file-age)\s+\S+\s+younger\s+\d+[mhd](?:\s+timeout=\d+s)?|manual)\s*$/i;
const WHO = /\b(session|sub-?agent|agent|handoff|owner)\b/i;
const DURATION = /(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|w)\b/gi;

function minutesOf(text: string): number | null {
  let total = 0, found = false;
  for (const m of text.matchAll(DURATION)) {
    found = true;
    const n = Number(m[1]); const u = m[2]!.toLowerCase();
    total += u.startsWith("m") ? n : u.startsWith("h") ? n * 60 : u === "d" ? n * 8 * 60 : n * 5 * 8 * 60;
  }
  return found ? total : null;
}

function parseStep(raw: string, line: number): Step | null {
  const m = STEP.exec(raw);
  if (!m) return null;
  let text = m[2]!.trim();
  const must = /^\*\s+/.test(text);
  if (must) text = text.replace(/^\*\s+/, "");
  const paren = /\(([^()]*)\)\s*\.?\s*$/.exec(text)?.[1] ?? "";
  const who = WHO.exec(paren)?.[1]?.toLowerCase() ?? null;
  return { line, state: m[1]!.toLowerCase() as Step["state"], text, must, who, minutes: who || paren ? minutesOf(paren) : null };
}

export function parse(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const header: string[] = [];
  const goals: GoalBlock[] = [];
  let goal: GoalBlock | null = null;
  let field: string | null = null;
  lines.forEach((raw, i) => {
    const n = i + 1;
    const heading = /^\s*##\s+(\d+)\s*[.)]\s*(.+?)\s*$/.exec(raw);
    if (heading) {
      goal = { id: heading[1]!, title: heading[2]!, line: n, fields: {}, order: [], checkDecls: [], steps: [] };
      goals.push(goal); field = null; return;
    }
    if (/^\s*#{1,3}\s/.test(raw)) { if (goal) goal = null; field = null; return; }
    if (!goal) { if (!goals.length) header.push(raw); return; }
    const g: GoalBlock = goal;
    if (field === "check" && CHECK_DECL.test(raw)) { g.checkDecls.push({ text: raw.trim().replace(/^[-*]\s+/, ""), line: n }); return; }
    const lab = LABEL.exec(raw);
    if (lab) {
      field = lab[1]!.toLowerCase();
      if (["result", "purpose", "plan", "check", "now"].includes(field)) {
        const key = field as keyof GoalBlock["fields"];
        if (!g.fields[key]) { g.fields[key] = { value: (lab[3] ?? "").replace(/^\*\*\s*/, "").trim(), line: n }; g.order.push(field); }
      }
      return;
    }
    if (field === "plan") { const s = parseStep(raw, n); if (s) { g.steps.push(s); return; } }
    if (field && raw.trim() && /^\s+/.test(raw) && ["result", "purpose", "now"].includes(field)) {
      const f = g.fields[field as "result"]; if (f) f.value += " " + raw.trim();
    }
  });
  return { lines, header, goals };
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
const fmtMin = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);

/** Things the owner must never see on the board: paths, hashes, job names, CLI tool names. */
export function internalWords(text: string): string[] {
  const hits: string[] = [];
  const pats: [string, RegExp][] = [
    ["path", /[A-Za-z]:[\\/][^\s,;)]*/g],
    ["path", /(?:^|\s)(?:\.{1,2}\/)?[\w.-]+\/[\w./-]+/g],
    ["file", /\b[\w-]+\.(?:ts|tsx|js|md|json|rs|py|ps1|sh|toml|html|pdf|csv|txt)\b/gi],
    ["commit hash", /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g],
    ["job name", /\b[a-z]{1,10}\d{2,}[a-z]?\b/gi],
    ["job name", /\b[a-z]+(?:-[a-z0-9]+)*-[a-z]\d+\b/gi],
    ["tool name", /\b(?:md-aio|bgrun|bun|tg-send|open-web|chatgpt-bridge|ray-board|keeper\.ts|git|npm|cargo|pwsh)\b/gi],
  ];
  for (const [kind, re] of pats) for (const m of text.matchAll(re)) hits.push(`${kind} "${m[0].trim()}"`);
  return hits;
}

export function check(markdown: string, opts: { today?: Date; file?: string } = {}): Report {
  const today = opts.today ?? new Date();
  const { lines, header, goals } = parse(markdown);
  const results: RuleResult[] = [];
  const add = (rule: string, title: string, hard: boolean, goal: string | null, pass: boolean, line: number | null, detail: string) =>
    results.push({ rule, title, hard, goal, pass, line, detail });

  // R1: category header (Ultimate Vision, Ultimate Purpose, Roles) before the first goal.
  const hdr = (re: RegExp) => {
    const i = header.findIndex((l) => re.test(l));
    if (i < 0) return null;
    const value = header[i]!.replace(re, "").replace(/^[*\s:]+/, "").trim();
    return { line: i + 1, value };
  };
  for (const [name, re] of [
    ["Ultimate Vision", /^\s*(?:[-*+]\s+)?\*{0,2}(?:Ultimate\s+)?Vision\*{0,2}\s*:\s*\*{0,2}/i],
    ["Ultimate Purpose", /^\s*(?:[-*+]\s+)?\*{0,2}(?:Ultimate\s+)?Purpose\*{0,2}\s*:\s*\*{0,2}/i],
    ["Roles", /^\s*(?:[-*+]\s+)?\*{0,2}Roles?\*{0,2}\s*:\s*\*{0,2}/i],
  ] as [string, RegExp][]) {
    const h = hdr(re);
    add("R1-header", `category header has ${name}`, true, null, !!h && h.value.length > 3, h?.line ?? null,
      h ? (h.value.length > 3 ? h.value.slice(0, 80) : "empty") : `no "${name}:" line before the first goal`);
  }

  // R2: 1-8 goals, each with Result, Purpose, Plan, Check, Now in that order.
  add("R2-goal-count", "between 1 and 8 results", true, null, goals.length >= 1 && goals.length <= 8, null, `${goals.length} goals`);
  const need = ["result", "purpose", "plan", "check", "now"];
  for (const g of goals) {
    const missing = need.filter((f) => !g.fields[f as "result"] || (f !== "plan" && f !== "check" && !g.fields[f as "result"]!.value));
    const seq = g.order.filter((f) => need.includes(f));
    const inOrder = seq.join(",") === need.filter((f) => seq.includes(f)).join(",");
    add("R2-fields", "Result, Purpose, Plan, Check, Now present and in order", true, g.id, !missing.length && inOrder, g.line,
      missing.length ? `missing ${missing.join(", ")}` : inOrder ? "ok" : `order is ${seq.join(" > ")}`);

    // R3: exactly one valid, runnable check line (manual alone does not count).
    const valid = g.checkDecls.filter((d) => CHECK_GRAMMAR.test(d.text));
    const runnable = valid.filter((d) => !/^check:\s+manual\b/i.test(d.text));
    const r3pass = g.checkDecls.length === 1 && runnable.length === 1;
    add("R3-runnable-check", "one runnable check: line (run/http/file, not only manual)", true, g.id, r3pass,
      g.checkDecls[0]?.line ?? g.fields.check?.line ?? g.line,
      !g.checkDecls.length ? "no indented check: line under Check" : g.checkDecls.length > 1 ? `${g.checkDecls.length} check: lines (ambiguous)`
        : !valid.length ? `malformed: ${g.checkDecls[0]!.text}` : !runnable.length ? "check: manual only" : g.checkDecls[0]!.text);

    // R4 (soft): Result is one measurable sentence of at most 40 words.
    const result = g.fields.result?.value ?? "";
    if (result) {
      const wc = result.split(/\s+/).filter(Boolean).length;
      const sentences = result.replace(/\d\.\d/g, "0").split(/[.!?](?:\s+|$)/).filter((s) => s.trim()).length;
      const measurable = /\d|\b(under|at least|at most|every|each|all|within|no more than|zero|none|same day|daily|weekly)\b/i.test(result);
      const probs = [wc > 40 && `${wc} words`, sentences > 1 && `${sentences} sentences`, !measurable && "no number, threshold or date"].filter(Boolean);
      add("R4-measurable", "Result is one measurable sentence, at most 40 words", false, g.id, !probs.length, g.fields.result!.line,
        probs.length ? probs.join("; ") : `${wc} words`);
    }

    // R5 (soft): Result is an outcome, Purpose is a reason distinct from the Result.
    const purpose = g.fields.purpose?.value ?? "";
    if (result && purpose) {
      const activity = /^(?:the\s+)?(work on|working on|research|look into|try|explore|investigate|think about|continue)\b/i.test(result);
      const rw = new Set(words(result)); const pw = words(purpose);
      const overlap = pw.length ? pw.filter((w) => rw.has(w)).length / pw.length : 1;
      const reason = /\b(because|so that|so the|so we|so they|so it|so nobody|so no|in order to)\b/i.test(purpose);
      const ok = !activity && (reason || overlap < 0.5);
      add("R5-outcome-reason", "Result is an outcome; Purpose gives a reason", false, g.id, ok, g.fields.purpose!.line,
        activity ? "Result starts with an activity verb" : ok ? (reason ? "reason word present" : `overlap ${Math.round(overlap * 100)}%`)
          : `Purpose has no "because/so that" and repeats ${Math.round(overlap * 100)}% of the Result`);
    }

    // R6: plan has 3-9 chunks and exactly one [~] (none allowed only when every chunk is done).
    const st = g.steps;
    const doing = st.filter((s) => s.state === "~").length;
    const allDone = st.length > 0 && st.every((s) => s.state === "x");
    const r6 = st.length >= 3 && st.length <= 9 && (doing === 1 || (allDone && doing === 0));
    add("R6-plan-shape", "plan has 3-9 chunks and exactly one [~]", true, g.id, r6, g.fields.plan?.line ?? g.line,
      `${st.length} chunks, ${doing} in progress${allDone ? ", all done" : ""}`);

    // R7: musts: at least one, at most half (METHOD: 20% of actions give 80% of results).
    const musts = st.filter((s) => s.must).length;
    add("R7-musts", "at least one and at most half of the chunks marked * (must)", true, g.id,
      musts >= 1 && musts <= Math.max(1, Math.floor(st.length / 2)), g.fields.plan?.line ?? g.line, `${musts} of ${st.length} marked *`);

    // R8: every unfinished chunk names who does it.
    const open = st.filter((s) => s.state !== "x");
    const noWho = open.filter((s) => !s.who);
    add("R8-who", "every unfinished chunk names session, sub-agent, handoff or owner", true, g.id, !noWho.length,
      noWho[0]?.line ?? g.fields.plan?.line ?? g.line, noWho.length ? `no leverage: "${noWho[0]!.text.slice(0, 60)}"${noWho.length > 1 ? ` (+${noWho.length - 1} more)` : ""}` : `${open.length} open, all assigned`);

    // R9 (soft): unfinished chunks carry a duration; report total and must time.
    const noDur = open.filter((s) => s.minutes == null);
    const total = open.reduce((a, s) => a + (s.minutes ?? 0), 0);
    const mustT = open.filter((s) => s.must).reduce((a, s) => a + (s.minutes ?? 0), 0);
    add("R9-duration", "every unfinished chunk has a duration", false, g.id, !noDur.length && mustT <= total,
      noDur[0]?.line ?? g.fields.plan?.line ?? g.line,
      `${noDur.length ? `${noDur.length} without duration; ` : ""}open time ${fmtMin(total)}, must time ${fmtMin(mustT)}`);

    // R10 (soft): no duplicate chunks; no chunk repeats the Result.
    const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const seen = new Map<string, number>(); let dup: Step | null = null;
    for (const s of st) { const k = norm(s.text); if (seen.has(k) || k === norm(result)) { dup = s; break; } seen.set(k, s.line); }
    add("R10-no-duplicates", "no duplicate chunk, none repeats the Result", false, g.id, !dup, dup?.line ?? g.fields.plan?.line ?? g.line,
      dup ? `duplicate: "${dup.text.slice(0, 60)}"` : "ok");

    // R11 (soft): no stalled plan; a finished plan is flagged for replacement.
    const stalled = st.some((s) => s.state === "x") && st.some((s) => s.state === " ") && doing === 0;
    add("R11-not-stalled", "plan is moving (not stalled, not finished and left standing)", false, g.id, !stalled && !allDone,
      g.fields.plan?.line ?? g.line, stalled ? "done and open chunks but nothing in progress" : allDone ? "result reached: replace or retire" : "ok");

    // R13: plain words: no paths, hashes, job or tool names in Result, Purpose, Now (hard), chunks (soft).
    const ownerText = (["result", "purpose", "now"] as const).flatMap((f) => (g.fields[f] ? internalWords(g.fields[f]!.value).map((h) => `${f}: ${h}`) : []));
    add("R13-plain-words", "no paths, hashes, job or tool names in Result, Purpose, Now", true, g.id, !ownerText.length,
      g.fields.result?.line ?? g.line, ownerText.length ? ownerText.slice(0, 3).join("; ") : "ok");
    const stepText = st.flatMap((s) => internalWords(s.text.replace(/\([^)]*\)\s*$/, "")).map((h) => ({ h, line: s.line })));
    add("R13-plain-steps", "no paths, hashes, job or tool names in the plan chunks", false, g.id, !stepText.length,
      stepText[0]?.line ?? g.fields.plan?.line ?? g.line, stepText.length ? stepText.slice(0, 3).map((x) => x.h).join("; ") : "ok");
  }

  // R12: weekly review dated within the last 7 days, with done / crossed off / carried over.
  const wi = lines.findIndex((l) => /week\s+of\s+\d{4}-\d{2}-\d{2}|weekly\s+review\s*\(?\s*\d{4}-\d{2}-\d{2}/i.test(l));
  if (wi < 0) add("R12-weekly-review", "weekly review dated within 7 days", true, null, false, null, 'no "Week of YYYY-MM-DD" line');
  else {
    const date = /(\d{4}-\d{2}-\d{2})/.exec(lines[wi]!)![1]!;
    let block = lines[wi]!;
    for (let j = wi + 1; j < lines.length && j < wi + 12; j++) {
      if (/^\s*#{1,3}\s/.test(lines[j]!) || /^\s*\*\*[^*]+:\*\*/.test(lines[j]!)) break;
      block += "\n" + lines[j];
    }
    const days = (Date.parse(today.toISOString().slice(0, 10)) - Date.parse(date)) / 86_400_000;
    const parts = ["done", "crossed off", "carried over"].filter((p) => !new RegExp(`\\b${p}\\b`, "i").test(block));
    const ok = days >= -1 && days <= 7 && !parts.length;
    add("R12-weekly-review", "weekly review dated within 7 days", true, null, ok, wi + 1,
      `${date} (${Math.round(days)} days ago)${parts.length ? `; missing ${parts.join(", ")}` : ""}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const hardFailures = results.filter((r) => r.hard && !r.pass).length;
  return {
    file: opts.file ?? "GOALS.md", goals: goals.length, passed, total: results.length,
    pct: results.length ? Math.round((100 * passed) / results.length) : 0, hardFailures, ok: hardFailures === 0, results,
  };
}

export function format(r: Report): string {
  const out = r.results.map((x) =>
    `${x.pass ? "PASS" : "FAIL"} ${x.hard ? "hard" : "soft"} ${(x.goal ? `#${x.goal} ` : "").padEnd(4)}${x.rule.padEnd(20)} ` +
    `${x.line ? `L${x.line}`.padEnd(5) : "     "} ${x.detail}`);
  out.push(`score ${r.passed}/${r.total} (${r.pct}%), ${r.goals} results, hard failures ${r.hardFailures}: ${r.ok ? "PASS" : "FAIL"}`);
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const ti = args.indexOf("--today");
  const today = ti >= 0 ? new Date(`${args[ti + 1]}T12:00:00Z`) : new Date();
  const target = args.filter((a, i) => !a.startsWith("--") && (ti < 0 || i !== ti + 1))[0];
  if (!target) { console.error("usage: bun tools/rpm-check.ts <ray folder | GOALS.md> [--json] [--today YYYY-MM-DD]"); process.exit(2); }
  const file = existsSync(target) && statSync(target).isDirectory() ? path.join(target, "GOALS.md") : target;
  if (!existsSync(file)) { console.error(`no GOALS.md at ${file}`); process.exit(2); }
  const report = check(readFileSync(file, "utf8"), { today, file });
  console.log(json ? JSON.stringify(report, null, 2) : format(report));
  process.exit(report.ok ? 0 : 1);
}
