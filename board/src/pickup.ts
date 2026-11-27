import { homedir } from "node:os";
/** Ray Stop-hook pickup policy. Kept byte-identical in rays/pickup.ts and board src/pickup.ts
 * so the hook works without a board checkout and the board predicts exactly the same selection. */
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const STATE_FILE = ".pickup-state.json";
export const DAILY_CAP = 20;
const SID = /^[A-Za-z0-9-]{8,80}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const OWNERS = new Set(["session", "sub-agent", "subagent", "handoff"]);
export type Card = { result: string; index: number; raw: string; text: string; mark: " " | "~" | "x"; must: boolean; who: string; owners: string[]; shared: boolean; decision?: string; key: string };
export type StopInput = { session_id?: unknown; cwd?: unknown; stop_hook_active?: unknown };
export type Block = { decision: "block"; reason: string };
type Last = { key: string; at: string };
type SessionState = { day: string; count: number; last?: Last };
type State = { version: 1; sessions: Record<string, SessionState> };
type Options = { root?: string; now?: Date; quietHours?: string; asyncRewake?: boolean };
const empty = (): State => ({ version: 1, sessions: {} });
const readJson = (file: string): any => JSON.parse(readFileSync(file, "utf8"));
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** RPM assignments may name several roles in one group or separate timed groups.
 * Keep this parser in the standalone pickup module so the Stop hook and board agree. */
export function parseAssignment(text: string): { text: string; owners: string[]; durations: string[]; shared: boolean } {
  const paren = /\(([^()]*)\)\s*$/.exec(text);
  const owners: string[] = [], durations: string[] = [];
  let sequential = false;
  if (paren) {
    const inner = paren[1]!;
    sequential = /(?:^|[,;])\s*then\s+/i.test(inner);
    const role = /(?:^|[,;])\s*(?:then\s+)?(session|sub-agent|subagent|handoff|owner|agent|claude|chatgpt)\b/gi;
    for (const m of inner.matchAll(role)) {
      const name = m[1]!.toLowerCase();
      if (!owners.includes(name)) owners.push(name);
    }
    // Preserve qualifiers (e.g. 10m login) and the order of timed groups.
    for (const group of inner.split(/[,;]/)) {
      const time = /^\s*((?:\d+(?:\.\d+)?\s*(?:min|m|h|d|w)\b|done\b).*?)\s*$/i.exec(group);
      if (time) durations.push(time[1]!);
    }
    if (owners.length || durations.length) text = text.slice(0, paren.index).trim();
  }
  return { text, owners, durations, shared: !sequential && owners.includes("owner") && owners.some(w => OWNERS.has(w)) };
}

