#!/usr/bin/env node
/**
 * A conservative, offline restart-readiness check for one ray or a set of rays.
 * Node 22: node --experimental-strip-types src/resume-check.ts <ray> [--json]
 * Bun: bun src/resume-check.ts <ray> [--json]
 *
 * Snapshot support: rays/<ray>/{*-resume.md,git-log.txt,files.txt,queue/*}.
 * Live support: <ray>/plans/*-resume.md, .docs/chatgpt/small/{queue,running,done,failed}.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

export type Severity = "critical" | "error" | "warning" | "info";
export interface Finding {
  severity: Severity;
  message: string;
  line: number;
  code: string;
}
export interface CheckResult {
  ray: string;
  note: string | null;
  score: number;
  findings: Finding[];
  lastUpdated: string | null;
  durationMs: number;
  evidence: { commit: string | null; heartbeat: string | null; activeJobs: string[]; queuedJobs: string[] };
}
export interface CheckOptions { maxWords?: number; git?: boolean }

const WEIGHTS: Record<string, number> = {
  "missing-section": 12, "empty-section": 8, "too-long": 16, "freshness-commit": 8,
  "freshness-done": 4, "running-missing": 11, "queued-missing": 9,
  "incorrect-flight": 7, "unknown-active": 5, "done-unmentioned": 8,
  "next-vague": 6, "next-count": 4, "broken-link": 8, "link-unverifiable": 2, "secret": 20, "ip-address": 6,
};
const CAPS: Record<string, number> = {
  structure: 40, length: 16, freshness: 16, flight: 40, done: 24,
  next: 25, links: 25, secrets: 40,
};

function read(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}
function dirEntries(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}
function matchingNote(rayDir: string): string | null {
  const candidates = [join(rayDir, "plans"), rayDir].flatMap(dir =>
    dirEntries(dir).filter(s => /(?:^|-)resume\.md$/i.test(s)).map(s => join(dir, s)));
  candidates.sort((a, b) => {
    const dateA = basename(a).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
    const dateB = basename(b).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
    return dateB.localeCompare(dateA) || statSync(b).mtimeMs - statSync(a).mtimeMs;
  });
  return candidates[0] ?? null;
}
function parseGitLine(line: string): { date: Date; subject: string } | null {
  const m = line.match(/^[a-f0-9]{6,40}\s+(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)\s+([+-]\d\d)(\d\d)\s+(.*)$/i);
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  return Number.isNaN(+date) ? null : { date, subject: m[5] };
}
function gitEvidence(rayDir: string, note: string, useGit: boolean): { last: Date; commit: Date | null } {
  // The supplied archive has all files stamped with extraction time. Use the
  // newest "resume" commit for these snapshots rather than the zip's mtime.
  const snapshot = read(join(rayDir, "git-log.txt")).split(/\r?\n/).map(parseGitLine)
    .filter((v): v is {date: Date; subject: string} => !!v);
  if (snapshot.length) {
    const dated = snapshot.find(v => /\bresume\b/i.test(v.subject));
    return { last: dated?.date ?? statSync(note).mtime, commit: snapshot[0]?.date ?? null };
  }
  if (useGit) {
    const rel = relative(rayDir, note).replace(/\\/g, "/");
    const result = spawnSync("git", ["-C", rayDir, "log", "-1", "--format=%h %ai %s", "--", rel],
      { encoding: "utf8", timeout: 100, windowsHide: true });
    const event = parseGitLine(result.stdout?.trim() ?? "");
    const latest = spawnSync("git", ["-C", rayDir, "log", "-1", "--format=%h %ai %s"],
      { encoding: "utf8", timeout: 100, windowsHide: true });
    return { last: new Date(Math.max(+(event?.date ?? new Date(0)), +statSync(note).mtime)), commit: parseGitLine(latest.stdout?.trim() ?? "")?.date ?? null };
  }
  return { last: statSync(note).mtime, commit: null };
}
function headings(lines: string[]): Map<string, { start: number; end: number }> {
  const sections = new Map<string, { start: number; end: number }>();
  const found: { key: string; index: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const title = h[1].replace(/[*_`]/g, "").toLowerCase();
    let key = "";
    if (/^now(?:\b|[\s(:—-])/.test(title)) key = "Now";
    else if (/^in[\s-]*flight\b/.test(title)) key = "In flight";
    else if (/^next(?:\b|[\s(:—-])/.test(title)) key = "Next";
    else if (/^waiting(?:\s+on)?(?:\s+the)?\s+owner\b/.test(title)) key = "Waiting on the owner";
    else if (/^gotchas?\b/.test(title)) key = "Gotchas";
    // Repeated "Now" is valid; the latest is assumed authoritative.
    if (key && !sections.has(key)) sections.set(key, { start: i, end: lines.length });
    found.push({ key, index: i });
  }
  for (const [key, sect] of sections) {
    sect.end = found.find(h => h.index > sect.start && /^#{1,2}\s/.test(lines[h.index]))?.index ?? lines.length;
  }
  return sections;
}
function escaped(str: string): string { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function mentions(text: string, job: string): boolean {
  return new RegExp(`(^|[^\\w-])${escaped(job)}(?=$|[^\\w-])`, "i").test(text);
}
function inventory(rayDir: string): { paths: Set<string>; roots: Set<string> } {
  const paths = new Set<string>(["README.md"]);
  const roots = new Set<string>();
  let folder = "";
  for (const original of read(join(rayDir, "files.txt")).split(/\r?\n/)) {
    const line = original.trim().replace(/\\/g, "/");
    if (!line || line.startsWith("#")) continue;
    if (/^[\w./ -]+:$/.test(line)) { folder = line.slice(0, -1); roots.add(folder); continue; }
    paths.add(normalize(join(folder, line)).replace(/\\/g, "/"));
  }
  return { paths, roots };
}
function jobName(name: string): string | null {
  const s = basename(name.replace(/\\/g, "/"))
    .replace(/\.(?:attach|tries|zip|ready-at|state\.json|json|md|txt)$/i, "");
  return s && !/^(queue|running|done|failed|hold|cancelled)$/i.test(s) ? s : null;
}
type JobState = "queued" | "running" | "done" | "failed";
type JobEvent = { name: string; state: JobState; time: Date; line: string };
interface QueueEvidence {
  events: JobEvent[];
  explicit: Map<string, JobState>;
  heartbeat: { running: number; queued: number; raw: string } | null;
}
function queueEvidence(rayDir: string, anchor: Date): QueueEvidence {
  const explicit = new Map<string, JobState>();
  const listing = read(join(rayDir, "queue", "listing.txt"));
  let group = "";
  for (const raw of listing.split(/\r?\n/)) {
    const line = raw.trim().replace(/\\/g, "/");
    if (/^[/\w.:-]+\/(queue|running|done|failed):$/.test(line))
      group = line.match(/\/(queue|running|done|failed):$/)?.[1] ?? "";
    else if (/^(?:queue|running|done|failed)\/.+/.test(line)) {
      const [, state, file] = line.match(/^(queue|running|done|failed)\/(.+)$/) ?? [];
      const name = jobName(file ?? "");
      if (name) explicit.set(name, (state === "queue" ? "queued" : state) as JobState);
    } else if (group && line && !/^(queue|running|done|failed|hold|cancelled)$/.test(line)) {
      // Only a listing of nested directory contents establishes the state.
      // Flat snapshot listings have group="queue" but the "queue" marker is
      // itself a directory and all files are mixed; don't infer from those.
      if (/\/(running|done|failed|queue)\//.test(line)) {
        const m = line.match(/\/(running|done|failed|queue)\/([^/]+)$/);
        const name = m && jobName(m[2]);
        if (name) explicit.set(name, (m![1] === "queue" ? "queued" : m![1]) as JobState);
      }
    }
  }
  // The live keeper layout: small/queue/*.txt are queued prompts (next to .attach/.zip/.state.json sidecars of every
  // job ever pushed), small/queue/{running,done,failed,cancelled}/*.txt hold the rest. Only .txt prompts are jobs.
  const live = join(rayDir, ".docs", "chatgpt", "small", "queue");
  if (existsSync(live)) {
    for (const [folder, state] of [["", "queued"], ["running", "running"], ["done", "done"], ["failed", "failed"]] as const)
      for (const file of dirEntries(folder ? join(live, folder) : live))
        if (file.endsWith(".txt") && !file.startsWith(".")) explicit.set(file.slice(0, -4), state);
  }
  else for (const base of [join(rayDir, ".docs", "chatgpt", "small"), join(rayDir, "queue")]) {
    for (const [folder, state] of [["queue", "queued"], ["running", "running"], ["done", "done"], ["failed", "failed"]] as const) {
      for (const file of dirEntries(join(base, folder))) {
        if (file.startsWith(".")) continue;
        const name = jobName(file);
        if (name) explicit.set(name, state);
      }
    }
  }
  const tail = read(join(rayDir, "queue", "keeper-tail.txt")).split(/\r?\n/);
  const events: JobEvent[] = [];
  let heartbeat: QueueEvidence["heartbeat"] = null;
  const utcDay = anchor.toISOString().slice(0, 10);
  for (const line of tail) {
    const time = line.match(/^(\d\d:\d\d:\d\d)\s/);
    if (!time) continue;
    const date = new Date(`${utcDay}T${time[1]}Z`);
    const hb = line.match(/\bHEARTBEAT running=(\d+) queued=(\d+)/);
    if (hb) heartbeat = { running: +hb[1], queued: +hb[2], raw: line };
    const m = line.match(/\b(launched|done|failed)\s+([A-Za-z0-9][\w.-]+)/);
    if (!m) continue;
    events.push({ name: m[2], state: m[1] === "launched" ? "running" : m[1] as JobState, time: date, line });
  }
  return { events, explicit, heartbeat };
}
function linkStatus(rayDir: string, note: string, raw: string, known: {paths: Set<string>; roots: Set<string>}): "ok" | "broken" | "unknown" {
  let href = raw.trim().split(/\s+["']/)[0].replace(/^<|>$/g, "");
  try { href = decodeURIComponent(href); } catch { /* leave literal */ }
  href = href.split("#")[0].split("?")[0].replace(/\\/g, "/");
  if (!href || /^(?:https?:|mailto:|file:|data:|\/\/|[a-z]:\/)/i.test(href)) return "ok";
  if (isAbsolute(href)) return existsSync(href) ? "ok" : "unknown";
  // The benchmark archives flatten plans/YYYY-MM-DD-resume.md into the ray
  // folder. Preserve the real plans/ link base when files.txt proves it exists.
  const bases = [dirname(note), join(rayDir, "plans"), rayDir];
  for (const base of bases) {
    const absolute = resolve(base, href);
    if (existsSync(absolute)) return "ok";
    const candidate = relative(rayDir, absolute).replace(/\\/g, "/");
    if (known.paths.has(candidate) || known.paths.has(normalize(candidate).replace(/\\/g, "/"))) return "ok";
  }
  const possibilities = bases.map(base => relative(rayDir, resolve(base, href)).replace(/\\/g, "/"));
  const underIndexedRoot = possibilities.some(path =>
    [...known.roots].some(folder => path.startsWith(folder + "/") || path === folder));
  return underIndexedRoot ? "broken" : "unknown";
}
function stepsInNext(lines: string[], start: number, end: number) {
  const steps: { line: number; text: string }[] = [];
  for (let i = start + 1; i < end; i++) {
    const s = lines[i].trim();
    const m = s.match(/^(?:(?:\d+[a-z]?[.)]|[-*+])\s+)(.+)$/i);
    if (!m || s.startsWith("|")) continue;
    if (/^(?:~~|done\b|completed\b)/i.test(m[1])) continue;
    steps.push({ line: i + 1, text: m[1] });
  }
  return steps;
}
function concrete(step: string, knownJobs: Set<string>): boolean {
  const text = step.replace(/https?:\/\/\S+/g, "");
  if (/`[^`]*(?:[/\\]|\.(?:ts|js|md|json|tsx|ps1|sh|py|sql)\b|\b(?:bun|node|git|keeper|bgrun|npm|pnpm|curl|md-aio|python|uv|cargo|systemctl|blender|docker|npx|ssh|scp|tsc|powershell)\b)[^`]*`/i.test(text)) return true;
  if (/(?:[.\w-]+[/\\])+[\w.-]+/.test(text) || /\b[\w-]+\.(?:ts|js|md|json|tsx|ps1|sh|py|sql|zip|blend|pdf)\b/i.test(text)) return true;
  if (/\b(?:bun|node|git|keeper\.ts|bgrun|npm|pnpm|curl|md-aio|python|uv|cargo|systemctl|blender|docker|npx|ssh|scp|tsc|powershell)\s+[^\s,.]+/.test(text)) return true;
  for (const job of knownJobs) if (mentions(text, job)) return true;
  // Project-specific handoff IDs (including b62 and 102-book-...), even when
  // the keeper's tail no longer goes back far enough to show them.
  if (/\b(?:[a-z]+\d{1,3}[a-z]?|[a-z][\w-]*-\d{2,}[\w-]*)\b/i.test(text)) return true;
  if (/`[a-z][\w-]*(?:-\d+[a-z]?)?[\w-]*`/i.test(text) &&
    /\b(?:handoff|job|apply|refetch|merge|launch|queue|re-push)\b/i.test(text)) return true;
  return false;
}
function safeExcerpt(input: string): string {
  return input
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[psuo]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[redacted credential]")
    .replace(/\b(?:api[_-]?key|secret|access[_-]?token|bearer|private[_-]?key|password)\s*[:=]\s*[^\s"'`]+/gi, "[redacted assignment]")
    .replace(/(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w-]|\.\d)/g, "[redacted IP]");
}
function secretsAt(line: string): { code: string; message: string; severity: Severity }[] {
  const found: { code: string; message: string; severity: Severity }[] = [];
  // Do not echo secret material into findings, JSON or a status board.
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[psuo]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b|eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/.test(line)
    || /\b(?:api[_-]?key|secret|access[_-]?token|bearer|private[_-]?key|password)\s*[:=]\s*(?!\s*(?:\$\{|<|REDACTED|YOUR_|example|xxxx|\*{3}))[^\s"'`]{12,}/i.test(line))
    found.push({ code: "secret", message: "Possible credential/token material; remove or redact it.", severity: "critical" });
  const ipv4 = /(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w-]|\.\d)/g;
  // Loopback and the wildcard address name no machine; everything else could be a server.
  if ([...line.matchAll(ipv4)].some(m => m[0].split(".").every(o => +o <= 255) && !/^(?:127\.|0\.0\.0\.0$)/.test(m[0])))
    found.push({ code: "ip-address", message: "Literal IPv4 address present; use a non-sensitive host reference.", severity: "warning" });
  if (/\b(?:(?:[a-f\d]{1,4}:){7}(?:[a-f\d]{1,4})|(?:[a-f\d]{1,4}:){1,7}:)\b/i.test(line))
    found.push({ code: "ip-address", message: "Literal IPv6 address present; use a host reference.", severity: "warning" });
  return found;
}

export function checkResume(rayFolder: string, options: CheckOptions = {}): CheckResult {
  const start = performance.now();
  const rayDir = resolve(rayFolder);
  const ray = basename(rayDir);
  const findings: Finding[] = [];
  const groups = new Map<string, number>();
  const add = (group: string, code: string, severity: Severity, message: string, line: number) => {
    findings.push({ severity, message, line, code });
    groups.set(group, Math.min(CAPS[group] ?? 100, (groups.get(group) ?? 0) + (WEIGHTS[code] ?? 0)));
  };
  const note = matchingNote(rayDir);
  if (!note) {
    add("structure", "missing-section", "critical", "No resume note found in plans/ or the ray folder.", 0);
    return { ray, note: null, score: 0, findings, lastUpdated: null,
      durationMs: +(performance.now() - start).toFixed(3),
      evidence: { commit: null, heartbeat: null, activeJobs: [], queuedJobs: [] } };
  }
  const md = read(note);
  const lines = md.split(/\r?\n/);
  const sect = headings(lines);
  const needed = ["Now", "In flight", "Next", "Waiting on the owner", "Gotchas"];
  for (const name of needed) {
    const s = sect.get(name);
    if (!s) add("structure", "missing-section", "error", `Missing "${name}" heading.`, 1);
    else if (!lines.slice(s.start + 1, s.end).some(x => x.trim() && !/^<!--/.test(x.trim())))
      add("structure", "empty-section", "error", `"${name}" has no content.`, s.start + 1);
  }
  const words = (md.match(/\S+/g) ?? []).length;
  const max = options.maxWords ?? 1500; // ~500 words/page; conservative estimate
  if (words > max) add("length", "too-long", "warning",
    `${words} words (~${(words / 500).toFixed(1)} pages); limit is ~3 pages (${max} words).`, 1);

  const { last, commit } = gitEvidence(rayDir, note, options.git !== false);
  if (commit && commit.getTime() > last.getTime() + 2 * 60_000) {
    add("freshness", "freshness-commit", "warning",
      `Newest ray commit (${commit.toISOString()}) is newer than resume edit (${last.toISOString()}).`, 1);
  }
  const evidence = queueEvidence(rayDir, commit ?? last);
  const jobStates = new Map<string, JobState>();
  for (const event of evidence.events) jobStates.set(event.name, event.state);
  for (const [job, status] of evidence.explicit) jobStates.set(job, status);
  let active = [...jobStates].filter(([, state]) => state === "running").map(([job]) => job);
  const queued = [...jobStates].filter(([, state]) => state === "queued").map(([job]) => job);
  // On the snapshots, the keeper tail covers only the last 40 lines. Its final
  // heartbeat is authoritative for totals, but not for names that aged out.
  const hb = evidence.heartbeat;
  if (hb?.running === 0 && ![...evidence.explicit.values()].includes("running")) active = [];
  if (hb && active.length > hb.running) {
    // Suppress aged-out, ambiguous launch events rather than create false
    // "running job missing" positives.
    active = active.slice(-hb.running);
  }
  const noteText = md;
  for (const name of active) if (!mentions(noteText, name))
    add("flight", "running-missing", "error", `Running keeper job "${name}" is not named in the resume note.`, sect.get("In flight")?.start !== undefined ? sect.get("In flight")!.start + 1 : 1);
  for (const name of queued) if (!mentions(noteText, name))
    add("flight", "queued-missing", "error", `Queued job "${name}" is not named in the resume note.`, sect.get("In flight")?.start !== undefined ? sect.get("In flight")!.start + 1 : 1);
  if (hb && (hb.running > active.length || hb.queued > queued.length))
    add("flight", "unknown-active", "warning",
      `Keeper reports ${hb.running} running / ${hb.queued} queued; only ${active.length} running / ${queued.length} queued names are provable from this snapshot. Inspect the live queue folders.`, 1);

  // Check explicit status assertions, not historical prose saying a job "was
  // queued". The last 40 keeper events can't prove that old jobs are still live.
  const flight = sect.get("In flight");
  if (flight) {
    const knownJobs = new Set([...jobStates.keys()]);
    // Add names advertised by the flat archive's .attach/.zip filenames.
    for (const s of read(join(rayDir, "queue", "listing.txt")).split(/\r?\n/)) {
      if (/\.(?:attach|zip|state\.json)$/.test(s.trim())) {
        const j = jobName(s.trim()); if (j) knownJobs.add(j);
      }
    }
    for (let i = flight.start + 1; i < flight.end; i++) {
      const line = lines[i];
      if (!/\b(running|queued)\b/i.test(line) || /^\s*(?:~~|<!--)/.test(line)) continue;
      // Group claims are delimited by the NEXT status heading, not any later
      // mention of "queue" in an unrelated sentence.
      const claims: string[] = [];
      for (const m of line.matchAll(/\b(?:running|queued)(?:\s+(?:\d{1,2}:\d\d|21\s+Nov))?\s*:\s*([^\n]*?)(?=\.\s+[A-Z0-9]|\b(?:running|queued|failed|applied|done)(?:\s+(?:\d{1,2}:\d\d|21\s+Nov))?\s*:|$)/gi))
        claims.push(m[1]);
      for (const name of knownJobs) {
        if (!mentions(line, name)) continue;
        const afterJob = new RegExp(`\\b${escaped(name)}\\b\\s*(?:\\([^)]{0,40}\\))?\\s*(?:[:—-]\\s*)?(?:is\\s+)?(?:running|queued)\\b`, "i").test(line);
        const inClaim = claims.some(text => mentions(text, name));
        if (!afterJob && !inClaim) continue;
        const near = line.slice(Math.max(0, line.toLowerCase().indexOf(name.toLowerCase()) - 22),
          line.toLowerCase().indexOf(name.toLowerCase()) + name.length + 55);
        if (/\b(?:applied|completed|failed|obsolete|superseded|landed|was)\b/i.test(near)) continue;
        const status = jobStates.get(name);
        if (status === "done" || status === "failed" || (hb?.running === 0 && hb.queued === 0 && status !== "queued")) {
          add("flight", "incorrect-flight", "warning",
            `"${name}" is described as active, but the keeper shows ${status ?? "no current job"} (or zero running/queued).`, i + 1);
        }
      }
    }
  }
  // Done after the last confirmed resume edit, not just any old zip in done/.
  const completed = new Map<string, Date>();
  for (const e of evidence.events) if (e.state === "done" && +e.time > +last) completed.set(e.name, e.time);
  // Live keepers can finish jobs before their messages scroll out of the
  // 40-line tail. File mtimes in the actual done/ folders supply this evidence.
  for (const base of [join(rayDir, ".docs", "chatgpt", "small", "done"), join(rayDir, "queue", "done")]) {
    for (const entry of dirEntries(base)) {
      const name = jobName(entry);
      if (!name) continue;
      try {
        const timestamp = statSync(join(base, entry)).mtime;
        if (+timestamp > +last && +timestamp > +(completed.get(name) ?? new Date(0)))
          completed.set(name, timestamp);
      } catch { /* an entry changed while the keeper was moving it */ }
    }
  }
  for (const [job, when] of completed) {
    if (mentions(noteText, job)) continue;
    add("done", "done-unmentioned", "error",
      `Reply "${job}" completed at ${when.toISOString()} after the note was updated and is not mentioned.`, 1);
  }
  if (completed.size) add("freshness", "freshness-done", "info",
    `${completed.size} handoff(s) finished after the last confirmed resume edit; review outcomes.`, 1);

  const next = sect.get("Next");
  if (next) {
    const steps = stepsInNext(lines, next.start, next.end);
    if (steps.length < 3 || steps.length > 5)
      add("next", "next-count", "warning", `Next has ${steps.length} open numbered/bulleted steps; expected 3–5.`, next.start + 1);
    const knownJobs = new Set([...jobStates.keys()]);
    for (const { line, text } of steps) if (!concrete(text, knownJobs))
      add("next", "next-vague", "warning",
        `Next step needs a specific file, command, or job: "${safeExcerpt(text.slice(0, 100))}${text.length > 100 ? "…" : ""}".`, line);
  }
  const known = inventory(rayDir);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const links = [...line.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)];
    for (const match of links) {
      const state = linkStatus(rayDir, note, match[1], known);
      if (state === "broken")
        add("links", "broken-link", "error", `Unresolved relative link in indexed files: ${safeExcerpt(match[1].split("?")[0].slice(0, 120))}.`, i + 1);
      else if (state === "unknown")
        add("links", "link-unverifiable", "info", `Relative link cannot be verified against this partial file inventory: ${safeExcerpt(match[1].split("?")[0].slice(0, 120))}.`, i + 1);
    }
    for (const sec of secretsAt(line)) add("secrets", sec.code, sec.severity, sec.message, i + 1);
  }
  const score = Math.max(0, 100 - [...groups.values()].reduce((a, b) => a + b, 0));
  return { ray, note: relative(rayDir, note).replace(/\\/g, "/"), score, findings,
    lastUpdated: last.toISOString(), durationMs: +(performance.now() - start).toFixed(3),
    evidence: { commit: commit?.toISOString() ?? null, heartbeat: hb?.raw ?? null, activeJobs: active, queuedJobs: queued } };
}

