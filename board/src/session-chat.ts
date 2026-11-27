// Session chat: a readable view of a ray's live Claude Code transcript for the board's side panel.
import path from "node:path";
// The owner reads the board, not the terminal: what they asked, what the session answered, one
// line per tool call. Thinking is never shown; reminders, hook feedback and tool-result bodies are
// "system" turns or snippets the UI hides by default.
//
// Transcripts grow to tens of MB, so each file is parsed incrementally: a byte offset per file,
// and every poll reads only the bytes appended since (up to the last complete line).
import { closeSync, openSync, readSync, statSync, readdirSync } from "node:fs";

export type ChatTool = { id: string; name: string; description: string; ok: boolean | null; result?: string };
export type ChatTurn = { role: "owner" | "session" | "peer" | "system"; at: string | null; text: string; from?: string; tools: ChatTool[] };

type FileState = { file: string; offset: number; size: number; turns: ChatTurn[]; tools: Map<string, ChatTool> };

const MAX_TEXT = 20_000;
const MAX_RESULT = 400;
const MAX_TURNS = 5_000;
const CHUNK = 4 * 1024 * 1024;
const cache = new Map<string, FileState>();

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function toolDescription(name: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  const pick = input.description ?? input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.prompt ?? input.skill ?? "";
  return cut(String(pick).replace(/\s+/g, " ").trim(), 2000);
}

const SYSTEM_TAGS = /^\s*<(system-reminder|task-notification|command-name|command-message|command-args|local-command-stdout|local-command-caveat|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr)\b/;

/** Classify a user text block: a real owner message, a cross-session peer message, or system noise. */
export function classifyUserText(raw: string): { role: ChatTurn["role"]; text: string; from?: string } {
  const peer = raw.match(/<cross-session-message\b[^>]*?from-name="([^"]*)"[^>]*>([\s\S]*?)(<\/cross-session-message>|$)/);
  if (peer) return { role: "peer", from: peer[1] || "another session", text: peer[2]!.trim() };
  // Owner 27 Nov: board chat messages reach the session as Stop-hook feedback; show them as the owner's own turn.
  const board = raw.match(/typed on the dashboard's \/chat page for this session\. Treat it as their next message:\s*([\s\S]*?)\s*(?:<\/system-reminder>|&lt;\/system-reminder&gt;|$)/);
  if (board && board[1]!.trim()) return { role: "owner", text: board[1]!.trim() };
  if (SYSTEM_TAGS.test(raw)) return { role: "system", text: raw.trim() };
  const stripped = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!stripped) return { role: "system", text: raw.trim() };
  return { role: "owner", text: stripped };
}

function push(st: FileState, turn: ChatTurn) {
  turn.text = cut(turn.text, MAX_TEXT);
  st.turns.push(turn);
  if (st.turns.length > MAX_TURNS) st.turns.splice(0, st.turns.length - MAX_TURNS);
}

/** Apply one transcript event to the state. Exported for tests. */
export function applyEvent(st: FileState, e: any) {
  if (!e || typeof e !== "object" || e.isSidechain) return;
  const at = typeof e.timestamp === "string" ? e.timestamp : null;
  const content = e.message?.content;
  if (e.type === "user") {
    if (e.isMeta) {
      // Meta lines are injected, never typed by the owner; cross-session messages arrive this way.
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((b: any) => b?.text ?? "").join("\n") : "";
      const c = classifyUserText(text);
      push(st, c.role === "peer" ? { role: "peer", at, text: c.text, from: c.from, tools: [] } : { role: "system", at, text, tools: [] });
      return;
    }
    const blocks: any[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (b?.type === "tool_result") {
        const t = st.tools.get(String(b.tool_use_id));
        if (t) {
          t.ok = b.is_error !== true;
          const body = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => x?.text ?? "").join("\n") : "";
          t.result = cut(body.trim(), MAX_RESULT);
          st.tools.delete(t.id);
        }
      } else if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        const c = classifyUserText(b.text);
        push(st, { role: c.role, at, text: c.text, ...(c.from ? { from: c.from } : {}), tools: [] });
      }
    }
    return;
  }
  if (e.type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        push(st, { role: "session", at, text: b.text.trim(), tools: [] });
      } else if (b?.type === "tool_use") {
        const tool: ChatTool = { id: String(b.id ?? ""), name: String(b.name ?? "tool"), description: toolDescription(b.name, b.input), ok: null };
        let last = st.turns[st.turns.length - 1];
        if (last?.role !== "session") { last = { role: "session", at, text: "", tools: [] }; st.turns.push(last); }
        last.tools.push(tool);
        if (tool.id) st.tools.set(tool.id, tool);
      }
      // thinking blocks are never shown
    }
  }
}

