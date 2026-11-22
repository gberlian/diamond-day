import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(repo, 'tools');
const tmp = mkdtempSync(path.join(tmpdir(), 'diamond-day paths with spaces '));

function run(tool, ...args) {
  const result = spawnSync(process.execPath, [path.join(tools, tool), ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${tool} exited ${result.status}: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const goal = [
  '# demo', '',
  '## 1. First goal',
  '- **Want:** First result.',
  '- **Check:** `node --version`',
  '- **Now:** Waiting.',
  '- **Next:** Verify.',
  '',
  '## 2. Second goal',
  '- **Want:** Second result.',
  '- **Check:** `node --version`',
  '- **Now:** Waiting.',
  '- **Next:** Verify.',
  '',
].join('\r\n');

try {
  const work = path.join(tmp, 'ray root with spaces');
  const ray = path.join(work, 'first-ray');
  mkdirSync(ray, { recursive: true });
  writeFileSync(path.join(work, 'rays.txt'), '# comment\r\nfirst-ray\r\n', 'utf8');
  const goals = path.join(ray, 'GOALS.md');
  writeFileSync(goals, goal, 'utf8');
  const out = run('check-goals.mjs', goals);
  assert.match(out, /GOAL 1: First goal/);
  assert.match(out, /GOAL 2: Second goal/);
  assert.match(out, /PASS goals: 2 goal\(s\)/);
  run('check-rays.mjs', work);
  run('board.mjs', work);
  assert.match(readFileSync(path.join(work, 'board.html'), 'utf8'), /Second goal/);
  console.log('PASS portability: CRLF goals and rays.txt, spaces, 2 goals, board');

  // Test Windows drive, slash and backslash semantics independent of host OS.
  const win = String.raw`C:\ray workspace\demo\GOALS.md`;
  assert.equal(path.win32.parse(win).root, 'C:\\');
  assert.equal(path.win32.basename(win), 'GOALS.md');
  assert.equal(path.win32.dirname(win), String.raw`C:\ray workspace\demo`);
  assert.equal(fileURLToPath(pathToFileURL(goals)), goals);
  console.log('PASS portability: Windows drive, backslash and file URL handling');

  if (process.platform !== 'win32') {
    // On POSIX, backslash is a legal filename character. Check that tool args
    // are passed literally (not interpreted as URLs, shell escapes or commands).
    const unusual = path.join(tmp, String.raw`C:\ray folder\GOALS.md`);
    writeFileSync(unusual, goal, 'utf8');
    assert.match(run('check-goals.mjs', unusual), /PASS goals: 2 goal\(s\)/);
    console.log('PASS portability: literal backslashes in POSIX filenames');
  } else {
    assert.equal(existsSync(goals), true);
    console.log('PASS portability: native Windows paths with drive letters and spaces');
  }
  console.log('PASS tools-portability.mjs');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
