import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import http from 'node:http';
import { CheckService, CheckError, STALE_MS, executeCheck, parseCheckDeclaration,
  parseGoals, tokenizeArgv, readRayGoals } from '../tools/checks.mjs';
import { createBoardServer } from '../tools/board.mjs';

const LOOPBACK = [127, 0, 0, 1].join('.');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arpe-tests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  fs.mkdirSync(path.join(root, 'demo'));
  fs.writeFileSync(path.join(root, 'rays.txt'), 'demo\n');
  const write = text => fs.writeFileSync(path.join(root, 'demo', 'GOALS.md'), text);
  const goal = (id, declaration, extras = '') =>
    `## ${id}. Goal ${id}\n- **Want:** Proof.\n- **Check:** Verify a precise criterion.\n  check: ${declaration}\n- **Now:** ${extras || 'New'}\n- **Next:** Repair it.\n\n`;
  return { root, write, goal, folder: path.join(root, 'demo') };
}

test('parser: exact grammar, quoting, malformed declarations, no prose execution', () => {
  assert.deepEqual(tokenizeArgv(String.raw`node "a path" 'with words' "an\"escaped"`),
    ['node', 'a path', 'with words', 'an"escaped']);
  assert.equal(tokenizeArgv('node "unterminated'), null);
  assert.deepEqual(parseCheckDeclaration('  check: run node -e "process.exit(0)" timeout=12s'),
    { kind: 'run', argv: ['node', '-e', 'process.exit(0)'], timeoutMs: 12000 });
  assert.deepEqual(parseCheckDeclaration('    check: http GET https://example.org/ 204'),
    { kind: 'http', url: 'https://example.org/', expectedStatus: 204, timeoutMs: 60000 });
  assert.deepEqual(parseCheckDeclaration('  check: file-age "reports/new file.md" younger 5h'),
    { kind: 'file', file: 'reports/new file.md', maxAgeMs: 18_000_000, timeoutMs: 60000 });
  assert.deepEqual(parseCheckDeclaration('  check: manual'), { kind: 'manual', timeoutMs: 60000 });
  for (const line of [
    'check: run node -v', '  check: run node -v timeout=0s',
    '  check: run node -v timeout=301s', '  check: file ../escape younger 1h',
    '  check: file C:\\outside younger 1h', '  check: http POST https://example.org 200',
    '  check: http GET https://example.org 99', '  check: manual timeout=8s',
    '  check: run node -v\n  check: manual'
  ]) assert.equal(parseCheckDeclaration(line), null, line);
  const goals = parseGoals(`# demo
## 1. A
- **Check:** \`node -e "process.exit(0)"\`
- **Now:** check: run node -e "process.exit(2)"
  check: run node -e "process.exit(3)"
## 2. B
- **Check:** Human acceptance.
  check: manual
- **Next:** check: run node -v
`);
  assert.equal(goals[0].spec, null);
  assert.equal(goals[1].spec.kind, 'manual');
  const examples = parseGoals('# demo\n## 1. Example\n- **Check:** Documentation only.\n  ```\n  check: run node -e "process.exit(0)"\n  ```\n  <!--\n  check: run node -e "process.exit(0)"\n  -->\n- **Now:** Unrun.\n');
  assert.equal(examples[0].spec, null, 'fenced and commented examples must remain inert');
});

test('runner: exit codes, output tail and no shell expansion', async t => {
  const f = fixture(t);
  const pass = await executeCheck({ kind: 'run',
    argv: [process.execPath, '-e', 'console.log("ok")'], timeoutMs: 5000 }, f.folder);
  assert.equal(pass.status, 'pass');
  assert.match(pass.lastLine, /ok/);
  const fail = await executeCheck({ kind: 'run',
    argv: [process.execPath, '-e', 'process.exit(7)'], timeoutMs: 5000 }, f.folder);
  assert.equal(fail.status, 'fail');
  assert.equal(fail.exitCode, 7);
  const noShell = await executeCheck({ kind: 'run',
    argv: [process.execPath, '-e', 'console.log(process.argv[1])', '$(touch injected)'],
    timeoutMs: 5000 }, f.folder);
  assert.equal(noShell.lastLine, '$(touch injected)');
  assert.equal(fs.existsSync(path.join(f.folder, 'injected')), false);
  const massive = await executeCheck({ kind: 'run',
    argv: [process.execPath, '-e', 'console.log("x".repeat(4000)+"END")'],
    timeoutMs: 5000 }, f.folder);
  assert.ok(Buffer.byteLength(massive.output) <= 2048);
  assert.match(massive.output, /END/);
});

