// Pending AskUserQuestion for the /chat page (written by prompt-proxy/scripts/hooks/phone-ask.ts).
// GET  /api/chat/ask?session=<id>                 -> { ask: {id, questions, at} | null }
// GET  /api/chat/ask                              -> { asks: [{session, ray, id, questions, at}] } (every open question)
// POST /api/chat/answer {session, id, answers}    -> writes <session>.answer.json; the hook answers the tool.
// Only the page itself may answer (x-chat-page header, as for /api/chat/send); the server listens on this PC and
// is reached over the tailnet only.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

const dir = () => process.env.PHONE_INBOX_DIR || join(homedir(), ".claude", "phone-inbox");
const validSession = (s: string) => /^[A-Za-z0-9-]{8,80}$/.test(s);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

type Ask = { id: string; session: string; at: number; cwd?: string; questions: { question: string; options?: { label: string }[]; multiSelect?: boolean }[] };

function readAsk(session: string): Ask | null {
  const file = join(dir(), `${session}.ask.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as Ask; } catch { return null; }
}

/** Use the configured root for ray identification; otherwise show the last folder. */
const rayOf = (cwd: string) => {
  const normalized = cwd.replace(/\\/g, "/");
  const base = loadConfig().raysRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const within = normalized.toLowerCase().startsWith(base.toLowerCase() + "/")
    ? normalized.slice(base.length + 1).split("/")[0] : null;
  return within || normalized.split("/").filter(Boolean).pop() || "";
};

export async function handleChatAsk(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/chat/ask" && req.method === "GET" && !url.searchParams.has("session")) {
    let names: string[] = [];
    try { names = readdirSync(dir()).filter((n) => n.endsWith(".ask.json")); } catch { /* no inbox yet */ }
    const asks = names.map((n) => readAsk(n.slice(0, -".ask.json".length))).filter((a): a is Ask => !!a)
      .map((a) => ({ session: a.session, ray: rayOf(a.cwd ?? ""), id: a.id, at: a.at, questions: a.questions }))
      .sort((a, b) => a.at - b.at);
    return json({ asks });
  }
  if (url.pathname === "/api/chat/ask" && req.method === "GET") {
    const session = url.searchParams.get("session") ?? "";
    if (!validSession(session)) return json({ error: "unknown session" }, 400);
    const ask = readAsk(session);
    return json({ ask: ask ? { id: ask.id, at: ask.at, questions: ask.questions } : null });
  }
  if (url.pathname === "/api/chat/answer" && req.method === "POST") {
    if (req.headers.get("x-chat-page") !== "1") return json({ error: "only the chat page may answer" }, 403);
    const body = await req.json().catch(() => ({})) as { session?: string; id?: string; answers?: Record<string, unknown> };
    const session = String(body.session ?? "");
    if (!validSession(session)) return json({ error: "unknown session" }, 400);
    const ask = readAsk(session);
    if (!ask || ask.id !== body.id) return json({ error: "that question is no longer open" }, 409);
    const answers: Record<string, string> = {};
    for (const q of ask.questions) {
      const a = body.answers?.[q.question];
      if (typeof a !== "string" || !a.trim() || a.length > 4000) return json({ error: `no answer for "${q.question}"` }, 400);
      answers[q.question] = a.trim();
    }
    mkdirSync(dir(), { recursive: true });
    const file = join(dir(), `${session}.answer.json`), tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ id: ask.id, answers, at: Date.now() }));
    renameSync(tmp, file);
    return json({ ok: true });
  }
  return null;
}
