#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { CheckError, CheckService } from './checks.mjs';

const ownFile = fileURLToPath(import.meta.url);
const LOCALHOST_IP = [127, 0, 0, 1].join('.');
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const css = `
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#172235;background:#f5f7fb}
*{box-sizing:border-box}body{max-width:1100px;margin:0 auto;padding:32px 22px;line-height:1.5}
header{display:flex;align-items:baseline;gap:24px;flex-wrap:wrap;border-bottom:1px solid #ccd5e2;margin-bottom:26px}
h1{font-size:2rem;letter-spacing:-.05em;margin:0 0 16px}h2{font-size:1.25rem;margin:0 0 12px}
h3{font-size:1.08rem;margin:0}main{display:grid;gap:22px}.ray{min-width:0}
.goals{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:15px}
.goal{background:white;border:1px solid #d7dfeb;border-radius:10px;padding:19px;min-width:0;box-shadow:0 2px 6px #152d5009}
.head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start}
.light{font-size:.78rem;font-weight:800;white-space:nowrap;border-radius:100px;padding:4px 10px;letter-spacing:.04em}
.light.pass{background:#d8f7e5;color:#126a3e}.light.fail{background:#ffe1e1;color:#9a1a20}
.light.manual{background:#e4eafa;color:#394c8a}.light.stale{background:#fff0c9;color:#845200}
.light.never{background:#e9edf2;color:#4c5868}
dl{margin:13px 0;display:grid;grid-template-columns:52px 1fr;gap:6px 12px;font-size:.88rem}
dt{font-weight:650;color:#526178}dd{margin:0;overflow-wrap:anywhere}
.meta{border-top:1px solid #e4e8ef;padding-top:12px;display:grid;gap:5px;font-size:.79rem;color:#59677b}
.last{white-space:normal;overflow-wrap:anywhere;color:#354255}
footer{margin-top:15px;display:flex;align-items:center;justify-content:flex-end}
button{border:0;border-radius:6px;background:#1859c9;color:white;padding:8px 16px;font:inherit;font-weight:650;cursor:pointer}
button:disabled{background:#dce1e8;color:#626d7d;cursor:not-allowed}
button:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}
#notice{font-size:.9rem;color:#7b2626;min-height:1.4em}
@media(prefers-reduced-motion:no-preference){button{transition:background-color .15s}}
`;
function render(data, live = false) {
  const panels = data.rays.map(ray => `<section class="ray" aria-label="${esc(ray.name)} ray">
<h2>${esc(ray.name)}</h2><div class="goals">${ray.goals.map(goal => {
    const time = goal.at ? new Date(goal.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'Never';
    const label = `${goal.state.toUpperCase()}: ${goal.title}`;
    return `<article class="goal" aria-label="${esc(label)}">
<div class="head"><h3>${esc(goal.id)}. ${esc(goal.title)}</h3><span class="light ${esc(goal.state)}" role="status" aria-label="${esc(goal.state)}">${esc(goal.state.toUpperCase())}</span></div>
<dl><dt>Want</dt><dd>${esc(goal.want)}</dd><dt>Check</dt><dd>${esc(goal.check)}</dd><dt>Now</dt><dd>${esc(goal.now)}</dd><dt>Next</dt><dd>${esc(goal.next)}</dd></dl>
<div class="meta"><span>Last run: <time ${goal.at ? `datetime="${esc(goal.at)}"` : ''}>${esc(time)}</time></span>
<span class="last">Last output: ${esc(goal.lastLine || '—')}</span>${goal.output ? `<details><summary>Output</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(goal.output)}</pre></details>` : ''}</div>
<footer><button type="button" data-ray="${esc(ray.name)}" data-goal="${esc(goal.id)}" ${!live || !goal.runnable ? 'disabled' : ''} aria-label="Run check for ${esc(ray.name)} goal ${esc(goal.id)}">Run</button></footer></article>`;
  }).join('\n')}</div></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>diamond-day | Ray board</title><style>${css}</style></head><body>
<header><h1>diamond-day</h1><strong>Ray board</strong><span id="notice" aria-live="polite"></span></header>
<main id="rays">${panels}</main>
${live ? `<script>
document.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-ray][data-goal]');
  if(!button||button.disabled)return;
  button.disabled=true;
  const notice=document.querySelector('#notice');
  notice.textContent='Running '+button.dataset.ray+'/'+button.dataset.goal;
  try {
    const u=new URL('/api/checks/run',location.origin);
    u.searchParams.set('ray',button.dataset.ray);u.searchParams.set('goal',button.dataset.goal);
    const res=await fetch(u,{method:'POST',headers:{'Accept':'application/json'}});
    const body=await res.json();
    if(!res.ok)throw Error(body.error||'Run failed');
    location.reload();
  }catch(error){notice.textContent=error.message;button.disabled=false;}
});
</script>` : ''}
</body></html>\n`;
}
function send(res, code, data, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    ...headers });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
const isLoopback = ip => [LOCALHOST_IP, '::1', `::ffff:${LOCALHOST_IP}`].includes(ip);