test('runner timeout kills descendants on Windows and POSIX', { timeout: 12000 }, async t => {
  const f = fixture(t);
  const marker = path.join(f.folder, 'descendant-alive.txt');
  const childScript = path.join(f.folder, 'child.cjs');
  const parentScript = path.join(f.folder, 'parent.cjs');
  fs.writeFileSync(childScript, `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'alive'),1900);setInterval(()=>{},1000);`);
  fs.writeFileSync(parentScript, `const {spawn}=require('node:child_process');
spawn(process.execPath,[${JSON.stringify(childScript)}],{stdio:'ignore'});
setInterval(()=>{},1000);`);
  const result = await executeCheck({ kind: 'run', argv: [process.execPath, parentScript],
    timeoutMs: 1000 }, f.folder);
  assert.equal(result.status, 'fail');
  assert.equal(result.timedOut, true);
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(fs.existsSync(marker), false, 'descendant survived a process tree timeout');
});

test('file checks: fresh, old, missing, traversal, symlink escape and future', async t => {
  const f = fixture(t);
  const target = path.join(f.folder, 'proof.txt');
  fs.writeFileSync(target, 'proof');
  const spec = { kind: 'file', file: 'proof.txt', maxAgeMs: 3600_000, timeoutMs: 5000 };
  assert.equal((await executeCheck(spec, f.folder)).status, 'pass');
  const old = new Date(Date.now() - 2 * 3600_000);
  fs.utimesSync(target, old, old);
  assert.equal((await executeCheck(spec, f.folder)).status, 'fail');
  assert.equal((await executeCheck({ ...spec, file: 'missing.txt' }, f.folder)).status, 'fail');
  assert.equal((await executeCheck({ ...spec, file: '../rays.txt' }, f.folder)).status, 'fail');
  const future = new Date(Date.now() + 120_000);
  fs.utimesSync(target, future, future);
  assert.equal((await executeCheck(spec, f.folder)).status, 'fail');
  try {
    fs.symlinkSync(path.join(f.root, 'rays.txt'), path.join(f.folder, 'escape.txt'));
    assert.equal((await executeCheck({ ...spec, file: 'escape.txt' }, f.folder)).status, 'fail');
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  }
});

test('http checks: exact status, redirects not followed and timeout', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') return; // abort signal must terminate response wait
    if (req.url === '/redirect') { res.writeHead(302, { location: '/ok' }); res.end('redirect'); return; }
    res.writeHead(201); res.end('created');
  });
  await new Promise(resolve => server.listen(0, LOOPBACK, resolve));
  t.after(() => server.close());
  const url = `http://${LOOPBACK}:${server.address().port}`;
  const base = { kind: 'http', timeoutMs: 1500, expectedStatus: 201 };
  const ok = await executeCheck({ ...base, url: url + '/ok' }, os.tmpdir());
  assert.equal(ok.status, 'pass');
  assert.match(ok.lastLine, /created/);
  assert.equal((await executeCheck({ ...base, expectedStatus: 200, url: url + '/ok' }, os.tmpdir())).status, 'fail');
  assert.equal((await executeCheck({ ...base, expectedStatus: 302, url: url + '/redirect' }, os.tmpdir())).status, 'pass');
  const timeout = await executeCheck({ ...base, url: url + '/slow', timeoutMs: 150 }, os.tmpdir());
  assert.equal(timeout.status, 'fail');
  assert.equal(timeout.timedOut, true);
});

