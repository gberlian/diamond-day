/** Optional read-only usage database. No configured database means no usage panel. */
import path from 'node:path';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {type Settings} from './config.ts';
type Price={input:number;output:number;cacheRead:number;cacheWrite:number};
function prices(file:string):Record<string,Price>{
  const out:Record<string,Price>={};try{for(const [model,p] of Object.entries(JSON.parse(readFileSync(file,'utf8')) as Record<string,any>)){
    const input=Number(p.input),output=Number(p.output),cacheRead=Number(p.cache_read??input*.1),cacheWrite=Number(p.cache_write??input*1.25);
    if([input,output,cacheRead,cacheWrite].every(n=>Number.isFinite(n)&&n>=0))out[model]={input,output,cacheRead,cacheWrite};
  }}catch{}return out;
}
const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
const normalize=(p:string)=>{const v=path.resolve(p);return process.platform==='win32'?v.toLowerCase():v;};
export async function sessionUsage(s:Settings,ray:string){
  const file=s.usageProxyDb;if(!file||!existsSync(file))return null;
  try{
    if(!lstatSync(file).isFile())return null;
    const db=process.versions.bun?new (await import('bun:sqlite')).Database(file,{readonly:true}):new (await import('node:sqlite')).DatabaseSync(file,{readOnly:true});
    try{
      const query=(sql:string)=>'query' in db?db.query(sql):db.prepare(sql);
      const since=Date.now()-86400000,root=normalize(path.join(s.root,ray)),table=prices(s.usageProxyPrices||path.join(path.dirname(path.dirname(file)),'prices.json'));
      const rows=(query('select * from requests where started_at >= ? order by started_at desc').all(since) as any[]).filter(row=>typeof row.project_path==='string'&&normalize(row.project_path)===root);
      if(!rows.length)return null;
      const calls=rows.map(row=>{const model=String(row.model??''),p=Object.keys(table).filter(x=>model.startsWith(x)).sort((a,b)=>b.length-a.length)[0];const rate=p?table[p]:null;
        const input=n(row.input_uncached),read=n(row.cache_read),write=n(row.cache_write),output=n(row.output_tokens),stored=row.cost_usd??row.total_cost_usd;
        const usd=typeof stored==='number'&&Number.isFinite(stored)?stored:rate?(input*rate.input+read*rate.cacheRead+write*rate.cacheWrite+output*rate.output)/1e6:null;
        return {at:n(row.started_at),model,contextTokens:input+read+write,uncached:input,cacheRead:read,cacheWrite:write,output,usd,reason:String(row.cache_reason??''),wasted:n(row.cache_wasted),sysChars:n(row.sys_chars),toolsChars:n(row.tools_chars),msgsChars:n(row.msgs_chars)};});
      return {last:calls[0],calls:calls.slice(0,40),ray24h:{calls:calls.length,usd:calls.every(c=>c.usd!==null)?calls.reduce((a,c)=>a+c.usd!,0):null,wasted:calls.reduce((a,c)=>a+c.wasted,0)}};
    }finally{db.close();}
  }catch{return null;}
}