export async function createBoardServer(root, { port = 5195, schedule = true } = {}) {
  const service = new CheckService(root);
  const server = http.createServer(async (req, res) => {
    try {
      if (!isLoopback(req.socket.remoteAddress)) {
        send(res, 403, { error: 'localhost_only' }); return;
      }
      const allowedHost = /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/i;
      if (!allowedHost.test(req.headers.host || '')) {
        send(res, 403, { error: 'invalid_host' }); return;
      }
      const u = new URL(req.url || '/', `http://${LOCALHOST_IP}`);
      if (req.method === 'GET' && ['/','/board','/board.html','/api/board'].includes(u.pathname)) {
        if (schedule) service.schedule();
        const data = service.board();
        if (u.pathname === '/api/board') send(res, 200, data);
        else send(res, 200, render(data, true), 'text/html; charset=utf-8');
        return;
      }
      if (u.pathname === '/api/checks/run') {
        if (req.method !== 'POST') {
          send(res, 405, { error: 'POST_required' }, 'application/json; charset=utf-8', { allow: 'POST' }); return;
        }
        const origin = req.headers.origin;
        const site = req.headers['sec-fetch-site'];
        if ((origin && origin !== `http://${req.headers.host}`) ||
            (site && !['same-origin', 'none'].includes(site))) {
          send(res, 403, { error: 'cross_origin' }); return;
        }
        const ray = u.searchParams.get('ray') || '';
        const goal = u.searchParams.get('goal') || '';
        const result = await service.run(ray, goal);
        send(res, 200, result);
        return;
      }
      send(res, 404, { error: 'not_found' });
    } catch (error) {
      send(res, error instanceof CheckError ? error.status : 500,
        { error: error instanceof CheckError ? error.message : 'server_error' },
        'application/json; charset=utf-8',
        error instanceof CheckError && error.retryAfterMs ?
          { 'retry-after': String(Math.ceil(error.retryAfterMs / 1000)) } : {});
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOCALHOST_IP, resolve);
  });
  const interval = schedule ? setInterval(() => {
    try { service.schedule(); } catch (error) { console.error('board scheduling:', error.message); }
  }, 60_000) : null;
  server.once('close', () => { if (interval) clearInterval(interval); });
  return { server, service, url: `http://${LOCALHOST_IP}:${server.address().port}/board` };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'serve') {
    const at = args.indexOf('--port');
    const port = at >= 0 ? Number(args[at + 1]) : 5195;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('invalid port');
    if (at >= 0) args.splice(at, 2);
    const root = path.resolve(args[1] || '.');
    const board = await createBoardServer(root, { port });
    console.log(`BOARD_URL=${board.url}`);
  } else {
    const root = path.resolve(args[0] || '.');
    const service = new CheckService(root);
    const file = path.join(root, 'board.html');
    fs.writeFileSync(file, render(service.board(), false));
    console.log(`PASS board: wrote ${file}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === ownFile) {
  main().catch(e => { console.error(`FAIL board: ${e.message}`); process.exitCode = 1; });
}