/** Only checkboxes inside a numbered result's Plan are work; proof and decision belong to the preceding card. */
export function parsePickupCards(md: string): Card[] {
  const cards: Card[] = [], occurrences = new Map<string, number>();
  let result = "", title = "", plan = false, index = 0, current: Card | undefined;
  for (const line of md.split(/\r?\n/)) {
    const heading = /^##\s+(\d+)\s*[.)]\s*(.*?)\s*$/.exec(line);
    if (heading) { [, result, title] = heading; plan = false; index = 0; current = undefined; continue; }
    if (/^#{1,3}\s/.test(line)) { plan = false; current = undefined; continue; }
    if (/^\s*[-*+]\s+\*\*Plan:\*\*/i.test(line)) { plan = !!result; current = undefined; continue; }
    if (/^\s*[-*+]\s+\*\*[^*]+:\*\*/.test(line)) { plan = false; current = undefined; continue; }
    if (!plan) continue;
    const step = /^\s+[-*+]\s+\[( |~|x|X)\]\s?(.*)$/.exec(line);
    if (step) {
      const raw = step[2]!.trim(), must = /^\*/.test(raw);
      const { text, owners, shared } = parseAssignment(raw.replace(/^\*\s*/, ""));
      const identity = JSON.stringify([title, raw]);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      const key = createHash("sha256").update(JSON.stringify([identity, occurrence])).digest("hex");
      current = { result, index: index++, raw, text, must, who: owners[0] ?? "", owners, shared, mark: step[1]!.toLowerCase() as Card["mark"], key };
      cards.push(current); continue;
    }
    const decision = /^\s+decision:\s*(.*?)\s*$/i.exec(line);
    if (current && decision) { current.decision = decision[1] || "!invalid"; continue; }
    if (/^\s+proof:\s*/i.test(line)) continue;
    if (line.trim()) { current = undefined; if (!/^\s/.test(line)) plan = false; }
  }
  return cards;
}

/** Fail closed for missing, malformed or unanswered decision links. The board can answer in pending/
 * without moving the request; archived decisions use answered/. A pending request takes precedence. */
export function decisionAnswered(dir: string, id: string): boolean {
  if (!ID.test(id)) return false;
  for (const area of ["pending", "answered"]) {
    const base = join(dir, "decisions", area);
    const file = join(base, `${id}.json`);
    if (!existsSync(file)) continue;
    try {
      const d = readJson(file), a = readJson(join(base, `${id}.answer.json`));
      return d?.id === id && Array.isArray(d.options) && typeof a?.key === "string" &&
        typeof a.note === "string" && a.note.length <= 500 && typeof a.at === "string" &&
        Number.isFinite(Date.parse(a.at)) && (d.allowNote === true || !a.note.trim()) &&
        (a.key ? d.options.some((o: any) => o?.key === a.key) : d.allowNote === true && !!a.note.trim());
    } catch { return false; }
  }
  return false;
}
export const isSessionCard = (c: Card) => OWNERS.has(c.who) || (c.shared && c.owners.some(w => OWNERS.has(w)));
export function selectNext(cards: Card[], answered: (id: string) => boolean): Card | null {
  // One session's execution lane per ray: an agent-owned running card precludes another pickup.
  if (cards.some(c => c.mark === "~" && isSessionCard(c))) return null;
  const eligible = cards.filter(c => c.mark === " " && isSessionCard(c) && (!c.decision || answered(c.decision)));
  return eligible.find(c => c.must) ?? eligible[0] ?? null;
}

/** Local machine time, inclusive start/exclusive end, including midnight-crossing intervals.
 * An invalid nonempty setting disables pickup rather than accidentally waking overnight. */
export function inQuietHours(value: string | undefined, now: Date): boolean {
  if (!value?.trim()) return false;
  const m = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return true;
  const start = Number(m[1]) * 60 + Number(m[2]), end = Number(m[3]) * 60 + Number(m[4]);
  const minute = now.getHours() * 60 + now.getMinutes();
  return start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
}
function readState(dir: string): State {
  try {
    const data = readJson(join(dir, STATE_FILE));
    if (data?.version !== 1 || !data.sessions || typeof data.sessions !== "object" || Array.isArray(data.sessions)) throw Error("invalid pickup state");
    for (const [sid, s] of Object.entries(data.sessions) as [string, SessionState][]) {
      if (!SID.test(sid) || !s || !/^\d{4}-\d\d-\d\d$/.test(s.day) || !Number.isInteger(s.count) || s.count < 0 ||
          (s.last && (!/^[a-f0-9]{64}$/.test(s.last.key) || !Number.isFinite(Date.parse(s.last.at))))) throw Error("invalid pickup session state");
    }
    return data;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty(); throw e; }
}
function saveState(dir: string, state: State) {
  const file = join(dir, STATE_FILE), tmp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(state) + "\n", { flag: "wx" }); renameSync(tmp, file); }
  finally { try { unlinkSync(tmp); } catch {} }
}
function loadCards(dir: string): Card[] { return parsePickupCards(readFileSync(join(dir, "GOALS.md"), "utf8")); }
function pauseReason(dir: string, root: string, now: Date, quiet?: string): string | null {
  if (existsSync(join(root, "WAKE-PAUSED"))) return "Automatic wake-ups paused";
  if (existsSync(join(dir, ".no-pickup"))) return "Pickup disabled (.no-pickup)";
  if (inQuietHours(quiet, now)) return "Pickup quiet hours";
  return null;
}
function rayDir(cwd: unknown, root: string): string | null {
  if (typeof cwd !== "string" || !cwd) return null;
  // Windows paths are native on the production machine; injected roots enable portable tests.
  const rel = relative(resolve(root), resolve(cwd)), ray = rel.split(/[\\/]/)[0] ?? "";
  if (!ray || ray === ".." || isAbsolute(rel) || !/^[A-Za-z0-9][\w.-]{0,63}$/.test(ray)) return null;
  return join(root, ray);
}
export type Preview = { nextCard: Card | null; pickupStatus: string | null; picked: { card: Card; at: string }[] };
/** Read only: board never claims work or increments the cap. No session ID is exposed in the API. */
export function pickupPreview(dir: string, options: Options = {}): Preview {
  const now = options.now ?? new Date(), root = options.root ?? resolve(dir, "..");
  try {
    const cards = loadCards(dir), state = readState(dir);
    const picked = cards.filter(c => c.mark !== "x").flatMap(card => {
      const at = Object.values(state.sessions).map(s => s.last).filter(s => s?.key === card.key)
        .map(s => s!.at).sort().at(-1);
      return at ? [{ card, at }] : [];
    });
    const next = selectNext(cards, id => decisionAnswered(dir, id));
    const paused = pauseReason(dir, root, now, options.quietHours ?? process.env.RAY_PICKUP_QUIET_HOURS);
    return { nextCard: paused ? null : next, pickupStatus: paused ?? (next ? null :
      cards.some(c => c.mark === "~" && isSessionCard(c)) ? "Session card running" : "No eligible card"), picked };
  } catch { return { nextCard: null, pickupStatus: "Pickup plan or state unavailable", picked: [] }; }
}
export function pickup(input: StopInput, options: Options = {}): Block | null {
  const root = options.root ?? process.env.KEEPER_WAKE_RAYS ?? join(homedir(), "rays");
  const sid = typeof input.session_id === "string" ? input.session_id : "";
  const dir = rayDir(input.cwd, root), now = options.now ?? new Date();
  if (!dir || !SID.test(sid) || pauseReason(dir, root, now, options.quietHours ?? process.env.RAY_PICKUP_QUIET_HOURS)) return null;
  const lock = join(dir, ".pickup-state.lock");
  let fd: number;
  try { fd = openSync(lock, "wx"); }
  catch {
    // A crashed hook cannot disable pickup permanently. Do not retry in this invocation.
    try { if (Date.now() - statSync(lock).mtimeMs > 60_000) unlinkSync(lock); } catch {}
    return null;
  }
  try {
    const cards = loadCards(dir), state = readState(dir);
    const next = selectNext(cards, id => decisionAnswered(dir, id));
    if (!next) return null;
    const day = localDay(now), prior = state.sessions[sid];
    const count = prior?.day === day ? prior.count : 0;
    if (count >= DAILY_CAP) return null;
    // A continuation may pick a different card after finishing; never repeat an unchanged card
    // during a Stop-hook continuation. Also deduplicate overlapping callbacks from the same turn.
    if (prior?.last?.key === next.key && (input.stop_hook_active === true || now.getTime() - Date.parse(prior.last.at) < (options.asyncRewake ? 300_000 : 2000))) return null;
    // Avoid double assignment while another session is still marking its offered card.
    if (Object.entries(state.sessions).some(([other, s]) => other !== sid && s.last?.key === next.key &&
      now.getTime() - Date.parse(s.last.at) < 5 * 60_000)) return null;
    state.sessions[sid] = { day, count: count + 1, last: { key: next.key, at: now.toISOString() } };
    // Bound history while retaining the current local day and recent pickup labels.
    for (const [id, s] of Object.entries(state.sessions)) if (s.day !== day && s.last &&
      now.getTime() - Date.parse(s.last.at) > 30 * 86400_000) delete state.sessions[id];
    saveState(dir, state);
    return { decision: "block", reason: `Next card (result #${next.result}): ${next.text}. Mark it [~] in GOALS.md, do it${next.shared ? " (only the session/agent part; leave the owner part open until the owner completes it)" : next.who === "session" ? "" : ` (start the ${next.who})`}, ${next.shared ? "record proof of your part; if the owner still has work, leave the card open and assign the remaining work to the owner only. Mark [x] only when both parts are complete." : "then mark [x] with a proof line."} Follow existing approval and safety rules.` };
  } catch { return null; }
  finally { closeSync(fd); try { unlinkSync(lock); } catch {} }
}

/** Synchronous Stop command: exit 0 with one JSON decision, or no output. */
export function runPickup(inputText: string, options: Options = {}): string {
  try { const block = pickup(JSON.parse(inputText), options); return block ? JSON.stringify(block) + "\n" : ""; }
  catch { return ""; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(runPickup(readFileSync(0, "utf8")));
}
