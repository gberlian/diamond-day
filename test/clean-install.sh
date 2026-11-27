#!/usr/bin/env bash
set -euo pipefail
REPO=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d); export HOME="$TMP/home with spaces"; mkdir -p "$HOME"
unset RAYS_ROOT RAY_BOARD_PORT BUN_INSTALL
export RAY_NO_BROWSER=1 RAY_RESTORE_MANUAL=1
# A free port avoids interfering with a developer's running board.
export RAY_BOARD_PORT=$(node -e 'const s=require("net").createServer();s.listen(0,"localhost",()=>{console.log(s.address().port);s.close()})')
cleanup(){ bash "$REPO/install.sh" --uninstall --purge >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
start=$SECONDS
bash "$REPO/install.sh"
# The installed login shell setup must make ray available without calling its absolute path.
source "$HOME/.profile"
command -v arpe
arpe list | grep -Fx demo
ray list >"$TMP/alias-out" 2>"$TMP/alias-err"
grep -Fx demo "$TMP/alias-out"
grep -i 'arpe' "$TMP/alias-err"
arpe new demo2 'A small demo'
arpe board demo2 | grep -F "/board/p/demo2"
arpe restore | grep -Fx 'Resume in a terminal: arpe open demo2'
if [[ ${RAY_RUNTIME:-bun} == node ]]; then runtime=(node --experimental-strip-types --disable-warning=ExperimentalWarning)
elif command -v bun >/dev/null; then runtime=(bun)
else runtime=("$HOME/.arpe/bun/bin/bun"); fi
for n in demo demo2; do
  echo "RPM check: $n"
  "${runtime[@]}" "$REPO/tools/rpm-check.ts" "$HOME/rays/$n"
done
base="http://localhost:$RAY_BOARD_PORT"
node --input-type=module - "$base" <<'JS'
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
const base=process.argv[2];
const r=await fetch(base+'/board');assert.equal(r.status,200);const html=await r.text();
for(const n of ['demo','demo2']) assert.ok(html.includes('/board/p/'+n+'"'));
const j=await (await fetch(base+'/api/board/projects')).json();assert.deepEqual(j.projects.map(x=>x.ray).sort(),['demo','demo2']);
for(const n of ['demo','demo2']) {const page=await fetch(base+'/board/p/'+n);assert.equal(page.status,200);for(const script of (await page.text()).matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script[1]);const p=await (await fetch(base+'/api/board/project/'+n)).json();assert.equal(p.results[0].cards.length,3);assert.equal(p.results[0].cards[0].must,true);assert.match(p.results[0].check,/resume note/i); if(n==='demo'){assert.equal(p.results[0].checkResult.state,'pass');const c=await (await fetch(base+'/api/board/project/demo/card?result=1&step=0&view=check')).json();assert.equal(c.last.state,'pass');console.log('PASS demo Check: '+c.last.output);}const doc=await fetch(base+'/api/board/project/'+n+'/doc?path='+n+'/plans/resume.md');assert.equal(doc.status,200);assert.match(await doc.text(),/Project created/);}
assert.equal((await fetch(base+'/board/p/missing')).status,404);
for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script[1]);
console.log('PASS board: HTTP 200; projects demo, demo2; both RPM project pages and card APIs answer; scripts parse; resume links resolve');
JS
share_port=$(node -e 'const s=require("net").createServer();s.listen(0,[127,0,0,1].join("."),()=>{console.log(s.address().port);s.close()})')
arpe share start "$share_port"
invite=$(arpe share demo Guest viewer 1)
share_base="http://$(printf '%s.%s.%s.%s' 127 0 0 1):$share_port"
node --input-type=module - "$base" "$share_base" "$invite" <<'JS'
import assert from 'node:assert/strict';
const [base,guest,invite]=process.argv.slice(2);assert.equal((await fetch(base+'/board/sharing')).status,200);assert.equal((await fetch(guest+'/api/board')).status,404);
const token=new URL(invite).hash.split('/')[1];assert.match(token,/^[A-Za-z0-9_-]{43}$/);const r=await fetch(guest+'/c/demo/api',{headers:{authorization:'Bearer '+token}});assert.equal(r.status,200);assert.equal((await r.json()).role,'viewer');
console.log('PASS sharing: owner page HTTP 200; share listener /api/board HTTP 404; viewer invitation works');
JS
# Reinstall in place; preserve project contents, token, and sharing settings.
old_settings=$(cat "$HOME/.arpe/settings.json")
cp "$HOME/rays/demo2/GOALS.md" "$TMP/goals-before"
bash "$REPO/install.sh"
cmp "$TMP/goals-before" "$HOME/rays/demo2/GOALS.md"
node -e 'const a=JSON.parse(process.argv[1]),b=require(process.argv[2]);for(const k of ["root","port","token","sharePort"])require("node:assert/strict").equal(a[k],b[k])' "$old_settings" "$HOME/.arpe/settings.json"
echo 'PASS upgrade: existing project, token, root, board and share ports preserved'
# A duplicate new command must not overwrite existing content.
if arpe new demo2 'overwrite'; then echo 'FAIL duplicate creation accepted' >&2; exit 1; fi
grep -Fq 'A small demo' "$HOME/rays/demo2/GOALS.md"
bash "$REPO/install.sh" --uninstall --purge
node --input-type=module - "$base" "$share_base" <<'JS'
import assert from 'node:assert/strict';
await assert.rejects(fetch(process.argv[3]+'/join',{signal:AbortSignal.timeout(2000)}));
await assert.rejects(fetch(process.argv[2]+'/board',{signal:AbortSignal.timeout(2000)}));
console.log('PASS uninstall: board no longer answers');
JS
[[ -z $(find "$HOME" -mindepth 1 -print -quit) ]] || { find "$HOME" -mindepth 1 -print; exit 1; }
! command -v arpe >/dev/null
((SECONDS-start<900))
echo "PASS clean-install.sh: empty HOME after uninstall; ${SECONDS-start}s elapsed"
