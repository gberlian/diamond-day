import { DOC_STYLE, DOC_RENDER_JS } from "./docs-page.ts";
import { NOTIFICATION_TAG } from "./decision-notifications.ts";
/** HTML for /board/projects and /board/p/<ray>. Same palette and type as /board: dense, few words. */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const HEAD = (title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0E1621"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<style>::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2c3446;border-radius:8px;border:2px solid transparent;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:#3d4862;background-clip:padding-box}*{scrollbar-width:thin;scrollbar-color:#2c3446 transparent}${CSS}${DOC_STYLE}</style></head>`;

const CSS = `
:root { --ink:#0E1621; --row:#132033; --card:#182840; --rule:#22344A; --text:#E3EAF2; --soft:#B6C3D1; --mute:#7C8FA4; --dim:#4A5D73;
  --busy:#F3B64C; --done:#4CC2B4; --hot:#F07A5A; }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
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
.proj { display:grid; grid-template-columns:minmax(0,1fr) var(--chatw,420px); height:calc(100vh - 48px); }
.rpm { overflow-y:auto; padding:14px 22px 60px; }
.chat { border-left:1px solid var(--rule); display:flex; flex-direction:column; min-height:0; min-width:0; background:var(--row); position:relative; }
html, body { overflow-x:hidden; }
.chat-resize { position:absolute; left:-4px; top:0; bottom:0; width:8px; cursor:col-resize; z-index:5; } .chat-resize:hover, .chat-resize.on { background:var(--rule); }
@media (max-width: 900px) { .chat-resize { display:none; } }
.chat header { display:flex; gap:10px; align-items:center; padding:8px 12px; border-bottom:1px solid var(--rule); color:var(--mute); font-size:13px; }
.chat header .grow { flex:1; }
.side-tabs { display:flex; flex-wrap:wrap; gap:2px; min-width:0; } .side-tabs button { white-space:nowrap; background:none; border:0; border-bottom:2px solid transparent; color:var(--mute); font:inherit; font-size:13px; padding:4px 8px; cursor:pointer; } .side-tabs button[aria-current] { color:var(--text); border-bottom-color:var(--done); } .side-tabs i { font-style:normal; color:var(--dim); }
.chat header label { white-space:nowrap; } .chat.lib-on header label, .chat.lib-on #older { display:none; }
.doc-sort { display:flex; gap:4px; margin:0 0 8px; } .doc-sort button[aria-pressed="true"] { color:var(--text); border-color:var(--done); }
.side-lib { overflow-y:auto; padding:8px 12px; flex:1; min-height:0; }
.chat-log { overflow-y:auto; padding:8px 12px; flex:1; min-height:0; }
.turn { padding:6px 0; border-bottom:1px solid var(--rule); } .turn .tm { color:var(--dim); font-size:11px; margin-right:6px; white-space:nowrap; } .turn > .msg > :first-child { margin-top:0; }
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
.card .must { color:var(--busy); margin-right:4px; }
.rhead .check-light { display:inline-block; width:9px; height:9px; flex:none; border-radius:50%; background:var(--mute); align-self:center; }
.rhead .check-light.pass { background:#4CCB88; } .rhead .check-light.fail { background:#F06464; }
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
nav.top .navbtn { background:transparent; border:1px solid var(--rule); color:var(--soft); font:inherit; font-size:13px; border-radius:4px; padding:2px 9px; cursor:pointer; } nav.top .navbtn:hover { color:var(--text); }
.usage table { border-collapse:collapse; width:100%; font-size:13px; } .usage td, .usage th { text-align:left; padding:3px 8px 3px 0; border-bottom:1px solid var(--rule); white-space:nowrap; } .usage th { color:var(--mute); font-weight:500; } .usage .big { font-size:26px; font-weight:600; } .usage .ctxbar { display:flex; width:100%; height:14px; border-radius:3px; overflow:hidden; margin:6px 0 2px; background:var(--rule); } .usage .ctxbar i { display:block; height:100%; } .usage .miss { color:var(--hot); } .usage p { color:var(--soft); }
nav.top .gear { background:transparent; border:0; color:var(--mute); font-size:17px; cursor:pointer; padding:2px 6px; } nav.top .gear:hover { color:var(--text); }
dialog#settings { min-width:320px; } dialog#settings label { display:flex; justify-content:space-between; align-items:center; gap:16px; margin:10px 0; color:var(--soft); }
dialog#settings input { width:72px; } dialog#settings input[type=text] { width:180px; } dialog#settings .counts { color:var(--mute); font-size:13px; }
details.result > summary, details.lib > summary { list-style:none; cursor:pointer; } details.result > summary::-webkit-details-marker, details.lib > summary::-webkit-details-marker { display:none; }
details.result:not([open]) .rhead .count::after { content:' ▸'; } details.result[open] .rhead .count::after { content:' ▾'; }
details.lib { margin:18px 0; border-top:1px solid var(--rule); padding-top:10px; } details.lib > summary { font-size:17px; font-weight:600; color:var(--text); }
details.lib > summary span { color:var(--mute); font-weight:400; font-size:13px; margin-left:6px; }
.insight { margin:12px 0; } .insight b { display:block; color:var(--text); } .insight p { margin:3px 0 0; color:var(--soft); line-height:1.45; } .insight time, .lrow time { color:var(--dim); font-size:12px; }
.lrow { display:flex; gap:12px; align-items:baseline; padding:5px 0; border-bottom:1px solid var(--rule); } .lrow a.t { flex:1; color:var(--soft); text-decoration:none; } .lrow a.t:hover { color:var(--text); } .lrow a.pdf { color:var(--mute); font-size:12px; text-decoration:none; }
.lib .empty { color:var(--dim); }
.pcard h2 { font-size:19px; line-height:1.3; margin:0 0 4px; } .pcard .ctx { color:var(--mute); font-size:13px; margin-bottom:14px; }
.pcard .plinks { list-style:none; padding:0; margin:6px 0 14px; } .pcard .plinks li { padding:4px 0; border-bottom:1px solid var(--rule); } .pcard .plinks a { color:var(--done); text-decoration:none; }
.pcard .flist { list-style:none; padding:0; margin:4px 0 12px; font-size:13px; } .pcard .flist li { padding:4px 0; border-bottom:1px solid var(--rule); overflow-wrap:anywhere; } .pcard .flist a { color:var(--done); text-decoration:none; } .pcard .flist .thumb { display:block; margin-top:6px; } .pcard .flist .thumb img { max-width:100%; max-height:220px; border:1px solid var(--rule); border-radius:4px; }
.pcard .pview.data { background:transparent; border:1px solid var(--rule); padding:10px 12px; color:var(--fg); } .dvh { margin:0 0 8px; color:var(--soft); font-size:13px; } .dvc { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px 20px; margin-bottom:10px; } .dvf { margin:0; } .dvf figcaption { font-size:12px; color:var(--soft); margin-bottom:4px; } .dvf svg { display:block; overflow:visible; } .dvb { fill:var(--done); opacity:.75; } .dvl, .dvn { font-size:10px; fill:var(--soft); } .dvt { overflow-x:auto; } .dvt table { border-collapse:collapse; font-size:12px; width:100%; } .dvt th, .dvt td { text-align:left; padding:3px 8px 3px 0; border-bottom:1px solid var(--rule); white-space:nowrap; } .dvt th { color:var(--soft); font-weight:500; }
.turn .msg.clamp { display:-webkit-box; -webkit-line-clamp:5; -webkit-box-orient:vertical; overflow:hidden; } .turn .more { display:inline-block; margin-top:2px; font-size:12px; color:var(--done); } .turn .msg.clamp + .tool { } .turn:has(.msg.clamp) .more { }
.pcard .pview { display:block; width:100%; margin:8px 0 14px; border:1px solid var(--rule); border-radius:4px; background:#fff; } .pcard img.pview, .pcard a.pview img { max-width:100%; display:block; } .pcard a.pview { border:0; background:none; } .pcard iframe.pview.pdf { height:70vh; } .pcard iframe.pview.doc { height:55vh; }
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
aside.panel.card-modal { width:min(1040px, calc(100vw - 32px)); }
.card-tabs { display:flex; gap:2px; overflow-x:auto; margin:0 34px 12px 0; border-bottom:1px solid var(--rule); scrollbar-width:thin; position:sticky; top:0; z-index:2; background:var(--row); }
.card-tabs button { flex:none; white-space:nowrap; max-width:240px; overflow:hidden; text-overflow:ellipsis; border:0; border-radius:0; border-bottom:2px solid transparent; padding:7px 10px; }
.card-tabs button[aria-selected="true"] { color:var(--text); border-bottom-color:var(--done); }
.panel.card-modal .close { position:sticky; top:0; z-index:3; background:var(--row); }
.card-tabs button:focus-visible { outline:1px solid var(--done); outline-offset:-2px; }
.card-tab-pane[hidden] { display:none; } .card-tab-pane { min-width:0; overflow-wrap:anywhere; }
.card-frame { width:100%; height:65vh; border:1px solid var(--rule); background:var(--ink); }
.pcard .pview.mdoc { background:var(--ink); color:var(--text); }
.tab-path { margin:4px 0 8px; color:var(--done); overflow-wrap:anywhere; }
.card-proof,.check-output { white-space:pre-wrap; overflow-wrap:anywhere; background:var(--ink); padding:8px; margin:4px 0 12px; font-size:12px; }
.card-code { overflow:auto; background:var(--ink); border:1px solid var(--rule); padding:6px 0; font:12px/1.55 monospace; max-height:65vh; }
.code-line { display:flex; white-space:pre; min-width:max-content; } .line-no { color:var(--mute); text-align:right; min-width:4ch; margin-right:12px; user-select:none; } .code-line code { padding-right:12px; }
.syntax-keyword { color:#c99bf0; } .syntax-string { color:#9fd58a; } .syntax-number { color:#f0b072; } .syntax-comment { color:#8296ac; }
.check-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; } .check-row time { color:var(--mute); } .check-row button { margin-left:auto; } .check-state.pass { color:var(--done); } .check-state.fail { color:var(--hot); } .check-state.stale { color:var(--busy); } .check-message { color:var(--soft); margin:6px 0; } .check-acceptance { white-space:pre-wrap; }
@media(max-width:480px) { aside.panel.card-modal { top:2vh; width:calc(100vw - 12px); max-height:96vh; padding:10px; } .card-tabs button { max-width:180px; padding:7px 8px; } .card-frame { height:68vh; } }
aside.panel.wide { width:min(1040px, calc(100vw - 32px)); }
aside.panel { position:fixed; top:5vh; left:50%; transform:translateX(-50%); width:min(760px, calc(100vw - 32px)); max-height:90vh; background:var(--row); border:1px solid var(--rule);
  overflow-y:auto; padding:12px 16px 24px; z-index:30; box-shadow:0 20px 60px rgba(0,0,0,.6); }
aside.panel[hidden], #pveil[hidden] { display:none; }
#pveil { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:29; }
.flag { display:inline-block; min-width:16px; padding:0 4px; margin-left:6px; font-size:12px; font-weight:700; line-height:16px; text-align:center; cursor:help; }
.card .outs { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; margin-top:6px; } .card .outs i { font-style:normal; font-size:11px; color:var(--done); border:1px solid var(--rule); border-radius:3px; padding:0 5px; }
.card .outs i { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.card .outs .who, .card .outs .duration { color:var(--soft); } .card .outs .shared { color:var(--busy); }
.pcard .mdoc { background:transparent; border:1px solid var(--rule); padding:12px 18px; max-height:60vh; overflow:auto; } .flag.decision-wait { color:var(--busy); }
.card .flag { float:right; margin:1px 0 0 6px; }
.side-tabs button, .tabs a { border-radius:0; }
.chat-opts { padding:0 12px; }
.hrow { cursor:pointer; } .hrow .hs { color:var(--mute); font-size:12px; white-space:nowrap; } .hrow.bad .hs { color:var(--hot); } .hrow.ok .hs { color:var(--done); }
.chat-opts #older { display:block; width:100%; margin:6px 0 2px; padding:6px; color:var(--soft); border:1px solid var(--rule); border-radius:4px; background:transparent; }
.chat-opts #older:hover { background:var(--row); color:var(--text); }
.chat-opts #older[hidden] { display:none; }
#settings .switch { display:flex; justify-content:space-between; align-items:center; gap:12px; }
#settings .switch input { appearance:none; width:34px; height:18px; border-radius:9px; background:var(--rule); position:relative; cursor:pointer; margin:0; }
#settings .switch input::after { content:""; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:var(--soft); transition:left .15s; }
#settings .switch input:checked { background:var(--done); }
#settings .switch input:checked::after { left:18px; background:var(--ink); }
.chat-opts[hidden] { display:none; }
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
.proj.docs-open { grid-template-columns:220px minmax(0,1fr) var(--chatw,420px); }
.docs-sidebar { min-width:0; overflow:auto; border-right:1px solid var(--rule); background:var(--row); padding:10px; }
.docs-sidebar header { display:flex; align-items:center; justify-content:space-between; }
.docs-sidebar input, .card-decision textarea { width:100%; background:var(--ink); color:var(--text); border:1px solid var(--rule); border-radius:4px; padding:7px; font:inherit; margin:8px 0; }
.docs-sidebar ul { list-style:none; padding-left:12px; margin:3px 0; }
.docs-sidebar a, .docs-sidebar summary { display:block; padding:4px; color:var(--soft); overflow-wrap:anywhere; cursor:pointer; }
.docs-sidebar a:hover, .docs-sidebar a[aria-current] { color:var(--done); }
.pdoc .board-document { overflow-wrap:anywhere; padding:12px 4px 40px; }
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
<nav class="top"><a href="/board/all">all</a><a href="/board/docs">docs</a><a href="/board/decisions">decisions</a><a href="/board/sharing">sharing</a><a href="/board/stats">stats</a><span class="grow"></span><span class="tabs" id="fleet" hidden title="ChatGPT chats the whole machine runs at once"><button type="button" data-d="-1" aria-label="fewer">−</button><b id="fleet-n">–</b> chats<button type="button" data-d="1" aria-label="more">+</button><i id="fleet-status"></i></span><button id="new" hidden>+ project</button></nav>
<main class="list" id="list"></main>
<section style="padding:12px 18px"><a href="/board/sharing">Share / connect a company</a><div id="connected-companies"></div></section>
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
  fleet.hidden = !d.fleetLimit;
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
async function loadConnections(){try{const r=await fetch('/api/companies/connections',{cache:'no-store'});if(!r.ok)return;const d=await r.json();const parent=document.getElementById('connected-companies');parent.replaceChildren();for(const c of d.cards){const row=document.createElement('div');row.className='result';const a=document.createElement('a');a.href='/api/companies/connections/'+encodeURIComponent(c.id)+'/open';a.textContent=c.name+' · connected';row.append(a);const p=document.createElement('p');p.textContent=c.error||c.vision;row.append(p);parent.append(row)}}catch{}}loadConnections();setInterval(loadConnections,30000);
load().then(() => { if (new URLSearchParams(location.search).get("new") && !document.getElementById("new").hidden) document.getElementById("new").click(); }); setInterval(load, 15000);
</script>${NOTIFICATION_TAG}</body></html>`;
}