export const newState = (file: string): FileState => ({ file, offset: 0, size: 0, turns: [], tools: new Map() });

/** Read whatever was appended to `file` since the last call and return all turns parsed so far. */
export function readChat(file: string): ChatTurn[] {
  let st = cache.get(file);
  let size = 0;
  try { size = statSync(file).size; } catch { cache.delete(file); return []; }
  if (!st || size < st.offset) { st = newState(file); cache.set(file, st); }
  if (size === st.offset) return st.turns;
  const fd = openSync(file, "r");
  try {
    let carry = Buffer.alloc(0);
    while (st.offset + carry.length < size) {
      const want = Math.min(CHUNK, size - st.offset - carry.length);
      const buf = Buffer.alloc(want);
      const got = readSync(fd, buf, 0, want, st.offset + carry.length);
      if (got <= 0) break;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, got)]) : buf.subarray(0, got);
      const nl = data.lastIndexOf(0x0a);
      if (nl < 0) { carry = data; continue; }
      for (const line of data.subarray(0, nl).toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try { applyEvent(st, JSON.parse(line)); } catch { /* a corrupt line is skipped */ }
      }
      st.offset += nl + 1;
      carry = data.subarray(nl + 1);
    }
  } finally { closeSync(fd); }
  st.size = size;
  return st.turns;
}

/** Page newest-last: `before` is a turn index (exclusive) from an earlier page; null = newest. */
export function chatPage(turns: ChatTurn[], before: number | null, limit: number) {
  const end = before == null ? turns.length : Math.max(0, Math.min(before, turns.length));
  const n = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  const start = Math.max(0, end - n);
  return { turns: turns.slice(start, end), start, end, total: turns.length, before: start > 0 ? start : null };
}

export const validRay = (ray: string) => /^[a-z0-9][a-z0-9_-]{0,40}$/i.test(ray);

/** Chat across sessions (owner, 26 Nov: "it should continue ... messages of past sessions ... indicated with breaker
 * when new session starts"). Every top-level transcript in the current one's folder from the last `days` days, oldest
 * first, each new session after the first opened by a "break" turn. The restart boilerplate and empty turns are dropped. */
export function readChatHistory(currentFile: string, days = 3, now = Date.now()): ChatTurn[] {
  const dir = path.dirname(currentFile);
  let files: { file: string; mtime: number; birth: number }[] = [];
  try {
    files = readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => {
      const file = path.join(dir, n), s = statSync(file);
      return { file, mtime: s.mtimeMs, birth: s.birthtimeMs || s.ctimeMs };
    }).filter((f) => f.file === currentFile || now - f.mtime < days * 86_400_000);
  } catch { return readChat(currentFile); }
  files.sort((a, b) => a.birth - b.birth);
  // Memory (26 Nov: the board died after history was added): at most 3 earlier sessions, each read once and kept
  // slim (text only, no tool calls), and its full parse dropped from the cache.
  const older = files.filter((f) => f.file !== currentFile).slice(-3);
  files = [...older, ...files.filter((f) => f.file === currentFile)];
  const out: ChatTurn[] = [];
  for (const f of files) {
    const turns = (f.file === currentFile ? readChat(f.file) : slim(f.file)).filter((t) => (t.text && t.text.trim()) || t.tools.length)
      .filter((t) => !(t.role === "owner" && /^(Fresh session\. Read |Read the newest plans\/)/.test(t.text)));
    if (!turns.length) continue;
    if (out.length) out.push({ role: "break", at: turns[0]!.at, text: "new session", tools: [] } as unknown as ChatTurn);
    out.push(...turns);
  }
  return out;
}

const slimCache = new Map<string, { size: number; turns: ChatTurn[] }>();
function slim(file: string): ChatTurn[] {
  let size = 0; try { size = statSync(file).size; } catch { return []; }
  if (size > 40_000_000) return [];
  const hit = slimCache.get(file); if (hit && hit.size === size) return hit.turns;
  const turns = readChat(file).filter((x) => x.text && x.text.trim()).map((x) => ({ role: x.role, at: x.at, text: x.text.slice(0, 4000), from: x.from, tools: [] }));
  cache.delete(file); slimCache.set(file, { size, turns });
  return turns;
}
