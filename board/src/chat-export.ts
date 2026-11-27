// Chat export: every long session reply in a ray's live transcript becomes a Markdown note in
// <ray>/docs/changes/chat/YYYY-MM-DD-HHMM-<id>.md, so a desktop watcher can open it in md-aio
// (owner, 27 Nov: long chat replies should open by themselves, not only behind the Read button).
//
//   bun src/chat-export.ts            one pass over every ray
//   bun src/chat-export.ts --watch    a pass every 20 s
//
// A reply is long when it has more than 5 non-empty lines or more than 700 characters.
// Only replies newer than --since minutes (default 30) are written, so a first run does not flood.
// The file name carries a hash of the reply, so a reply is written once.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, lstatSync } from "node:fs";
import { home, type Settings } from "./config.ts";
import { safeUnder } from "./docs-page.ts";
import path from "node:path";
import { readChatHistory, chatPage, type ChatTurn } from "./session-chat.ts";

export const MAX_LINES = 5;
export const MAX_CHARS = 700;

export function isLong(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return lines > MAX_LINES || text.length > MAX_CHARS;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function noteName(turn: ChatTurn): string {
  const d = turn.at ? new Date(turn.at) : new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const id = createHash("sha1").update(turn.text).digest("hex").slice(0, 8);
  return `${stamp}-${id}.md`;
}

export function noteBody(ray: string, turn: ChatTurn): string {
  return `# ${ray}, ${turn.at ? new Date(turn.at).toLocaleString("en-GB") : ""}\n\n${turn.text.trim()}\n`;
}

/** Writes the long session replies of `turns` newer than `sinceMs` into `dir`; returns the new files. */
export function exportTurns(ray: string, turns: ChatTurn[], dir: string, sinceMs: number): string[] {
  const out: string[] = [];
  for (const t of turns) {
    if (t.role !== "session" || !t.text || !isLong(t.text)) continue;
    if (t.at && Date.parse(t.at) < sinceMs) continue;
    const file = path.join(dir, noteName(t));
    if (existsSync(file)) continue;
    mkdirSync(dir, { recursive: true });
    try{writeFileSync(file, noteBody(ray, t), {encoding:"utf8",flag:"wx"});}catch(e:any){if(e.code==="EEXIST")continue;throw e;}
    out.push(file);
  }
  return out;
}

export function chatFor(s:Settings,ray:string,before:number|null=null,limit=100){
  const root=s.claudeProjectsDir||path.join(home(),'.claude','projects');
  const key=path.resolve(s.root,ray).replace(/[:\\/]/g,'-');const dir=safeUnder(root,key);
  let turns:ChatTurn[]=[];
  if(dir){const files=readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.jsonl')).map(e=>path.join(dir,e.name)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);if(files.length)turns=readChatHistory(files[0]!);}
  // The export destination must not traverse a symlink or junction.
  if(!turns.length)return chatPage([],before,limit);
  let base=path.resolve(s.root,ray);for(const component of ['docs','changes','chat']){base=path.join(base,component);if(!existsSync(base))mkdirSync(base);if(!lstatSync(base).isDirectory()||lstatSync(base).isSymbolicLink())throw Error('Unsafe chat export directory');}
  exportTurns(ray,turns,base,Date.now()-30*60_000);
  return chatPage(turns.filter(t=>t.role!== 'system'&&t.text),before,limit);
}
