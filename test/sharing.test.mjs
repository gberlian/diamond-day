import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {Script} from 'node:vm';
const src=new URL('../board/src/',import.meta.url);
const loop=[127,0,0,1].join('.');
const flags=['--experimental-strip-types','--disable-warning=ExperimentalWarning'];
const free=host=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,host,()=>{const n=s.address().port;s.close(()=>resolve(n));});});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t){
  const home=mkdtempSync(path.join(tmpdir(),'sharing test ')),root=path.join(home,'rays'),dir=path.join(home,'.arpe');mkdirSync(dir);mkdirSync(root);
  const port=await free('localhost'),sharePort=await free(loop),token='owner-test';const env={...process.env,HOME:home,USERPROFILE:home,RAY_NO_BROWSER:'1'};
  writeFileSync(path.join(dir,'settings.json'),JSON.stringify({root,port,sharePort,agent:'claude-code',runtime:process.execPath,runtimeArgs:flags,token,ownsRoot:true}));
  // fileURLToPath works for Windows drive letters and spaces.
  const {fileURLToPath}=await import('node:url');
  function run(...args){const r=spawnSync(process.execPath,[...flags,fileURLToPath(new URL('arpe-cli.ts',src)),...args],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
  run('new','demo','Shared project');run('new','other','Unshared project');
  const child=spawn(process.execPath,[...flags,fileURLToPath(new URL('server.ts',src))],{env,stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(home,{recursive:true,force:true});});
  const base=`http://localhost:${port}`,guest=`http://${loop}:${sharePort}`;
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await delay(50);}
  const owner=(ray,b)=>fetch(base+'/api/companies/'+ray,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(b)});
  const invite=(role='viewer')=>new URL(run('share','demo','Guest',role,'1')).hash.split('/')[1];
  const get=(p,token)=>fetch(guest+p,{headers:token?{authorization:'Bearer '+token}:{}});
  const post=(p,token,b)=>fetch(guest+p,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',origin:guest},body:JSON.stringify(b)});
  return {home,root,base,guest,owner,invite,get,post};
}
test('sharing: invitation scope, cookie, viewer denial, revoke, separate listener',async t=>{
  const f=await fixture(t);const page=await fetch(f.base+'/board/sharing');assert.equal(page.status,200);for(const [,js] of (await page.text()).matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(js);
  for(const p of ['/api/board','/board/sharing','/api/companies','/board/stats','/health','/c/demo/api'])assert.equal((await f.get(p)).status,404,p);
  const token=f.invite();assert.match(token,/^[A-Za-z0-9_-]{43}$/);const r=await f.get('/c/demo/api',token);assert.equal(r.status,200);const data=await r.json();assert.equal(data.ray,'demo');assert.equal(data.role,'viewer');assert.equal((await f.get('/c/other/api',token)).status,404);
  assert.equal((await f.post('/c/demo/api/edit',token,{op:'result'})).status,403);
  const join=await f.post('/join',token,{ray:'demo',token});assert.equal(join.status,200);const cookie=join.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Path=\/c\/demo/);assert.equal((await fetch(f.guest+'/c/demo',{headers:{cookie:cookie.split(';')[0]}})).status,200);
  const member=(await (await fetch(f.base+'/api/companies/demo')).json()).members[0];assert.equal(member.hash,undefined);assert.equal((await f.owner('demo',{op:'revoke',id:member.id})).status,200);assert.equal((await f.get('/c/demo/api',token)).status,404);
});
test('sharing: editor may change intent and publish reviewed artifacts, not execution',async t=>{
  const f=await fixture(t);const token=f.invite('editor');let d=await (await f.get('/c/demo/api',token)).json();
  assert.equal((await f.post('/c/demo/api/edit',token,{op:'result',id:'1',key:'purpose',value:'A revised purpose',revision:d.revision})).status,200);
  assert.equal((await f.post('/c/demo/api/edit',token,{op:'result',id:'1',key:'purpose',value:'Stale change',revision:d.revision})).status,409);
  d=await (await f.get('/c/demo/api',token)).json();assert.equal(d.results[0].purpose,'A revised purpose');assert.equal((await f.post('/c/demo/api/edit',token,{op:'step',revision:d.revision})).status,403);
  writeFileSync(path.join(f.root,'demo','docs','review.md'),'# Reviewed');assert.equal((await f.get('/c/demo/api/artifact?path=docs/review.md',token)).status,404);
  assert.equal((await f.owner('demo',{op:'publish',artifacts:['docs/review.md'],decisions:[],handoffs:[]})).status,200);assert.equal(await (await f.get('/c/demo/api/artifact?path=docs/review.md',token)).text(),'# Reviewed');
  assert.equal((await f.get('/c/demo/api/artifact?path=GOALS.md',token)).status,404);
});
test('board: stats, notes, long transcript export and Dismiss',async t=>{
  const f=await fixture(t);const base=path.join(f.root,'demo');const transcript=path.join(f.home,'.claude','projects',base.replace(/[:\\/]/g,'-'));mkdirSync(transcript,{recursive:true});const text='Long reply '.repeat(100);writeFileSync(path.join(transcript,'session.jsonl'),JSON.stringify({type:'assistant',timestamp:new Date().toISOString(),message:{content:[{type:'text',text}]}})+'\n');
  const p=await fetch(f.base+'/board/p/demo');const html=await p.text();for(const [,js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(js);assert.match(html,/-webkit-line-clamp:5/);assert.match(html,/data-tab="notes"/);
  const token=/const DECISION_TOKEN = "([^"]+)"/.exec(html)[1];const chat=await (await fetch(f.base+'/api/board/project/demo/chat')).json();assert.equal(chat.turns[0].text,text.trim());let project=await (await fetch(f.base+'/api/board/project/demo')).json();assert.equal(project.library.changes.length,1);
  const note=await fetch(f.base+'/api/board/project/demo/chat',{method:'POST',headers:{'content-type':'application/json',origin:f.base,'x-decision-token':token},body:JSON.stringify({text:'Next result'})});assert.equal(note.status,202);
  writeFileSync(path.join(base,'decisions','review.json'),JSON.stringify({id:'review',title:'Review',question:'Approve?',options:[{key:'yes',label:'Yes'}]}));const inbox=await (await fetch(f.base+'/board/decisions')).text();assert.match(inbox,/Dismiss/);
  const answer=await fetch(f.base+'/api/decisions/answer',{method:'POST',headers:{'content-type':'application/json',origin:f.base,'x-decision-token':token},body:JSON.stringify({ray:'demo',id:'review',key:'dismissed',note:''})});assert.equal(answer.status,200);assert.equal(JSON.parse(readFileSync(path.join(base,'decisions','review.answer.json'),'utf8')).key,'dismissed');
  assert.doesNotMatch(await (await fetch(f.base+'/board/decisions')).text(),/data-id="review"/);
  const stats=await fetch(f.base+'/api/board/stats');assert.equal(stats.status,200);assert.ok((await stats.json()).rays.some(r=>r.ray==='demo'));assert.equal((await fetch(f.base+'/board/stats')).status,200);
});
test('optional prompt-proxy usage stays hidden without records and scopes costs to the project',async t=>{
  let DatabaseSync;try{({DatabaseSync}=await import('node:sqlite'));}catch{t.skip('node:sqlite needs Node 22.13+');return;}
  async function sessionUsage(s,ray){const code=`import {sessionUsage} from ${JSON.stringify(new URL('session-usage.ts',src).href)};console.log(JSON.stringify(await sessionUsage(JSON.parse(process.argv[1]),process.argv[2])));`;const r=spawnSync(process.execPath,[...flags,'--input-type=module','-e',code,JSON.stringify(s),ray],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
  const home=mkdtempSync(path.join(tmpdir(),'usage test '));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const root=path.join(home,'rays'),usageProxyDb=path.join(home,'usage.sqlite');assert.equal(await sessionUsage({root},'demo'),null);
  const db=new DatabaseSync(usageProxyDb);db.exec('create table requests (started_at integer, project_path text, model text, input_uncached integer, cache_read integer, cache_write integer, output_tokens integer, cost_usd real)');
  const q=db.prepare('insert into requests values (?,?,?,?,?,?,?,?)');q.run(Date.now(),path.join(root,'demo'),'example',10,20,30,40,.5);q.run(Date.now(),path.join(root,'demo-other'),'example',100,200,300,400,9);db.close();
  const d=await sessionUsage({root,usageProxyDb},'demo');assert.equal(d.ray24h.calls,1);assert.equal(d.ray24h.usd,.5);assert.equal(d.last.contextTokens,60);assert.equal(await sessionUsage({root,usageProxyDb},'missing'),null);
});
