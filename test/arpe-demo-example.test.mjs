import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const example=path.join(repo,'examples','arpe-demo');
const strip=['--experimental-strip-types','--disable-warning=ExperimentalWarning'];
const cli=path.join(repo,'board','src','arpe-cli.ts');
const rpm=path.join(repo,'tools','rpm-check.ts');
function run(entry,args=[],opts={}){return spawnSync(process.execPath,[...(entry.endsWith('.ts')?strip:[]),entry,...args],{encoding:'utf8',timeout:100000,...opts});}
function passed(r){assert.equal(r.status,0,`exit ${r.status}\n${r.stdout}\n${r.stderr}\n${r.error||''}`);return r.stdout;}
function temp(t){const dir=mkdtempSync(path.join(tmpdir(),'arpe example test '));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function config(home,port=5195){const root=path.join(home,'rays');mkdirSync(path.join(home,'.arpe'),{recursive:true});writeFileSync(path.join(home,'.arpe','settings.json'),JSON.stringify({root,port,agent:'claude-code',runtime:process.execPath,runtimeArgs:strip,token:'test-only',ownsRoot:true}));return {root,env:{...process.env,HOME:home,USERPROFILE:home,RAY_NO_BROWSER:'1'}};}
function tree(dir){return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?tree(path.join(dir,e.name)).map(([n,b])=>[`${e.name}/${n}`,b]):[[e.name,readFileSync(path.join(dir,e.name))]]);}

test('arpe-demo example: RPM 17/17 and historical starter fails five hard rules',()=>{
  assert.match(passed(run(rpm,[example,'--today','2026-11-26'])),/score 17\/17.*hard failures 0: PASS/);
  const bad=run(rpm,[path.join(example,'docs','original-starter.md'),'--today','2026-11-26']);
  assert.equal(bad.status,1);assert.match(bad.stdout,/score 10\/17.*hard failures 5: FAIL/);
});

test('arpe-demo example: arpe new --from copies files, registers ray and refuses overwrite',t=>{
  const home=temp(t);const {root,env}=config(home);
  assert.match(passed(run(cli,['new','arpe-demo','--from',path.relative(repo,example)],{cwd:repo,env})),/Created arpe-demo/);
  const target=path.join(root,'arpe-demo');assert.deepEqual(tree(target),tree(example));
  assert.match(readFileSync(path.join(root,'rays.txt'),'utf8'),/^arpe-demo\s*$/);
  assert.match(passed(run(cli,['list'],{env})),/^arpe-demo\s*$/);
  const duplicate=run(cli,['new','arpe-demo','--from',example],{env});assert.notEqual(duplicate.status,0);assert.deepEqual(tree(target),tree(example));
  assert.notEqual(run(cli,['new','../bad','--from',example],{env}).status,0);
  assert.notEqual(run(cli,['new','nested','--from',root],{env}).status,0);
  assert.equal(existsSync(path.join(root,'nested')),false);
  passed(run(path.join(target,'replay.mjs'),['prepare']));
  assert.match(passed(run(rpm,[target])),/score 17\/17.*hard failures 0: PASS/);
  assert.match(readFileSync(path.join(target,'GOALS.md'),'utf8'),/\[x\] Mission reviewed[\s\S]*proof: plans\/first-steps.md[\s\S]*\[~\] \* Page counts/);
});

test('arpe-demo example: board decision API links a card and saves one owner answer',async t=>{
  const home=temp(t);const port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'localhost',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const {root,env}=config(home,port);passed(run(cli,['new','arpe-demo','--from',example],{env}));
  const ray=path.join(root,'arpe-demo');const goals=path.join(ray,'GOALS.md');
  // Explicit test fixture: only link a question; no synthetic completion or site evidence.
  writeFileSync(goals,readFileSync(goals,'utf8').replace('  - [ ] * Owner looks at the page pictures and says whether it is right (owner, 10m)','  - [ ] * Owner looks at the page pictures and says whether it is right (owner, 10m)\n    decision: countdown-review'));
  mkdirSync(path.join(ray,'decisions'),{recursive:true});writeFileSync(path.join(ray,'decisions','countdown-review.json'),JSON.stringify({id:'countdown-review',title:'Countdown page: right, and online?',question:'Choose the destination.',options:[{key:'online',label:'Looks right, put it online'},{key:'local',label:'Looks right, keep it local'}],allowNote:true}));
  const server=spawn(process.execPath,[...strip,path.join(repo,'board','src','server.ts')],{env,stdio:'ignore'});t.after(async()=>{if(server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}});
  const base=`http://localhost:${port}`;
  for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const p=await (await fetch(base+'/api/board/project/arpe-demo')).json();assert.equal(p.results[0].cards[4].decisionItem.state,'pending');
  assert.match(await (await fetch(base+'/board/decisions')).text(),/countdown-review/);
  const html=await (await fetch(base+'/board/p/arpe-demo')).text();const token=/const DECISION_TOKEN = "([^"]+)"/.exec(html)[1];
  const request=(headers,key='online')=>fetch(base+'/api/decisions/answer',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({ray:'arpe-demo',id:'countdown-review',key,note:''})});
  assert.equal((await request({})).status,403);
  assert.equal((await request({origin:base,'x-decision-token':token},'invalid')).status,400);
  assert.equal((await request({origin:base,'x-decision-token':token})).status,200);
  assert.equal(JSON.parse(readFileSync(path.join(ray,'decisions','countdown-review.answer.json'),'utf8')).key,'online');
  assert.equal((await request({origin:base,'x-decision-token':token},'local')).status,409);
  assert.equal((await (await fetch(base+'/api/board/project/arpe-demo')).json()).results[0].cards[4].decisionItem.state,'answered');
});

test('arpe-demo example: actual browser Check passes five of five and captures both widths',t=>{
  const dir=temp(t);const site=path.join(dir,'site');cpSync(path.join(example,'site'),site,{recursive:true});
  const output=passed(run(path.join(site,'test','e2e.mjs')));assert.equal((output.match(/^PASS /gm)||[]).length,5);assert.match(output,/all checks passed \(5\/5\)/);
  for(const width of [1280,390]){const png=readFileSync(path.join(site,'test','shots',`${width}.png`));assert.equal(png.readUInt32BE(16),width);}
});