export function projectPage(ray: string, decisionToken = ""): string {
  return `${HEAD(ray + " · board")}<body>
<nav class="top"><div class="pick"><button id="pick-btn" aria-haspopup="true" aria-expanded="false"><span class="dot" id="pick-dot"></span><b id="pick-name"></b><i>▾</i></button><div class="pick-menu" id="pick-menu" hidden></div></div><button hidden type="button" class="navbtn" id="ctx-btn" title="What this session sends with every call">Context</button><button hidden type="button" class="navbtn" id="spend-btn" title="What this project costs">Spend</button><span class="grow"></span><button id="docs-toggle" hidden></button><a href="/board/sharing">sharing</a><a href="/board/stats">stats</a><button hidden class="gear" id="settings-btn" aria-label="Settings" title="Settings">⚙</button></nav>
<dialog id="settings"><form id="floor-form" method="dialog"><h2>Settings</h2><label>ChatGPT chats at once, all projects <input type="number" name="fleet" min="1" max="40"></label><label>Fresh session after, thousand tokens <input type="number" name="ctx" min="100" max="1000" step="50"></label><label>New projects go in <input type="text" name="raysRoot" spellcheck="false"></label><label>New repos go in <input type="text" name="codeRoot" spellcheck="false"></label><h3 id="settings-project-h"></h3><label>Handoffs kept running <input type="number" name="floor" min="1" max="10"></label><label class="switch"><span>Show tool calls in chat</span><input type="checkbox" id="sys" role="switch"></label><p class="counts" id="settings-counts"></p><div class="row"><button type="button" id="settings-close">Close</button><button type="submit" value="save">Save</button></div><output></output></form></dialog>
<div class="proj" id="project-layout"><aside id="docs-sidebar" class="docs-sidebar" hidden>
<header><strong>Documents</strong><button id="docs-close" aria-label="Close documents">×</button></header>
<input type="search" id="docs-search" placeholder="Search documents" aria-label="Search documents">
<div id="docs-sort"></div><div id="docs-tree"></div></aside><div class="main-pane"><div class="rpm" id="rpm"></div>
</div>
<section class="chat"><div class="chat-resize" id="chat-resize" title="Drag to resize"></div><header><span class="dot" id="sdot"></span><nav class="side-tabs" id="side-tabs"><button type="button" data-tab="chat" aria-current="true">Chat</button><button type="button" data-tab="insights">Insights <i></i></button><button type="button" data-tab="decisions">Decisions <i></i></button><button type="button" data-tab="documents">Documents <i></i></button><button type="button" data-tab="changes">Changes <i></i></button><button type="button" data-tab="plans">Plans <i></i></button><button type="button" data-tab="notes">Notes <i></i></button><button type="button" hidden data-tab="handoffs">Handoffs <i></i></button></nav></header><div class="chat-opts" id="chat-opts"><button id="older" type="button" hidden>Load older messages</button></div><div class="chat-log" id="log"></div><div class="side-lib" id="side-lib" hidden></div><form class="chat-compose" id="chat-compose" hidden><textarea id="chat-text" aria-label="Message to session" rows="3" maxlength="16000" required placeholder="Message"></textarea><button id="chat-send" type="submit">Save note</button><output id="chat-status" aria-live="polite"></output></form></section></div>
<div id="pveil" hidden></div><aside class="panel" id="panel" role="dialog" aria-modal="true" aria-label="Details" hidden><button class="close" id="pclose" aria-label="Close">×</button><div id="pbody"></div></aside>
<script>const RAY = ${JSON.stringify(ray).replace(/</g, "\\u003c")};
${SHARED_JS}
const DECISION_TOKEN = ${JSON.stringify(decisionToken).replace(/</g, "\\u003c")};
${DOC_RENDER_JS}
${PROJECT_JS}</script>${NOTIFICATION_TAG}</body></html>`;
}

