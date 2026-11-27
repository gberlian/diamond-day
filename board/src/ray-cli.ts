#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync, cpSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { settings, installDir, url, loopback, type Settings } from './config.ts';
import { validName, projectNames } from './projects.ts';
import { sendNote } from './ray-note.ts';
import { startBoard, stopBoard } from './service.ts';
const read=(p:string)=>existsSync(p)?readFileSync(p,'utf8'):'';
const put=(p:string,t:string)=>{try{writeFileSync(p,t,{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST')throw e;}};
const clean=(v:string)=>v.replace(/[\r\n\0]+/g,' ').trim();
function dir(s:Settings,n:string){if(!validName(n))throw new Error('Invalid or reserved ray name');const p=path.join(s.root,n);if(existsSync(p)&&(!lstatSync(p).isDirectory()||lstatSync(p).isSymbolicLink()))throw new Error('Ray must be a real directory');return p;}
function active(s:Settings,n:string,on:boolean){const f=path.join(s.root,'rays.txt');const lines=read(f).split(/\r?\n/).filter(x=>x.trim()!==n&&x.trim());if(on)lines.push(n);writeFileSync(f,lines.join('\n')+'\n');}
export function newRay(s:Settings,n:string,mission:string){
  const p=dir(s,n),m=clean(mission);if(!m)throw new Error('Mission required');
  mkdirSync(s.root,{recursive:true});if(existsSync(p))throw new Error(`Ray already exists: ${n}`);mkdirSync(p); // refuse existing folders, do not overwrite work
  for(const d of ['plans','decisions','insights','docs/goals','docs/changes','handoffs','.docs/chatgpt/small'])mkdirSync(path.join(p,d),{recursive:true});
  const day=new Date().toISOString().slice(0,10);
  put(path.join(p,'README.md'),`# ${n}\n\n## Mission\n${m}\n\n## Repos\n| Repo | What |\n|---|---|\n`);
  put(path.join(p,'GOALS.md'),`# ${n}\n\n**Ultimate Vision:** ${m}\n**Ultimate Purpose:** Because meaningful progress deserves a clear direction.\n**Roles:** Builder, Tester\n**Week of ${day}:** done: project created; crossed off: none; carried over: define the first outcome.\n\n## 1. Establish the first outcome\n- **Result:** One current resume note records the next outcome within 24 hours.\n- **Purpose:** So that the owner and agent can resume without losing context.\n- **Plan:**\n  - [~] * Clarify the first measurable outcome with the owner (session, 30m)\n  - [ ] Write a suitable acceptance criterion (session, 20m)\n  - [ ] Review the next action with the owner (owner, 15m)\n- **Check:** A resume note exists and is current.\n  check: file plans/resume.md younger 24h\n- **Now:** The project is ready to define its first measurable outcome.\n`);
  put(path.join(p,'plans','resume.md'),`# Resume\n\n## Now\nProject created. Mission: ${m}\n\n## In flight\nNone.\n\n## Next\nAgree on a measurable result and replace the starter block with its runnable check.\n\n## Waiting on the owner\nApproval of the first Result and Purpose.\n\n## Gotchas\nNone.\n`);
  put(path.join(p,'plans',`${day}-from-owner-start.md`),`# Owner start\n\n${m}\n`);
  const rule=s.agent==='codex'?'AGENTS.md':s.agent==='claude-desktop'?'PROJECT-INSTRUCTIONS.md':'CLAUDE.md';
  const shared=`## Boundaries and evidence
Edit only this ray and repositories listed in its README. Do not change permissions, grant trust, spend money, or publish without approval. Do not expose private files or secrets in handoffs. Run the declared Check in the ray directory and record actual evidence; the RPM score is not outcome proof. Add proof under each done card; finish only when the Check passes and every must has proof. Archive and replace a reached Result with the owner’s next approved outcome. Keep exactly one card running while work remains. Ask blocked questions through a card-linked decision in decisions/ and read the saved answer before acting. Keep all five parts of plans/resume.md current after each meaningful step. Confirm the successor has read and understood the resume note before closing a session. Delegate substantial independent work using the handoff template and review returned files before accepting them.`;
  put(path.join(p,rule),`# Ray instructions\n\nRead GOALS.md and plans/resume.md first. The owner owns Result and Purpose; the agent owns the plan. Run \`bun ../tools/rpm-check.ts .\` after editing goals.\n\n${shared}`);
  put(path.join(p,'.gitignore'),'.docs/\n.board/\n');active(s,n,true);console.log(`Created ${n}: ${p}`);
}
/** Copy a trusted, self-contained template. No links, no overwrite, no execution. */
export function newRayFrom(s:Settings,n:string,from:string){
  const p=dir(s,n), source=path.resolve(from);
  if(!lstatSync(source).isDirectory()||lstatSync(source).isSymbolicLink())throw new Error('Template must be a real directory');
  const goal=path.join(source,'GOALS.md');
  if(!lstatSync(goal).isFile()||lstatSync(goal).isSymbolicLink())throw new Error('Template requires a regular GOALS.md');
  mkdirSync(s.root,{recursive:true});
  const target=path.join(realpathSync(s.root),n), actual=realpathSync(source);
  const rel=path.relative(actual,target);
  if(!rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)))throw new Error('Template cannot contain its destination');
  function validate(base:string){
    for(const entry of readdirSync(base,{withFileTypes:true})){
      const child=path.join(base,entry.name);
      if(entry.isSymbolicLink()||(!entry.isDirectory()&&!entry.isFile()))throw new Error('Template contains a link or special file');
      if(entry.name==='.git')throw new Error('Template must not contain repository metadata');
      if(entry.isDirectory())validate(child);
    }
  }
  validate(source);
  mkdirSync(p); // exclusive: never modify an existing ray
  try { for(const entry of readdirSync(source))cpSync(path.join(source,entry),path.join(p,entry),{recursive:true,force:false,errorOnExist:true}); }
  catch(e){rmSync(p,{recursive:true,force:true});throw e;}
  active(s,n,true);console.log(`Created ${n}: ${p}`);
}
function checkName(s:Settings,n:string){if(!projectNames(s.root).includes(n))throw new Error(`Unknown ray: ${n}`);return dir(s,n);}
function browser(s:Settings,n?:string){const address=`${url(s)}/board${n?'/p/'+encodeURIComponent(n):''}`;console.log(address);
  if(process.env.RAY_NO_BROWSER==='1')return;
  const custom=process.env.RAY_BROWSER_BIN;
  // No shell interpolation; URL is a distinct argument.
  const cmd=custom|| (process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open');
  const args=!custom&&process.platform==='win32'?['url.dll,FileProtocolHandler',address]:[address];
  const child=spawn(cmd,args,{stdio:'ignore',detached:true,windowsHide:true});child.on('error',()=>console.log('Open the printed URL in a browser.'));child.unref();
  const script=process.env.RAY_WINDOW_SCRIPT, ahk=process.env.RAY_AUTOHOTKEY_BIN;
  if(process.platform==='win32'&&script&&ahk&&existsSync(script)&&existsSync(ahk)){const layout=spawn(ahk,[script,n||'',address],{stdio:'ignore',detached:true});layout.on('error',e=>console.error('Optional placement:',e.message));layout.unref();}
}
const sessionFile=(n:string)=>path.join(installDir(),`session-${n}.json`);
async function stop(s:Settings,n:string){checkName(s,n);const f=sessionFile(n);if(existsSync(f)){
  const a=JSON.parse(read(f));try{const r=await fetch(`http://${loopback}:${a.port}/stop`,{method:'POST',headers:{authorization:`Bearer ${a.token}`},signal:AbortSignal.timeout(1500)});if(!r.ok)throw new Error('Session stop refused');}catch(e){throw new Error(`Could not stop managed session: ${e}`);}
}active(s,n,false);console.log(`Stopped ${n}; shared board remains running.`);}
async function openRay(s:Settings,n:string){const p=checkName(s,n);await startBoard(s);browser(s,n);
  if(s.agent==='claude-desktop'){console.log('Open the project in Claude Desktop using PROJECT-INSTRUCTIONS.md.');return;}
  const agent=executable(process.env.RAY_AGENT_BIN|| (s.agent==='codex'?'codex':'claude'));
  if(!agent)throw new Error('Agent executable not found; install it or set RAY_AGENT_BIN.');
  const f=sessionFile(n);if(existsSync(f))throw new Error(`A managed session exists for ${n}; use ray stop ${n} first (remove stale session file only after verifying no session is running).`);
  const token=randomUUID();let child:ReturnType<typeof spawn>|undefined;
  const ctl=createServer((req,res)=>{if(req.method!=='POST'||req.url!=='/stop'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403).end();return;}child?.kill();res.end('ok');});
  await new Promise<void>((resolve,reject)=>{ctl.once('error',reject);ctl.listen(0,loopback,resolve);});
  try {writeFileSync(f,JSON.stringify({port:(ctl.address() as {port:number}).port,token}),{flag:'wx',mode:0o600});}catch(e){ctl.close();throw e;}
  try{active(s,n,true);child=spawn(agent,[],{cwd:p,stdio:'inherit',shell:process.platform==='win32'&&/\.(cmd|bat)$/i.test(agent)});await new Promise<void>((resolve,reject)=>{child!.once('error',reject);child!.once('exit',code=>{if(code&&code!==0)reject(new Error(`Agent exited ${code}`));else resolve();});});}
  finally{ctl.close();ctl.closeAllConnections();rmSync(f,{force:true});}
}
function executable(name:string):string|null {
  const extensions=process.platform==='win32'?['',...((process.env.PATHEXT||'.EXE;.CMD;.BAT').split(';'))]:[''];
  if(!name)return null;
  for(const base of path.isAbsolute(name)||name.includes(path.sep)?['']: (process.env.PATH||'').split(path.delimiter)) {
    for(const ext of extensions){const candidate=base?path.join(base,name+ext):name+ext;try{if(lstatSync(candidate).isFile()||lstatSync(candidate).isSymbolicLink())return candidate;}catch{}}
  }
  return null;
}
async function restore(s:Settings){
  await startBoard(s);browser(s);
  const names=read(path.join(s.root,'rays.txt')).split(/\r?\n/).filter(x=>projectNames(s.root).includes(x));
  const custom=process.env.RAY_TERMINAL_BIN;
  const defaultTerminal=process.platform==='win32'?'wt.exe':process.platform==='linux'&&(process.env.DISPLAY||process.env.WAYLAND_DISPLAY)?'x-terminal-emulator':'';
  const terminal=process.env.RAY_RESTORE_MANUAL==='1'?null:executable(custom||defaultTerminal);
  const prefix=process.env.RAY_TERMINAL_ARGS?JSON.parse(process.env.RAY_TERMINAL_ARGS):process.platform==='win32'?['new-tab']:['-e'];
  if(!Array.isArray(prefix)||prefix.some(x=>typeof x!=='string'))throw new Error('RAY_TERMINAL_ARGS must be a JSON string array');
  const agent=executable(process.env.RAY_AGENT_BIN||(s.agent==='codex'?'codex':'claude'));
  for(const name of names){
    if(existsSync(sessionFile(name)))continue;
    if(!terminal||!agent||s.agent==='claude-desktop'){console.log(`Resume in a terminal: ray open ${name}`);continue;}
    const child=spawn(terminal,[...prefix,s.runtime,...s.runtimeArgs,path.join(installDir(),'board','src','ray-cli.ts'),'open',name],{detached:true,stdio:'ignore',windowsHide:false});
    child.on('error',()=>console.log(`Resume in a terminal: ray open ${name}`));child.unref();
  }
}
async function configureShare(s:Settings,port?:number,origin?:string){
  if(port!==undefined&&(!Number.isInteger(port)||port<1||port>65535||port===s.port))throw Error('Invalid share port');
  if(origin){const u=new URL(origin);if(u.protocol!=='https:'||!u.hostname.endsWith('.ts.net')||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Use an HTTPS Tailscale origin');origin=u.origin;}
  const next={...s,sharePort:port,shareOrigin:origin};const file=path.join(installDir(),'settings.json');
  await stopBoard(s);writeFileSync(file,JSON.stringify(next,null,2)+'\n',{mode:0o600});
  try{await startBoard(next);}catch(e){writeFileSync(file,JSON.stringify(s,null,2)+'\n',{mode:0o600});await startBoard(s);throw e;}
}
async function share(s:Settings,n:string|undefined,args:string[]){
  if(n==='start'){if(args.length<1||args.length>2)throw Error('Usage: ray share start PORT [HTTPS_ORIGIN]');await configureShare(s,Number(args[0]),args[1]);console.log('Sharing listener started');return;}
  if(n==='stop'){if(args.length)throw Error('Usage: ray share stop');await configureShare(s);console.log('Sharing listener stopped');return;}
  if(!n||args.length>3)throw Error('Usage: ray share PROJECT [PERSON] [viewer|editor] [HOURS]');checkName(s,n);
  if(!s.sharePort)throw Error('Run ray share start PORT [HTTPS_ORIGIN] first');await startBoard(s);
  const response=await fetch(`${url(s)}/api/companies/${encodeURIComponent(n)}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${s.token}`},body:JSON.stringify({op:'invite',person:args[0]||'Guest',role:args[1]||'viewer',ttlHours:args[2]===undefined?168:Number(args[2])})});
  const d=await response.json();if(!response.ok)throw Error(d.error||'Invite failed');
  console.log(`${s.shareOrigin||'http://'+[127,0,0,1].join('.')+':'+s.sharePort}/join#${n}/${d.token}`);
}
export async function main(args:string[]){const s=settings();const [cmd,n,...rest]=args;
  switch(cmd){case 'new':if(n&&rest.length===2&&rest[0]==='--from')newRayFrom(s,n,rest[1]!);else if(n&&rest.length===1&&rest[0]!=='--from')newRay(s,n,rest[0]!);else throw new Error('Usage: ray new NAME "MISSION" | ray new NAME --from TEMPLATE');break;
  case 'note':if(!n||rest.length!==3)throw Error('Usage: ray note TO FROM SLUG FILE|-');console.log(sendNote(s.root,n,rest[0]!,rest[1]!,readFileSync(rest[2]==='-'?0:rest[2]!,'utf8')).file);break;
  case 'share':await share(s,n,rest);break;
  case 'list':if(n)throw new Error('Usage: ray list');for(const name of projectNames(s.root))console.log(name);break;
  case 'board':if(rest.length)throw new Error('Usage: ray board [NAME]');if(n)checkName(s,n);await startBoard(s);browser(s,n);break;
  case 'open':if(!n||rest.length)throw new Error('Usage: ray open NAME');await openRay(s,n);break;
  case 'stop':if(!n||rest.length)throw new Error('Usage: ray stop NAME');await stop(s,n);break;
  case 'restore':if(n)throw new Error('Usage: ray restore');await restore(s);break;
  default:throw new Error('Usage: ray new|open|stop|board|list|restore|share|note');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
