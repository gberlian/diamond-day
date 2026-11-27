#!/usr/bin/env bun
import { createServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Companies, ownerRequest } from './companies.ts';
import { StatsCache } from './stats.ts';
import { sendNote } from './ray-note.ts';
import { sessionUsage } from './session-usage.ts';
import { chatFor } from './chat-export.ts';
import { saveAnswer } from './decisions.ts';
import { settings, loopback, installDir, home } from './config.ts';
import { project, rows, projectNames } from './projects.ts';
import { projectsPage, projectPage } from './projects-page.ts';
import { renderDocsIndex, renderDoc, serveDocAsset, safeUnder } from './docs-page.ts';
const s=settings();
const decisionToken=randomUUID();
const companies=new Companies({root:s.root,dataDir:installDir(),actions:true,ownerToken:s.token,sharePort:s.sharePort,shareOrigin:s.shareOrigin});
const stats=new StatsCache({raysRoot:s.root,claudeProjectsDir:s.claudeProjectsDir||path.join(home(),'.claude','projects'),dataDir:installDir()});
async function request(req:import('node:http').IncomingMessage):Promise<Request>{
  const host=req.headers.host||'localhost';const method=req.method||'GET';const headers=new Headers();
  for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
  let body:Buffer|undefined;if(method!=='GET'&&method!=='HEAD'){const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>65536)throw Error('Request too large');chunks.push(c);}body=Buffer.concat(chunks);}
  return new Request(new URL(req.url||'/',`http://${host}`),{method,headers,body});
}
async function send(res:import('node:http').ServerResponse,r:Response){res.writeHead(r.status,{...Object.fromEntries(r.headers),'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(Buffer.from(await r.arrayBuffer()));}
const guest=s.sharePort===undefined?null:createServer(async(req,res)=>{try{await send(res,await companies.handle(await request(req),'tailnet',req.socket.remoteAddress));}catch{res.writeHead(404).end();}});

const html=(body:string)=>new Response(body,{headers:{'content-type':'text/html; charset=utf-8'}});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const server=createServer(async(req,res)=>{
  try {
    // Reject DNS rebinding and non-loopback Host values.
    const host=req.headers.host;
    if(!req.url?.startsWith('/')||req.url.startsWith('//')||Object.keys(req.headers).some(k=>/^(tailscale-|x-forwarded-|forwarded$)/i.test(k))){res.writeHead(403).end();return;}
    if (![`${loopback}:${s.port}`,`${[127,0,0,1].join(".")}:${s.port}`,`[::1]:${s.port}`].includes(host || '')) {res.writeHead(403).end();return;}
    const u=new URL(req.url || '/',`http://${loopback}:${s.port}`); const p=u.pathname;
    let r:Response;
    if (p==='/health' && req.method==='GET') r=Response.json({ok:true,owned:req.headers.authorization===`Bearer ${s.token}`});
    else if (p==='/shutdown' && req.method==='POST' && req.headers.authorization===`Bearer ${s.token}`) {r=Response.json({ok:true});res.once('finish',()=>{guest?.close();guest?.closeAllConnections();server.close();server.closeAllConnections();});}
    else if(p==='/board/sharing'||p==='/api/companies'||p.startsWith('/api/companies/')){
      const q=await request(req);r=ownerRequest(q,req.socket.remoteAddress)?await companies.owner(q):new Response('forbidden',{status:403});
    } else if(p==='/board/stats'&&req.method==='GET')r=html((await stats.get()).html);
    else if((p==='/api/board/stats'||p==='/api/stats')&&req.method==='GET')r=new Response((await stats.get()).json,{headers:{'content-type':'application/json'}});
    else if(/^\/api\/board\/project\/[a-z][a-z0-9-]{0,63}\/usage$/.test(p)&&req.method==='GET'){const ray=p.split('/')[4]!;r=project(s.root,ray)?Response.json(await sessionUsage(s,ray)):new Response('not found',{status:404});}
    else if(/^\/api\/board\/project\/[a-z][a-z0-9-]{0,63}\/chat$/.test(p)&&req.method==='POST'){
      if(req.headers.origin!==`http://${host}`||req.headers['x-decision-token']!==decisionToken)r=Response.json({error:'Forbidden'},{status:403});
      else try{const q=await request(req);const {text}=await q.json();if(typeof text!=='string')throw Error();r=Response.json(sendNote(s.root,p.split('/')[4]!,'board','chat',text),{status:202});}catch{r=Response.json({error:'Invalid message'},{status:400});}
    } else if(/^\/api\/board\/project\/[a-z][a-z0-9-]{0,63}\/chat$/.test(p)&&req.method==='GET'){
      const ray=p.split('/')[4]!;r=project(s.root,ray)?Response.json(chatFor(s,ray)):new Response('not found',{status:404});
    }
    else if(p==='/api/decisions/answer'  && req.method==='POST') {
      if(req.headers['x-decision-token']!==decisionToken || req.headers.origin!==`http://${host}`)r=Response.json({error:'Forbidden'},{status:403});
      else try {
        let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)throw Error('Answer too large');}
        const {ray,id,key,note}=JSON.parse(text);
        const d=project(s.root,typeof ray==='string'?ray:'');
        if(!d||!d.decisionInbox.some(x=>x.id===id))throw Error('Decision not found');
        r=Response.json({answer:saveAnswer(s.root,ray,id,key,note)});
      }catch(e){r=Response.json({error:'Invalid or already answered decision'},{status:400});}
    } else if(req.method!=='GET') r=new Response('read only',{status:405});
    else if (['/','/board','/board/projects','/board/all'].includes(p)) {
      // Initial HTML also exposes the real project names before browser JS loads.
      const initial=rows(s.root).map(x=>`<div class="prow stopped"><a class="name" href="/board/p/${encodeURIComponent(x.ray)}">${esc(x.ray)}</a><span class="vision">${esc(x.vision)}</span></div>`).join('');
      r=html(projectsPage().replace('<main class="list" id="list"></main>',()=>`<main class="list" id="list">${initial}</main>`));
    } else if(p==='/board/decisions') {
      const items=projectNames(s.root).flatMap(ray=>(project(s.root,ray)?.decisionInbox||[]).filter(x=>x.state==='pending').map(x=>`<section><h2>${esc(x.decision.title)}</h2><p><a href="/board/p/${encodeURIComponent(ray)}?decision=${encodeURIComponent(x.id)}">${esc(ray)} · ${esc(x.id)}</a></p><p>${esc(x.decision.question)}</p><form data-ray="${esc(ray)}" data-id="${esc(x.id)}">${x.decision.options.map((o:any)=>`<label><input type="radio" name="key" value="${esc(o.key)}"> ${esc(o.label)}${o.detail?`<p>${esc(o.detail)}</p>`:''}${(o.images||[]).map((img:string)=>`<img alt="${esc(o.label)}" src="/api/decisions/image?ray=${encodeURIComponent(ray)}&amp;path=${encodeURIComponent(img)}">`).join('')}</label>`).join('')}${x.decision.allowNote?'<label>Note <textarea name="note" maxlength="500"></textarea></label>':''}<button type="submit">Answer</button> <button type="submit" value="dismissed">Dismiss</button><output></output></form></section>`));
      r=html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Decision inbox</title><style>body{color-scheme:dark;background:#0e1621;color:#e3eaf2;font:15px system-ui;margin:20px auto;max-width:900px;padding:0 16px}a{color:#b6c3d1}section{padding:16px;background:#132033;border:1px solid #22344a;margin:12px 0}label{display:block;margin:10px 0}img{max-width:220px;display:block}button,textarea{font:inherit}output{display:block;color:#e1b56a}p{white-space:pre-wrap}</style><body><a href="/board">Projects</a><h1>Decision inbox</h1>${items.join('')||'<p>No pending decisions</p>'}<script>document.addEventListener('submit',async e=>{const f=e.target;if(!f.matches('form[data-id]'))return;e.preventDefault();const data=new FormData(f),dismiss=e.submitter?.value==='dismissed';for(const b of f.querySelectorAll('button'))b.disabled=true;try{const r=await fetch('/api/decisions/answer',{method:'POST',headers:{'content-type':'application/json','x-decision-token':${JSON.stringify(decisionToken)}},body:JSON.stringify({ray:f.dataset.ray,id:f.dataset.id,key:dismiss?'dismissed':data.get('key')||'',note:dismiss?'':data.get('note')||''})});if(!r.ok)throw Error('Answer failed');f.closest('section').remove()}catch(e){f.querySelector('output').textContent=e.message;for(const b of f.querySelectorAll('button'))b.disabled=false}})</script></body></html>`);
    } else if(p==='/api/decisions/image') {
      const ray=u.searchParams.get('ray')||'', image=u.searchParams.get('path')||'';
      const d=project(s.root,ray);
      r=d&&safeUnder(path.join(s.root,ray),image)&&d.decisionInbox.some(x=>x.decision.options.some((o:any)=>o.images?.includes(image)))?serveDocAsset(s.root,`${ray}/${image}`):new Response('not found',{status:404});
    } else if(p==='/api/board/projects'||p==='/api/board') r=Response.json({projects:rows(s.root),editEnabled:false});
    else if(p==='/board/docs') r=html(renderDocsIndex(s.root,projectNames(s.root),u.searchParams.get('ray')));
    else if(p==='/board/doc') r=renderDoc(s.root,u.searchParams.get('path')||'');
    else if(p==='/board/doc-asset') r=serveDocAsset(s.root,u.searchParams.get('path')||'');
    else {
      const m=/^\/(board\/p|api\/board\/project)\/([a-z][a-z0-9-]{0,63})(\/doc)?$/.exec(p);
      const d=m?project(s.root,m[2]!):null;
      if(!m||!d) r=new Response('not found',{status:404});
      else if(m[3] && m[1]==='api/board/project') {
        const rel=u.searchParams.get('path')||''; r=rel.startsWith(`${m[2]}/`) ? renderDoc(s.root,rel,true) : new Response("not found",{status:404});
      } else if(m[3]) r=new Response('not found',{status:404});
      else r=m[1]==='board/p'?html(projectPage(m[2]!,decisionToken)):Response.json(d);
    }
    res.writeHead(r.status,{...Object.fromEntries(r.headers),'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(Buffer.from(await r.arrayBuffer()));
  } catch(e){console.error(e);if(!res.headersSent)res.writeHead(500);res.end('board error');}
});
server.on('error',e=>{console.error(e);process.exitCode=1;});
const start=()=>server.listen(s.port,loopback,()=>console.log(`Board: http://${loopback}:${s.port}/board`));
server.on('error',()=>{guest?.close();guest?.closeAllConnections();});
if(guest){guest.once('error',e=>{console.error(e);process.exitCode=1;});guest.listen(s.sharePort,[127,0,0,1].join('.'),start);}else start();
