import { DOC_STYLE, DOC_RENDER_JS } from "./docs-page.ts";
const NOTIFICATION_TAG = "";
/** HTML for /board/projects and /board/p/<ray>. Same palette and type as /board: dense, few words. */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const HEAD = (title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0E1621"><title>${esc(title)}</title>

<style>::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2c3446;border-radius:8px;border:2px solid transparent;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:#3d4862;background-clip:padding-box}*{scrollbar-width:thin;scrollbar-color:#2c3446 transparent}${CSS}${DOC_STYLE}</style></head>`;

const CSS = `
:root { --ink:#0E1621; --row:#132033; --card:#182840; --rule:#22344A; --text:#E3EAF2; --soft:#B6C3D1; --mute:#7C8FA4; --dim:#4A5D73;
  --busy:#F3B64C; --done:#4CC2B4; --hot:#F07A5A; }
* { box-sizing:border-box; }
html, body { margin:0; background:var(--ink); color:var(--text); font:400 14px/1.35 "Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif; font-variant-numeric:tabular-nums; }
a { color:inherit; }
button { font:inherit; color:var(--soft); background:transparent; border:1px solid var(--rule); border-radius:4px; padding:2px 9px; cursor:pointer; }
button:hover { background:var(--row); color:var(--text); }
nav.top { display:flex; gap:14px; align-items:center; padding:10px 18px; border-bottom:1px solid var(--rule); background:var(--row); }
nav.top a { color:var(--soft); text-decoration:none; } nav.top a:hover { color:var(--text); }
nav.top .grow { flex:1; }
nav.top .tabs { display:inline-flex; align-items:center; gap:6px; color:var(--mute); font-size:13px; }
nav.top .tabs b { color:var(--text); font-weight:600; min-width:2ch; text-align:right; }
nav.top .tabs button { width:22px; height:22px; padding:0; border:1px solid var(--rule); border-radius:4px; background:transparent; color:var(--soft); cursor:pointer; font:inherit; line-height:1; }
nav.top .tabs button:hover { color:var(--text); border-color:var(--dim); }
nav.top .tabs i { font-style:normal; color:var(--mute); min-width:1ch; }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--dim); vertical-align:1px; }
.dot.idle { background:var(--done); } .dot.running { background:var(--busy); }
@media (prefers-reduced-motion:no-preference) { .dot.running { animation:beat 1.4s ease-in-out infinite; } }
@keyframes beat { 50% { opacity:.25; } }
.bars { display:flex; gap:3px; align-items:center; }
.bar { width:34px; height:6px; border-radius:3px; background:var(--rule); overflow:hidden; }
.bar i { display:block; height:100%; background:var(--done); }
/* list */
.list { max-width:1400px; margin:0 auto; }
.prow { display:grid; grid-template-columns:20px 130px minmax(0,1fr) auto 64px; gap:12px; align-items:center; padding:9px 18px;
  border-bottom:1px solid var(--rule); background:var(--row); cursor:pointer; }
.prow:hover { background:#16263b; }
.prow .name { font-size:17px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.prow.stopped .name { color:var(--mute); }
.prow .vision { color:var(--soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.prow .ago { color:var(--mute); text-align:right; font-size:13px; }
.prow .caret { border:0; padding:0; color:var(--dim); width:20px; }
.pmore { display:none; padding:4px 18px 10px 182px; background:var(--row); border-bottom:1px solid var(--rule); color:var(--soft); }
.pmore.open { display:block; } .pmore div { display:flex; gap:8px; align-items:center; padding:1px 0; }
.pmore .n { color:var(--mute); width:44px; text-align:right; }
dialog { background:var(--row); color:var(--text); border:1px solid var(--rule); border-radius:6px; width:min(460px, calc(100vw - 32px)); }
dialog::backdrop { background:rgba(0,0,0,.5); }
dialog label { display:block; color:var(--mute); font-size:13px; margin:8px 0 2px; }
dialog input, dialog textarea { width:100%; background:var(--ink); color:var(--text); border:1px solid var(--rule); border-radius:4px; padding:6px 8px; font:inherit; }
dialog .row { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; align-items:center; }
.err { color:var(--hot); font-size:13px; flex:1; }
/* project */
.tabs { display:flex; gap:2px; overflow-x:auto; padding:0 12px; border-bottom:1px solid var(--rule); background:var(--row); scrollbar-width:thin; }
.tabs a { padding:8px 10px; color:var(--mute); text-decoration:none; white-space:nowrap; border-bottom:2px solid transparent; }
.tabs a:hover { color:var(--text); } .tabs a.on { color:var(--text); border-bottom-color:var(--busy); }
.tabs a .dot { margin-right:5px; width:6px; height:6px; }
.proj { display:grid; grid-template-columns:minmax(0,1fr) 420px; height:calc(100vh - 48px); }
.rpm { overflow-y:auto; padding:14px 22px 60px; }
.chat { border-left:1px solid var(--rule); display:flex; flex-direction:column; min-height:0; background:var(--row); }
.chat header { display:flex; gap:10px; align-items:center; padding:8px 12px; border-bottom:1px solid var(--rule); color:var(--mute); font-size:13px; }
.chat header .grow { flex:1; }
.chat-log { overflow-y:auto; padding:8px 12px; flex:1; min-height:0; }
.turn { padding:6px 0; border-bottom:1px solid var(--rule); } .turn .who { color:var(--dim); font-size:12px; }
.turn.owner .msg { color:var(--busy); } .turn .msg p { margin:3px 0; } .turn pre { white-space:pre-wrap; font-size:12px; color:var(--soft); }
.turn .tool { color:var(--mute); font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere; }
.turn .tool.bad { color:var(--hot); } .turn .res { display:none; }
.chat-log:not(.sys) .turn:not(.break):not(:has(.msg)) { display:none; }
.turn.break { display:flex; align-items:center; gap:10px; color:var(--dim); font-size:12px; margin:14px 0; border:0; }
.turn.break::before, .turn.break::after { content:""; flex:1; border-top:1px solid var(--rule); }
.chat-log:not(.sys) .turn.system, .chat-log:not(.sys) .turn .tool { display:none; }
.chat-log.sys .turn .res { display:block; white-space:pre-wrap; color:var(--dim); }
h1 { font-size:26px; font-weight:600; margin:0 0 4px; }
.vision { font-size:19px; line-height:1.3; color:var(--text); margin:2px 0 6px; }
.meta { color:var(--soft); margin:2px 0; } .meta b { color:var(--mute); font-weight:500; margin-right:6px; }
.week { color:var(--soft); font-size:13px; margin:8px 0; }\n.limit { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:8px 0; color:var(--soft); }\n.limit input { width:64px; background:var(--ink); border:1px solid var(--rule); color:var(--text); padding:3px; border-radius:4px; font:inherit; }\n.proof-warning { color:var(--hot); } .proof { margin:10px 0; overflow-wrap:anywhere; } .proof a { color:var(--done); } .job pre { overflow-wrap:anywhere; } .job iframe { width:100%; height:360px; border:1px solid var(--rule); margin:6px 0; } .job .child { margin-left:12px; }
.docs { display:flex; flex-wrap:wrap; gap:4px 28px; margin:10px 0 4px; padding-left:22px; font-size:13px; }
.docs a { color:var(--done); text-decoration:none; } .docs a:hover { text-decoration:underline; }
.result { margin-top:18px; padding:12px 14px 14px; background:var(--row); border:1px solid var(--rule); border-radius:6px; }
.result.dragging { opacity:.4; } .result.drop { border-color:var(--busy); }
.rhead { display:flex; gap:10px; align-items:baseline; }
.rhead .num { color:var(--busy); font-weight:600; white-space:nowrap;  }
.rhead .title { font-size:18px; font-weight:500; flex:1; }
.rhead .count { color:var(--mute); font-size:13px; white-space:nowrap; }
.rtext { font-size:15px; margin:4px 0 2px; color:var(--text); }
.rpurp { color:var(--mute); margin:0 0 8px; }
.rnow { color:var(--soft); font-size:13px; margin:6px 0 0; border-top:1px solid var(--rule); padding-top:8px; }
.kanban { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin-top:6px; }
.col { min-height:40px; border-radius:4px; padding:4px; }
.col.drop { background:#1b2d46; outline:1px dashed var(--busy); }
.col h3 { margin:0 0 4px; font-size:12px; font-weight:500; color:var(--dim); display:flex; justify-content:space-between; }
.col.running h3 { color:var(--busy); } .col.done h3 { color:var(--done); }
.card { background:var(--card); border:1px solid var(--rule); border-radius:4px; padding:6px 8px; margin-bottom:5px; cursor:pointer; }
.card:hover { border-color:var(--mute); }

.col.done .card .t { color:var(--soft); }
.card .t { display:block; }
.card .m { display:flex; gap:6px; color:var(--mute); font-size:12px; margin-top:2px; }
.card .must { color:var(--busy); border:1px solid var(--busy); padding:0 4px; border-radius:3px; }
.card .j { margin-left:auto; color:var(--soft); }
.chat-compose { position:relative; margin:8px 12px 12px; border:1px solid var(--rule); border-radius:8px; background:var(--ink); }
.chat-compose:focus-within { border-color:var(--mute); }
.chat-compose button#chat-send { position:absolute; right:8px; bottom:8px; border:0; border-radius:6px; padding:5px 14px; background:var(--done); color:var(--ink); font:inherit; font-weight:600; cursor:pointer; }
.chat-compose button#chat-send:disabled { opacity:.5; }
.chat-compose textarea { display:block; width:100%; box-sizing:border-box; resize:none; font:inherit; font-size:15px; background:transparent; color:var(--text); border:0; outline:0; padding:10px 12px 40px; min-height:64px; max-height:40vh; }
.chat-compose output { position:absolute; left:12px; bottom:10px; right:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px; color:var(--mute); }
.docs-sidebar { display:none !important; } .proj.docs-open { grid-template-columns:unset; }
.pick { position:relative; } .pick > button { display:flex; align-items:center; gap:7px; background:transparent; border:0; color:var(--text); font:inherit; font-size:15px; cursor:pointer; padding:2px 4px; }
.pick > button b { font-weight:600; } .pick > button i { font-style:normal; color:var(--mute); font-size:11px; }
.pick-menu { position:absolute; top:calc(100% + 6px); left:0; z-index:20; min-width:220px; max-height:70vh; overflow:auto; background:var(--card); border:1px solid var(--rule); border-radius:6px; padding:4px; box-shadow:0 10px 30px #0008; }
.pick-menu a { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:4px; color:var(--soft); text-decoration:none; }
.pick-menu a:hover, .pick-menu a.on { background:var(--row); color:var(--text); } .pick-menu hr { border:0; border-top:1px solid var(--rule); margin:4px 0; }
nav.top .gear { background:transparent; border:0; color:var(--mute); font-size:17px; cursor:pointer; padding:2px 6px; } nav.top .gear:hover { color:var(--text); }
dialog#settings { min-width:320px; } dialog#settings label { display:flex; justify-content:space-between; align-items:center; gap:16px; margin:10px 0; color:var(--soft); }
dialog#settings input { width:72px; } dialog#settings .counts { color:var(--mute); font-size:13px; }
details.result > summary, details.lib > summary { list-style:none; cursor:pointer; } details.result > summary::-webkit-details-marker, details.lib > summary::-webkit-details-marker { display:none; }
details.result:not([open]) .rhead .count::after { content:' ▸'; } details.result[open] .rhead .count::after { content:' ▾'; }
details.lib { margin:18px 0; border-top:1px solid var(--rule); padding-top:10px; } details.lib > summary { font-size:17px; font-weight:600; color:var(--text); }
details.lib > summary span { color:var(--mute); font-weight:400; font-size:13px; margin-left:6px; }
.insight { margin:12px 0; } .insight b { display:block; color:var(--text); } .insight p { margin:3px 0 0; color:var(--soft); line-height:1.45; } .insight time, .lrow time { color:var(--dim); font-size:12px; }
.lrow { display:flex; gap:12px; align-items:baseline; padding:5px 0; border-bottom:1px solid var(--rule); } .lrow a.t { flex:1; color:var(--soft); text-decoration:none; } .lrow a.t:hover { color:var(--text); } .lrow a.pdf { color:var(--mute); font-size:12px; text-decoration:none; }
.lib .empty { color:var(--dim); }
.pcard h2 { font-size:19px; line-height:1.3; margin:0 0 4px; } .pcard .ctx { color:var(--mute); font-size:13px; margin-bottom:14px; }
.pcard .plinks { list-style:none; padding:0; margin:6px 0 14px; } .pcard .plinks li { padding:4px 0; border-bottom:1px solid var(--rule); } .pcard .plinks a { color:var(--done); text-decoration:none; }
.pcard h3 { font-size:13px; color:var(--mute); font-weight:500; margin:16px 0 4px; }
.card.failed { border-color:var(--hot); }
.card .fail { color:var(--hot); font-size:12px; margin-top:3px; display:block; }
.card .fail b { font-weight:500; background:var(--hot); color:var(--ink); border-radius:3px; padding:0 4px; margin-right:4px; }
.job .fr { color:var(--hot); font-size:13px; }
.card .j.live::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--busy); margin-right:4px; vertical-align:1px; }
.add { width:100%; border-style:dashed; color:var(--dim); }
[contenteditable="true"] { outline:1px solid var(--busy); border-radius:3px; background:var(--ink); padding:0 3px; }
.editable:hover { outline:1px dashed var(--dim); border-radius:3px; cursor:text; }
.newres { margin-top:14px; }
aside.panel { position:fixed; top:0; right:0; bottom:0; width:min(560px, 100vw); background:var(--row); border-left:1px solid var(--rule);
  overflow-y:auto; padding:12px 16px 40px; z-index:10; box-shadow:-10px 0 30px rgba(0,0,0,.4); }
aside.panel[hidden] { display:none; }
aside.panel .close { float:right; }
aside.panel h2 { font-size:18px; font-weight:500; margin:2px 40px 8px 0; }
.marks { display:flex; gap:6px; margin:4px 0 10px; } .marks button.on { border-color:var(--busy); color:var(--text); }
.job { border-top:1px solid var(--rule); padding:8px 0; }
.job .jn { font-weight:500; } .job .js { color:var(--mute); font-size:13px; }
.job .links { display:flex; flex-wrap:wrap; gap:4px 12px; margin:4px 0; font-size:13px; }
.job .links a { color:var(--done); }
.job pre { white-space:pre-wrap; background:var(--ink); padding:6px 8px; border-radius:4px; font-size:12px; color:var(--soft); max-height:260px; overflow:auto; margin:4px 0; }
.job .lbl { color:var(--dim); font-size:12px; margin-top:6px; }
.imgs { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:6px; margin-top:6px; }
.imgs img { width:100%; border-radius:4px; border:1px solid var(--rule); }
.main-pane { min-width:0; min-height:0; overflow:auto; }
.main-pane .rpm { overflow:visible; }
.proj.docs-open { grid-template-columns:220px minmax(0,1fr) 420px; }
.docs-sidebar { min-width:0; overflow:auto; border-right:1px solid var(--rule); background:var(--row); padding:10px; }
.docs-sidebar header { display:flex; align-items:center; justify-content:space-between; }
.docs-sidebar input, .card-decision textarea { width:100%; background:var(--ink); color:var(--text); border:1px solid var(--rule); border-radius:4px; padding:7px; font:inherit; margin:8px 0; }
.docs-sidebar ul { list-style:none; padding-left:12px; margin:3px 0; }
.docs-sidebar a, .docs-sidebar summary { display:block; padding:4px; color:var(--soft); overflow-wrap:anywhere; cursor:pointer; }
.docs-sidebar a:hover, .docs-sidebar a[aria-current] { color:var(--done); }
#document-pane { min-width:0; padding:12px; }
#document-pane .board-document { overflow-wrap:anywhere; padding:12px 4px 40px; }
.card .decision-wait, .card-decision h3 { color:var(--busy); }
.card .decision-answer { color:var(--done); overflow-wrap:anywhere; }
.card-decision { border:1px solid var(--rule); padding:12px; margin:12px 0; overflow-wrap:anywhere; }
.card-decision p { white-space:pre-wrap; }
.card-decision label { display:block; padding:8px 0; }
.card-decision img { width:min(100%,240px); display:block; margin:6px 0; }
.card-decision output { display:block; color:var(--hot); }
@media (max-width: 900px) {
  .proj, .proj.docs-open { grid-template-columns:minmax(0,1fr); height:auto; }
  .docs-sidebar { position:fixed; top:0; bottom:0; left:0; width:min(320px, 90vw); z-index:11; box-shadow:8px 0 30px #0008; }
  nav.top { flex-wrap:wrap; }
  .rpm { overflow:visible; padding:12px 16px 30px; }
  .chat { border-left:0; border-top:1px solid var(--rule); height:75vh; }
  .kanban { grid-template-columns:1fr; }
  .prow { padding:9px 16px; }
  .prow { grid-template-columns:20px minmax(0,1fr) 44px; }
  .prow .vision { grid-column:2 / -1; grid-row:2; white-space:normal; font-size:13px; }
  .prow .bars { grid-column:2 / -1; grid-row:3; } .prow .bars .bar { flex:1; min-width:4px; max-width:34px; }
  .pmore { padding-left:52px; }
  nav.top { padding:10px 16px; }
}`;

const SHARED_JS = `
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const ago = (ms) => { if (!ms) return ""; const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? "now" : s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d"; };
const bars = (results) => '<span class="bars">' + results.map((r) =>
  '<span class="bar" title="#' + esc(r.id) + ' ' + esc(r.title) + ' ' + r.done + '/' + r.total + '"><i style="width:' + (r.total ? Math.round(100 * r.done / r.total) : 0) + '%"></i></span>').join("") + '</span>';
async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || ("HTTP " + r.status));
  return out;
}`;

export function projectsPage(): string {
  return `${HEAD("Projects")}<body>
<nav class="top"><a href="/board">all</a><a href="/board/docs">docs</a><span class="grow"></span><span class="tabs" id="fleet" hidden title="ChatGPT chats the whole machine runs at once"><button type="button" data-d="-1" aria-label="fewer">−</button><b id="fleet-n">–</b> chats<button type="button" data-d="1" aria-label="more">+</button><i id="fleet-status"></i></span><button id="new" hidden>+ project</button></nav>
<main class="list" id="list"></main>
<dialog id="dlg"><form id="form" method="dialog">
<label>Name</label><input name="name" required pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]*" maxlength="64" autocomplete="off">
<label>Vision</label><textarea name="vision" rows="2"></textarea>
<label>Purpose</label><textarea name="purpose" rows="2"></textarea>
<label>Roles</label><input name="roles" autocomplete="off">
<div class="row"><span class="err" id="err"></span><button type="button" id="cancel">cancel</button><button type="submit">create</button></div>
</form></dialog>
<script>${SHARED_JS}
const list = document.getElementById("list"), open = new Set();
async function load() {
  const d = await (await fetch("/api/board/projects", { cache: "no-store" })).json();
  document.getElementById("new").hidden = !d.editEnabled;
  const fleet = document.getElementById("fleet");
  fleet.hidden = !d.editEnabled;
  if (!fleet.dataset.dirty && d.fleetLimit) document.getElementById("fleet-n").textContent = d.fleetLimit;
  list.innerHTML = d.projects.map((p) => '<div class="prow ' + p.session + (p.running ? "" : " stopped") + '" data-ray="' + esc(p.ray) + '">' +
    '<button class="caret" data-more="' + esc(p.ray) + '" aria-label="expand">' + (open.has(p.ray) ? "▾" : "▸") + '</button>' +
    '<span class="name"><span class="dot ' + p.session + '"></span> ' + esc(p.ray) + '</span>' +
    '<span class="vision" title="' + esc(p.vision) + '">' + esc(p.vision) + '</span>' + bars(p.results) +
    '<span class="ago">' + ago(p.lastActivity) + '</span></div>' +
    '<div class="pmore' + (open.has(p.ray) ? " open" : "") + '">' + p.results.map((r) => '<div><span class="n">' + r.done + '/' + r.total +
    '</span><span class="bar"><i style="width:' + (r.total ? Math.round(100 * r.done / r.total) : 0) + '%"></i></span>#' + esc(r.id) + ' ' + esc(r.title) + '</div>').join("") + '</div>').join("");
}
list.addEventListener("click", (e) => {
  const more = e.target.closest(".caret");
  if (more) { const r = more.dataset.more; open.has(r) ? open.delete(r) : open.add(r); load(); return; }
  const row = e.target.closest(".prow");
  if (row) location.href = "/board/p/" + encodeURIComponent(row.dataset.ray);
});
const dlg = document.getElementById("dlg"), form = document.getElementById("form");
document.getElementById("new").onclick = () => { document.getElementById("err").textContent = ""; dlg.showModal(); };
document.getElementById("cancel").onclick = () => dlg.close();
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  try { const out = await post("/api/board/projects", Object.fromEntries(new FormData(form))); location.href = out.href; }
  catch (err) { document.getElementById("err").textContent = err.message; }
});
const fleetEl = document.getElementById("fleet"); let fleetTimer;
fleetEl.onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const n = document.getElementById("fleet-n"), st = document.getElementById("fleet-status");
  const v = Math.min(40, Math.max(1, (Number(n.textContent) || 20) + Number(b.dataset.d)));
  n.textContent = v; fleetEl.dataset.dirty = "1"; st.textContent = ""; clearTimeout(fleetTimer);
  fleetTimer = setTimeout(async () => {
    try { await post("/api/board/fleet/jobs", { limit: v }); st.textContent = "✓"; } catch (err) { st.textContent = err.message; }
    delete fleetEl.dataset.dirty;
  }, 900);
};
load().then(() => { if (new URLSearchParams(location.search).get("new") && !document.getElementById("new").hidden) document.getElementById("new").click(); }); setInterval(load, 15000);
</script>${NOTIFICATION_TAG}</body></html>`;
}

export function projectPage(ray: string, decisionToken = ""): string {
  return `${HEAD(ray + " · board")}<body><style>.proj { grid-template-columns: minmax(0,1fr); } .proj.docs-open { grid-template-columns: minmax(180px, 260px) minmax(0,1fr); } .proj .chat[hidden] { display:none; } .docs-sidebar:not([hidden]) { display:block !important; } @media(max-width:900px){.proj.docs-open{grid-template-columns:minmax(0,1fr)}}</style>
<nav class="top"><div class="pick"><button id="pick-btn" aria-haspopup="true" aria-expanded="false"><span class="dot" id="pick-dot"></span><b id="pick-name"></b><i>▾</i></button><div class="pick-menu" id="pick-menu" hidden></div></div><span class="grow"></span><button id="docs-toggle" aria-expanded="false">docs</button><button class="gear" id="settings-btn" hidden aria-label="Settings" title="Settings">⚙</button></nav>
<dialog id="settings"><form id="floor-form" method="dialog"><h2>Settings</h2><label>Handoffs at once, this project <input type="number" name="floor" min="1" max="10"></label><label>ChatGPT chats, whole machine <input type="number" name="fleet" min="1" max="40"></label><p class="counts" id="settings-counts"></p><div class="row"><button type="button" id="settings-close">Close</button><button type="submit" value="save">Save</button></div><output></output></form></dialog>
<div class="proj" id="project-layout"><aside id="docs-sidebar" class="docs-sidebar" hidden>
<header><strong>Documents</strong><button id="docs-close" aria-label="Close documents">×</button></header>
<input type="search" id="docs-search" placeholder="Search documents" aria-label="Search documents">
<div id="docs-tree"></div></aside><div class="main-pane"><div class="rpm" id="rpm"></div>
<section id="document-pane" hidden><button id="back-plan">← Back to plan</button><div id="document-content"></div></section></div>
<section class="chat" hidden><header><span class="dot" id="sdot"></span><span>chat</span><span class="grow"></span><label><input type="checkbox" id="sys"> tools</label><button id="older" hidden>older</button></header><div class="chat-log" id="log"></div><form class="chat-compose" id="chat-compose" hidden><textarea id="chat-text" aria-label="Message to session" rows="3" maxlength="16000" required placeholder="Message"></textarea><button id="chat-send" type="submit">Send</button><output id="chat-status" aria-live="polite"></output></form></section></div>
<aside class="panel" id="panel" hidden><button class="close" id="pclose">×</button><div id="pbody"></div></aside>
<script>const RAY = ${JSON.stringify(ray).replace(/</g, "\\u003c")};
${SHARED_JS}
const DECISION_TOKEN = ${JSON.stringify(decisionToken).replace(/</g, "\\u003c")};
${DOC_RENDER_JS}
${PROJECT_JS}</script>${NOTIFICATION_TAG}</body></html>`;
}

const PROJECT_JS = `
let P = null, panelCard = null;
let initialDecision = typeof location !== "undefined" ? new URLSearchParams(location.search).get("decision") : null;
const API = "/api/board/project/" + encodeURIComponent(RAY);
const rpm = document.getElementById("rpm");
const editing = () => document.activeElement && document.activeElement.isContentEditable;
let loading = false;
function ed(op, extra, text, cls, tag) {
  const attrs = P.editEnabled ? ' data-edit="' + esc(JSON.stringify(Object.assign({ op }, extra))) + '"' : "";
  return '<' + (tag || "div") + ' class="' + cls + (P.editEnabled ? " editable" : "") + '"' + attrs + '>' + esc(text) + '</' + (tag || "div") + '>';
}
function answerText(item) {
  const a = item.answer;
  if (!a) return "";
  return [a.key ? item.decision?.options.find(o => o.key === a.key)?.label || a.key : "", a.note].filter(Boolean).join(" · ");
}
function decisionHtml(c) {
  if (!c.decision) return "";
  const x = c.decisionItem, d = x?.decision;
  if (!d || x.state === "error") return '<div class="card-decision">Decision unavailable: ' + esc(x?.error || c.decision) + '</div>';
  return '<section class="card-decision"><h3>' + esc(d.title) + '</h3><p>' + esc(d.question) + '</p>' +
    (x.answer ? '<p class="decision-answer">Answered: ' + esc(answerText(x)) + '</p>' :
      '<form id="card-decision-form"><fieldset><legend>Choose an option</legend>' + d.options.map(o =>
        '<label><input type="radio" name="key" value="' + esc(o.key) + '"> ' + esc(o.label) +
        (o.detail ? '<p>' + esc(o.detail) + '</p>' : "") + (o.images || []).map(img =>
          '<img loading="lazy" alt="' + esc(o.label) + '" src="/api/decisions/image?ray=' + encodeURIComponent(RAY) + '&amp;path=' + encodeURIComponent(img) + '">').join("") + '</label>').join("") +
      '</fieldset>' + (d.allowNote ? '<label>Optional note<textarea name="note" maxlength="500"></textarea></label>' : "") +
      '<button type="submit">Answer</button><output aria-live="polite"></output></form>') + '</section>';
}
function cardHtml(r, c) {
  const failed = c.cause && c.cause.kind === "failed";
  return '<div class="card' + (failed ? " failed" : "") + '" data-id="' + esc(r.id) + '" data-i="' + c.index + '">' +
    '<span class="t">' + (c.must ? '<b class="must">*</b> ' : '') + esc(c.text) + '</span>' + '<span class="m">' + esc([c.who,c.dur].filter(Boolean).join(' · ')) + '</span>' +
    (c.decisionItem?.state === "pending" ? '<span class="decision-wait">waiting on you</span>' : "") +
    (c.missingProof ? '<span class="fail">done without proof</span>' : "") +
    (failed ? '<span class="fail" title="' + esc(c.cause.reason || "") + '">failed · retry</span>' : "") + '</div>';
}
let closedResults = new Set(); try { closedResults = new Set(JSON.parse(localStorage.getItem("board-closed-" + RAY) || "[]")); } catch {}
function libraryHtml() {
  const L = P.library || { insights: [], decisions: [], documents: [] };
  const docLink = (x) => '/board/doc?path=' + encodeURIComponent(x.path);
  const sec = (key, title, items, row) => '<details class="lib" data-lib="' + key + '"' + (closedResults.has(key) ? "" : " open") + '><summary>' + title + '<span>' + items.length + '</span></summary>' +
    (items.length ? items.map(row).join("") : "") + '</details>';
  return sec("insights", "Insights", L.insights, (x) => '<div class="insight"><b>' + esc(x.title) + '</b><p>' + esc(x.text || "") + '</p><time>' + esc(x.date) + '</time></div>') +
    sec("decisions", "Decisions", L.decisions, (x) => '<div class="lrow"><a class="t" data-doc="' + esc(x.path) + '" href="' + docLink(x) + '">' + esc(x.title) + '</a><time>' + esc(x.date) + '</time></div>') +
    sec("documents", "Documents", L.documents, (x) => '<div class="lrow"><a class="t" data-doc="' + esc(x.path) + '" href="' + docLink(x) + '">' + esc(x.title) + '</a><a class="pdf" href="' + docLink(x) + '&print=1" target="_blank" rel="noopener">PDF</a><time>' + esc(x.date) + '</time></div>');
}
function render() {
  const head = '<h1>' + esc(P.name) + '</h1>' + ed("header", { key: "vision" }, P.vision, "vision") +
    (P.purpose || P.editEnabled ? '<div class="meta"><b>purpose</b>' + ed("header", { key: "purpose" }, P.purpose, "", "span") + '</div>' : "") +
    (P.roles ? '<div class="meta"><b>roles</b>' + esc(P.roles) + '</div>' : "") + (P.week ? '<div class="week">' + esc(P.week) + '</div>' : "");
  const cols = [["planned", " "], ["running", "~"], ["done", "x"]];
  const results = P.results.map((r) => {
    const done = r.cards.filter((c) => c.column === "done").length;
    const missing = r.cards.filter(c => c.missingProof).length;
    return '<details class="result" data-id="' + esc(r.id) + '"' + (closedResults.has(r.id) ? "" : " open") + '><summary class="rhead"><span class="num">#' + esc(r.id) + '</span>' +
      '<span class="title">' + esc(r.title) + '</span>' + '<span class="count">' + done + '/' + r.cards.length + '</span></summary>' +
      ed("result", { id: r.id, key: "result" }, r.result, "rtext") + ed("result", { id: r.id, key: "purpose" }, r.purpose, "rpurp") +
      (missing ? '<div class="proof-warning">Goal check: ' + missing + ' done without proof</div>' : "") +
      '<div class="kanban">' + cols.map(([k, m]) => {
        const cards = r.cards.filter((c) => c.column === k);
        return '<div class="col ' + k + '" data-id="' + esc(r.id) + '"><h3><span>' + k + '</span><span>' + cards.length + '</span></h3>' +
          cards.map((c) => cardHtml(r, c)).join("") + '</div>';
      }).join("") + '</div>' + (r.check ? '<div class="rnow"><b>Check (not run by board):</b> ' + esc(r.check) + '</div>' : '') + (r.now ? '<div class="rnow"><b>Now:</b> ' + esc(r.now) + '</div>' : "") + '</details>';
  }).join("");
  rpm.innerHTML = head + results + libraryHtml();
  for (const d of rpm.querySelectorAll("details.result, details.lib")) d.ontoggle = () => {
    const key = d.dataset.id || d.dataset.lib; d.open ? closedResults.delete(key) : closedResults.add(key);
    try { localStorage.setItem("board-closed-" + RAY, JSON.stringify([...closedResults])); } catch {}
  };
  updateDocTree();
  document.getElementById("sdot").className = "dot " + P.session.session;

}
async function load(force) {
  if (loading || panelCard || (!force && (editing() || document.activeElement?.closest("#floor-form")))) return;
  loading = true;
  try {
    const next = await (await fetch(API, { cache: "no-store" })).json();
    if (panelCard || editing() || (!force && document.activeElement?.closest("#floor-form"))) return;
    P = next; document.getElementById("chat-compose").hidden = !P.editEnabled; render();
    if (initialDecision) {
      const wanted = initialDecision; initialDecision = null;
      for (const r of P.results) { const c = r.cards.find(c => c.decision === wanted); if (c) { openCard(r.id,c.index); return; } }
      location.href = "/board/decisions?ray=" + encodeURIComponent(RAY) + "&id=" + encodeURIComponent(wanted);
    }
  } catch {} finally { loading = false; }
}
async function edit(body) {
  try { await post(API + "/edit", body); } catch (e) { alert(e.message); }
  await load(true);
}
const pickBtn = document.getElementById("pick-btn"), pickMenu = document.getElementById("pick-menu");
document.getElementById("pick-name").textContent = RAY;
async function tabs() {
  const d = await (await fetch("/api/board/projects", { cache: "no-store" })).json();
  const me = d.projects.find((p) => p.ray === RAY); if (me) document.getElementById("pick-dot").className = "dot " + me.session;
  pickMenu.innerHTML = d.projects.map((p) => '<a href="/board/p/' + encodeURIComponent(p.ray) + '"' + (p.ray === RAY ? ' class="on"' : "") + '><span class="dot ' + p.session + '"></span>' + esc(p.ray) + '</a>').join("") +
    '<hr><a href="/board/projects">All projects</a>' + (d.editEnabled ? '<a href="/board/projects?new=1">+ New project</a>' : "");
}
pickBtn.onclick = (e) => { e.stopPropagation(); pickMenu.hidden = !pickMenu.hidden; pickBtn.setAttribute("aria-expanded", String(!pickMenu.hidden)); };
document.addEventListener("click", (e) => { if (!pickMenu.hidden && !e.target.closest(".pick")) { pickMenu.hidden = true; pickBtn.setAttribute("aria-expanded", "false"); } });
// Inline editing: click, type, Enter or leaving the field saves; Escape cancels.
rpm.addEventListener("click", (e) => {
  const t = e.target.closest("[data-edit]");
  if (t && !t.isContentEditable) {
    t.dataset.was = t.textContent; t.contentEditable = "true"; t.focus();
    const sel = getSelection(); sel.selectAllChildren(t); sel.collapseToEnd(); return;
  }
  const card = e.target.closest(".card");
  if (card) openCard(card.dataset.id, Number(card.dataset.i));
});
rpm.addEventListener("keydown", (e) => {
  const t = e.target.closest("[data-edit]");
  if (!t) return;
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); t.blur(); }
  if (e.key === "Escape") { t.textContent = t.dataset.was; t.blur(); }
});
rpm.addEventListener("focusout", (e) => {
  const t = e.target.closest("[data-edit]");
  if (!t || !t.isContentEditable) return;
  t.contentEditable = "false";
  const text = t.textContent.trim();
  if (text === (t.dataset.was || "").trim()) return;
  edit(Object.assign(JSON.parse(t.dataset.edit), { text }));
});
// Floor is a scheduler control, not an execution-card edit.
const settings = document.getElementById("settings"), floorForm = document.getElementById("floor-form");
document.getElementById("settings-btn").onclick = async () => {
  floorForm.elements.floor.value = P?.floor ?? "";
  try { const d = await (await fetch("/api/board/projects", { cache: "no-store" })).json(); floorForm.elements.fleet.value = d.fleetLimit ?? ""; } catch {}
  document.getElementById("settings-counts").textContent = (P?.activeJobs ?? 0) + " running · " + (P?.queuedJobs ?? 0) + " queued";
  const edit = !!P?.editEnabled; for (const el of floorForm.elements) if (el.name) el.disabled = !edit;
  floorForm.querySelector("output").textContent = ""; settings.showModal();
};
document.getElementById("settings-close").onclick = () => settings.close();
floorForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const output = floorForm.querySelector("output"), button = floorForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const floor = Number(floorForm.elements.floor.value), fleet = Number(floorForm.elements.fleet.value);
    if (floor && floor !== P.floor) { await post(API + "/floor", { floor }); P.floor = floor; }
    if (fleet) await post("/api/board/fleet/jobs", { limit: fleet });
    output.textContent = "Saved"; setTimeout(() => settings.close(), 500);
  } catch (err) { output.textContent = err.message; } finally { button.disabled = false; }
});
// Open panels are snapshots. Polling is paused while open; chat polling is independent.
const panel = document.getElementById("panel"), pbody = document.getElementById("pbody");
const linkHtml = (l) => '<a href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
const diffFrame = (url) => '<a class="difflink" href="' + esc(url) + '" target="_blank" rel="noopener">Open the change</a>';
function openCard(id, i) {
  const r = P.results.find(x => x.id === id), c = r && r.cards.find(x => x.index === i);
  if (!c) return;
  panelCard = { id, i };
  const proofText = (c.proofLinks || []).length ? "" : (c.proof || "").trim();
  const niceLabel = (l) => l.label.startsWith("commit ") ? "The change (" + l.label.slice(7, 14) + ")" : ((decodeURIComponent(l.href.split("path=")[1] || l.href).split("/").pop() || l.label).replace(/\.md$/i, "").replace(/[-_]+/g, " "));
  const proof = (c.proof ? '<h3>Proof</h3>' + (proofText ? '<p>' + esc(proofText) + '</p>' : "") +
    '<ul class="plinks">' + (c.proofLinks || []).map(l => '<li><a href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(niceLabel(l)) + '</a></li>').join("") + '</ul>' : "");
  const jobs = c.jobs.map(j => {
    const commit = j.appliedCommit ? "/board/diff?hash=" + encodeURIComponent(j.appliedCommit) + "&ray=" + encodeURIComponent(RAY) : null;
    const diff = commit || j.replyDiff?.link;
    const links = [
      j.conversationUrl ? linkHtml({ href:j.conversationUrl, label:"Conversation" }) : "",
      diff ? linkHtml({ href:diff, label:commit ? "Applied commit " + j.appliedCommit.slice(0,7) : "Reply diff" }) : ""
    ].filter(Boolean).join(" ");
    return '<div class="job" data-job="' + esc(j.name) + '"><div><span class="jn">' + esc(j.name) + '</span> <span class="js">' + esc(j.state) +
      (j.minutes ? " · " + Math.round(j.minutes) + "m" : "") + '</span></div>' +
      (j.queuePosition != null ? '<div>Queue position: ' + (j.queuePositionEstimated ? 'estimated ' : '') + esc(j.queuePosition) + ' · ' + esc(j.waitReason || "Waiting") + '</div>' : "") +
      (j.failureReason ? '<div class="fr">' + esc(j.failureReason) + '</div>' : "") +
      (links ? '<div class="links">' + links + '</div>' : "") +
      '<div class="lbl">Request</div><pre class="req">' + esc(j.promptPreview || "Loading request…") + '</pre>' +
      '<div class="attachments"></div><div class="lbl">Reply explanation</div><pre class="rep">' + esc(j.replyPreview || "No reply yet") + '</pre>' +
      '<div class="artifacts"></div><div class="diff">' + (diff ? diffFrame(diff) : "") + '</div>' +
      (j.state === "done-zip-missing" && P.editEnabled ? '<button class="rescue">Retry download</button><output class="rescue-status"></output>' : "") +
      (j.images.length ? '<div class="imgs">' + j.images.map(p => '<a href="/board/doc-asset?path=' + encodeURIComponent(p) + '" target="_blank" rel="noopener"><img loading="lazy" src="/board/doc-asset?path=' + encodeURIComponent(p) + '" alt="' + esc(p) + '"></a>').join("") + '</div>' : "") + '</div>';
  }).join("");
  pbody.innerHTML = '<div class="pcard"><h2>' + esc(c.text) + '</h2><div class="ctx">#' + esc(r.id) + ' ' + esc(r.title) + ' · ' + esc(c.column) + '</div>' +
    decisionHtml(c) + (c.missingProof ? '<p class="proof-warning">Done without proof</p>' : "") + proof +
    (jobs ? '<h3>Handoffs</h3>' + jobs : "") + '</div>';
  panel.hidden = false; panel.scrollTop = 0;
  for (const el of pbody.querySelectorAll(".job")) hydrateJob(el);
}
async function hydrateJob(el, recovered = false) {
  try {
    const response = await fetch(API + "/job/" + encodeURIComponent(el.dataset.job), { cache: "no-store" });
    if (!response.ok) throw Error("Request details unavailable");
    const t = await response.json();
    if (!el.isConnected) return;
    const patchText = (selector, value) => {
      const node = el.querySelector(selector), top = node.scrollTop;
      if (node.textContent !== value) node.textContent = value;
      node.scrollTop = top;
    };
    patchText(".req", t.prompt || "No recorded request");
    patchText(".rep", t.reply || "No recorded reply");
    el.querySelector(".attachments").textContent = t.attachments?.length ? "Attachments: " + t.attachments.map(a => typeof a === "string" ? a : (a?.name || a?.path || JSON.stringify(a))).join(", ") : "";
    el.querySelector(".artifacts").innerHTML = t.files?.length ? '<div class="lbl">Returned files</div>' + t.files.map(f => '<div>' + linkHtml(f) + '</div>').join("") : "";
    if (t.appliedCommit && (recovered || !el.querySelector(".diff a"))) {
      const url = "/board/diff?ray=" + encodeURIComponent(RAY) + "&hash=" + encodeURIComponent(t.appliedCommit);
      el.querySelector(".diff").innerHTML = linkHtml({href:url,label:"Applied commit " + t.appliedCommit.slice(0,7)}) + diffFrame(url);
    } else if (t.overlayLink && (recovered || !el.querySelector(".diff a"))) el.querySelector(".diff").innerHTML = diffFrame(t.overlayLink);
  } catch (err) { if (el.isConnected) el.querySelector(".artifacts").textContent = err.message; }
}
pbody.addEventListener("submit", async e => {
  if (e.target.id !== "card-decision-form") return;
  e.preventDefault();
  const form = e.target, button = form.querySelector("button"), output = form.querySelector("output");
  const r = P.results.find(r => r.id === panelCard?.id), c = r?.cards.find(c => c.index === panelCard?.i);
  if (!c?.decisionItem || button.disabled) return;
  const data = new FormData(form);
  button.disabled = true;
  try {
    const response = await fetch("/api/decisions/answer", {method:"POST", headers:{"content-type":"application/json","x-decision-token":DECISION_TOKEN},
      body:JSON.stringify({ray:RAY,id:c.decision,key:data.get("key") || "",note:data.get("note") || ""})});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Answer failed");
    c.decisionItem.answer = result.answer; c.decisionItem.state = "answered";
    const section = form.closest(".card-decision");
    const saved = document.createElement("p"); saved.className = "decision-answer"; saved.textContent = "Answered: " + answerText(c.decisionItem);
    form.replaceWith(saved);
    const card = [...rpm.querySelectorAll(".card")].find(el=>el.dataset.id===r.id && Number(el.dataset.i)===c.index);
    const badge = card?.querySelector(".decision-wait"); if (badge) { badge.className="decision-answer"; badge.textContent=saved.textContent; }
    document.dispatchEvent(new Event("decision-answered"));
  } catch(err) { output.textContent=err.message; } finally { button.disabled=false; }
});
pbody.addEventListener("click", async e => {
  const button = e.target.closest(".rescue");
  if (!button) return;
  const el = button.closest(".job"), status = el.querySelector(".rescue-status");
  button.disabled = true; status.textContent = "Recovering…";
  try {
    const result = await post("/api/rays/" + encodeURIComponent(RAY) + "/jobs/" + encodeURIComponent(el.dataset.job) + "/rescue", {});
    status.textContent = result.message;
    await hydrateJob(el, true);
  } catch (err) { status.textContent = err.message; }
  finally { button.disabled = false; }
});
function closePanel() { panel.hidden = true; panelCard = null; load(true); }
document.getElementById("pclose").onclick = closePanel;
document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) closePanel(); });
// Chat: the ray's live session transcript, newest at the bottom.
const log = document.getElementById("log"), olderBtn = document.getElementById("older");
let chat = { end: 0, before: null, signature: "" };
let chatLoading = false;
const compose = document.getElementById("chat-compose"), chatText = document.getElementById("chat-text"), sendBtn = document.getElementById("chat-send"), chatStatus = document.getElementById("chat-status");
compose.onsubmit = async (e) => {
  e.preventDefault(); if (sendBtn.disabled || !chatText.value.trim()) return;
  const text = chatText.value; sendBtn.disabled = true; chatStatus.textContent = "Submitting…";
  try {
    const response = await fetch("/api/rays/" + encodeURIComponent(RAY) + "/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.message || result.error || "Send failed");
    chatStatus.textContent = result.mode === "fallback" ? "Not sent to session. Saved to " + result.file + " (" + result.reason + ")." : result.message;
    if (chatText.value === text) chatText.value = "";
    await loadChat();
  } catch (err) { chatStatus.textContent = err.message; } finally { sendBtn.disabled = false; }
};
function chatMd(text) {
  return String(text).split(/\`\`\`[^\\n]*\\n?/).map((part, i) => i % 2 ? "<pre>" + esc(part) + "</pre>" :
    esc(part).split(/\\n{2,}/).filter((x) => x.trim()).map((p) => "<p>" + p.replace(/\`([^\`\\n]+)\`/g, "<code>$1</code>")
      .replace(/\\*\\*([^*\\n]+)\\*\\*/g, "<strong>$1</strong>").replace(/\\n/g, "<br>") + "</p>").join("")).join("");
}
function turnHtml(t) {
  if (t.role === "break") return '<div class="turn break"><span>new session' + (t.at ? " · " + esc(new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })) : "") + '</span></div>';
  const who = t.role === "owner" ? "you" : t.role === "peer" ? (t.from || "peer") : t.role === "system" ? "system" : "session";
  const time = t.at ? new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const tools = (t.tools || []).map((x) => '<div class="tool' + (x.ok === false ? " bad" : "") + '">▸ <b>' + esc(x.name) + '</b> ' + esc(x.description || "") +
    (x.result ? '<div class="res">' + esc(x.result) + '</div>' : "") + '</div>').join("");
  return '<div class="turn ' + t.role + '"><div class="who">' + esc(who) + ' · ' + esc(time) + '</div>' +
    (t.text ? '<div class="msg">' + (t.role === "system" ? esc(t.text) : chatMd(t.text)) + '</div>' : "") + tools + '</div>';
}
const chatUrl = (b) => "/api/rays/" + encodeURIComponent(RAY) + "/chat?limit=60" + (b != null ? "&before=" + b : "");
async function loadChat() {
  if (chatLoading) return; chatLoading = true;
  try {
    const r = await fetch(chatUrl(null), { cache: "no-store" });
    if (!r.ok) { log.textContent = ""; return; }
    const page = await r.json();
    const signature = JSON.stringify([page.session, page.end, page.turns]);
    if (signature === chat.signature && log.childElementCount) return;
    const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 60 || !chat.end;
    log.innerHTML = page.turns.map(turnHtml).join("");
    chat = { end: page.end, before: page.before, signature };
    olderBtn.hidden = page.before == null;
    if (follow) log.scrollTop = log.scrollHeight;
  } catch {} finally { chatLoading = false; }
}
olderBtn.onclick = async () => {
  if (chat.before == null) return;
  const page = await (await fetch(chatUrl(chat.before), { cache: "no-store" })).json();
  const h = log.scrollHeight;
  log.insertAdjacentHTML("afterbegin", page.turns.map(turnHtml).join(""));
  log.scrollTop += log.scrollHeight - h;
  chat.before = page.before; olderBtn.hidden = page.before == null;
};
document.getElementById("sys").onchange = (e) => log.classList.toggle("sys", e.target.checked);
const sidebar = document.getElementById("docs-sidebar"), docTree = document.getElementById("docs-tree");
const docSearch = document.getElementById("docs-search"), docToggle = document.getElementById("docs-toggle");
const docPane = document.getElementById("document-pane"), docContent = document.getElementById("document-content");
let docSignature = "", currentDoc = "", docRequest = 0;
function toggleDocs(open) {
  sidebar.hidden = !open; document.getElementById("project-layout").classList.toggle("docs-open",open);
  docToggle.setAttribute("aria-expanded",String(open));
}
docToggle.onclick = () => toggleDocs(sidebar.hidden);
document.getElementById("docs-close").onclick = () => toggleDocs(false);
document.addEventListener("keydown", e => { if(e.key==="Escape" && !sidebar.hidden && panel.hidden) toggleDocs(false); });

function updateDocTree(force = false) {
  const tree = P?.docTree || [], q = (docSearch.value || "").trim().toLowerCase();
  const signature = JSON.stringify([tree,q,currentDoc,P?.decisionInbox]);
  if (!force && signature === docSignature) return;
  docSignature = signature;
  const expanded = new Set([...docTree.querySelectorAll("details[open]")].map(d=>d.dataset.group));
  const build = (nodes, parent = "", matched = false) => nodes.map(n=>{
    const name = parent + "/" + n.label, own = matched || !q || (n.label + " " + (n.path || "")).toLowerCase().includes(q) ||
      (name==="/Decisions" && (P?.decisionInbox || []).some(x=>(x.id+" "+x.decision?.title).toLowerCase().includes(q)));
    const children = n.children ? build(n.children,name,matched || (!!q && own)) : "";
    if (!own && !children) return "";
    const link = n.path ? '<a data-doc="' + esc(n.path) + '" href="/board/doc?path=' + encodeURIComponent(n.path) + '"' +
      (currentDoc === n.path ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a>' : esc(n.label);
    return '<li>' + (n.children ? '<details data-group="' + esc(name) + '"' + (q || expanded.has(name) || currentDoc && n.children.some(x=>currentDoc.startsWith(x.path || "NO_MATCH")) ? ' open' : '') +
      '><summary>' + (n.path ? esc(n.label) : link) + '</summary>' + (n.path ? link : "") + '<ul>' + (children || "<li>No documents</li>") + '</ul></details>' : link) + '</li>';
  }).join("");
  docTree.innerHTML = '<ul>' + build(tree) + '</ul>';
  const decisions = P?.decisionInbox || [];
  const group = [...docTree.querySelectorAll("details")].find(el=>el.dataset.group==="/Decisions");
  if (group && decisions.length) {
    const ul = group.querySelector("ul");
    for (const x of decisions.filter(x=>!q || (x.id+" "+x.decision?.title).toLowerCase().includes(q))) {
      const li=document.createElement("li"), a=document.createElement("a");
      a.href=x.card ? "/board/p/"+encodeURIComponent(RAY)+"?decision="+encodeURIComponent(x.id) :
        "/board/decisions?ray="+encodeURIComponent(RAY)+"&id="+encodeURIComponent(x.id);
      a.textContent=(x.decision?.title || x.id)+(x.state==="pending"?" · waiting":"");
      if(x.card) a.dataset.decision=x.id;
      li.append(a); ul.append(li);
    }
  }
}
docSearch.oninput = () => updateDocTree(true);
async function openDocument(relative) {
  const request = ++docRequest; currentDoc = relative; rpm.hidden = true; docPane.hidden = false;
  updateDocTree(true); docContent.textContent = "Loading document…";
  if (typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches) toggleDocs(false);
  try {
    const response = await fetch(API + "/doc?path=" + encodeURIComponent(relative), {cache:"no-store"});
    if (!response.ok) throw Error("Document unavailable (" + response.status + ")");
    const html = await response.text(); if (request !== docRequest) return;
    const fragment = new DOMParser().parseFromString(html,"text/html");
    const data = JSON.parse(fragment.getElementById("doc-data").textContent);
    const article = document.createElement("article"); article.className="board-document";
    docContent.replaceChildren(article);
    await renderBoardDocument(article,data);
    docPane.parentElement.scrollTop = 0;
  } catch(err) { if(request===docRequest) docContent.textContent=err.message; }
}
function backPlan() { ++docRequest; currentDoc=""; docPane.hidden=true; rpm.hidden=false; updateDocTree(true); }
document.getElementById("back-plan").onclick = backPlan;
docTree.onclick = e => { const a=e.target.closest("a[data-doc]"); if(a){e.preventDefault();openDocument(a.dataset.doc);return;}
  const d=e.target.closest("a[data-decision]"); if(d){e.preventDefault();backPlan();toggleDocs(false);
    for(const r of P.results){const c=r.cards.find(c=>c.decision===d.dataset.decision);if(c){openCard(r.id,c.index);return;}}}
};
docContent.onclick = e => { const a=e.target.closest("a[href]"); if(!a)return; const u=new URL(a.href,location.href);
  if(u.origin===location.origin && u.pathname==="/board/doc" && u.searchParams.get("path")?.startsWith(RAY+"/")){e.preventDefault();openDocument(u.searchParams.get("path"));} };
rpm.addEventListener("click", (e) => { const a = e.target.closest("a[data-doc]"); if (a && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openDocument(a.dataset.doc); } });
chatText.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); compose.requestSubmit(); } });
chatText.addEventListener("input", () => { chatText.style.height = "auto"; chatText.style.height = chatText.scrollHeight + "px"; });
load(true); tabs();
setInterval(load, 15000); setInterval(tabs, 15000);
`;
