// A deterministic rehearsal of the original project, with fresh proof and a real owner answer.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const file=rel=>path.join(root,rel);
const read=rel=>readFileSync(file(rel),'utf8');
const write=(rel,text)=>{mkdirSync(path.dirname(file(rel)),{recursive:true});writeFileSync(file(rel),text);};
const day=()=>new Date().toISOString().slice(0,10);
const stamp=()=>new Date().toISOString();
const review=(goals,text)=>goals.replace(/^\*\*Week of .*$/m,`**Week of ${day()}:** ${text}`);
const now=(goals,text)=>goals.replace(/^- \*\*Now:\*\* .*$/m,`- **Now:** ${text}`);
const card=(goals,index,mark,proof,decision)=>{let n=-1;return goals.replace(/^  - \[[ x~]\] (.*)(?:\n    (?:proof|decision):[^\n]*)*/gm, (all,text)=>{if(++n!==index)return all;return `  - [${mark}] ${text}${proof?'\n    proof: '+proof:''}${decision?'\n    decision: '+decision:''}`;});};
const resume=(current,next,waiting='None.',gotchas='Original starter lacked a runnable Check and sufficient cards. A shell quoting error stopped the original browser test twice; repair the cause before retrying.')=>write('plans/resume.md',`# Resume\n\n## Now\n${current}\n\n## In flight\nNone.\n\n## Next\n${next}\n\n## Waiting on the owner\n${waiting}\n\n## Gotchas\n${gotchas}\n`);
const question='decisions/countdown-review.json';
function linkedDecision(goals){
  const id=/^  - \[[ x~]\] \* Owner looks at the page pictures[^\n]*\n(?:    proof: [^\n]*\n)?    decision: ([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/m.exec(goals)?.[1];
  if(!id)throw Error('No decision linked to the owner review card');
  return id;
}
function runCheck(log,url){
  const r=spawnSync(process.execPath,[file('site/test/e2e.mjs'),...(url?[url]:[])],{cwd:root,encoding:'utf8',timeout:90000});
  const output=(r.stdout||'')+(r.stderr||'')+(r.error?String(r.error)+'\n':'');
  write(log,`${stamp()}\nExit: ${r.status??'unavailable'}\n${output}`);process.stdout.write(output);
  if(r.status!==0||!output.includes('all checks passed (5/5)')){resume('Browser Check failed; see '+log,'Fix the test or page and rerun the same stage.','None.',output.trim().split('\n').at(-1)||'Browser test failed.');throw Error('Check failed; no completion recorded');}
}
function stageExpected(g,index){const cards=[...g.matchAll(/^  - \[([ x~])\]/gm)];if(cards[index]?.[1]!=='~')throw Error('Unexpected stage; read the resume note before continuing.');}
try {
  let g=read('GOALS.md'); const [command,url]=process.argv.slice(2);
  if(command==='prepare'){
    stageExpected(g,0);
    write('plans/first-steps.md','# First steps\n\nOwner mission and measurable Result reviewed. Use the reference page, run the five-point browser Check, inspect both screenshots, record setup gaps and ask the owner where the page belongs.\n');
    g=card(g,0,'x','plans/first-steps.md');g=card(g,1,'~');
    g=review(g,'done: mission reviewed; crossed off: none; carried over: page and test.');
    g=now(g,'The mission and measurable plan are agreed; the page awaits testing.');write('GOALS.md',g);
    resume('Mission reviewed; reference page available.','Inspect and test the page with the build stage.');
  }else if(command==='build'){
    stageExpected(g,1);
    runCheck('site/test/last-run.txt');
    write('plans/setup-gaps.md','# Setup gaps from the first ray\n\nThe original command stopped midway, the starter Result copied the mission, the Check was missing, the plan had too few cards, no must, incomplete review, a thin instruction file, an incomplete resume note and missing folders. The public kit uses a self-contained project and explicit checks. The reference page runs in a browser without a build step.\n');
    const imagePaths=['site/test/shots/1280.png','site/test/shots/390.png'];
    write(question,JSON.stringify({id:'countdown-review',title:'Countdown page: right, and online?',question:'The countdown page is built and its browser test passes. It counts to a date in the link or picked under the clock, and falls back to next New Year. Is it right, and should it go online?',options:[{key:'online',label:'Looks right, put it online',images:imagePaths},{key:'local',label:'Looks right, keep it local',images:imagePaths},{key:'change',label:'Needs changes (say what)',images:imagePaths}],allowNote:true,createdAt:stamp()},null,2)+'\n');
    g=card(g,1,'x','site/test/last-run.txt — browser test 5 of 5');g=card(g,2,'x','site/test/last-run.txt and screenshots at 1280 and 390 pixels');g=card(g,3,'x','plans/setup-gaps.md');g=card(g,4,'~',null,'countdown-review');
    g=now(g,'The page passes all five browser checks; the owner can review both pictures and choose where it belongs.');g=review(g,'done: mission, page, browser test and setup notes; crossed off: none; carried over: owner review.');write('GOALS.md',g);
    resume('Browser Check passed 5/5; both screenshots are in the decision.','Read the saved answer and run finish once the owner approves.','Countdown page: right, and online?');
  }else if(command==='finish'){
    stageExpected(g,4);
    const id=linkedDecision(g),answer=`decisions/${id}.answer.json`;
    if(!existsSync(file(answer)))throw Error('Answer the question on the board first.');
    const a=JSON.parse(read(answer));
    if(a.key==='change')throw Error('Owner requested changes. Revise and ask again with a new decision ID; do not claim completion.');
    if(!['local','online'].includes(a.key))throw Error('Unexpected decision');
    if(a.key==='online'&&(!url||new URL(url).protocol!=='https:'||new URL(url).username||new URL(url).password||new URL(url).hash||/\s/.test(url)))throw Error('Online approval needs a deployed HTTPS address. Publish only the page, then supply its address.');
    if(a.key==='local'&&url)throw Error('Local approval does not authorize publication.');
    runCheck('site/test/final-run.txt',url);
    write('decisions/countdown-review.md',`# Countdown page placement\n\nContext: page and browser test passed and the owner reviewed the two pictures.\n\nDecision: ${a.key==='online'?'Publish the page at the owner-approved address.':'Keep the page local.'}\n\nReason: the owner selected ${a.key} in the decision inbox.${a.note?' Owner note: '+a.note:''}\n\nEvidence: the final browser Check passed 5/5.\n`);
    g=card(g,4,'x',answer+' — '+a.key,id);
    g=card(g,5,'x',a.key==='online'?'site/test/final-run.txt — live browser test 5 of 5':'decisions/countdown-review.md — owner chose local');
    if(url)g=g.replace('check: run bun site/test/e2e.mjs timeout=90s',`check: run bun site/test/e2e.mjs ${url} timeout=90s`);
    g=now(g,a.key==='online'?'The page is online and the browser test passes all five points against it.':'The page is approved for local use and the browser test passes all five points.');
    // The historical board ended with six done cards and a seventh, running case-log card.
    g=g.replace(/^- \*\*Check:\*\*/m,'  - [~] Write one final case log entry with the owner decision and proof (session, 20m)\n- **Check:**');
    g=review(g,'done: countdown, proof and owner decision; crossed off: further polishing; carried over: final case log.');
    write('GOALS.md',g);
    resume('Result reached. All three must cards have proof; the final browser Check passed 5/5.','Show the six-of-seven board. Run close to record this last stage and archive the Result.');
    console.log('Result reached; board shows six of seven cards. Run close to archive the Result.');
  }else if(command==='close'){
    stageExpected(g,6);
    const checkLine=/^  check: run bun site\/test\/e2e\.mjs(?: (https:\/\/\S+))? timeout=90s$/m.exec(g);
    if(!checkLine)throw Error('Unexpected Check; review the current Result before closing.');
    const musts=[...g.matchAll(/^  - \[([ x~])\] \* [^\n]+(?:\n    proof: ([^\n]+))?/gm)];
    if(musts.length!==3||musts.some(m=>m[1]!=='x'||!m[2]))throw Error('Every must needs a proof line before closing.');
    runCheck('site/test/final-run.txt',checkLine[1]);
    write('docs/case-log.md',`# Countdown case log\n\n${stamp()}: mission reviewed, browser Check passed five of five, owner chose ${JSON.parse(read(`decisions/${linkedDecision(g)}.answer.json`)).key}, final Check passed. Evidence: site/test/final-run.txt and the two screenshots. No further polishing required.\n`);
    g=card(g,6,'x','docs/case-log.md');g=review(g,'done: countdown, proof, owner decision and final case log; crossed off: further polishing; carried over: none.');
    write('GOALS.md',g);write('docs/completed-result.md',g);
    resume('Result archived. All three must cards have proof; the final browser Check passed 5/5.','Replace the Result with the next owner-approved measurable outcome, or stop this finished ray.');
    console.log('Result archived in docs/completed-result.md. Replace or retire it, do not polish it.');
  }else throw Error('Usage: bun replay.mjs prepare|build|finish [public-https-address]|close');
}catch(e){console.error(e.message);process.exitCode=1;}
