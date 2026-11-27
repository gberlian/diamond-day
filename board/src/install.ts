import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { home, installDir, settings, url, type Settings } from './config.ts';
import { validName } from './projects.ts';
import { newRay } from './ray-cli.ts';
import { startBoard, stopBoard } from './service.ts';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=installDir(), file=path.join(dir,'settings.json');
const sh=(s:string)=>"'"+s.replace(/'/g,"'\\''")+"'";
const marker='# arpe managed PATH';
function profiles(add:boolean) {
  if(process.platform==='win32')return;
  const stateFile=path.join(dir,'profile-state.json');
  const state:Record<string,{existed:boolean;prefixNewline:boolean}> = existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{};
  const line=`export PATH="$HOME/.arpe/bin:$PATH" ${marker}\n`;
  const names=['.profile','.bashrc','.zshrc',...['.bash_profile','.bash_login'].filter(n=>existsSync(path.join(home(),n)))];
  for(const n of add?names:Object.keys(state)) {
    const p=path.join(home(),n),existed=existsSync(p),old=existed?readFileSync(p,'utf8'):'';
    if(add) {
      if(old.includes(line))continue;
      const prefixNewline=!!old&&!old.endsWith('\n');
      state[n]={existed,prefixNewline};
      writeFileSync(stateFile,JSON.stringify(state,null,2));
      writeFileSync(p,old+(prefixNewline?'\n':'')+line);
    } else if(existed&&old.includes(line)) {
      const at=old.indexOf(line),before=old.slice(0,at),after=old.slice(at+line.length);
      const text=(state[n]?.prefixNewline&&at+line.length===old.length?before.slice(0,-1):before)+after;
      if(!text&&!state[n]?.existed)rmSync(p,{force:true});else writeFileSync(p,text);
    }
  }
}
function copyMissing(from:string,to:string){if(existsSync(to))return;cpSync(from,to,{recursive:true,errorOnExist:true,force:false});}
async function install(args:string[]){let root=process.env.RAYS_ROOT||path.join(home(),'rays'), port=Number(process.env.RAY_BOARD_PORT||5195),agent='claude-code';const extra:string[]=[];
  for(let i=0;i<args.length;i++){const a=args[i]!.toLowerCase();if(a==='--root'||a==='-root')root=args[++i]!;else if(a==='--port'||a==='-port')port=Number(args[++i]);else if(a==='--agent'||a==='-agent')agent=args[++i]!;else if(a==='--ray'||a==='-ray')extra.push(args[++i]!);else if(a==='--demo'||a==='-demo'){}else throw new Error(`Unknown option ${args[i]}`);}
  root=path.resolve(root);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');if(!['claude-code','codex','claude-desktop'].includes(agent))throw new Error('Invalid agent');
  const within=(base:string,child:string)=>{const r=path.relative(base,child);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
  if(within(dir,root)||within(root,dir))throw new Error('Project root must not overlap installation directory');
  if(extra.some(n=>!n||!validName(n)))throw new Error('Invalid ray name');
  const old=existsSync(file)?settings():null;
  if(!old&&existsSync(dir)&&!existsSync(path.join(dir,".bootstrap-owned")))throw new Error("Installation directory already exists without managed settings; move it first.");
  if(old&&(old.root!==root||old.port!==port||old.agent!==agent))throw new Error('Existing install uses different settings; uninstall first.');
  if(existsSync(root)&&(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink()))throw new Error('Root must be a real directory');
  if(old&&readdirSync(dir).some(n=>/^session-.*\.json$/.test(n)))throw new Error("Stop managed sessions before reinstalling");
  if(old)await stopBoard(old);
  const runtime=process.execPath,runtimeArgs=process.versions.bun?[]:['--experimental-strip-types','--disable-warning=ExperimentalWarning'];
  const s:Settings={root,port,agent,runtime,runtimeArgs,token:old?.token||randomUUID(),sharePort:old?.sharePort,shareOrigin:old?.shareOrigin,claudeProjectsDir:old?.claudeProjectsDir,usageProxyDb:old?.usageProxyDb,usageProxyPrices:old?.usageProxyPrices,ownsRoot:old?.ownsRoot??!existsSync(root)};
  mkdirSync(dir,{recursive:true});mkdirSync(path.join(dir,'bin'),{recursive:true});
  for(const name of ['board']){const dest=path.join(dir,name);if(path.resolve(source,name)!==dest){rmSync(dest,{recursive:true,force:true});cpSync(path.join(source,name),dest,{recursive:true});}}
  mkdirSync(path.join(dir,'tools'),{recursive:true});cpSync(path.join(source,'tools','rpm-check.ts'),path.join(dir,'tools','rpm-check.ts'));
  writeFileSync(file,JSON.stringify(s,null,2)+'\n',{mode:0o600});mkdirSync(root,{recursive:true});
  copyMissing(path.join(source,'templates'),path.join(root,'templates'));mkdirSync(path.join(root,'tools'),{recursive:true});
  for(const n of ['rpm-check.ts','check-goals.mjs','check-rays.mjs','checks.mjs','board.mjs','open-note.mjs','diamond.mjs','diamond-hook.mjs'])copyMissing(path.join(source,'tools',n),path.join(root,'tools',n));
  if(!existsSync(path.join(root,'README.md')))writeFileSync(path.join(root,'README.md'),'# Rays\n\nOpen the shared board with `ray board`. Create a project with `ray new NAME "Mission"`. The active list is rays.txt; project GOALS.md files are the source of truth. Edit those files and keep each resume note current.\n');
  for(const name of [...new Set(['demo',...extra])])if(!existsSync(path.join(root,name,'GOALS.md')))newRay(s,name,name==='demo'?'A small demo of the RPM board':`Improve ${name}`);
  const entry=path.join(dir,'board','src','ray-cli.ts');
  if(process.platform==='win32')writeFileSync(path.join(dir,'bin','ray.cmd'),`@echo off\r\n"${runtime}" ${runtimeArgs.join(' ')} "${entry}" %*\r\n`);
  else writeFileSync(path.join(dir,'bin','ray'),`#!/usr/bin/env bash\nexec ${[runtime,...runtimeArgs,entry].map(sh).join(' ')} "$@"\n`,{mode:0o755});
  // Make the downloaded Bun available through the same managed PATH as ray.
  if(process.versions.bun && runtime.startsWith(path.join(dir,'bun')+path.sep)){
    if(process.platform==='win32')writeFileSync(path.join(dir,'bin','bun.cmd'),`@echo off\r\n"${runtime}" %*\r\n`);
    else writeFileSync(path.join(dir,'bin','bun'),`#!/usr/bin/env bash\nexec ${sh(runtime)} "$@"\n`,{mode:0o755});
  }
  profiles(true);await startBoard(s);console.log(`PASS install: ${url(s)}/board (runtime: ${process.versions.bun?'Bun':'Node fallback'})`);console.log(`PATH: ${path.join(dir,'bin')}`);
}
async function uninstall(purge:boolean){if(!existsSync(file)){console.log('No installed board');return;}const s=settings();if(purge&&!s.ownsRoot)throw new Error('Refusing to purge a project root that existed before installation');
  if(readdirSync(dir).some(n=>/^session-.*\.json$/.test(n)))throw new Error('Stop managed ray sessions before uninstalling');
  await stopBoard(s);profiles(false);if(purge)rmSync(s.root,{recursive:true,force:true});
  // Windows bootstrap removes the installation folder after this runtime exits (Bun may live inside it).
  if(process.platform!=='win32')rmSync(dir,{recursive:true,force:true});
  console.log(`PASS uninstall${purge?' (project root purged)':' (project data preserved)'}`);
}
const args=process.argv.slice(2);(args.some(a=>/^--?uninstall$/i.test(a))?uninstall(args.some(a=>/^--?purge$/i.test(a))):install(args)).catch(e=>{console.error(e.message);process.exitCode=1;});
