/** Server-rendered handoff board, using the same domain operations as every transport. */
import { context, type DomainContext } from "./domain/fsreader.ts";
import { invoke } from "./domain/ops.ts";
import type { JobTimeline, Throughput, TooEasyJob } from "./domain/model.ts";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const min = (n: number | null) => n === null ? "–" : n.toFixed(1);
const clock = (iso: string) => new Date(iso).toLocaleString(undefined,
  { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const graphX = (ms: number, from: number, to: number) =>
  Math.max(10, Math.min(960, 10 + (ms - from) / (to - from) * 950));
const thinkY = (minutes: number) => 85 - Math.min(90, minutes) / 90 * 72;
const dotRow = (ray: string, jobs: JobTimeline[], from: number, to: number) => {
  const dots = jobs.filter((j) => j.ray === ray && j.thinkMinutes !== null &&
    j.outcome !== "running" && Boolean(j.doneAt || j.failedAt))
    .map((j) => ({ job: j, date: Date.parse(j.doneAt ?? j.failedAt!) }))
    .filter((j) => j.date >= from && j.date <= to);
  const line = (value: number, color: string) =>
    `<line x1="8" x2="960" y1="${thinkY(value)}" y2="${thinkY(value)}" stroke="${color}" stroke-dasharray="3 5" stroke-width="0.9" opacity=".7"/>`;
  const circles = dots.map(({ job, date }) => {
    const shade = job.thinkMinutes! < 10 ? "#F07A5A" :
      job.thinkMinutes! < 30 ? "#F3B64C" : "#4CC2B4";
    const title = `${job.name} · ${min(job.thinkMinutes)}m · ${clock(job.doneAt ?? job.failedAt!)}`;
    return `<circle cx="${graphX(date, from, to).toFixed(2)}" cy="${thinkY(job.thinkMinutes!).toFixed(2)}" r="4" fill="${shade}"><title>${esc(title)}</title></circle>`;
  }).join("");
  return `<section class="ray-row"><div class="ray">${esc(ray)}</div>
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img"
      aria-label="${esc(ray)} think minutes for ${dots.length} terminal handoffs in 24 hours">
      ${line(10, "#F07A5A")}${line(30, "#F3B64C")}
      ${circles}<text x="971" y="${thinkY(10) + 3}" fill="#F07A5A">10</text>
      <text x="971" y="${thinkY(30) + 3}" fill="#F3B64C">30</text>
    </svg><div class="count">${dots.length}</div></section>`;
};

const occupancyGraph = (data: Throughput) => {
  const series = data.machine.occupancy;
  const points: string[] = [];
  const segments: string[] = [];
  const start = series.length ? Date.parse(series[0]!.at) : 0;
  const end = series.length ? Date.parse(series[series.length - 1]!.at) : start + 1;
  for (const point of series) {
    if (point.running === null) {
      if (points.length) segments.push(points.join(" "));
      points.length = 0;
      continue;
    }
    const x = graphX(Date.parse(point.at), start, end).toFixed(2);
    const y = Math.max(5, 87 - Math.min(25, point.running) / 20 * 72).toFixed(2);
    points.push(`${x},${y}`);
  }
  if (points.length) segments.push(points.join(" "));
  const paths = segments.map((segment) =>
    `<polyline points="${segment}" fill="none" stroke="#4CC2B4" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join("");
  const latest = [...series].reverse().find((p) => p.running !== null)?.running;
  return `<div class="occupancy">
    <span class="big">${latest ?? "–"}<small> / 20</small></span>
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Machine keeper running occupancy, ten-minute samples, 24 hours; cap 20">
      <line x1="8" x2="960" y1="15" y2="15" stroke="#F07A5A" stroke-dasharray="4 4" opacity=".85"/>
      ${paths}<text x="970" y="18" fill="#F07A5A">20</text>
    </svg>
    <span class="tiny">24h</span></div>`;
};

/** Pure render over injected root/clock; no browser-side fetch or JS framework. */
export function renderHandoffsPage(ctx: DomainContext = context()): string {
  const throughput = invoke("throughput", { hours: 24 }, ctx) as Throughput;
  const timelines = invoke("jobTimeline", {}, ctx) as JobTimeline[];
  const easy = invoke("tooEasy", { hours: 48 }, ctx) as TooEasyJob[];
  const from = ctx.now - 24 * 3_600_000;
  const rows = throughput.byRay.map((r) => dotRow(r.ray, timelines, from, ctx.now)).join("");
  const alerts = easy.map((j) =>
    `<li><span class="name">${esc(j.ray)} / ${esc(j.name)}</span>
       <span>${min(j.thinkMinutes)}m</span>
       <span>${j.promptBytes === null ? "–" : j.promptBytes.toLocaleString()} B</span></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0E1621"><title>Rays · handoffs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#0E1621;--row:#132033;--rule:#22344A;--text:#E3EAF2;--soft:#B6C3D1;--mute:#7C8FA4;--busy:#F3B64C;--done:#4CC2B4;--hot:#F07A5A}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--text);font:400 14px/1.35 "Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1500px;margin:auto;padding:0 18px 30px}nav{display:flex;gap:22px;padding:16px 0;color:var(--mute);border-bottom:1px solid var(--rule)}
a{color:var(--soft);text-decoration:none;border-bottom:1px solid var(--rule)}a:hover{color:var(--text)}
.occupancy,.ray-row{display:grid;grid-template-columns:140px minmax(0,1fr) 48px;align-items:center;gap:14px;border-bottom:1px solid var(--rule)}
.occupancy{background:var(--row);padding:12px 14px;margin:14px 0 8px}.ray-row{padding:5px 14px;background:var(--row)}
.big{font-size:30px;font-weight:600}.big small{font-size:16px;color:var(--mute);font-weight:400}.ray{font-size:18px;color:var(--soft)}
svg{display:block;width:100%;height:74px;overflow:visible}svg text{font:500 14px "Barlow Semi Condensed",sans-serif}
.count,.tiny{color:var(--mute);text-align:right;font-size:13px}
.threshold{display:flex;gap:15px;padding:10px 14px;color:var(--mute);font-size:12px}
.threshold b{font-weight:500}.threshold b:nth-child(1){color:var(--hot)}.threshold b:nth-child(2){color:var(--busy)}.threshold b:nth-child(3){color:var(--done)}
.easy{margin-top:22px}.easy-label{font-size:17px;color:var(--mute);border-bottom:1px solid var(--rule);padding:8px 0}
ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:minmax(0,1fr) 75px 100px;gap:12px;padding:8px 12px;border-bottom:1px solid var(--rule);color:var(--mute)}
li .name{color:var(--soft);overflow-wrap:anywhere}li span:not(:first-child){text-align:right}
@media(max-width:600px){main{padding:0 8px 20px}.occupancy,.ray-row{grid-template-columns:90px minmax(0,1fr) 24px;gap:4px}.ray{font-size:14px}svg{height:70px}.big{font-size:20px}.big small{font-size:12px}li{grid-template-columns:minmax(0,1fr) 48px 65px;gap:4px;padding:8px 2px}}
</style></head><body><main>
<nav><a href="/board">board</a><a href="/board/handoffs" aria-current="page">handoffs</a></nav>
${occupancyGraph(throughput)}
<div class="threshold"><b>&lt;10m</b><b>10–30m</b><b>≥30m</b><span>24h</span></div>
${rows}
<div class="easy"><div class="easy-label">&lt;10m · 48h · ${easy.length}</div><ul>${alerts}</ul></div>
</main></body></html>`;
}