const PROJECT_JS = `
let P = null, panelCard = null;
let initialCard = typeof location !== "undefined" ? cardHash() : null;
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
    (typeof P !== "undefined" && P?.decisionEnabled === false) ? d.options.map(o => '<p>' + esc(o.label) + (o.detail ? ' · ' + esc(o.detail) : '') + (o.images || []).map(img => '<img loading="lazy" alt="' + esc(o.label) + '" src="' + "/api/board/project/" + encodeURIComponent(c.decisionRay || RAY) + '/decision-image?path=' + encodeURIComponent(img) + '">').join("") + '</p>').join("") :
    // One "write it in the note" option is not a choice: show only a text field (owner 26 Nov).
    (d.options.length === 1 && d.allowNote && /note|reply/i.test(d.options[0].key + " " + d.options[0].label)) ?
      '<form id="card-decision-form"><input type="hidden" name="key" value="' + esc(d.options[0].key) + '"><textarea name="note" maxlength="500" required aria-label="Your answer"></textarea>' +
      '<button type="submit">Answer</button><button type="button" class="dismiss" data-dismiss="1">Dismiss</button><output aria-live="polite"></output></form>' :
      '<form id="card-decision-form"><fieldset><legend>Choose an option</legend>' + d.options.map(o =>
        '<label><input type="radio" name="key" value="' + esc(o.key) + '"> ' + esc(o.label) +
        (o.detail ? '<p>' + esc(o.detail) + '</p>' : "") + (o.images || []).map(img =>
          '<img loading="lazy" alt="' + esc(o.label) + '" src="/api/decisions/image?ray=' + encodeURIComponent(RAY) + '&amp;path=' + encodeURIComponent(img) + '">').join("") + '</label>').join("") +
      '</fieldset>' + (d.allowNote ? '<label>Optional note<textarea name="note" maxlength="500"></textarea></label>' : "") +
      '<button type="submit">Answer</button><button type="button" class="dismiss" data-dismiss="1">Dismiss</button><output aria-live="polite"></output></form>') + '</section>';
}
function cardHtml(r, c) {
  const failed = c.cause && c.cause.kind === "failed";
  const proofs = c.proofs || (c.proof ? [c.proof] : []);
  const links = c.modalTabs ? c.modalTabs.filter(t => t.kind === "file") : c.proofLinks || [];
  const chip = (cls, label, tip) => '<i class="' + cls + '" title="' + esc(tip || label) + '">' + esc(label) + '</i>';
  // Owner 27 Nov: a card shows only the files it produced. No who/duration/shared badges, no raw proof text,
  // no commit chips (a commit is not a file), no star.
  const files = links.filter(l => !l.label.startsWith("commit "));
  const seen = new Set();
  const metadata = files.filter(l => { const k = l.path || l.href; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(l => chip("proof-link", fileLabel(l), l.path || l.label)).join("");
  return '<div class="card' + (failed ? " failed" : "") + '" data-id="' + esc(r.id) + '" data-i="' + c.index + '">' +
    (c.decisionItem?.state === "pending" ? '<span class="flag decision-wait" title="Waiting on your decision">?</span>' : "") +
    '<span class="t">' + esc(c.text) + '</span>' +
    (failed ? '<span class="fail" title="' + esc(c.cause.reason || "") + '">failed · retry</span>' : "") +
    (metadata ? '<span class="outs">' + metadata + '</span>' : "") + '</div>';
}
function checkLight(r) {
  const state = r.checkState === "pass" || r.checkState === "fail" ? r.checkState : "stale";
  const at = r.checkResult?.at;
  const tip = state.toUpperCase() + " · Last run: " + (at || "never") +
    (!at && r.checkResult?.state === "manual" ? " (awaiting manual report)" : "");
  return '<span class="check-light ' + state + '" role="img" aria-label="' + esc(tip) + '" title="' + esc(tip) + '"></span>';
}
let closedResults = new Set(); try { closedResults = new Set(JSON.parse(localStorage.getItem("board-closed-" + RAY) || "[]")); } catch {}
const pdfLink = (x) => API + "/artifact?path=" + encodeURIComponent(x.pdf);
const docUrl = (relative) => API + "/doc?path=" + encodeURIComponent(relative);
const docLink = (x) => docUrl(x.path) + "&view=1";
const docPdf = (x) => x.pdf ? pdfLink(x) : docUrl(x.path) + "&pdf=1";
const modalLinks = (view, pdf) => '<div class="ctx"><a href="' + esc(view) + '" target="_blank" rel="noopener">Open in new tab</a> · <a href="' + esc(pdf) + '" target="_blank" rel="noopener">PDF</a></div>';
function decisionLinks(ray, id) {
  const url = "/api/board/project/" + encodeURIComponent(ray) + "/decision?id=" + encodeURIComponent(id);
  return modalLinks(url, url + "&print=1");
}
function sortDocuments(items, key) {
  const name = (a,b) => (a.title || a.label).localeCompare(b.title || b.label) || (a.path || "").localeCompare(b.path || "");
  return [...items].sort((a,b) => (key === "date" ? (b.mtime ?? -1) - (a.mtime ?? -1) : key === "size" ? (b.size ?? b.bytes ?? -1) - (a.size ?? a.bytes ?? -1) : 0) || name(a,b));
}
function sortControls() {
  return '<div class="doc-sort" role="group" aria-label="Sort documents">' + ["name", "date", "size"].map(key => '<button type="button" data-sort="' + key + '" aria-pressed="' + (key === docSort) + '">' + key + '</button>').join("") + '</div>';
}
function libraryHtml() {
  const L = P.library || { insights: [], decisions: [], documents: [] };
  const sec = (key, title, items, row) => '<details class="lib" data-lib="' + key + '"' + (closedResults.has(key) ? "" : " open") + '><summary>' + title + '<span>' + items.length + '</span></summary>' +
    (items.length ? items.map(row).join("") : "") + '</details>';
  return sec("insights", "Insights", L.insights, (x) => '<div class="insight"><b>' + esc(x.title) + '</b><p>' + esc(x.text || "") + '</p><time>' + esc(x.date) + '</time></div>') +
    sec("decisions", "Decisions", L.decisions, (x) => '<div class="lrow"><a class="t" data-doc="' + esc(x.path) + '" href="' + esc(docLink(x)) + '">' + esc(x.title) + '</a><time>' + esc(x.date) + '</time></div>') +
    sec("documents", "Documents", L.documents, (x) => '<div class="lrow"><a class="t" data-doc="' + esc(x.path) + '" href="' + esc(docLink(x)) + '">' + esc(x.title) + '</a><a class="pdf" href="' + esc(docPdf(x)) + '" target="_blank" rel="noopener">PDF</a><time>' + esc(x.date) + '</time></div>');
}
function render() {
  const head = '<h1>' + esc(P.name) + '</h1>' + ed("header", { key: "vision" }, P.vision, "vision") +
    (P.purpose || P.editEnabled ? '<div class="meta"><b>purpose</b>' + ed("header", { key: "purpose" }, P.purpose, "", "span") + '</div>' : "") +
    "";
  const cols = [["planned", " "], ["running", "~"], ["done", "x"]];
  const results = P.results.map((r) => {
    const done = r.cards.filter((c) => c.column === "done").length;
    const missing = r.cards.filter(c => c.missingProof).length;
    return '<details class="result" data-id="' + esc(r.id) + '"' + (closedResults.has(r.id) ? "" : " open") + '><summary class="rhead"><span class="num">#' + esc(r.id) + '</span>' +
      '<span class="title">' + esc(r.title) + '</span>' + checkLight(r) +
      '<span class="count">' + done + '/' + r.cards.length + '</span></summary>' +
      ed("result", { id: r.id, key: "result" }, r.result, "rtext") + ed("result", { id: r.id, key: "purpose" }, r.purpose, "rpurp") +
      '<div class="kanban">' + cols.map(([k, m]) => {
        const cards = r.cards.filter((c) => c.column === k);
        return '<div class="col ' + k + '" data-id="' + esc(r.id) + '"><h3><span>' + k + '</span><span>' + cards.length + '</span></h3>' +
          cards.map((c) => cardHtml(r, c)).join("") + '</div>';
      }).join("") + '</div>' + (r.now ? '<div class="rnow"><b>Now:</b> ' + esc(r.now) + '</div>' : "") + '</details>';
  }).join("");
  rpm.innerHTML = head + results;
  renderSideTabs();
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
    if (P.usageEnabled) { const usage = await fetch("/api/rays/" + encodeURIComponent(RAY) + "/usage").then(r=>r.json()).catch(()=>null); for(const id of ["ctx-btn","spend-btn"]) document.getElementById(id).hidden = !usage || !!usage.error; }
    if (initialCard) {
      const wanted = initialCard; initialCard = null;
      if (P.results.some(r => r.id === wanted.id && r.cards.some(c => c.index === wanted.i))) {
        if (typeof history !== "undefined") history.replaceState({...history.state, boardModal:false}, "", location.pathname + location.search);
        openCard(wanted.id, wanted.i, wanted.tab); return;
      }
    }
    if (initialDecision) {
      const wanted = initialDecision; initialDecision = null;
      for (const r of P.results) { const c = r.cards.find(c => c.decision === wanted); if (c) { openCard(r.id,c.index); return; } }
      openDecision(RAY, wanted);
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
  // Owner 27 Nov: the dialog froze ~3 s waiting for three requests; open first, fill as answers arrive.
  floorForm.querySelector("output").textContent = ""; if (!settings.open) settings.showModal();
  floorForm.elements.floor.value = P?.floor ?? "";
  document.getElementById("settings-project-h").textContent = (P?.name || RAY) + " only";
  const get = (u) => fetch(u, { cache: "no-store" }).then(r => r.json());
  get("/api/board/projects").then(d => { floorForm.elements.fleet.value = d.fleetLimit ?? ""; }).catch(() => {});
  if (!document.getElementById("settings-btn").hidden) get("/api/board/restarter/context").then(c => { floorForm.elements.ctx.value = Math.round(c.ctxMax / 1000); }).catch(() => {});
  get("/api/board/folders").then(f => { floorForm.elements.raysRoot.value = f.raysRoot; floorForm.elements.codeRoot.value = f.codeRoot; }).catch(() => {});
  document.getElementById("settings-counts").textContent = (P?.activeJobs ?? 0) + " running · " + (P?.queuedJobs ?? 0) + " queued";
  const edit = !!P?.editEnabled; for (const el of floorForm.elements) if (el.name) el.disabled = !edit;
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
    const ctx = Number(floorForm.elements.ctx.value); if (ctx) await post("/api/board/restarter/context", { ctxMax: ctx * 1000 });
    await post("/api/board/folders", { raysRoot: floorForm.elements.raysRoot.value.trim(), codeRoot: floorForm.elements.codeRoot.value.trim() });
    output.textContent = "Saved"; setTimeout(() => settings.close(), 500);
  } catch (err) { output.textContent = err.message; } finally { button.disabled = false; }
});
// Open panels are snapshots. Polling is paused while open; chat polling is independent.
const panel = document.getElementById("panel"), pbody = document.getElementById("pbody");
const scopedProofHref = (href) => {
  if (href.startsWith("/board/doc?") || href.startsWith("/board/doc-asset?")) {
    const asset = href.startsWith("/board/doc-asset?");
    const relative = new URLSearchParams(href.split("?")[1]).get("path");
    if (relative?.startsWith(RAY + "/")) return asset ? API + "/doc-asset?path=" + encodeURIComponent(relative) : docLink({path:relative});
  }
  return href;
};
const linkHtml = (l) => '<a href="' + esc(scopedProofHref(l.href)) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
const diffFrame = (url) => '<a class="difflink" href="' + esc(url) + '" target="_blank" rel="noopener">Open the change</a>';
/** Proof shown in the modal itself (owner 26 Nov: "cant we just embed it there in modal"). */
function fileLabel(l) {
  if (l.label.startsWith("commit ")) return "change " + l.label.slice(7, 14);
  const p = l.path || decodeURIComponent(l.href.split("path=")[1] || l.label);
  return p.split("/").pop() || l.label;
}
// Owner 27 Nov: people understand Markdown and pictures, not raw CSV/JSONL. Data files become a summary:
// row count, small charts of the most telling columns, and a few rows. Code and logs get no preview.
function dvParseCsv(text, sep) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === String.fromCharCode(10)) { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== String.fromCharCode(13)) cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter(r => r.some(v => v !== "")).map(r => Object.fromEntries(head.map((h, i) => [h || ("column " + (i + 1)), r[i] ?? ""])));
}
function dvFlat(o) {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return { value: o };
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) { if (v2 === null || typeof v2 !== "object") out[k + "." + k2] = v2; }
    else if (!Array.isArray(v)) out[k] = v;
    else out[k] = v.length + " items";
  }
  return out;
}
function dvRows(text, file) {
  if (file.endsWith(".csv")) return dvParseCsv(text, ",");
  if (file.endsWith(".tsv")) return dvParseCsv(text, String.fromCharCode(9));
  if (file.endsWith(".jsonl")) return text.split(String.fromCharCode(10)).map(l => l.trim()).filter(Boolean).map(l => { try { return dvFlat(JSON.parse(l)); } catch { return null; } }).filter(Boolean);
  const j = JSON.parse(text);
  if (Array.isArray(j)) return j.map(dvFlat);
  const arr = Object.values(j).find(v => Array.isArray(v) && v.length && typeof v[0] === "object");
  return arr ? arr.map(dvFlat) : [dvFlat(j)];
}
function dvNum(v) { if (typeof v === "number") return v; if (typeof v !== "string" || v.trim() === "") return NaN; const n = Number(v.replace(/,/g, "")); return n; }
function dvBars(items, title) {
  const max = Math.max(...items.map(x => x[1]), 1), w = 260, bh = 14;
  const bars = items.map((x, i) => '<text x="0" y="' + (i * (bh + 4) + 11) + '" class="dvl">' + esc(String(x[0]).slice(0, 22)) + '</text>' +
    '<rect x="120" y="' + (i * (bh + 4)) + '" width="' + Math.max(1, Math.round((w - 160) * x[1] / max)) + '" height="' + bh + '" rx="2" class="dvb"></rect>' +
    '<text x="' + (124 + Math.round((w - 160) * x[1] / max)) + '" y="' + (i * (bh + 4) + 11) + '" class="dvn">' + x[1] + '</text>').join("");
  return '<figure class="dvf"><figcaption>' + esc(title) + '</figcaption><svg viewBox="0 0 ' + w + ' ' + (items.length * (bh + 4)) + '" width="100%">' + bars + '</svg></figure>';
}
function dvHist(vals, title) {
  const lo = Math.min(...vals), hi = Math.max(...vals), bins = 10, w = 260, h = 70;
  const counts = new Array(bins).fill(0);
  for (const v of vals) counts[hi === lo ? 0 : Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins))]++;
  const max = Math.max(...counts, 1), bw = w / bins;
  const sorted = [...vals].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const fmt = n => Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : String(Math.round(n * 100) / 100);
  const bars = counts.map((c, i) => '<rect x="' + (i * bw + 1) + '" y="' + (h - Math.round(h * c / max)) + '" width="' + (bw - 2) + '" height="' + Math.round(h * c / max) + '" class="dvb"><title>' + c + '</title></rect>').join("");
  return '<figure class="dvf"><figcaption>' + esc(title) + ' · min ' + fmt(lo) + ' · median ' + fmt(med) + ' · max ' + fmt(hi) + '</figcaption><svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" preserveAspectRatio="none">' + bars + '</svg></figure>';
}
function dvRender(rows) {
  if (!rows.length) return '<p class="dvh">No rows.</p>';
  const cols = [...new Set(rows.slice(0, 300).flatMap(r => Object.keys(r)))];
  const charts = [];
  for (const c of cols) {
    const vals = rows.map(r => r[c]).filter(v => v !== "" && v !== null && v !== undefined);
    if (vals.length < 2) continue;
    const nums = vals.map(dvNum).filter(Number.isFinite);
    const distinct = new Map(); for (const v of vals) distinct.set(String(v), (distinct.get(String(v)) || 0) + 1);
    if (nums.length >= vals.length * 0.8 && distinct.size > 3) charts.push({ score: 2, html: dvHist(nums, c) });
    else if (distinct.size > 1 && distinct.size <= 12 && distinct.size < vals.length) charts.push({ score: 3, html: dvBars([...distinct.entries()].sort((a, b) => b[1] - a[1]), c) });
  }
  const shown = charts.sort((a, b) => b.score - a.score).slice(0, 4).map(x => x.html).join("");
  const tc = cols.slice(0, 6);
  const table = '<div class="dvt"><table><tr>' + tc.map(c => '<th>' + esc(c) + '</th>').join("") + '</tr>' +
    rows.slice(0, 6).map(r => '<tr>' + tc.map(c => '<td>' + esc(String(r[c] ?? "").slice(0, 40)) + '</td>').join("") + '</tr>').join("") + '</table></div>';
  return '<p class="dvh">' + rows.length.toLocaleString() + ' rows · ' + cols.length + ' columns</p>' + (shown ? '<div class="dvc">' + shown + '</div>' : "") + table;
}
async function fillDataPreviews(root) {
  for (const el of root.querySelectorAll(".pview.data[data-src]")) {
    try {
      const res = await fetch(el.dataset.src, { cache: "no-store" });
      if (!res.ok) throw Error("Data unavailable");
      const text = await res.text();
      if (text.length > 5000000) { el.textContent = "Too large to preview"; continue; }
      el.innerHTML = dvRender(dvRows(text, el.dataset.file));
    } catch { el.textContent = "Data unavailable"; }
  }
}
async function fillDocPreviews(root) {
  for (const el of root.querySelectorAll(".mdoc[data-path]")) {
    try {
      const html = await (await fetch(API + "/doc?path=" + encodeURIComponent(el.dataset.path), { cache: "no-store" })).text();
      const data = JSON.parse(new DOMParser().parseFromString(html, "text/html").getElementById("doc-data").textContent);
      const article = document.createElement("article"); article.className = "board-document";
      el.replaceChildren(article); await renderBoardDocument(article, data, RAY);
    } catch { el.textContent = "Document unavailable"; }
  }
}
function proofPreview(l) {
  const h = l.href, file = decodeURIComponent(h.split("path=")[1] || "").toLowerCase();
  if (h.startsWith("/board/doc-asset")) return '<a class="pview" href="' + esc(scopedProofHref(h)) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(scopedProofHref(h)) + '" alt=""></a>';
  if (file.endsWith(".pdf")) return '<iframe class="pview pdf" src="' + esc(h) + '#view=FitH" title="' + esc(l.label) + '"></iframe>';
  if (h.startsWith("/board/doc?")) return '<div class="pview mdoc" data-path="' + esc(decodeURIComponent(h.split("path=")[1] || "")) + '">Loading…</div>';
  if (/[.](csv|tsv|jsonl|json)$/.test(file)) return '<div class="pview data" data-src="' + esc(scopedProofHref(h)) + '" data-file="' + esc(file) + '">Loading…</div>';
  return "";
}
// One card session owns its tabs and any in-flight preview requests.
function cardHash() {
  const params = new URLSearchParams((location.hash || "").slice(1));
  const m = /^(\\d+)\\.(\\d+)$/.exec(params.get("card") || "");
  if (!m) return null;
  const k = params.get("tab") || "0";
  return { id: m[1], i: Number(m[2]), tab: /^\\d+$/.test(k) ? Number(k) : 0 };
}
function cardEndpoint(session, view, extra = "") {
  return API + "/card?result=" + encodeURIComponent(session.id) + "&step=" + session.i + "&view=" + view + extra;
}
function codeMarkup(text) {
  // Escape every token, including comments, before adding a small dependency-free lexer.
  const tokens = /("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\/\\/.*|#.*|\\b(?:const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|throw|try|catch|new|def|print|exit|true|false|null|undefined|interface|type|public|private|fn|use|package|func|echo)\\b|\\b\\d+(?:\\.\\d+)?\\b)/g;
  return '<div class="card-code" tabindex="0" aria-label="Source code">' + String(text || "").split(/\\r?\\n/).map((line, i) => {
    let pos = 0, html = "";
    for (const m of line.matchAll(tokens)) {
      const token = m[0], cls = /^(?:\\/\\/|#)/.test(token) ? "comment" : /^["']/.test(token) ? "string" : /^\\d/.test(token) ? "number" : "keyword";
      html += esc(line.slice(pos, m.index)) + '<span class="syntax-' + cls + '">' + esc(token) + '</span>'; pos = m.index + token.length;
    }
    return '<div class="code-line"><span class="line-no" aria-hidden="true">' + (i + 1) + '</span><code>' + html + esc(line.slice(pos)) + '</code></div>';
  }).join("") + '</div>';
}
function checkMarkup(data, message = "", running = false) {
  const last = data.last || {}, state = last.state || "never";
  const label = {pass:"Pass",fail:"Fail",stale:"Stale",manual:"Manual",never:"Never"}[state] || "Never";
  const when = last.at ? new Date(last.at).toLocaleString() : "Not run yet";
  return '<div class="check-row"><span class="check-state ' + esc(state) + '">' + esc(label) + '</span><time title="' + esc(last.at || "") + '">' + esc(when) + '</time>' +
    '<button type="button" data-check-run' + (!data.runnable || running || last.running ? ' disabled' : '') + '>' + (running || last.running ? 'Running…' : 'Run') + '</button></div>' +
    '<p class="check-message" role="status">' + esc(message || (!data.runnable ? (last.kind === "manual" ? "Manual checks are reported, not executed." : "No runnable check (or demo is read-only).") : "")) + '</p>' +
    '<h3>Declaration</h3><pre class="check-output">' + esc(data.declaration || "No check declaration") + '</pre>' +
    (data.acceptance && data.acceptance !== data.declaration ? '<p class="check-acceptance">' + esc(data.acceptance) + '</p>' : '') +
    (data.script ? '<h3>' + esc(data.script.path) + '</h3>' + codeMarkup(data.script.text) + (data.script.truncated ? '<p class="ctx">First 80 lines (size limited).</p>' : '') : '') +
    '<h3>Last output</h3><pre class="check-output">' + esc(last.output || last.lastLine || "No recorded output") + '</pre>';
}
function pollCardCheck(session, el, data) {
  if (data.last?.running && typeof setTimeout !== "undefined") setTimeout(() => {
    if (panelCard === session && !session.running && session.check === data) void fetchCardCheck(session, el);
  }, 2000);
}
async function fetchCardCheck(session, el) {
  const request = session.checkRequest = (session.checkRequest || 0) + 1;
  try {
    const res = await fetch(cardEndpoint(session, "check"), {cache:"no-store"});
    if (!res.ok) throw Error("Check unavailable (" + res.status + ")");
    const data = await res.json();
    if (panelCard !== session || session.running || request !== session.checkRequest) return;
    session.check = data; el.innerHTML = checkMarkup(data);
    pollCardCheck(session, el, data);
  } catch (err) { if (panelCard === session && !session.running && request === session.checkRequest) el.textContent = err.message; }
}
async function runCardCheck(session, el) {
  if (!session.check?.runnable || session.running || session.check.last?.running) return;
  session.checkRequest = (session.checkRequest || 0) + 1;
  session.running = true; el.innerHTML = checkMarkup(session.check, "", true);
  let message = "";
  try {
    const res = await fetch("/api/checks/run?ray=" + encodeURIComponent(RAY) + "&goal=" + encodeURIComponent(session.id), {method:"POST"});
    const record = await res.json();
    if (!res.ok) {
      const retry = res.headers.get("retry-after");
      throw Error(res.status === 429 ? "Check is on cooldown. Try again in " + (retry || "a few") + " seconds." : (record.error || "Check failed to run"));
    }
    session.check.last = {...session.check.last, ...record, state:record.status, running:false};
  } catch (err) { message = err.message; }
  finally {
    if (panelCard === session) {
      el.innerHTML = checkMarkup(session.check, message, true);
      // Read the authoritative light and tail; retain the completed POST result if refresh fails.
      try {
        const res = await fetch(cardEndpoint(session, "check"), {cache:"no-store"});
        if (res.ok) session.check = await res.json();
      } catch {}
      if (panelCard === session) {
        el.innerHTML = checkMarkup(session.check, message);
        pollCardCheck(session, el, session.check);
      }
    }
    session.running = false;
  }
}
async function loadCardTab(session, index, el) {
  const tab = session.tabs[index];
  if (tab.kind === "card") { for (const job of el.querySelectorAll(".job")) hydrateJob(job); return; }
  if (tab.kind === "check") { await fetchCardCheck(session, el); return; }
  if (tab.preview === "unavailable") { el.innerHTML = '<p class="tab-path">' + esc(tab.path) + '</p><p>File is outside the project folder; preview unavailable.</p>'; return; }
  const href = scopedProofHref(tab.href);
  const link = '<p class="tab-path"><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(tab.path || tab.href) + '</a></p>';
  if (tab.kind === "diff") {
    el.innerHTML = link + '<iframe class="card-frame" src="' + esc(href) + '" title="' + esc(tab.label) + '"></iframe>'; return;
  }
  if (tab.kind === "url") {
    let same = false; try { same = new URL(href, location.href).origin === location.origin; } catch {}
    el.innerHTML = link + (same ? '<iframe class="card-frame" sandbox src="' + esc(href) + '" title="' + esc(tab.label) + '"></iframe>' : ''); return;
  }
  if (tab.preview === "code") {
    el.innerHTML = link + '<p>Loading…</p>';
    try {
      const res = await fetch(cardEndpoint(session, "source", "&tab=" + index + "&path=" + encodeURIComponent(tab.path)), {cache:"no-store"});
      if (!res.ok) throw Error("File unavailable (" + res.status + ")");
      const source = await res.json();
      if (panelCard === session) el.innerHTML = link + codeMarkup(source.text) + (source.truncated ? '<p class="ctx">Preview truncated. Open the file for the rest.</p>' : '');
    } catch (err) { if (panelCard === session) el.innerHTML = link + '<p>' + esc(err.message) + '</p>'; }
    return;
  }
  el.innerHTML = link + proofPreview(tab);
  if (tab.preview === "markdown") fillDocPreviews(el);
  if (tab.preview === "data") fillDataPreviews(el);
}
function selectCardTab(index, focus = false) {
  const session = panelCard;
  if (!session?.tabs) return;
  if (!Number.isInteger(index) || index < 0 || index >= session.tabs.length) index = 0;
  session.tab = index;
  const buttons = [...pbody.querySelectorAll("[data-card-tab]")];
  const panes = [...pbody.querySelectorAll("[data-card-pane]")];
  for (const [k, button] of buttons.entries()) {
    button.setAttribute("aria-selected", String(k === index)); button.tabIndex = k === index ? 0 : -1;
    if (k === index) { if (focus) button.focus(); button.scrollIntoView?.({block:"nearest",inline:"nearest"}); }
  }
  for (const [k, pane] of panes.entries()) pane.hidden = k !== index;
  const pane = panes[index];
  if (pane && !session.loaded.has(index)) { session.loaded.add(index); void loadCardTab(session, index, pane); }
  else if (pane && session.tabs[index].kind === "check" && !session.running && session.previousTab !== index) void fetchCardCheck(session, pane);
  session.previousTab = index;
  if (typeof history !== "undefined") history.replaceState({...history.state, boardModal:true}, "", "#card=" + session.id + "." + session.i + "&tab=" + index);
}
pbody.addEventListener("click", e => {
  const tab = e.target.closest?.("[data-card-tab]");
  if (tab) { selectCardTab(Number(tab.dataset.cardTab), true); return; }
  const run = e.target.closest?.("[data-check-run]");
  if (run && panelCard?.tabs) void runCardCheck(panelCard, run.closest("[data-card-pane]"));
});
pbody.addEventListener("keydown", e => {
  const tab = e.target.closest?.("[data-card-tab]"); if (!tab || !panelCard?.tabs) return;
  const n = panelCard.tabs.length, i = Number(tab.dataset.cardTab);
  const next = e.key === "ArrowRight" ? (i+1)%n : e.key === "ArrowLeft" ? (i+n-1)%n : e.key === "Home" ? 0 : e.key === "End" ? n-1 : null;
  if (next !== null) { e.preventDefault(); selectCardTab(next, true); }
});
function openCard(id, i, initialTab = 0) {
  const r = P?.results.find(x => x.id === id), c = r && r.cards.find(x => x.index === i);
  if (!c) return;
  const tabs = c.modalTabs || [{kind:"card",label:"Card"}, ...(c.proofLinks || []).map(l => ({...l, kind:l.label.startsWith("commit ") ? "diff" : "file", label:fileLabel(l)})), {kind:"check",label:"Check"}];
  beginPanel({ id, i, tabs, loaded:new Set() });
  panel.classList.toggle("card-modal", true);
  const proof = c.proof ? '<h3>Proof</h3><pre class="card-proof">' + esc(c.proof) + '</pre>' : "";
  const jobs = c.jobs.map(j => {
    const commit = j.appliedCommit ? "/board/diff?hash=" + encodeURIComponent(j.appliedCommit) + "&ray=" + encodeURIComponent(RAY) : null;
    const diff = commit || j.replyDiff?.link;
    const links = [
      j.conversationUrl ? '<a class="chat-link" href="' + esc(j.conversationUrl) + '" target="_blank" rel="noopener">Conversation</a>' : "",
      diff ? linkHtml({ href:diff, label:commit ? "Applied commit " + j.appliedCommit.slice(0,7) : "Reply diff" }) : ""
    ].filter(Boolean).join(" ");
    return '<div class="job" data-job="' + esc(j.name) + '"><div><span class="jn">' + esc(j.name) + '</span> <span class="js">' + esc(j.state) +
      (j.minutes ? " · " + Math.round(j.minutes) + "m" : "") + '</span></div>' +
      (j.queuePosition != null ? '<div>Queue position: ' + (j.queuePositionEstimated ? 'estimated ' : '') + esc(j.queuePosition) + ' · ' + esc(j.waitReason || "Waiting") + '</div>' : "") +
      (j.failureReason ? '<div class="fr">' + esc(j.failureReason) + '</div>' : "") +
      (links ? '<div class="links">' + links + '</div>' : "") +
      '<div class="lbl">Request</div><pre class="req">' + esc(j.promptPreview || "Loading request…") + '</pre>' +
      '<div class="attachments"></div><div class="lbl">Reply</div><pre class="rep">' + esc(j.replyPreview || "No reply yet") + '</pre>' +
      '<div class="artifacts"></div><div class="diff">' + (diff ? diffFrame(diff) : "") + '</div>' +
      (j.state === "done-zip-missing" && P.editEnabled ? '<button class="rescue">Retry download</button><output class="rescue-status"></output>' : "") + '</div>';
  }).join("");
  const overview = '<h2>' + esc(c.text) + '</h2><div class="ctx">#' + esc(r.id) + ' ' + esc(r.title) + ' · ' + esc(c.column) + '</div>' +
    (c.decision ? decisionLinks(RAY, c.decision) : "") + decisionHtml(c) + proof + (jobs ? '<h3>Handoffs</h3>' + jobs : "");
  pbody.innerHTML = '<div class="pcard"><div class="card-tabs" role="tablist" aria-label="Card outputs">' + tabs.map((t,k) => '<button type="button" role="tab" id="card-tab-' + k + '" aria-controls="card-pane-' + k + '" aria-selected="false" tabindex="-1" data-card-tab="' + k + '" title="' + esc(t.path || t.href || t.label) + '">' + esc(t.label) + '</button>').join("") + '</div>' +
    tabs.map((t,k) => '<section class="card-tab-pane" role="tabpanel" id="card-pane-' + k + '" aria-labelledby="card-tab-' + k + '" data-card-pane="' + k + '"' + (k ? ' hidden' : '') + '>' + (k ? '' : overview) + '</section>').join("") + '</div>';
  showPanel(); selectCardTab(initialTab, true);
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
    const base = (a) => String(typeof a === "string" ? a : (a?.name || a?.path || "")).split(String.fromCharCode(92)).join("/").split("/").pop();
    el.querySelector(".attachments").innerHTML = t.attachments?.length ? '<div class="lbl">Sent with the request</div><ul class="flist">' +
      t.attachments.map(a => '<li>' + esc(base(a)) + '</li>').join("") + '</ul>' : "";
    const isImg = (f) => /[.](png|jpe?g|gif|webp|svg)$/i.test(decodeURIComponent(f.href) + " " + (f.label || "")) && f.href.includes("/board/doc-asset");
    el.querySelector(".artifacts").innerHTML = t.files?.length ? '<div class="lbl">Returned files</div><ul class="flist">' + t.files.map(f =>
      '<li>' + linkHtml(f) + (isImg(f) ? '<a class="thumb" href="' + esc(f.href) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(f.href) + '" alt=""></a>' : "") + '</li>').join("") + '</ul>' : "";
    if (t.appliedCommit && (recovered || !el.querySelector(".diff a"))) {
      const url = "/board/diff?ray=" + encodeURIComponent(RAY) + "&hash=" + encodeURIComponent(t.appliedCommit);
      el.querySelector(".diff").innerHTML = linkHtml({href:url,label:"Applied commit " + t.appliedCommit.slice(0,7)}) + diffFrame(url);
    } else if (t.overlayLink && (recovered || !el.querySelector(".diff a"))) el.querySelector(".diff").innerHTML = diffFrame(t.overlayLink);
  } catch (err) { if (el.isConnected) el.querySelector(".artifacts").textContent = err.message; }
}
pbody.addEventListener("click", e => {
  const d = e.target.closest && e.target.closest("button[data-dismiss]"); if (!d) return;
  const form = d.closest("form"); if (!form) return;
  form.dataset.dismiss = "1"; form.noValidate = true; // a dismissal needs no text (owner 27 Nov)
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
});
pbody.addEventListener("submit", async e => {
  if (e.target.id !== "card-decision-form") return;
  e.preventDefault();
  const form = e.target, button = form.querySelector("button"), output = form.querySelector("output");
  const r = P.results.find(r => r.id === panelCard?.id), c = panelCard?.c || r?.cards.find(c => c.index === panelCard?.i);
  if (P?.decisionEnabled === false || !c?.decisionItem || button.disabled) return;
  const data = new FormData(form);
  button.disabled = true;
  try {
    const response = await fetch("/api/decisions/answer", {method:"POST", headers:{"content-type":"application/json","x-decision-token":DECISION_TOKEN},
      body:JSON.stringify({ray:c.decisionRay || RAY,id:c.decision,key:form.dataset.dismiss ? "dismissed" : (data.get("key") || ""),note:form.dataset.dismiss ? "" : (data.get("note") || "")})});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Answer failed");
    c.decisionItem.answer = result.answer; c.decisionItem.state = "answered";
    const section = form.closest(".card-decision");
    const saved = document.createElement("p"); saved.className = "decision-answer"; saved.textContent = "Answered: " + answerText(c.decisionItem);
    form.replaceWith(saved);
    const card = [...rpm.querySelectorAll(".card")].find(el=>el.dataset.id===r.id && Number(el.dataset.i)===c.index);
    card?.querySelector(".decision-wait")?.remove();
    document.dispatchEvent(new Event("decision-answered"));
  } catch(err) { output.textContent=err.message; } finally { button.disabled=false; }
});
// Conversation links open in the Chrome profile signed in to ChatGPT when this machine sets one; else a normal tab.
pbody.addEventListener("click", async e => {
  const a = e.target.closest("a.chat-link");
  if (!a || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const r = await fetch("/api/open-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: a.href }) }).catch(() => null);
  if (!r || !r.ok) window.open(a.href, "_blank", "noopener");
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
// One history entry per modal session; opening another item replaces its content.
function beginPanel(card) {
  ++docRequest; currentDoc = "";
  panelCard = card; panel.classList.toggle("wide", false); panel.classList.toggle("card-modal", false);
  if (!card.tabs && typeof history !== "undefined" && cardHash()) history.replaceState({...history.state}, "", location.pathname + location.search);
  if (typeof history !== "undefined" && !history.state?.boardModal) history.pushState({ ...history.state, boardModal: true }, "");
}
function showPanel() { panel.hidden = false; pveil.hidden = false; panel.scrollTop = 0; }
// Owner 27 Nov: see the context the session sends with every call, and what it costs; from the usage proxy's records.
const kTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
const usd = (n) => "$" + (n >= 10 ? n.toFixed(0) : n.toFixed(2));
const WHY = { normal_growth: "only the new messages were new", ttl_expired: "cache expired (idle over an hour)", system_changed: "instructions changed (rules, tools or memory)", history_rewritten: "earlier messages changed", model_changed: "model changed", first_call: "first call of the session" };
async function usageModal(kind) {
  beginPanel({ usage: kind }); pbody.innerHTML = '<div class="pcard usage"><p>Loading…</p></div>'; showPanel();
  let u; try { u = await (await fetch("/api/rays/" + encodeURIComponent(RAY) + "/usage", { cache: "no-store" })).json(); } catch { u = null; }
  const box = pbody.querySelector(".usage"); if (!box) return;
  if (!u || u.error) { box.innerHTML = "<p>No usage records" + (u?.error ? ": " + esc(u.error) : "") + "</p>"; return; }
  if (kind === "context") {
    const l = u.last; if (!l) { box.innerHTML = "<p>No calls recorded for the live session.</p>"; return; }
    const total = l.sysChars + l.toolsChars + l.msgsChars || 1, part = (n, c) => '<i style="width:' + (100 * n / total).toFixed(1) + '%;background:' + c + '"></i>';
    box.innerHTML = '<h2>Context</h2><div class="big">' + kTok(l.contextTokens) + ' tokens</div><p>sent with every call · ' + l.msgCount + ' messages · ' + l.toolCount + ' tools · ' + esc(l.model) + '</p>' +
      '<div class="ctxbar">' + part(l.sysChars, "var(--busy)") + part(l.toolsChars, "var(--mute)") + part(l.msgsChars, "var(--done)") + '</div>' +
      '<table><tr><th>Part</th><th>Characters</th><th>Share</th></tr>' + [["Instructions", l.sysChars], ["Tools", l.toolsChars], ["Conversation", l.msgsChars]].map(([n, c]) => '<tr><td>' + n + '</td><td>' + kTok(c) + '</td><td>' + (100 * c / total).toFixed(0) + '%</td></tr>').join("") + '</table>' +
      '<h3>Last calls</h3><table><tr><th>Time</th><th>From cache</th><th>Written</th><th>Why</th><th>Cost</th></tr>' + u.calls.slice(0, 15).map(c => '<tr' + (c.reason && c.reason !== "normal_growth" ? ' class="miss"' : '') + '><td>' + new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + '</td><td>' + kTok(c.cacheRead) + '</td><td>' + kTok(c.cacheWrite + c.uncached) + '</td><td>' + esc(WHY[c.reason] || c.reason) + '</td><td>' + usd(c.usd) + '</td></tr>').join("") + '</table>';
  } else {
    const s = u.session24h, r = u.ray24h;
    box.innerHTML = '<h2>Spend, last 24 hours</h2><div class="big">' + usd(r.usd) + '</div><p>' + r.calls + ' calls for this project at API prices · this session ' + usd(s.usd) + ' in ' + s.calls + ' calls</p>' +
      '<table><tr><th></th><th>This session</th></tr><tr><td>Read from cache</td><td>' + kTok(s.cacheRead) + ' tokens</td></tr><tr><td>Written to cache</td><td>' + kTok(s.cacheWrite) + ' tokens</td></tr></table>' +
      '<h3>Cache misses, whole project</h3>' + (u.misses.length ? '<table><tr><th>Why</th><th>Calls</th><th>Tokens rebuilt</th></tr>' + u.misses.map(m => '<tr><td>' + esc(WHY[m.reason] || m.reason) + '</td><td>' + m.calls + '</td><td>' + kTok(m.wasted) + '</td></tr>').join("") + '</table>' : '<p>None.</p>');
  }
}
document.getElementById("ctx-btn")?.addEventListener("click", () => usageModal("context"));
document.getElementById("spend-btn")?.addEventListener("click", () => usageModal("spend"));

function hidePanel() {
  ++docRequest; currentDoc = ""; panel.classList.toggle("wide", false); panel.classList.toggle("card-modal", false); panel.hidden = true; pveil.hidden = true; panelCard = null;
  pbody.replaceChildren(); updateDocTree(true); load(true);
}
function closePanel() {
  if (panel.hidden) return;
  if (typeof history !== "undefined" && history.state?.boardModal) history.back();
  else hidePanel();
}
if (typeof window !== "undefined" && typeof history !== "undefined") {
  // Reloading a modal history entry must not leave an invisible modal entry behind.
  if (history.state?.boardModal) history.replaceState({ ...history.state, boardModal: false }, "");
  window.addEventListener("popstate", () => {
    const wanted = cardHash();
    if (wanted && P?.results.some(r => r.id === wanted.id && r.cards.some(c => c.index === wanted.i))) {
      if (panelCard?.id === wanted.id && panelCard?.i === wanted.i && panelCard.tabs) selectCardTab(wanted.tab);
      else openCard(wanted.id, wanted.i, wanted.tab);
    } else if (!panel.hidden) hidePanel();
  });
}
document.getElementById("pclose").onclick = closePanel;
const pveil = document.getElementById("pveil"); pveil.onclick = closePanel;

/** A decision with no card on this project (or another project's): same modal, decision only. */
async function openDecision(ray, id) {
  if (ray === RAY && P) for (const r of P.results) { const c = r.cards.find(c => c.decision === id); if (c?.decisionItem?.decision) { openCard(r.id, c.index); return; } }
  let x = ray === RAY ? P?.decisionInbox?.find(x => x.id === id) : null;
  if (!x && P && P.decisionEnabled !== false) {
    const request = docRequest;
    const data = await (await fetch("/api/decisions", { cache: "no-store" })).json();
    if (request !== docRequest) return;
    x = data.items.find(x => x.ray === ray && x.id === id);
  }
  if (!x?.decision) return;
  const c = { text: x.decision.title, decision: id, decisionItem: x, decisionRay: ray, jobs: [] };
  beginPanel({ c });
  pbody.innerHTML = '<div class="pcard"><div class="ctx">' + esc(ray) + '</div>' + decisionLinks(ray, id) + decisionHtml(c) + '</div>';
  showPanel();
}
window.__openDecision = openDecision;
document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) { e.preventDefault(); closePanel(); } });
// Chat: the ray's live session transcript, newest at the bottom.
const log = document.getElementById("log"), olderBtn = document.getElementById("older");
let chat = { end: 0, before: null, signature: "" };
let chatLoading = false;
const compose = document.getElementById("chat-compose"), chatText = document.getElementById("chat-text"), sendBtn = document.getElementById("chat-send"), chatStatus = document.getElementById("chat-status");
compose.onsubmit = async (e) => {
  e.preventDefault(); if (sendBtn.disabled || !chatText.value.trim()) return;
  const text = chatText.value; sendBtn.disabled = true; chatStatus.textContent = "Submitting…";
  try {
    const response = await fetch("/api/rays/" + encodeURIComponent(RAY) + "/chat", { method: "POST", headers: { "content-type": "application/json", "x-decision-token": DECISION_TOKEN }, body: JSON.stringify({ text }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.message || result.error || "Send failed");
    chatStatus.textContent = result.message || "Saved note: " + result.file;
    if (chatText.value === text) chatText.value = "";
    await loadChat();
  } catch (err) { chatStatus.textContent = err.message; } finally { sendBtn.disabled = false; }
};
function chatMd(text) {
  return String(text).split(/\`\`\`[^\\n]*\\n?/).map((part, i) => i % 2 ? "<pre>" + esc(part) + "</pre>" :
    esc(part).split(/\\n{2,}/).filter((x) => x.trim()).map((p) => "<p>" + p.replace(/\`([^\`\\n]+)\`/g, "<code>$1</code>")
      .replace(/\\*\\*([^*\\n]+)\\*\\*/g, "<strong>$1</strong>").replace(/\\n/g, "<br>") + "</p>").join("")).join("");
}
const chatFull = new Map(); let chatFullSeq = 0;
function chatLines(text) { return String(text).split(String.fromCharCode(10)); }
// Owner 27 Nov 16:40: at most two sentences show; the rest opens in the modal, "Read +N words" on the same line.
function chatFlat(text) {
  return chatLines(text).map(l => l.trim()).filter(l => l && !/^([|]|\`\`\`)/.test(l)).map(l => l.replace(/^(#+|[-*]|[0-9]+[.)]) /, "")).join(" ").replace(/\\s+/g, " ").trim();
}
function chatWords(text) { return String(text).split(/\\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length; }
function chatLead(text) {
  const flat = chatFlat(text), re = /[.!?]["')\\]]*(?=\\s|$)/g; let m, n = 0, cut = flat.length;
  while ((m = re.exec(flat))) { if (++n === 2) { cut = m.index + m[0].length; break; } }
  return flat.slice(0, cut).trim();
}
function chatLong(text) { return chatWords(text) > chatWords(chatLead(text)) + 2; }
async function openMessage(key) {
  const text = chatFull.get(key); if (!text) return;
  beginPanel({ msg: key });
  pbody.innerHTML = '<div class="pcard pdoc"><article class="board-document"></article></div>';
  panel.classList.toggle("wide", true); showPanel();
  await renderBoardDocument(pbody.querySelector("article"), [{ rel: RAY + "/chat.md", text }], RAY);
}
document.addEventListener("click", e => { const a = e.target.closest && e.target.closest("a.more[data-full]"); if (a) { e.preventDefault(); openMessage(a.dataset.full); } });
function turnHtml(t) {
  if (t.role === "break") return '<div class="turn break"><span>new session' + (t.at ? " · " + esc(new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })) : "") + '</span></div>';
  const who = t.role === "owner" ? "you" : t.role === "peer" ? (t.from || "peer") : t.role === "system" ? "system" : "session";
  const time = t.at ? new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const tools = (t.tools || []).map((x) => '<div class="tool' + (x.ok === false ? " bad" : "") + '">▸ <b>' + esc(x.name) + '</b> ' + esc(x.description || "") +
    (x.result ? '<div class="res">' + esc(x.result) + '</div>' : "") + '</div>').join("");
  // Owner 26 Nov: only the time, on the same line; colour tells you from the session. Peers keep their name.
  const label = t.role === "peer" ? who + " " + time : t.role === "system" ? "system " + time : time;
  const tm = '<span class="tm">' + esc(label) + '</span>';
  // Owner 27 Nov: a chat message is at most five lines; a long or structured reply shows its opening and a
  // "Read" link that opens the whole message, rendered as Markdown, in the modal.
  const long = t.text && t.role !== "system" && chatLong(t.text);
  let body = t.text ? (t.role === "system" ? esc(t.text) : chatMd(long ? chatLead(t.text) : t.text)) : "";
  let more = "";
  if (long) { const key = "m" + (++chatFullSeq); chatFull.set(key, t.text); more = ' <a class="more" href="#" data-full="' + key + '">Read +' + Math.max(1, chatWords(t.text) - chatWords(chatLead(t.text))) + ' words</a>'; }
  // time goes inside the first paragraph so it sits on the text's own line; Read goes at its end
  if (/^<p[ >]/.test(body)) body = body.replace(/^<p([^>]*)>/, (m) => m + tm); else body = tm + body;
  if (more) body = body.endsWith("</p>") ? body.slice(0, -4) + more + "</p>" : body + more;
  // Owner 27 Nov: a turn with no words (only tool calls) shows no empty row; its tools still show when tool calls are on.
  if (!t.text || !String(t.text).trim()) return tools ? '<div class="turn ' + t.role + '">' + tools + '</div>' : "";
  return '<div class="turn ' + t.role + '"><div class="msg">' + body + '</div>' + tools + '</div>';
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
    const tagged = (t, i) => turnHtml(t).replace('<div class="turn', '<div data-i="' + (page.start + i) + '" class="turn');
    if (!chat.end || chat.session !== page.session) {
      log.innerHTML = page.turns.map(tagged).join("") || '<p class="ctx">No local transcript yet.</p>';
      chat = { end: page.end, before: page.before, signature, session: page.session };
      olderBtn.hidden = page.before == null; olderLabel(page);
    } else {
      // Owner 26 Nov: new messages must not reset the scroll or drop older pages: patch and append only.
      const top = log.scrollTop;
      page.turns.forEach((t, i) => {
        const html = tagged(t, i), el = log.querySelector('[data-i="' + (page.start + i) + '"]');
        if (el) { if (el.outerHTML !== html) el.outerHTML = html; } else log.insertAdjacentHTML("beforeend", html);
      });
      chat = { ...chat, end: page.end, signature, session: page.session };
      if (!follow) log.scrollTop = top;
    }
    if (follow) log.scrollTop = log.scrollHeight;
  } catch {} finally { chatLoading = false; }
}
let loadingOlder = false;
// Owner 26 Nov: no auto-load (the scrollbar jumped); the button says how much is loaded and how much is left.
function olderLabel(page) {
  const total = Math.max(1, Math.ceil((page.total ?? page.end ?? 0) / 60)), left = Math.ceil((chat.before ?? 0) / 60);
  olderBtn.textContent = "Load older messages · " + (total - left) + " of " + total + " pages loaded";
}
olderBtn.onclick = async () => {
  if (chat.before == null || loadingOlder) return;
  loadingOlder = true; try {
  const page = await (await fetch(chatUrl(chat.before), { cache: "no-store" })).json();
  const h = log.scrollHeight;
  log.insertAdjacentHTML("afterbegin", page.turns.map(turnHtml).join(""));
  log.scrollTop += log.scrollHeight - h;
  chat.before = page.before; olderBtn.hidden = page.before == null; olderLabel(page);
  } finally { loadingOlder = false; }
};
const sysBox = document.getElementById("sys");
try { sysBox.checked = localStorage.getItem("board-show-tools") === "1"; } catch {}
log.classList.toggle("sys", sysBox.checked);
sysBox.onchange = (e) => { log.classList.toggle("sys", e.target.checked); try { localStorage.setItem("board-show-tools", e.target.checked ? "1" : "0"); } catch {} };
const sidebar = document.getElementById("docs-sidebar"), docTree = document.getElementById("docs-tree");
const docSearch = document.getElementById("docs-search"), docToggle = document.getElementById("docs-toggle");
let docSignature = "", currentDoc = "", docRequest = 0;
let docSort = "date";
function toggleDocs(open) {
  sidebar.hidden = !open; document.getElementById("project-layout").classList.toggle("docs-open",open);
  docToggle.setAttribute("aria-expanded",String(open));
}
docToggle.onclick = () => toggleDocs(sidebar.hidden);
document.getElementById("docs-close").onclick = () => toggleDocs(false);
document.addEventListener("keydown", e => { if(e.key==="Escape" && !e.defaultPrevented && !sidebar.hidden && panel.hidden) toggleDocs(false); });

function updateDocTree(force = false) {
  const tree = P?.docTree || [], q = (docSearch.value || "").trim().toLowerCase();
  const signature = JSON.stringify([tree,q,currentDoc,P?.decisionInbox,docSort]);
  if (!force && signature === docSignature) return;
  docSignature = signature;
  document.getElementById("docs-sort").innerHTML = sortControls();
  const expanded = new Set([...docTree.querySelectorAll("details[open]")].map(d=>d.dataset.group));
  const build = (nodes, parent = "", matched = false) => nodes.map(n=>{
    const name = parent + "/" + n.label, own = matched || !q || (n.label + " " + (n.path || "")).toLowerCase().includes(q) ||
      (name==="/Decisions" && (P?.decisionInbox || []).some(x=>(x.id+" "+x.decision?.title).toLowerCase().includes(q)));
    const children = n.children ? build(sortDocuments(n.children, docSort),name,matched || (!!q && own)) : "";
    if (!own && !children) return "";
    const link = n.path ? '<a data-doc="' + esc(n.path) + '" href="' + esc(docLink(n)) + '"' +
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
      a.href=API+"/decision?id="+encodeURIComponent(x.id);
      a.textContent=(x.decision?.title || x.id)+(x.state==="pending"?" · waiting":"");
      a.dataset.decision=x.id;
      li.append(a); ul.append(li);
    }
  }
}
docSearch.oninput = () => updateDocTree(true);
document.getElementById("docs-sort").onclick = e => { const sort = e.target.closest("button[data-sort]"); if (sort) { docSort = sort.dataset.sort; updateDocTree(true); renderSideTabs(); } };
async function openDocument(relative) {
  beginPanel({ doc: relative });
  const request = docRequest; currentDoc = relative;
  const item = (P?.library?.documents || []).find(x => x.path === relative) || { path: relative, title: relative.split("/").pop() };
  pbody.innerHTML = '<div class="pcard pdoc"><h2>' + esc(item.title) + '</h2>' + modalLinks(docLink(item), docPdf(item)) +
    '<div class="doc-body">Loading document…</div></div>';
  panel.classList.toggle("wide", true); showPanel();
  const docContent = pbody.querySelector(".doc-body");
  updateDocTree(true);
  if (typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches) toggleDocs(false);
  try {
    const response = await fetch(API + "/doc?path=" + encodeURIComponent(relative), {cache:"no-store"});
    if (!response.ok) throw Error("Document unavailable (" + response.status + ")");
    const html = await response.text(); if (request !== docRequest) return;
    const fragment = new DOMParser().parseFromString(html,"text/html");
    const data = JSON.parse(fragment.getElementById("doc-data").textContent);
    const article = document.createElement("article"); article.className="board-document";
    docContent.replaceChildren(article);
    await renderBoardDocument(article,data,RAY);
  } catch(err) { if(request===docRequest) docContent.textContent=err.message; }
}
docTree.onclick = e => { if(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; const a=e.target.closest("a[data-doc]"); if(a){e.preventDefault();openDocument(a.dataset.doc);return;}
  const d=e.target.closest("a[data-decision]"); if(d){e.preventDefault();toggleDocs(false);openDecision(RAY,d.dataset.decision);}
};
pbody.addEventListener("click", e => { const a=e.target.closest(".doc-body a[href], .mdoc a[href], .plinks a[href]"); if(!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)return; const u=new URL(a.href,location.href);
  if(u.origin===location.origin && (u.pathname===API+"/doc" || u.pathname==="/board/doc") && u.searchParams.get("path")?.startsWith(RAY+"/")){e.preventDefault();openDocument(u.searchParams.get("path"));} });

// Owner 26 Nov: "insights, decisions, and documents as tabs in sidebar where chat is one of the tabs".
var sideTab = "chat"; try { sideTab = localStorage.getItem("board-side-tab-" + RAY) || "chat"; } catch {}
function handoffRows() {
  const H = P.handoffs || [];
  if (!H.length) return '<p class="empty">None yet.</p>';
  const bad = (h) => /fail|missing|lost|dead|stale/i.test(h.state) && !h.applied && !h.supersede;
  const word = (h) => h.applied ? "applied" : h.supersede ? "set aside" : bad(h) ? h.state.replace(/-/g, " ") :
    h.state === "done" ? "done, not applied" : h.state;
  const rows = [...H.filter(bad), ...H.filter(h => !bad(h))];
  return rows.map(h => '<div class="lrow hrow' + (bad(h) ? ' bad' : h.applied ? ' ok' : '') + '" data-job="' + esc(h.name) + '"><span class="t">' + esc(h.name) + '</span>' +
    '<span class="hs" title="' + esc(h.failureReason || h.supersede || "") + '">' + esc(word(h)) + (h.minutes ? ' · ' + Math.round(h.minutes) + 'm' : '') + '</span>' +
    '<time>' + esc(String(h.finishedAt || h.startedAt || "").slice(5, 16).replace("T", " ")) + '</time></div>').join("");
}
function sideRows(key) {
  if (key === "handoffs") return handoffRows();
  const L = P.library || { insights: [], decisions: [], documents: [] };
  const items = key === "documents" ? sortDocuments(L[key] || [], docSort) : L[key] || [];
  if (!items.length && key !== "documents" && key !== "decisions") return '<p class="empty">None yet.</p>';
  if (key === "insights") return items.map((x) => '<div class="insight"><b>' + esc(x.title) + '</b><p>' + esc(x.text || "") + '</p><time>' + esc(x.date) + '</time></div>').join("");
  const live = key === "decisions" ? (P.decisionInbox || []).map(x => '<div class="lrow"><a class="t" data-decision="' + esc(x.id) + '" href="' + API + '/decision?id=' + encodeURIComponent(x.id) + '">' + esc(x.decision?.title || x.id) + '</a></div>').join("") : "";
  return (key === "documents" ? sortControls() : "") + live + (!items.length && !live ? '<p class="empty">None yet.</p>' : "") + items.map((x) => '<div class="lrow"><a class="t" data-doc="' + esc(x.path) + '" href="' + esc(docLink(x)) + '">' + esc(x.title) + '</a>' +
    (key === "documents" ? '<a class="pdf" href="' + esc(docPdf(x)) + '" target="_blank" rel="noopener">PDF</a>' : '') + '<time>' + esc(key === "documents" && x.mtime != null ? new Date(x.mtime).toLocaleString() : x.date) + '</time></div>').join("");
}
// Owner 27 Nov: the chat column is resizable; the width is remembered per browser.
(function () {
  const grip = document.getElementById("chat-resize"), proj = grip && grip.closest && grip.closest(".proj"); if (!grip || !proj) return;
  try { const w = Number(localStorage.getItem("board-chat-width")); if (w >= 280) proj.style.setProperty("--chatw", w + "px"); } catch {}
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId); grip.classList.add("on");
    const move = (ev) => { const w = Math.min(Math.max(280, window.innerWidth - ev.clientX), Math.round(window.innerWidth * 0.7)); proj.style.setProperty("--chatw", w + "px"); };
    const up = () => { grip.classList.remove("on"); grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      try { localStorage.setItem("board-chat-width", parseInt(getComputedStyle(proj).getPropertyValue("--chatw")) || 420); } catch {} };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
})();
function renderSideTabs() {
  const L = P.library || {};
  for (const b of document.querySelectorAll("#side-tabs button")) {
    const k = b.dataset.tab, i = b.querySelector("i");
    if (i) i.textContent = k === "handoffs" ? ((P.handoffs || []).filter(h => /fail|missing|lost|dead|stale/i.test(h.state) && !h.applied && !h.supersede).length || "") : (((L[k] || []).length + (k === "decisions" ? (P.decisionInbox || []).length : 0)) || "");
    if (k === sideTab) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  }
  const lib = document.getElementById("side-lib"), chatOn = sideTab === "chat";
  document.getElementById("log").hidden = !chatOn; document.getElementById("chat-opts").hidden = !chatOn;
  const compose = document.getElementById("chat-compose"); if (compose) compose.style.display = chatOn ? "" : "none";
  lib.hidden = chatOn; if (!chatOn) lib.innerHTML = sideRows(sideTab);
  lib.closest(".chat").classList.toggle("lib-on", !chatOn);
}
document.getElementById("side-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  sideTab = b.dataset.tab; try { localStorage.setItem("board-side-tab-" + RAY, sideTab); } catch {}
  renderSideTabs();
});
function openJob(name) {
  const h = (P.handoffs || []).find(x => x.name === name); if (!h) return;
  beginPanel({ job: name });
  pbody.innerHTML = '<div class="pcard"><h2>' + esc(name) + '</h2><div class="ctx">' + esc(h.state) + (h.minutes ? ' · ' + Math.round(h.minutes) + ' min' : '') +
    (h.failureReason ? ' · ' + esc(h.failureReason) : '') + (h.applied ? ' · applied ' + esc(String(h.applied).slice(0, 7)) : '') + '</div>' +
    '<div class="job" data-job="' + esc(name) + '"><div class="lbl">Request</div><pre class="req">Loading request…</pre><div class="attachments"></div>' +
    '<div class="lbl">Reply</div><pre class="rep"></pre><div class="artifacts"></div><div class="diff"></div></div></div>';
  showPanel();
  hydrateJob(pbody.querySelector(".job"));
}
document.getElementById("side-lib").addEventListener("click", (e) => { const j = e.target.closest(".hrow[data-job]"); if (j) { openJob(j.dataset.job); return; } });
document.getElementById("side-lib").addEventListener("click", (e) => {
  const sort = e.target.closest("button[data-sort]"); if (sort) { docSort = sort.dataset.sort; renderSideTabs(); updateDocTree(true); return; }
  const decision = e.target.closest("a[data-decision]"); if (decision && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openDecision(RAY, decision.dataset.decision); return; }
  const a = e.target.closest("a[data-doc]"); if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openDocument(a.dataset.doc); } });
rpm.addEventListener("click", (e) => { const a = e.target.closest("a[data-doc]"); if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openDocument(a.dataset.doc); } });
chatText.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); compose.requestSubmit(); } });
chatText.addEventListener("input", () => { chatText.style.height = "auto"; chatText.style.height = chatText.scrollHeight + "px"; });
load(true); tabs(); loadChat();
setInterval(load, 15000); setInterval(loadChat, 2000);
`;
