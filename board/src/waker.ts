// Waker (owner, 26 Nov: "it should react whenever handoff result comes in or whenever we edit something on the board
// blocks; or even whenever it rests for 5 mins without doing anything it should wake up and scan the current blocks").
// Every minute, for each ray with one live idle Claude session, send one message into the session when:
//   reply  - a handoff reply landed that is not marked applied,
//   board  - GOALS.md (the board's blocks) changed after the session last moved,
//   idle   - idle 5+ min with open plan cards (at most once per 30 min: every wake re-reads the whole context).
// Never while busy, never twice within 5 min, never for rays with .no-pickup or .no-wake.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { findSessions, sessionRegistryDir, pipePath, peerToken, messageFrames, writePipe } from "./chat-send.ts";

const ROOT = process.env.RAYS_ROOT ?? path.join(homedir(), "rays");
const STATE = path.join(homedir(), ".ray-restarts", "waker.json");
const MIN_GAP = 5 * 60_000, IDLE_AFTER = 5 * 60_000, IDLE_GAP = 30 * 60_000, SETTLE = 60_000;
type RayWake = { at: number; kind: string; replies?: string[] };
let state: Record<string, RayWake> = {};
try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}
const save = () => { try { writeFileSync(STATE, JSON.stringify(state, null, 1)); } catch {} };
const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };

function sessionInfo(ray: string): { status: string; updatedAt: number } | null {
  const want = path.resolve(ROOT, ray).toLowerCase();
  let best: { status: string; updatedAt: number } | null = null;
  try {
    for (const n of readdirSync(sessionRegistryDir())) {
      if (!n.endsWith(".json")) continue;
      try {
        const s = JSON.parse(readFileSync(path.join(sessionRegistryDir(), n), "utf8"));
        if (String(s.cwd ?? "").toLowerCase() !== want || s.kind !== "interactive") continue;
        try { process.kill(s.pid, 0); } catch (e: any) { if (e?.code !== "EPERM") continue; }
        if (!best || (s.updatedAt ?? 0) > best.updatedAt) best = { status: s.status ?? "", updatedAt: s.updatedAt ?? 0 };
      } catch {}
    }
  } catch {}
  return best;
}
export function unappliedReplies(ray: string, since: number): string[] {
  const q = path.join(ROOT, ray, ".docs", "chatgpt", "small");
  try {
    return readdirSync(q).filter((n) => /^reply-.+\.md$/.test(n)).map((n) => n.slice(6, -3))
      .filter((job) => mtime(path.join(q, `reply-${job}.md`)) > since && !existsSync(path.join(q, `zip-${job}`, ".applied")));
  } catch { return []; }
}
export function openCards(ray: string): number {
  try { return (readFileSync(path.join(ROOT, ray, "GOALS.md"), "utf8").match(/^\s+- \[( |~)\]/gm) ?? []).length; } catch { return 0; }
}
export function decide(ray: string, s: { status: string; updatedAt: number }, now: number, last?: RayWake): { kind: string; text: string; replies?: string[] } | null {
  if (existsSync(path.join(ROOT, ray, ".restart-gate.json"))) return null;
  if (s.status !== "idle" || now - s.updatedAt < SETTLE) return null;
  if (last && now - last.at < MIN_GAP) return null;
  const replies = unappliedReplies(ray, Math.max(s.updatedAt - 6 * 3600_000, 0)).filter((j) => !(last?.replies ?? []).includes(j));
  if (replies.length) return { kind: "reply", replies, text: `Waker: handoff repl${replies.length > 1 ? "ies" : "y"} landed and not applied: ${replies.join(", ")}. Apply each (read reply-<job>.md and zip-<job>/files, apply, test, commit, write .applied), then update the block it serves on the board with proof.` };
  if (mtime(path.join(ROOT, ray, "GOALS.md")) > s.updatedAt + 5_000 && (!last || mtime(path.join(ROOT, ray, "GOALS.md")) > last.at))
    return { kind: "board", text: "Waker: the owner edited your blocks on the board (GOALS.md changed). Re-read GOALS.md, act on what changed (new results, purposes, cards, owner notes), mark the card you pick up [~], and keep the plan moving." };
  const cards = openCards(ray);
  if (cards && now - s.updatedAt >= IDLE_AFTER && (!last || last.kind !== "idle" || now - last.at >= IDLE_GAP))
    return { kind: "idle", text: `Waker: you have been idle ${Math.round((now - s.updatedAt) / 60_000)} min with ${cards} open cards. Scan every block in GOALS.md: what moves each result forward now, what needs the owner (ask on the board's decision inbox), which cards to add to finish or improve the result. Do the next card in the session or queue it as a hard handoff (keep 2+ running), then update Now with proof. If everything waits on the owner or the device, say so in one line and stop.` };
  return null;
}
async function deliver(ray: string, text: string): Promise<string> {
  if (existsSync(path.join(ROOT, ray, ".restart-gate.json"))) return "skip: handover in progress";
  const dir = sessionRegistryDir();
  const sessions = findSessions(dir, path.join(ROOT, ray));
  if (sessions.length !== 1) return `skip: ${sessions.length} sessions`;
  const s = sessions[0]!, pipe = pipePath(s.messagingSocketPath), token = pipe && peerToken(dir, s, pipe);
  if (!pipe || !token) return "skip: no pipe";
  return await writePipe(pipe, messageFrames(token, text, s.sessionId));
}
export async function pass(now = Date.now(), dry = false) {
  const rays = readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(ROOT, e.name, "GOALS.md"))).map((e) => e.name);
  for (const ray of rays) {
    if (existsSync(path.join(ROOT, ray, ".no-pickup")) || existsSync(path.join(ROOT, ray, ".no-wake"))) continue;
    const s = sessionInfo(ray); if (!s) continue;
    const d = decide(ray, s, now, state[ray]); if (!d) continue;
    const res = dry ? "dry" : await deliver(ray, d.text);
    console.log(`${new Date(now).toISOString()} ${ray}: ${d.kind} -> ${res}${d.replies ? " " + d.replies.join(",") : ""}`);
    if (res === "written" || res === "uncertain") { state[ray] = { at: now, kind: d.kind, replies: [...(state[ray]?.replies ?? []).slice(-50), ...(d.replies ?? [])] }; save(); }
  }
}
if (import.meta.main) {
  const dry = process.argv.includes("--dry-run");
  if (process.argv.includes("--once") || dry) await pass(Date.now(), dry);
  else { console.log("waker started"); for (;;) { try { await pass(); } catch (e) { console.error(String(e).slice(0, 300)); } await Bun.sleep(60_000); } }
}
