// Local, card-linked decision inbox. The owner writes an answer once; the agent reads it on disk.
import { readFileSync, writeFileSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { safeUnder } from './docs-page.ts';
const idOK=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id);
export function readDecision(root:string,ray:string,id:string){
  if(!idOK(ray)||!idOK(id))return null;
  const base=safeUnder(root,`${ray}/decisions`);
  if(!base||lstatSync(base).isSymbolicLink())return null;
  try {
    const file=[`${id}.json`,`pending/${id}.json`,`answered/${id}.json`].map(p=>safeUnder(base,p)).find(p=>{try{return p&&lstatSync(p).isFile()&&lstatSync(p).nlink===1&&!lstatSync(path.dirname(p)).isSymbolicLink()&&realpathSync(p)===path.join(realpathSync(base),path.relative(base,p));}catch{return false;}});
    if(!file)return null;
    if(!lstatSync(file).isFile()||lstatSync(file).size>65536)return null;
    const raw=JSON.parse(readFileSync(file,'utf8'));
    const decision=raw;
    if(decision.id!==id||typeof decision.title!=='string'||typeof decision.question!=='string'||!Array.isArray(decision.options)||!decision.options.length||decision.options.length>10||!decision.options.every((o:any)=>idOK(o.key)&&typeof o.label==='string'&&(!o.images||Array.isArray(o.images)&&o.images.every((i:unknown)=>typeof i==='string')))||new Set(decision.options.map((o:any)=>o.key)).size!==decision.options.length)return null;
    let answer=null;
    try {const a=file.replace(/\.json$/,'.answer.json');if(lstatSync(a).isFile()&&lstatSync(a).nlink===1&&lstatSync(a).size<8192){const v=JSON.parse(readFileSync(a,'utf8'));if(typeof v.key!=='string'||typeof v.note!=='string'||typeof v.at!=='string')return null;answer={key:v.key,note:v.note,at:v.at};}else return null;}catch(e:any){if(e.code!=='ENOENT')return null;}
    const visible={id,title:decision.title,question:decision.question,allowNote:decision.allowNote===true,options:decision.options.map((o:any)=>({key:o.key,label:o.label,...(typeof o.detail==='string'?{detail:o.detail}:{}),...(o.images?{images:o.images}:{})}))};
    return {id,decision:visible,answer,state:answer?'answered':'pending',folder:path.dirname(file)};
  }catch{return null;}
}
export function saveAnswer(root:string,ray:string,id:string,key:unknown,note:unknown){
  const item=readDecision(root,ray,id);
  if(!item||item.answer||typeof key!=='string'||(key!=='dismissed'&&!item.decision.options.some((o:any)=>o.key===key))||typeof note!=='string'||note.length>500||(!item.decision.allowNote&&note))throw Error('Invalid or already answered decision');
  const answer={key,note,at:new Date().toISOString()};
  const base=item.folder;
  writeFileSync(path.join(base,`${id}.answer.json`),JSON.stringify(answer,null,2)+'\n',{flag:'wx'});
  return answer;
}

export class DecisionError extends Error { status:number; constructor(status: number,message:string){super(message);this.status=status;} }
export function decisionIds(root:string,ray:string):string[]{
  const ids=new Set<string>();
  for(const rel of ['decisions','decisions/pending','decisions/answered']){const dir=safeUnder(root,`${ray}/${rel}`);if(!dir)continue;try{for(const e of readdirSync(dir,{withFileTypes:true})){const id=e.name.replace(/\.json$/,'');if(e.isFile()&&e.name.endsWith('.json')&&idOK(id))ids.add(id);}}catch{}}
  return [...ids];
}
export class DecisionService {
  private root:string; constructor(root:string, _clock?:()=>number){this.root=root;}
  list(rays:string[],ids?:string[]){return rays.flatMap(ray=>(ids??decisionIds(this.root,ray)).flatMap(id=>{const x=readDecision(this.root,ray,id);if(!x)return [];const {folder,...item}=x;return [{...item,ray}];}));}
  answer(ray:string,id:string,key:unknown,note:unknown,_change=false,_allowUnlisted=false){try{return saveAnswer(this.root,ray,id,key,note??'');}catch{throw new DecisionError(400,'Invalid or already answered decision');}}
}
export function safeImage(folder:string,rel:string){const file=safeUnder(folder,rel);const ext=path.extname(rel).toLowerCase();const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif'};if(!file||!mime[ext]||!lstatSync(file).isFile())throw new DecisionError(404,'Image not found');return {file,mime:mime[ext],size:lstatSync(file).size};}
