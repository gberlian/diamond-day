// Five browser checks from the original countdown, with picker, desktop and New Year assertions included.
// Runs with Bun or Node 22+; no package installation. Use an installed Chromium-family browser.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function browserPath() {
  const override = process.env.CHROME || process.env.CHROME_PATH;
  if (override) return override;
  const candidates = process.platform === 'win32' ? [
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(p => [path.join(p,'Google/Chrome/Application/chrome.exe'),path.join(p,'Microsoft/Edge/Application/msedge.exe')])
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', path.join(homedir(),'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  ] : ['chromium','chromium-browser','google-chrome','google-chrome-stable','microsoft-edge'];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) ? existsSync(candidate) : spawnSync(candidate,['--version'],{stdio:'ignore',timeout:4000}).status===0) return candidate;
  }
  throw Error('Install Chrome, Edge or Chromium, or set CHROME to its executable.');
}
const localHost=[127,0,0,1].join('.');
let server;
if(!process.argv[2]){
  server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(readFileSync(path.join(root,'index.html')));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,localHost,resolve);});
}
const url = new URL(process.argv[2] || `http://${localHost}:${server.address().port}/`);
if (!['http:','https:'].includes(url.protocol)) throw Error('Expected a web address');
const targetUrl = value => { const u = new URL(url); u.searchParams.delete('to'); if(value) u.searchParams.set('to',value); return u.href; };
const shots = path.join(root,'test','shots');
mkdirSync(shots,{recursive:true});
const profile = mkdtempSync(path.join(tmpdir(),'arpe-browser-'));
let child, ws;
const failures=[];
function ok(condition,message){ console.log(`${condition?'PASS':'FAIL'} ${message}`); if(!condition)failures.push(message); }
try {
  child=spawn(browserPath(),['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,...(process.getuid?.()===0?['--no-sandbox']:[]),'about:blank'],{stdio:'ignore',windowsHide:true});
  let launchError; child.on('error',e=>{launchError=e;});
  let port;
  for(let i=0;i<500;i++){
    if(launchError)throw launchError;
    if(child.exitCode!==null)throw Error(`Browser exited ${child.exitCode}`);
    try {port=Number(readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);if(port)break;}catch{}
    await sleep(100);
  }
  if(!port)throw Error('Browser debug port did not start');
  const host=`http://${[127,0,0,1].join('.')}:${port}`;
  const tab=await (await fetch(host+'/json/new?about:blank',{method:'PUT'})).json();
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Browser connection timed out')),10000);ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(Error('Browser connection failed'));},{once:true});});
  let id=0;const pending=new Map();
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);const job=pending.get(m.id);if(job){pending.delete(m.id);clearTimeout(job.timer);m.error?job.reject(Error(m.error.message)):job.resolve(m.result);}});
  function call(method,params={}){return new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error(`Browser timed out: ${method}`));},15000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});}
  async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true});if(result.exceptionDetails)throw Error('Page script failed: '+expression);return result.result.value;}
  async function size(width,height){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
  async function navigate(address){
    const r=await call('Page.navigate',{url:address});if(r.errorText)throw Error(r.errorText);
    for(let i=0;i<100;i++){try{if(await evaluate(`location.href === ${JSON.stringify(address)} && document.readyState === 'complete' && !!document.querySelector('#to')`))return;}catch{}await sleep(100);}
    throw Error('Countdown page did not load');
  }
  const read=()=>evaluate(`Array.from(document.querySelectorAll('.n'),e=>Number(e.textContent)).reduce((n,v,i)=>n+v*[86400,3600,60,1][i],0)`);
  const fits=()=>evaluate('document.documentElement.scrollWidth <= innerWidth');
  async function screenshot(name){const {data}=await call('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(shots,name),Buffer.from(data,'base64'));}
  await size(1280,800);
  const to=new Date(Date.now()+2*86400e3+3*3600e3+600e3);
  await navigate(targetUrl(to.toISOString()));
  const a=await read();const desktopFits=await fits();
  ok(Math.abs(a-(to.getTime()-Date.now())/1000)<5,`remaining matches target (${a}s)`);
  await sleep(2200);const b=await read();
  ok(a-b>=1&&a-b<=4,`counts down (${a} -> ${b})`);
  await screenshot('1280.png');await size(390,844);
  ok(desktopFits&&await fits(),'no horizontal scroll at 1280 or 390 px');await screenshot('390.png');
  await navigate(targetUrl(new Date(Date.now()-1000).toISOString()));
  ok(await read()===0&&await evaluate('document.body.classList.contains("done")'),'past target shows zero');
  await navigate(targetUrl());
  const fallback=await evaluate(`Math.abs((new Date(new Date().getFullYear()+1,0,1)-Date.now())/1000 - (${await read()})) < 5`);
  const picked=await evaluate(`(()=>{const input=document.querySelector('#to');const d=new Date(Date.now()+7200000);const pad=n=>String(n).padStart(2,'0');input.value=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());input.dispatchEvent(new Event('change'));return {value:input.value,query:new URLSearchParams(location.search).get('to'),seconds:(new Date(input.value)-Date.now())/1000};})()`);
  ok(fallback&&picked.value===picked.query&&Math.abs(await read()-picked.seconds)<5,'no target falls back to next New Year; picker updates countdown and link');
  if(failures.length){console.log(`${failures.length} failed`);process.exitCode=1;}else console.log('all checks passed (5/5)');
} catch(e){console.error(e.message);process.exitCode=1;}
finally {
  server?.close();server?.closeAllConnections();
  ws?.close();
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2000)]);}
  for(let i=0;i<5;i++){try{rmSync(profile,{recursive:true,force:true});break;}catch{await sleep(200);}}
}