export function formatTable(results: CheckResult[]): string {
  const rows = [["Ray", "Score", "Findings", "Critical", "Errors", "Warnings", "ms"],
    ...results.map(r => [r.ray, `${r.score}/100`, `${r.findings.length}`,
      `${r.findings.filter(f => f.severity === "critical").length}`,
      `${r.findings.filter(f => f.severity === "error").length}`,
      `${r.findings.filter(f => f.severity === "warning").length}`, r.durationMs.toFixed(1)])];
  const widths = rows[0].map((_, c) => Math.max(...rows.map(row => row[c].length)));
  return rows.map((row, i) => row.map((s, c) => s.padEnd(widths[c])).join("  ").trimEnd())
    .reduce<string[]>((acc, row, i) => (i === 1 ? [...acc, widths.map(w => "-".repeat(w)).join("  "), row] : [...acc, row]), []).join("\n");
}

function cli(argv: string[]): number {
  let threshold = 70, json = false, targets: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--threshold" || arg === "-t") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0 || value > 100) { process.stderr.write("Invalid --threshold (0–100)\n"); return 2; }
      threshold = value;
    } else if (arg === "--all") {
      const parent = argv[++i];
      if (!parent) { process.stderr.write("Missing path after --all\n"); return 2; }
      targets.push(...dirEntries(parent).map(s => join(parent, s)).filter(d => {
        try { return statSync(d).isDirectory(); } catch { return false; }
      }));
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Unknown option: ${arg}\n`); return 2;
    } else targets.push(arg);
  }
  if (!targets.length) {
    process.stderr.write("Usage: resume-check <ray-folder> [<ray-folder> ...] [--all rays-dir] [--json] [--threshold 70]\n");
    return 2;
  }
  const results = targets.map(d => checkResume(d));
  if (json) process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + "\n");
  else {
    process.stdout.write(formatTable(results) + "\n");
    for (const r of results) if (r.findings.length) {
      process.stdout.write(`\n${r.ray} (${r.note ?? "no note"}):\n`);
      for (const f of r.findings)
        process.stdout.write(`  ${f.severity.padEnd(8)} L${f.line}: ${f.message}\n`);
    }
  }
  return results.some(r => r.score < threshold) ? 1 : 0;
}
const self = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (self) process.exitCode = cli(process.argv.slice(2));
