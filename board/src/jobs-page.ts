/** Every handoff, live from the bridge ledger, in the board's own look. Per ray: replies that came back
 * and wait to be applied first (loud), then running and queued, then the rest. "ChatGPT time" is the
 * ledger's minutes (wall time of the last attempt). Applied also counts a commit that names the job,
 * like the board does (src/commit-match.ts). Cached 30 s. */
import { readLedger } from "./ledger-reader.ts";
import { ledgerRay } from "./goals.ts";
import { loadConfig } from "./config.ts";
import { rayNames } from "./domain/fsreader.ts";
import { applyCommitEvidence } from "./commit-match.ts";
import { replyDiffs, replyDiffLabel, type ReplyDiff } from "./reply-diffs.ts";

let cache: { at: number; root: string; html: string } | null = null;
export async function renderJobsPage(root = loadConfig().raysRoot): Promise<string> {
  if (cache && cache.root === root && Date.now() - cache.at < 30_000) return cache.html;
  const html = await build(root);
  cache = { at: Date.now(), root, html };
  return html;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const pad = (n: number) => String(n).padStart(2, "0");
// The board runs on the owner's PC: local time.
const local = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? "" : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const when = (j: any) => String(j.finishedAt ?? j.startedAt ?? j.pushedAt ?? "");

// Plain words and a tone per ledger state. Order = how loudly it asks for the ray's attention.
export const STATES: Record<string, { word: string; tone: string; rank: number }> = {
  done: { word: "back, not applied yet", tone: "wait", rank: 0 },
  sending: { word: "sending", tone: "busy", rank: 1 },
  running: { word: "ChatGPT working", tone: "busy", rank: 2 },
  queued: { word: "queued", tone: "dim", rank: 3 },
  waiting: { word: "queued", tone: "dim", rank: 3 },
  "done-zip-missing": { word: "reply files lost", tone: "hot", rank: 4 },
  failed: { word: "failed", tone: "hot", rank: 5 },
  stale: { word: "stuck", tone: "hot", rank: 6 },
  dead: { word: "lost", tone: "hot", rank: 7 },
  // Old replies nobody applied: listed, but quiet, so they don't bury the fresh ones.
  "unapplied-late": { word: "back long ago, never applied", tone: "old", rank: 8 },
  applied: { word: "applied", tone: "done", rank: 9 },
  superseded: { word: "skipped", tone: "dim", rank: 10 },
};
const stateOf = (s: string) => STATES[s] ?? { word: s, tone: "dim", rank: 11 };

function row(j: any, ray: string, rd?: ReplyDiff): string {
  const st = String(j.state ?? ""), s = stateOf(st);
  const url = j.chatUrl ?? j.conversationUrl ?? (j.chatId ? `https://chatgpt.com/c/${j.chatId}` : "");
  const commit = st === "applied" ? String(j.appliedCommit ?? j.applied ?? "").match(/[0-9a-f]{7,40}/i)?.[0] : "";
  const why = st === "failed" ? j.failureReason : st === "superseded" ? (j.supersedeReason ?? j.supersededReason) : st === "applied" ? (j.appliedBy ?? "") : "";
  const mins = j.minutes != null ? `${Math.round(j.minutes)} min` : "";
  const name = url ? `<a class="name" href="${esc(url)}" target="_blank" rel="noopener" title="Open the ChatGPT conversation">${esc(j.name)}</a>` : `<span class="name">${esc(j.name)}</span>`;
  const diff = commit ? `<a class="commit" href="/board/diff?ray=${encodeURIComponent(ray)}&job=${encodeURIComponent(j.name)}" target="_blank">${esc(commit)} diff</a>` : "";
  const prompt = j.promptPreview ?? j.prompt ?? "", reply = j.replyPreview ?? j.reply ?? "";
  // A waiting reply laid over the repo as branch reply/<job> by the coordinator: its size and diff.
  const pending = !commit && rd ? (rd.link ? `<a class="commit" href="${esc(rd.link)}" target="_blank">${esc(replyDiffLabel(rd))} diff</a>` : `<span class="mins">${esc(replyDiffLabel(rd))}</span>`) : "";
  return `<li class="job ${s.tone}" data-state="${esc(st)}">
  <div class="line">${name}<span class="chip ${s.tone}">${esc(s.word)}</span><span class="mins" title="ChatGPT time on the last attempt">${esc(mins)}</span><span class="when">${esc(local(when(j)))}</span>${diff}${pending}</div>
  ${why ? `<div class="why">${esc(why)}</div>` : ""}
  ${prompt || reply ? `<details><summary>prompt and reply</summary>${prompt ? `<pre>${esc(prompt)}</pre>` : ""}${reply ? `<pre class="reply">${esc(reply)}</pre>` : ""}</details>` : ""}
</li>`;
}

async function build(root: string): Promise<string> {
  const config = loadConfig();
  const ledger = config.integrations.ledger.enabled || process.env.RAY_BOARD_LEDGER_FIXTURE
    ? await readLedger(root, Date.now(), config.integrations.ledger.path) : { jobs: [], error: null };
  const live = new Set(rayNames(root));
  const byRay = new Map<string, any[]>();
  for (const j of ledger.jobs as any[]) {
    const r = ledgerRay(j) ?? "";
    if (!byRay.has(r)) byRay.set(r, []);
    byRay.get(r)!.push(j);
  }
  const diffs = replyDiffs(root);
  const sections = [...byRay.entries()].map(([ray, jobs]) => {
    const own = live.has(ray) ? applyCommitEvidence(root, ray, jobs) : jobs;
    own.sort((a, b) => stateOf(a.state).rank - stateOf(b.state).rank || when(b).localeCompare(when(a)));
    const waiting = own.filter((j) => j.state === "done").length;
    const working = own.filter((j) => ["running", "sending", "queued", "waiting"].includes(j.state)).length;
    const old = own.filter((j) => j.state === "unapplied-late").length;
    const head = [waiting ? `<span class="count wait">${waiting} back, waiting to be applied</span>` : "",
      working ? `<span class="count busy">${working} at ChatGPT</span>` : "",
      old ? `<span class="count old">${old} older never applied</span>` : ""].join("");
    return { ray, live: live.has(ray), waiting, html: `<section class="ray" data-ray="${esc(ray)}" data-live="${live.has(ray) ? 1 : 0}">
<h2>${esc(ray || "unknown")}${head}</h2><ul>${own.map((j) => row(j, ray, diffs.get(`${ray.toLowerCase()}/${j.name}`))).join("")}</ul></section>` };
  }).sort((a, b) => Number(b.live) - Number(a.live) || b.waiting - a.waiting || a.ray.localeCompare(b.ray));

  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Handoffs</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root { --ink:#0E1621; --row:#132033; --rule:#22344A; --text:#E3EAF2; --soft:#B6C3D1; --mute:#7C8FA4; --dim:#4A5D73; --busy:#F3B64C; --done:#4CC2B4; --hot:#F07A5A; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--ink); color:var(--text); font:400 15px/1.4 "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
nav { display:flex; gap:16px; align-items:center; padding:12px 18px; border-bottom:1px solid var(--rule); background:var(--row); }
nav a { color:var(--soft); text-decoration:none; } nav a:hover { color:var(--text); }
.bar { display:flex; gap:10px; flex-wrap:wrap; margin-left:auto; }
select, input { font:inherit; color:var(--text); background:var(--ink); border:1px solid var(--rule); border-radius:4px; padding:3px 8px; }
#c { color:var(--mute); align-self:center; }
.ray { padding:12px 18px 4px; border-bottom:1px solid var(--rule); }
h2 { margin:0 0 6px; font-size:19px; font-weight:600; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
.count { font-size:14px; font-weight:500; } .count.wait { color:var(--busy); } .count.busy { color:var(--soft); } .count.old { color:var(--dim); }
ul { list-style:none; margin:0; padding:0; }
.job { padding:6px 0 6px 10px; border-left:3px solid transparent; border-top:1px solid var(--rule); }
.job.wait { border-left-color:var(--busy); background:#1a2433; } .job.hot { border-left-color:var(--hot); }
.line { display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
.name { color:var(--text); text-decoration:none; font-weight:500; } a.name:hover { text-decoration:underline; }
.chip { font-size:13px; padding:0 7px; border-radius:3px; border:1px solid var(--rule); color:var(--mute); white-space:nowrap; }
.chip.wait { color:var(--busy); border-color:var(--busy); font-weight:600; } .chip.busy { color:var(--busy); border-color:var(--busy); }
.chip.done { color:var(--done); border-color:var(--done); } .chip.old { color:var(--mute); }
.job.old .name { color:var(--soft); font-weight:400; } .chip.hot { color:var(--hot); border-color:var(--hot); } .chip.dim { color:var(--dim); }
.mins, .when { color:var(--mute); font-size:13px; } .commit { color:var(--done); font-size:13px; }
.why { color:var(--soft); font-size:13px; margin-top:2px; }
details { margin-top:2px; } summary { color:var(--dim); font-size:13px; cursor:pointer; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; background:var(--row); color:var(--soft); padding:8px; border-radius:4px; font-size:13px; margin:4px 0; max-width:110ch; user-select:text; }
pre.reply { border-left:2px solid var(--done); }
@media (max-width:600px) { nav { flex-wrap:wrap; } .bar { margin-left:0; } }
</style>
<nav><a href="/board">board</a><a href="/board/handoffs">timeline</a>
<div class="bar"><select id="ray"><option value="">running rays</option><option value="*">all rays</option>${[...byRay.keys()].sort().map((r) => `<option>${esc(r)}</option>`).join("")}</select>
<select id="st"><option value="">all states</option>${[...new Map(Object.entries(STATES).map(([k, v]) => [v.word, k])).entries()].map(([w, k]) => `<option value="${k}">${esc(w)}</option>`).join("")}</select>
<input id="q" placeholder="job name"><span id="c"></span></div></nav>
<main>${sections.map((s) => s.html).join("\n")}</main>
<script>
const f=()=>{const r=ray.value,s=st.value,q=document.getElementById('q').value.toLowerCase();let n=0;
for(const sec of document.querySelectorAll('section.ray')){const showRay=r==='*'||(r===''?sec.dataset.live==='1':sec.dataset.ray===r);let m=0;
for(const li of sec.querySelectorAll('li.job')){const ok=showRay&&(!s||li.dataset.state===s||(s==='queued'&&li.dataset.state==='waiting'))&&(!q||li.textContent.toLowerCase().includes(q));li.style.display=ok?'':'none';if(ok)m++;}
sec.style.display=m?'':'none';n+=m;}
c.textContent=n+' jobs';};
for(const e of [ray,st,document.getElementById('q')])e.oninput=f;f();
</script></html>`;
}
