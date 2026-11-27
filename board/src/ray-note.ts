import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { projectNames, validName } from './projects.ts';
export function sendNote(root:string,to:string,from:string,slug:string,body:string){
  if(!projectNames(root).includes(to)||!(from==='owner'||from==='board'||projectNames(root).includes(from))||!validName(to)||!/^[a-z0-9-]{1,64}$/.test(slug)||!body.trim()||body.length>64000)throw Error('Invalid note');
  const base=realpathSync(path.join(root,to)),plans=path.join(base,'plans');
  if(!existsSync(plans))mkdirSync(plans);
  if(!lstatSync(plans).isDirectory()||lstatSync(plans).isSymbolicLink()||realpathSync(plans)!==plans)throw Error('Unsafe plans directory');
  const date=new Date().toISOString();const file=path.join(plans,`${date.slice(0,10)}-${date.slice(11,16).replace(':','')}-from-${from}-${slug}-${randomBytes(4).toString('hex')}.md`);
  writeFileSync(file,body.trim()+'\n',{flag:'wx',mode:0o600});return {file:path.basename(file),delivered:'note'};
}