test('history: manual report, 24-hour stale and 50-record cap', async t => {
  const f = fixture(t);
  f.write('# test\n' + f.goal(1, 'manual'));
  let time = Date.now();
  const service = new CheckService(f.root, { clock: () => time });
  let goal = readRayGoals(f.root, 'demo')[0];
  assert.equal(service.light('demo', goal).state, 'manual');
  assert.equal((await service.report('demo', '1', 'pass', 'verified')).status, 'pass');
  assert.equal(service.light('demo', goal).state, 'pass');
  time += STALE_MS + 1000;
  assert.equal(service.light('demo', goal).state, 'stale');
  await assert.rejects(service.report('demo', '1', 'pass', ''), /invalid_report/);
  for (let i = 0; i < 55; i++) await service.report('demo', '1', 'pass', `note ${i}`);
  assert.equal(service.read().goals['demo/1'].length, 50);
  assert.equal(service.read().goals['demo/1'].at(-1).lastLine, 'note 54');
});

test('board API: PASS/FAIL/MANUAL, POST, localhost CSRF and cooldown', async t => {
  const f = fixture(t);
  f.write('# test\n' + f.goal(1, 'run node -e "process.exit(0)"') +
    f.goal(2, 'run node -e "process.exit(3)"') + f.goal(3, 'manual'));
  const board = await createBoardServer(f.root, { port: 0, schedule: false });
  t.after(() => board.server.close());
  const base = board.url.replace(/\/board$/, '');
  const data = await (await fetch(`${base}/api/board`)).json();
  assert.deepEqual(data.rays[0].goals.map(g => g.state), ['never', 'never', 'manual']);
  const html = await (await fetch(`${base}/board`)).text();
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Run check for demo goal 1/);
  const post = path => fetch(`${base}/api/checks/run?ray=demo&goal=${path}`, { method: 'POST' });
  assert.equal((await post('1')).status, 200);
  assert.equal((await post('2')).status, 200);
  const now = await (await fetch(`${base}/api/board`)).json();
  assert.deepEqual(now.rays[0].goals.map(g => g.state), ['pass', 'fail', 'manual']);
  assert.equal((await post('1')).status, 429);
  const csrf = await fetch(`${base}/api/checks/run?ray=demo&goal=1`, {
    method: 'POST', headers: { origin: 'https://malicious.invalid' }
  });
  assert.equal(csrf.status, 403);
  assert.equal((await post('3')).status, 409);
  assert.equal((await post('999')).status, 404);
  assert.equal((await fetch(`${base}/api/checks/run?ray=..%2Foutside&goal=1`, { method: 'POST' })).status, 400);
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
});

test('no commands without Check declaration; symlinked rays and GOALS denied', async t => {
  const f = fixture(t);
  const marker = path.join(f.folder, 'should-not-exist');
  f.write(`# demo
## 1. Prose
- **Want:** Nothing executes.
- **Check:** Run \`node -e "require('fs').writeFileSync('should-not-exist','bad')"\` manually.
- **Now:** check: run node -e "require('fs').writeFileSync('should-not-exist','bad')"
- **Next:** Stay inert.
`);
  const service = new CheckService(f.root);
  assert.equal(service.board().rays[0].goals[0].state, 'never');
  await assert.rejects(service.run('demo', '1'), error => error.status === 404);
  assert.equal(fs.existsSync(marker), false);
  assert.throws(() => readRayGoals(f.root, '../outside'), error => error.status === 400);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'arpe-external-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'GOALS.md'), '# bad');
  try {
    fs.symlinkSync(outside, path.join(f.root, 'external'), 'junction');
    assert.throws(() => readRayGoals(f.root, 'external'), error => error.status === 400);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  }
  // Reject GOALS.md symlink out of the ray even if the ray folder itself is valid.
  fs.rmSync(path.join(f.folder, 'GOALS.md'));
  try {
    fs.symlinkSync(path.join(outside, 'GOALS.md'), path.join(f.folder, 'GOALS.md'));
    assert.throws(() => readRayGoals(f.root, 'demo'), error => error.status === 400);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  }
});
