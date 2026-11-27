/** Local Claude inbox transport. Protocol reference (unofficial):
 * https://github.com/Danielrp551/claudio/blob/main/docs/protocol.md
 * https://github.com/mikekelly/cc-peer/blob/main/docs/PROTOCOL.md
 * https://github.com/S3cur3Th1sSh1t/claudemessaging (Windows key canonicalization).
 */
import { existsSync, appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import type { BoardConfig } from './config.ts';
import { editingEnabled, writeGuard } from './goal-write.ts';
import { validRay } from './session-chat.ts';

export type ChatSession = { pid: number; sessionId: string; cwd: string; messagingSocketPath: string; procStart?: string; pidDomain?: string; peerProtocol?: number; kind?: string };
const normalize = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const names = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };
export const sessionRegistryDir = () => process.env.CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
export function findSessions(dir: string, cwd: string, isAlive = alive): ChatSession[] {
  return names(dir).flatMap(name => {
    if (!/^\d+\.json$/.test(name)) return [];
    try {
      const s = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as ChatSession;
      if (!Number.isSafeInteger(s.pid) || s.pid <= 0 || name !== `${s.pid}.json` || !isAlive(s.pid) ||
          typeof s.cwd !== 'string' || normalize(s.cwd) !== normalize(cwd) ||
          typeof s.sessionId !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(s.sessionId) ||
          (s.kind && s.kind !== 'interactive')) return [];
      return [s];
    } catch { return []; }
  });
}
export function pipePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const p = value.replace(/^uds:/, '');
  return /^\\\\\.\\pipe\\(?:LOCAL\\)?cc-msg-[a-f0-9]{8,64}$/i.test(p) ? p : null;
}
export function peerToken(dir: string, s: ChatSession, pipe: string): string | null {
  const hash = createHash('sha256').update(pipe.toLowerCase()).digest('hex');
  try {
    const file = path.join(dir, `${s.pid}.${hash}.key`);
    if (!lstatSync(file).isFile()) return null;
    const key = JSON.parse(readFileSync(file, 'utf8'));
    const keyStart = key.procStartFt ?? key.procStart;
    if (!s.procStart || String(keyStart) !== String(s.procStart) || (s.pidDomain && key.pidDomain && key.pidDomain !== s.pidDomain)) return null;
    return typeof key.peerToken === 'string' && /^[a-f0-9]{32}$/i.test(key.peerToken) ? key.peerToken : null;
  } catch { return null; }
}
export function messageFrames(token: string, text: string, sessionId: string): string {
  // No fabricated sender endpoint or permission attestation. Receiver may hold for approval.
  return JSON.stringify({ type: 'auth', token }) + '\n' + JSON.stringify({ msgV: 1,
    msg_id: 'cc-msg-' + randomUUID().replace(/-/g, ''), type: 'user', priority: 'next', session_id: sessionId,
    message: { role: 'user', content: '<cross-session-message from-name="ray-board">\n' + text + '\n</cross-session-message>' } }) + '\n';
}
/** Only connection failures are safe to retry via a file; after connect delivery is ambiguous. */
export function writePipe(pipe: string, frames: string): Promise<'written' | 'unavailable' | 'uncertain'> {
  return new Promise(resolve => {
    let connected = false, done = false;
    const socket = createConnection(pipe);
    const finish = (result: 'written' | 'unavailable' | 'uncertain') => {
      if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(result);
    };
    const timer = setTimeout(() => finish(connected ? 'uncertain' : 'unavailable'), 5000);
    socket.on('error', () => finish(connected ? 'uncertain' : 'unavailable'));
    socket.on('close', () => finish(connected ? 'uncertain' : 'unavailable'));
    socket.on('connect', () => { connected = true; socket.end(frames, () => finish('written')); });
  });
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
function contained(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function saveFallback(root: string, text: string, now: Date) {
  const plans = path.join(root, 'plans');
  mkdirSync(plans, { recursive: true });
  if (!contained(root, realpathSync(plans))) throw Error('unsafe plans directory');
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const file = path.join(plans, `${date}-from-board-chat.md`);
  try { if (!lstatSync(file).isFile() || !contained(root, realpathSync(file))) throw Error('unsafe plan file'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  appendFileSync(file, `\n\n## Board chat — ${now.toISOString()}\n\n${text}\n`, { encoding: 'utf8', flag: 'a' });
  return `plans/${path.basename(file)}`;
}
export type ChatSendOptions = { sessionsDir?: string; inboxDir?: string; isAlive?: (pid: number) => boolean; transport?: typeof writePipe; now?: () => Date };
/** Best-effort direct message to a ray's live session (no fallback file). Owner 26 Nov: a board decision
 * answer should reach the session at once, not at its next wake. */
export async function notifySession(raysRoot: string, ray: string, text: string): Promise<boolean> {
  try {
    const cwd = path.join(raysRoot, ray), dir = sessionRegistryDir();
    const sessions = findSessions(dir, cwd);
    if (sessions.length !== 1) return false;
    const s = sessions[0]!;
    // Owner 27 Nov ("wtf"): pipe messages pop an approval prompt in the terminal. Use the wake-hook inbox, like board chat.
    if (/^[0-9a-f-]{36}$/i.test(s.sessionId)) {
      const inbox = process.env.PHONE_INBOX_DIR ?? path.join(homedir(), '.claude', 'phone-inbox');
      mkdirSync(inbox, { recursive: true });
      appendFileSync(path.join(inbox, s.sessionId + '.jsonl'), JSON.stringify({ text, at: new Date().toISOString(), from: 'board' }) + String.fromCharCode(10));
      return true;
    }
    if (!(s.peerProtocol === undefined || s.peerProtocol === 1)) return false;
    const pipe = pipePath(s.messagingSocketPath), token = pipe && peerToken(dir, s, pipe);
    if (!pipe || !token) return false;
    return (await writePipe(pipe, messageFrames(token, text, s.sessionId))) === "written";
  } catch { return false; }
}
function switching(ray: string): boolean {
  try {
    const dir = process.env.RAY_RESTARTS_DIR ?? path.join(homedir(), '.ray-restarts');
    const st = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'))?.rays?.[ray];
    return ['opening-successor', 'awaiting-confirm', 'closing-old'].includes(st?.phase);
  } catch { return false; }
}
export async function handleChatSend(req: Request, config: BoardConfig, remoteAddress: string | undefined, options: ChatSendOptions = {}): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (! [[127,0,0,1].join("."), '::1', ("::ffff:" + [127,0,0,1].join("."))].includes(remoteAddress ?? '') || !editingEnabled(config) ||
      process.env.RAY_BOARD_DEMO === '1' || process.env.RAY_BOARD_DEMO === 'true') return json({ error: 'local only or disabled' }, 403);
  const denied = writeGuard(req, config, true); if (denied) return denied;
  if (req.headers.get('origin') !== new URL(req.url).origin) return json({ error: 'same origin required' }, 403);
  const ray = /^\/api\/rays\/([a-z0-9_-]+)\/chat$/i.exec(new URL(req.url).pathname)?.[1] ?? '';
  if (!validRay(ray)) return json({ error: 'bad ray' }, 400);
  const body = await req.json().catch(() => null);
  const text = body?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 16000 || text.includes('\0')) return json({ error: 'invalid message' }, 400);
  let root: string;
  const cwd = path.join(config.raysRoot, ray);
  try { root = realpathSync(cwd); if (!contained(realpathSync(config.raysRoot), root) || !statSync(root).isDirectory()) throw Error(); }
  catch { return json({ error: 'unknown or unsafe ray' }, 404); }
  // Owner 27 Nov: the gate is written when a handover is asked for, long before a successor exists; the old
  // session keeps working and must keep getting the owner's messages. Block only while sessions are switching.
  if (existsSync(path.join(root, ".restart-gate.json")) && switching(ray)) return json({ error: "the session is switching to its successor; try again in a minute" }, 409);
  const dir = options.sessionsDir ?? sessionRegistryDir();
  const sessions = findSessions(dir, cwd, options.isAlive);
  if (sessions.length > 1) return json({ error: 'multiple live sessions for this ray; close the extra session first' }, 409);
  const s = sessions[0];
  let reason = 'no live compatible session';
  // Owner 27 Nov: pipe messages are held for approval in the terminal. The owner's own words from the local board
  // go to the session's wake-hook inbox instead, which the Stop hook delivers as the owner's next message.
  if (s && /^[0-9a-f-]{36}$/i.test(s.sessionId) && !options.transport) {
    try {
      const inbox = options.inboxDir ?? process.env.PHONE_INBOX_DIR ?? path.join(homedir(), '.claude', 'phone-inbox');
      mkdirSync(inbox, { recursive: true });
      appendFileSync(path.join(inbox, s.sessionId + '.jsonl'), JSON.stringify({ text, at: new Date().toISOString(), from: 'board' }) + String.fromCharCode(10));
      return json({ ok: true, mode: 'inbox', session: s.sessionId, message: 'Delivered to the session when its current step ends.' }, 202);
    } catch { reason = 'inbox write failed'; }
  }
  if (s && (s.peerProtocol === undefined || s.peerProtocol === 1)) {
    const pipe = pipePath(s.messagingSocketPath);
    const token = pipe && peerToken(dir, s, pipe);
    if (pipe && token) {
      const result = await (options.transport ?? writePipe)(pipe, messageFrames(token, text, s.sessionId));
      if (result !== 'unavailable') return json({ ok: result === 'written', mode: result === 'written' ? 'submitted' : 'uncertain', session: s.sessionId,
        message: result === 'written' ? 'Submitted to pipe; delivery is unconfirmed and may require terminal approval.' : 'Delivery uncertain; check the transcript before retrying.' }, result === 'written' ? 202 : 502);
      reason = 'pipe unavailable';
    } else reason = 'missing compatible local pipe or peer key';
  }
  try { return json({ ok: true, mode: 'fallback', file: saveFallback(root, text, (options.now ?? (() => new Date()))()), reason }, 202); }
  catch { return json({ error: 'could not save fallback plan' }, 500); }
}
