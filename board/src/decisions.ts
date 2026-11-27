// Local, card-linked decision inbox. The owner writes an answer once; the agent reads it on disk.
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { safeUnder } from './docs-page.ts';
const idOK=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id);
export function readDecision(root:string,ray:string,id:string){
  if(!idOK(ray)||!idOK(id))return null;
  const base=safeUnder(root,`${ray}/decisions`);
  if(!base||lstatSync(base).isSymbolicLink())return null;
  try {
    const file=path.join(base,`${id}.json`);
    if(!lstatSync(file).isFile()||lstatSync(file).size>65536)return null;
    const decision=JSON.parse(readFileSync(file,'utf8'));
    if(decision.id!==id||typeof decision.title!=='string'||typeof decision.question!=='string'||!Array.isArray(decision.options)||!decision.options.length||decision.options.length>10||!decision.options.every((o:any)=>idOK(o.key)&&typeof o.label==='string'&&(!o.images||Array.isArray(o.images)&&o.images.every((i:unknown)=>typeof i==='string')))||new Set(decision.options.map((o:any)=>o.key)).size!==decision.options.length)return null;
    let answer=null;
    try {const a=path.join(base,`${id}.answer.json`);if(lstatSync(a).isFile()&&lstatSync(a).size<8192)answer=JSON.parse(readFileSync(a,'utf8'));}catch(e:any){if(e.code!=='ENOENT')return null;}
    return {id,decision,answer,state:answer?'answered':'pending'};
  }catch{return null;}
}
export function saveAnswer(root:string,ray:string,id:string,key:unknown,note:unknown){
  const item=readDecision(root,ray,id);
  if(!item||item.answer||typeof key!=='string'||!item.decision.options.some((o:any)=>o.key===key)||typeof note!=='string'||note.length>500||(!item.decision.allowNote&&note))throw Error('Invalid or already answered decision');
  const answer={key,note,at:new Date().toISOString()};
  const base=safeUnder(root,`${ray}/decisions`)!;
  writeFileSync(path.join(base,`${id}.answer.json`),JSON.stringify(answer,null,2)+'\n',{flag:'wx'});
  return answer;
}
