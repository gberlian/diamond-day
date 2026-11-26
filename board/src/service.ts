import { spawn } from 'node:child_process';
import { closeSync, openSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { installDir, url, type Settings } from './config.ts';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function health(s:Settings):Promise<'owned'|'other'|'down'> {
  try {const r=await fetch(`${url(s)}/health`,{headers:{authorization:`Bearer ${s.token}`},signal:AbortSignal.timeout(800)});return r.ok && (await r.json()).owned===true?'owned':'other';}catch{return 'down';}
}
export async function startBoard(s:Settings) {
  const state=await health(s); if(state==='owned') return;
  if(state==='other') throw new Error(`Port ${s.port} already belongs to another service`);
  const dir=installDir();mkdirSync(dir,{recursive:true});
  const fd=openSync(path.join(dir,'board.log'),'a');
  let failure:Error|undefined;
  try {
    const child=spawn(s.runtime,[...s.runtimeArgs,path.join(dir,'board','src','server.ts')],{cwd:dir,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});
    child.on('error',e=>{failure=e;});child.unref();
  } finally{closeSync(fd);}
  for(let i=0;i<100;i++){if(failure) throw failure;const h=await health(s);if(h==='owned')return;if(h==='other')throw new Error('Port is in use');await delay(100);}
  throw new Error(`Board did not start; see ${path.join(dir,'board.log')}`);
}
export async function stopBoard(s:Settings) {
  if(await health(s)!=='owned')return;
  const r=await fetch(`${url(s)}/shutdown`,{method:'POST',headers:{authorization:`Bearer ${s.token}`},signal:AbortSignal.timeout(2000)});
  if(!r.ok)throw new Error('Board shutdown refused');
  for(let i=0;i<100;i++){if(await health(s)==='down')return;await delay(100);}
  throw new Error('Board did not shut down');
}
