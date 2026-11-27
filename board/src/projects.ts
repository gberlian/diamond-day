import { readdirSync, readFileSync, statSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { parseRpm } from './rpm.ts';
import { projectDocTree, safeUnder } from './docs-page.ts';
import { projectLibrary } from './library.ts';
import { readDecision } from './decisions.ts';
export const validName = (name: string) => /^[a-z][a-z0-9-]{0,63}$/.test(name) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9]|tools|templates|docs|plans|decisions|insights|handoffs)$/.test(name);
export function projectNames(root: string): string[] {
  try { return readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory() && validName(e.name) && safeGoals(root,e.name)).map(e=>e.name).sort(); } catch { return []; }
}
function safeGoals(root:string, name:string): string|null {
  if (!validName(name)) return null;
  const p=safeUnder(root,`${name}/GOALS.md`);
  try { return p && !lstatSync(path.join(root,name)).isSymbolicLink() && lstatSync(p).isFile() && statSync(p).size < 4*1024*1024 ? p : null; } catch { return null; }
}
export function project(root:string, name:string) {
  const p=safeGoals(root,name); if (!p) return null;
  const rpm=parseRpm(readFileSync(p,'utf8'),name);
  const decisionInbox:any[]=[];
  const results=rpm.results.map(r=>({...r,cards:r.steps.map(s=>{
    const item=s.decision?readDecision(root,name,s.decision):null;
    if(item)decisionInbox.push({...item,card:{result:r.id,index:s.index}});
    return {...s,column:s.mark==='x'?'done':s.mark==='~'?'running':'planned',cause:null,jobs:[],missingProof:s.mark==='x'&&!s.proof,decisionItem:item};
  })}));
  return {...rpm,ray:name,running:false,session:{session:'stopped',ago:null},lastActivity:statSync(p).mtimeMs,
    results,
    docs:[],docTree:projectDocTree(root,name),library:projectLibrary(root,name),decisionInbox,editEnabled:false,ledgerError:null,nextCard:null,pickupStatus:null};
}
export function rows(root:string) {
  return projectNames(root).flatMap(name=>{const p=project(root,name);return p?[{ray:name,name:p.name,vision:p.vision,running:false,session:'stopped',lastActivity:p.lastActivity,results:p.results.map(r=>({id:r.id,title:r.title,done:r.steps.filter(s=>s.mark==='x').length,total:r.steps.length,now:r.steps.some(s=>s.mark==='~')}))}]:[];});
}
