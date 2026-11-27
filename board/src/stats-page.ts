import type { Handoff, HandoffSort, Stats, Period } from "./stats.ts";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const exact = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : exact(n);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => n === null ? "—" : `${n.toFixed(n % 1 ? 1 : 0)}%`;
const tokens = (n: number | null) => n === null ? "—" : `<span title="${esc(exact(Math.round(n)))} tokens">${compact(Math.round(n))}</span>`;
const time = (n: number | null) => n === null ? "—" : new Date(n).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const duration = (n: number | null) => {
  if (n === null) return "—";
  const s = Math.round(n / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${h ? `${h}h ` : ""}${m ? `${m}m ` : ""}${s % 60}s`;
};
const size = (n: number | null) => n === null ? "—" : `<span title="${exact(n)} bytes">${n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`}</span>`;
const CSS = `
:root { --ink:#0E1621; --row:#132033; --card:#182840; --rule:#22344A; --text:#E3EAF2; --soft:#B6C3D1; --mute:#7C8FA4; --dim:#4A5D73; --done:#4CC2B4; --hot:#F07A5A; }
* {box-sizing:border-box;scrollbar-width:thin;scrollbar-color:#2c3446 transparent}
html,body {margin:0;background:var(--ink);color:var(--text);font:400 14px/1.35 "Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif;font-variant-numeric:tabular-nums}
a{color:inherit} nav.top{display:flex;gap:14px;align-items:center;padding:10px 18px;border-bottom:1px solid var(--rule);background:var(--row)}
nav.top a{color:var(--soft);text-decoration:none}nav.top a:hover,nav.top [aria-current]{color:var(--text)}nav.top [aria-current]{font-weight:600}nav .grow{flex:1}
main{max-width:1400px;margin:0 auto;padding:16px 18px 30px;min-width:0}h1,h2{font-weight:500;margin:0}h1{font-size:24px}h2{font-size:18px}header.line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:9px}section{margin-top:22px;min-width:0}.muted,small{color:var(--mute)}small{font-size:12px}p{margin:6px 0;color:var(--mute)}
.totals{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border-block:1px solid var(--rule);background:var(--row)}.metric{padding:10px 12px;min-width:0}.metric+.metric{border-left:1px solid var(--rule)}.metric span{display:block;color:var(--soft)}.metric b{font-size:24px;font-weight:500;display:block;line-height:1.2;overflow-wrap:anywhere}.metric small{display:block;margin-top:3px}
.scroll{overflow-x:auto;border-block:1px solid var(--rule);max-width:100%;position:relative}.scroll:focus-visible{outline:2px solid var(--soft);outline-offset:2px}table{width:100%;border-collapse:separate;border-spacing:0;white-space:nowrap;background:var(--row)}th,td{text-align:right;padding:6px 9px;border-bottom:1px solid var(--rule);font-weight:400}th{color:var(--mute);background:var(--ink);vertical-align:bottom}td:first-child,th:first-child,.left{text-align:left}tr:last-child td{border-bottom:0}tbody tr:hover td{background:#16263b}.rays th:first-child,.rays td:first-child,.handoffs th:first-child,.handoffs td:first-child{position:sticky;left:0;z-index:1;background:var(--row);box-shadow:1px 0 var(--rule)}.rays th:first-child,.handoffs th:first-child{background:var(--ink)}.rayname{font-weight:500;text-decoration:none}.rayname:hover,.job:hover{text-decoration:underline}.job{color:var(--text);text-decoration:none;border-bottom:1px solid var(--dim)}.ok{color:var(--done)}.bad{color:var(--hot)}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:inherit;white-space:nowrap}th button{display:inline-flex;gap:4px;align-items:center}th button:hover,th[aria-sort=ascending],th[aria-sort=descending]{color:var(--text)}button:focus-visible,a:focus-visible{outline:2px solid var(--soft);outline-offset:3px}.sortmark{min-width:9px;color:var(--soft)}
.period{display:flex;gap:3px;align-items:center}.period button{padding:3px 8px;border:1px solid var(--rule);border-radius:3px;color:var(--mute)}.period button[aria-pressed=true]{background:var(--row);color:var(--text);border-color:var(--dim)}
.chart{background:var(--row);border-block:1px solid var(--rule);padding:6px 10px 8px}.chartrow{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:8px;min-height:30px;border-bottom:1px solid var(--rule)}.chartrow:last-child{border:0}.chartrow .label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chartrow svg{width:100%;height:28px;display:block}.chartdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center;font-size:12px;color:var(--mute)}.chartrow rect{fill:#7C9FBE}.chartrow rect:last-child{fill:#A5C7E1}.chartrow rect:hover{fill:var(--done)}.hint{display:none}.empty{padding:14px;color:var(--mute)}
@media(max-width:700px){main{padding:12px 12px 24px}nav.top{padding:10px 12px;gap:12px;flex-wrap:wrap}.totals{grid-template-columns:repeat(3,minmax(0,1fr))}.metric{padding:8px 7px}.metric b{font-size:22px}.metric:nth-child(4){border-left:0}.metric:nth-child(n+4){border-top:1px solid var(--rule)}.hint{display:inline}.chartrow{grid-template-columns:96px minmax(0,1fr);gap:4px}.chart{padding:4px 6px}.chartdays{font-size:11px}.rays th,.rays td,.handoffs th,.handoffs td{padding:6px 8px}.rays td:first-child,.handoffs td:first-child{max-width:126px;overflow:hidden;text-overflow:ellipsis}.rays th:first-child,.handoffs th:first-child{max-width:126px}.handoffs td:nth-child(2),.handoffs th:nth-child(2){min-width:125px;max-width:180px;white-space:normal;overflow-wrap:anywhere}}
`;
const metrics: { label: string; value: (p: Period) => string }[] = [
  { label: "Claude tokens", value: p => compact(p.tokens) }, { label: "Calls", value: p => exact(p.calls) },
  { label: "Est. cost", value: p => money(p.cost) }, { label: "Handoffs", value: p => exact(p.handoffs) },
  { label: "Replies applied", value: p => pct(p.appliedPct) }, { label: "Checks passed", value: p => pct(p.checkPct) },
];
const rayRows = (stats: Stats, period: "today" | "sevenDays" | "all") => stats.rays.map(r => {
  const p = r[period];
  return `<tr><td><a class="rayname" href="/board/p/${encodeURIComponent(r.ray)}">${esc(r.ray)}</a></td><td>${exact(p.calls)}</td><td>${tokens(p.input)}</td><td>${tokens(p.cacheRead)}</td><td>${tokens(p.cacheWrite)}</td><td>${tokens(p.output)}</td><td>${tokens(p.thinking)}</td><td>${tokens(p.avgContext)}</td><td>${money(p.cost)}</td><td>${exact(p.handoffs)}</td><td title="${p.applied} of ${p.replies} replies">${pct(p.appliedPct)}</td><td title="${r.sevenDays.checksPassed} of ${r.sevenDays.checks} retained check results">${pct(r.sevenDays.checkPct)}</td></tr>`;
}).join("") || `<tr><td colspan="12" class="empty">No rays found</td></tr>`;
const columns: { key: HandoffSort; label: string; numeric?: boolean }[] = [
  {key:"ray",label:"Ray"},{key:"job",label:"Job"},{key:"thinkingMs",label:"Thinking time",numeric:true},{key:"outcome",label:"Outcome"},
  {key:"launched",label:"Launched",numeric:true},{key:"finished",label:"Finished",numeric:true},{key:"thoughtMs",label:"ChatGPT label",numeric:true},
  {key:"zipBytes",label:"Zip",numeric:true},{key:"attempts",label:"Attempts",numeric:true},
];
function handoffRow(j: Handoff): string {
  const values = [esc(j.ray), j.replyPath ? `<a class="job" href="/board/doc?path=${encodeURIComponent(j.replyPath)}">${esc(j.job)}</a>` : esc(j.job),
    `${esc(duration(j.thinkingMs))}${j.thinkingSource === "reply-mtime" ? ' <span title="Estimated from reply file modification time">~</span>' : ""}`, `<span class="${j.outcome === "applied" ? "ok" : ["failed","lost"].includes(j.outcome) ? "bad" : ""}">${esc(j.outcome)}</span>`,
    esc(time(j.launched)), `${esc(time(j.finished))}${j.finishSource === "reply-mtime" ? ' <span title="Estimated from reply file modification time">~</span>' : ""}`,
    esc(j.thoughtLabel ?? "—"), size(j.zipBytes), j.attempts ?? "—"];
  return `<tr>${columns.map((c, i) => `<td${[1,3,6].includes(i) ? ' class="left"' : ""} data-sort="${esc(j[c.key] ?? "")}"${j[c.key] == null ? ' data-null="1"' : ""}>${values[i]}</td>`).join("")}</tr>`;
}
function chart(stats: Stats): string {
  const map = new Map(stats.daily.map(r => [JSON.stringify([r.ray,r.day]),r.tokens]));
  const values = stats.rays.map(r => ({ ray:r.ray, values:stats.days.map(day => map.get(JSON.stringify([r.ray,day])) ?? 0) }));
  let max = 1; for (const r of values) for (const v of r.values) max = Math.max(max,v);
  return `<div class="chart"><div class="chartrow"><small>Ray</small><div class="chartdays">${stats.days.map(day => `<span title="${day}">${day.slice(5).replace("-","/")}</span>`).join("")}</div></div>${values.map(r => `<div class="chartrow"><span class="label" title="${esc(r.ray)}">${esc(r.ray)}</span><svg viewBox="0 0 700 28" preserveAspectRatio="none" role="img" aria-label="${esc(r.ray + ': ' + r.values.map((v,i) => `${stats.days[i]} ${exact(v)} tokens`).join(', '))}"><path d="M0 27.5H700" stroke="#22344A"/>${r.values.map((v,i) => { const h = v ? Math.max(1, v/max*25) : 0; return `<rect x="${i*100+15}" y="${27-h}" width="70" height="${h}"><title>${esc(stats.days[i])}: ${exact(v)} tokens</title></rect>`; }).join("")}</svg></div>`).join("") || '<div class="empty">No token data</div>'}</div><p>Shared scale: ${compact(max)} tokens at full height. Input (fresh + cached) and output; thinking is not added again.</p>`;
}
// Same null-last comparison as sortHandoffs. Sort actual cells, not formatted text.
const SCRIPT = `
const table = document.querySelector('.handoffs'), body = table.tBodies[0];
const headings = Array.from(table.tHead.rows[0].cells);
let active = headings.findIndex(h => h.getAttribute("aria-sort") === "descending"), direction = -1;
for (const [i, th] of headings.entries()) th.querySelector('button').addEventListener('click', () => {
  direction = active === i ? -direction : th.dataset.numeric === '1' ? -1 : 1; active = i;
  const rows = Array.from(body.rows).filter(r => r.cells.length === headings.length);
  const tie = (a,b) => a.cells[0].dataset.sort.localeCompare(b.cells[0].dataset.sort) || a.cells[1].dataset.sort.localeCompare(b.cells[1].dataset.sort);
  rows.sort((a,b) => {
    const x=a.cells[i], y=b.cells[i], xn=x.dataset.null==='1', yn=y.dataset.null==='1';
    if(xn||yn) return xn===yn?tie(a,b):xn?1:-1;
    return direction*(th.dataset.numeric==='1'?Number(x.dataset.sort)-Number(y.dataset.sort):x.dataset.sort.localeCompare(y.dataset.sort))||tie(a,b);
  });
  body.append(...rows);
  for (const [k,h] of headings.entries()) { h.removeAttribute('aria-sort'); h.querySelector('.sortmark').textContent=''; if(k===active){h.setAttribute('aria-sort',direction===1?'ascending':'descending');h.querySelector('.sortmark').textContent=direction===1?'↑':'↓';} }
});
const rayBody=document.querySelector('.rays tbody');
for(const button of document.querySelectorAll('.period button')) button.addEventListener('click',()=>{
  for(const b of document.querySelectorAll('.period button')) b.setAttribute('aria-pressed',String(b===button));
  rayBody.replaceChildren(document.getElementById('period-'+button.dataset.period).content.cloneNode(true));
});`;
export function renderStatsPage(stats: Stats): string {
  const d = stats.diagnostics, p = stats.prices.perMillion;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0E1621"><title>Fleet stats</title><style>${CSS}</style></head><body>
<nav class="top"><a href="/board/projects">projects</a><a href="/board/all">all</a><a href="/board/docs">docs</a><a href="/board/stats" aria-current="page">stats</a><a href="/board/sharing">sharing</a><span class="grow"></span><a href="/api/board/stats">JSON</a></nav>
<main><header class="line"><h1>Fleet stats</h1><small>${esc(stats.today)} · updated ${esc(time(stats.generatedAt))} (local time)</small></header>
<div class="totals">${metrics.map(m => `<div class="metric"><span>${m.label}</span><b>${m.value(stats.totals.today)}</b><small>${m.value(stats.totals.sevenDays)} / 7 days</small></div>`).join("")}</div><p>Today above · 7 days includes today.</p>
<section><header class="line"><h2>Per ray</h2><div class="period" aria-label="Ray totals period"><button data-period="today" aria-pressed="false">Today</button><button data-period="sevenDays" aria-pressed="true">7 days</button><button data-period="all" aria-pressed="false">All time</button></div></header><div class="scroll" tabindex="0" role="region" aria-label="Ray statistics table"><table class="rays"><thead><tr>${["Ray","Calls","Fresh input","Cache read","Cache write","Output","Thinking","Avg context","Est. cost","Handoffs","Applied","Checks (7d)"].map(s=>`<th scope="col">${s}</th>`).join("")}</tr></thead><tbody>${rayRows(stats,"sevenDays")}</tbody></table></div>${(["today","sevenDays","all"] as const).map(k=>`<template id="period-${k}">${rayRows(stats,k)}</template>`).join("")}<p><span class="hint">Swipe table for more columns. </span>Context = fresh + cache read + cache write. Applied = applied / recorded replies. Checks = passed / retained results.</p></section>
<section><header class="line"><h2>Daily Claude tokens</h2><small>Last 7 days</small></header>${chart(stats)}</section>
<section><header class="line"><h2>Handoffs <small>(${exact(stats.handoffs.length)})</small></h2><small>All recorded jobs · click any column to sort</small></header><div class="scroll" tabindex="0" role="region" aria-label="Sortable handoff table"><table class="handoffs"><thead><tr>${columns.map(c=>`<th scope="col" class="${["ray","job","outcome","thoughtMs"].includes(c.key)?"left":""}" data-numeric="${c.numeric?1:0}"${c.key==="thinkingMs"?' aria-sort="descending"':""}><button type="button">${c.label}<span class="sortmark" aria-hidden="true">${c.key==="thinkingMs"?"↓":""}</span></button></th>`).join("")}</tr></thead><tbody>${stats.handoffs.map(handoffRow).join("") || '<tr><td colspan="9" class="empty">No handoffs found</td></tr>'}</tbody></table></div><p><span class="hint">Swipe table for more columns. </span>Thinking time = latest launch to reply completion (not model-only time). ~ = reply mtime estimate; — = unavailable. Zip = compressed file or logged byte count.</p></section>
<p>List-price estimate (${esc(stats.prices.model)}, ${stats.prices.readOn}): $${p.input}/m fresh, $${p.cacheRead}/m read, $${p.cacheWrite}/m write (1 hour), $${p.output}/m output. Thinking is a subset of output. Check history is limited by the board's retention.</p>
${d.unreadable.length || d.undatedMessages || d.unkeyedMessages || d.malformedLines ? `<p>Data notes: ${d.unreadable.length} unreadable sources · ${d.undatedMessages} undated usage lines skipped · ${d.unkeyedMessages} usage lines without deduplication IDs · ${d.malformedLines} malformed lines skipped.</p>` : ""}
</main><script>${SCRIPT}</script></body></html>`;
}
