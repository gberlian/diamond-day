#!/usr/bin/env bun
import { createServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { saveAnswer } from './decisions.ts';
import { settings, loopback } from './config.ts';
import { project, rows, projectNames } from './projects.ts';
import { projectsPage, projectPage } from './projects-page.ts';
import { renderDocsIndex, renderDoc, serveDocAsset, safeUnder } from './docs-page.ts';
const s=settings();
const decisionToken=randomUUID();
const html=(body:string)=>new Response(body,{headers:{'content-type':'text/html; charset=utf-8'}});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const server=createServer(async(req,res)=>{
  try {
    // Reject DNS rebinding and non-loopback Host values.
    const host=req.headers.host;
    if (![`${loopback}:${s.port}`,`${[127,0,0,1].join(".")}:${s.port}`,`[::1]:${s.port}`].includes(host || '')) {res.writeHead(403).end();return;}
    const u=new URL(req.url || '/',`http://${loopback}:${s.port}`); const p=u.pathname;
    let r:Response;
    if (p==='/health' && req.method==='GET') r=Response.json({ok:true,owned:req.headers.authorization===`Bearer ${s.token}`});
    else if (p==='/shutdown' && req.method==='POST' && req.headers.authorization===`Bearer ${s.token}`) {r=Response.json({ok:true});res.once('finish',()=>{server.close();server.closeAllConnections();});}
    else if(p==='/api/decisions/answer' && req.method==='POST') {
      if(req.headers['x-decision-token']!==decisionToken || req.headers.origin!==`http://${host}`)r=Response.json({error:'Forbidden'},{status:403});
      else try {
        let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)throw Error('Answer too large');}
        const {ray,id,key,note}=JSON.parse(text);
        const d=project(s.root,typeof ray==='string'?ray:'');
        if(!d||!d.decisionInbox.some(x=>x.id===id))throw Error('Decision not linked to a card');
        r=Response.json({answer:saveAnswer(s.root,ray,id,key,note)});
      }catch(e){r=Response.json({error:'Invalid or already answered decision'},{status:400});}
    } else if(req.method!=='GET') r=new Response('read only',{status:405});
    else if (['/','/board','/board/projects','/board/all'].includes(p)) {
      // Initial HTML also exposes the real project names before browser JS loads.
      const initial=rows(s.root).map(x=>`<div class="prow stopped"><a class="name" href="/board/p/${encodeURIComponent(x.ray)}">${esc(x.ray)}</a><span class="vision">${esc(x.vision)}</span></div>`).join('');
      r=html(projectsPage().replace('<main class="list" id="list"></main>',()=>`<main class="list" id="list">${initial}</main>`));
    } else if(p==='/board/decisions') {
      const items=projectNames(s.root).flatMap(ray=>(project(s.root,ray)?.decisionInbox||[]).map(x=>`<li><a href="/board/p/${encodeURIComponent(ray)}?decision=${encodeURIComponent(x.id)}">${esc(ray)}: ${esc(x.decision.title)}</a> — ${esc(x.state)}</li>`));
      r=html(`<!doctype html><html><meta charset="utf-8"><title>Decision inbox</title><body><a href="/board">Projects</a><h1>Decision inbox</h1><ul>${items.join('')}</ul></body></html>`);
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
server.listen(s.port,loopback,()=>console.log(`Board: http://${loopback}:${s.port}/board`));
