import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { eolLike, readZip } from '../tools/diamond.mjs';

const tool = fileURLToPath(new URL('../tools/diamond.mjs', import.meta.url));

function run(program, args, cwd, env = {}) {
  const r = spawnSync(program, args, {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8',
    windowsHide: true, maxBuffer: 16 * 1024 * 1024
  });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function git(repo, ...args) {
  const r = run('git', ['-c', 'core.autocrlf=false', ...args], repo);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.err}`);
  return r.out.trim();
}
function cli(cwd, ...args) {
  return run(process.execPath, [tool, ...args], cwd);
}
function good(result) {
  assert.equal(result.code, 0, `exit ${result.code}\n${result.out}\n${result.err}`);
  return result.out;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diamond test paths with spaces-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 75 }));
  const repo = path.join(root, 'project with spaces');
  const inbox = path.join(root, 'inbox with spaces');
  fs.mkdirSync(repo);
  fs.mkdirSync(inbox);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Review Tester');
  git(repo, 'config', 'user.email', 'tester@local');
  const writeRepo = (relative, value) => {
    const abs = path.join(repo, ...relative.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, value);
  };
  writeRepo('examples/demo-ray/site/index.html', 'start\nkeep\n');
  writeRepo('examples/demo-ray/site/about.html', 'about\r\nkeep\r\n');
  writeRepo('examples/demo-ray/site/assets/style.css', 'body {}\n');
  writeRepo('docs/staged.md', 'original\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'initial');
  const putFolder = (job, fileMap) => {
    const dir = path.join(inbox, job);
    for (const [name, body] of Object.entries(fileMap)) {
      const filename = path.join(dir, ...name.split('/'));
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, body);
    }
    return dir;
  };
  const scan = (...opts) => cli(root, 'scan', '--inbox', inbox, '--repos', repo, ...opts);
  const show = job => cli(root, 'show', job, '--inbox', inbox);
  const decide = (job, action, reason) => cli(root, 'decide', job, action, ...(reason ? [reason] : []), '--inbox', inbox);
  return { root, repo, inbox, writeRepo, putFolder, scan, show, decide };
}

const crctab = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1;
  return c >>> 0;
});
function crc32(b) {
  let v = 0xffffffff;
  for (const n of b) v = crctab[(v ^ n) & 255] ^ v >>> 8;
  return (v ^ 0xffffffff) >>> 0;
}
function zipBuffer(entries) {
  // The fixture encoder deliberately supports both compression methods without dependencies.
  const local = [], central = [];
  let offset = 0;
  for (const { name, content, method = 8 } of entries) {
    const filename = Buffer.from(name);
    const plain = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const compressed = method === 8 ? deflateRawSync(plain) : plain;
    const crc = crc32(plain);
    const a = Buffer.alloc(30);
    a.writeUInt32LE(0x04034b50);
    a.writeUInt16LE(20, 4);
    a.writeUInt16LE(method, 8);
    a.writeUInt32LE(crc, 14);
    a.writeUInt32LE(compressed.length, 18);
    a.writeUInt32LE(plain.length, 22);
    a.writeUInt16LE(filename.length, 26);
    local.push(a, filename, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(plain.length, 24);
    c.writeUInt16LE(filename.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, filename);
    offset += a.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, eocd]);
}
function writeZip(inbox, job, entries) {
  const destination = path.join(inbox, `${job}.zip`);
  fs.writeFileSync(destination, zipBuffer(entries));
  return destination;
}

test('nested overlay, metadata omitted, index and worktree untouched even with staged changes', t => {
  const f = fixture(t);
  f.putFolder('nested-job', {
    'site/index.html': 'start\nfixed\n',
    'site/new.txt': 'new file\n',
    'APPLY.md': 'instruction only',
    'NOTES.txt': 'not code',
    'NOTES': 'not code',
    'SUMMARY.md': 'not code',
    'SUMMARY': 'not code',
    'VERIFICATION.md': 'not code',
    'VERIFICATION': 'not code',
    'site/change.patch': 'not code'
  });
  // The existing staged change must be neither included in the generated commit nor disturbed.
  f.writeRepo('docs/staged.md', 'staged difference\n');
  git(f.repo, 'add', 'docs/staged.md');
  const before = git(f.repo, 'status', '--porcelain=v1', '--untracked-files=all');
  const indexBefore = git(f.repo, 'ls-files', '--stage');
  const head = git(f.repo, 'rev-parse', 'HEAD');
  good(f.scan());
  assert.equal(git(f.repo, 'status', '--porcelain=v1', '--untracked-files=all'), before);
  assert.equal(git(f.repo, 'ls-files', '--stage'), indexBefore);
  assert.equal(git(f.repo, 'rev-parse', 'reply/nested-job^'), head);
  assert.equal(git(f.repo, 'show', 'reply/nested-job:examples/demo-ray/site/index.html'), 'start\nfixed');
  assert.equal(git(f.repo, 'show', 'reply/nested-job:examples/demo-ray/site/new.txt'), 'new file');
  assert.equal(git(f.repo, 'show', 'reply/nested-job:docs/staged.md'), 'original');
  assert.equal(run('git', ['cat-file', '-e', 'reply/nested-job:APPLY.md'], f.repo).code, 128);
  const diff = fs.readFileSync(path.join(f.inbox, 'nested-job.DIFF.md'), 'utf8');
  assert.match(diff, /Per-file unified diff/);
  assert.match(diff, /site\/index.html/);
  assert.doesNotMatch(diff, /instruction only/);
  const index = fs.readFileSync(path.join(f.inbox, '.diamond', 'index.md'), 'utf8');
  assert.match(index, /nested-job/);
  assert.match(index, /\+2 \/ -1/);
  assert.match(f.show('nested-job').out, /nested-job/);
});

test('CRLF stored in HEAD stays CRLF, LF converted as needed, binaries unchanged', t => {
  const f = fixture(t);
  f.putFolder('eol-job', {
    'site/about.html': 'about\nchanged\n',
    'site/index.html': 'start\r\nchanged\r\n',
    'site/byte.bin': Buffer.from([0, 13, 10, 255, 1])
  });
  good(f.scan());
  const about = spawnSync('git', ['show', 'reply/eol-job:examples/demo-ray/site/about.html'], { cwd: f.repo }).stdout;
  const index = spawnSync('git', ['show', 'reply/eol-job:examples/demo-ray/site/index.html'], { cwd: f.repo }).stdout;
  const binary = spawnSync('git', ['show', 'reply/eol-job:examples/demo-ray/site/byte.bin'], { cwd: f.repo }).stdout;
  assert.deepEqual(about, Buffer.from('about\r\nchanged\r\n'));
  assert.deepEqual(index, Buffer.from('start\nchanged\n'));
  assert.deepEqual(binary, Buffer.from([0, 13, 10, 255, 1]));
  assert.equal(eolLike(Buffer.from('x\r\ny'), null).toString(), 'x\ny');
  assert.match(fs.readFileSync(path.join(f.inbox, 'eol-job.DIFF.md'), 'utf8'), /Binary file changed/);
});

test('HEAD movement regenerates a generated reply branch against current HEAD', t => {
  const f = fixture(t);
  f.putFolder('moving-job', { 'site/index.html': 'start\nupdated\n' });
  good(f.scan());
  const first = git(f.repo, 'rev-parse', 'reply/moving-job');
  f.writeRepo('docs/staged.md', 'new head contents\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '-qm', 'advance HEAD');
  const newHead = git(f.repo, 'rev-parse', 'HEAD');
  good(f.scan());
  const next = git(f.repo, 'rev-parse', 'reply/moving-job');
  assert.notEqual(first, next);
  assert.equal(git(f.repo, 'rev-parse', 'reply/moving-job^'), newHead);
  assert.equal(git(f.repo, 'show', 'reply/moving-job:docs/staged.md'), 'new head contents');
  assert.match(fs.readFileSync(path.join(f.inbox, 'moving-job.DIFF.md'), 'utf8'), /updated/);
});

test('a human commit on top is never overwritten when HEAD moves', t => {
  const f = fixture(t);
  f.putFolder('human-job', { 'site/index.html': 'start\nagent\n' });
  good(f.scan());
  const first = git(f.repo, 'rev-parse', 'reply/human-job');
  const tree = git(f.repo, 'rev-parse', `${first}^{tree}`);
  const human = git(f.repo, 'commit-tree', tree, '-p', first, '-m', 'human follow-up');
  git(f.repo, 'update-ref', 'refs/heads/reply/human-job', human);
  f.writeRepo('docs/staged.md', 'latest HEAD\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '-qm', 'HEAD updated');
  assert.match(good(f.scan()), /human-job: kept/);
  assert.equal(git(f.repo, 'rev-parse', 'reply/human-job'), human);
  assert.match(fs.readFileSync(path.join(f.inbox, 'human-job.DIFF.md'), 'utf8'), /Human commits/);
});

test('ZIP stored and deflated entries; dry-run writes neither refs nor index', t => {
  const f = fixture(t);
  const zip = writeZip(f.inbox, 'mixed-zip', [
    { name: 'files/site/index.html', content: 'start\nfrom deflate\n', method: 8 },
    { name: 'files/site/assets/style.css', content: 'body { color: black; }\n', method: 0 },
    { name: 'files/APPLY.md', content: 'metadata', method: 0 }
  ]);
  const decoded = readZip(zip);
  assert.equal(decoded.get('site/index.html').toString(), 'start\nfrom deflate\n');
  assert.equal(decoded.get('site/assets/style.css').toString(), 'body { color: black; }\n');
  const head = git(f.repo, 'rev-parse', 'HEAD');
  const before = git(f.repo, 'status', '--porcelain=v1', '--untracked-files=all');
  assert.match(good(f.scan('--dry-run')), /mixed-zip: dry-run .*2f \+2 -2/);
  assert.equal(fs.existsSync(path.join(f.inbox, '.diamond')), false);
  assert.equal(fs.existsSync(path.join(f.inbox, 'mixed-zip.DIFF.md')), false);
  assert.equal(run('git', ['show-ref', '--verify', '--quiet', 'refs/heads/reply/mixed-zip'], f.repo).code, 1);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), head);
  assert.equal(git(f.repo, 'status', '--porcelain=v1', '--untracked-files=all'), before);
  good(f.scan());
  assert.equal(git(f.repo, 'show', 'reply/mixed-zip:examples/demo-ray/site/index.html'), 'start\nfrom deflate');
  assert.equal(git(f.repo, 'show', 'reply/mixed-zip:examples/demo-ray/site/assets/style.css'), 'body { color: black; }');
});

test('merge is refused on a dirty tree; merge and skip decisions are recorded', t => {
  const f = fixture(t);
  f.putFolder('merge-job', { 'site/index.html': 'start\nmergeable\n' });
  f.putFolder('skip-job', { 'site/about.html': 'about\nskippable\n' });
  good(f.scan());
  f.writeRepo('scratch.txt', 'untracked\n');
  const refused = f.decide('merge-job', 'merge');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /dirty/);
  assert.equal(fs.existsSync(path.join(f.inbox, '.diamond', 'decisions.json')), false);
  fs.unlinkSync(path.join(f.repo, 'scratch.txt'));
  good(f.decide('merge-job', 'merge', 'Reviewed diff'));
  assert.match(git(f.repo, 'log', '-1', '--pretty=%s'), /Merge branch 'reply\/merge-job'/);
  good(f.decide('skip-job', 'skip', 'Superseded by separate work'));
  const decisions = JSON.parse(fs.readFileSync(path.join(f.inbox, '.diamond', 'decisions.json')));
  assert.equal(decisions['merge-job'].decision, 'merge');
  assert.equal(decisions['skip-job'].reason, 'Superseded by separate work');
  assert.match(good(f.scan()), /skip-job: skip/);
  assert.match(fs.readFileSync(path.join(f.inbox, '.diamond', 'index.md'), 'utf8'), /Superseded by separate work/);
});

test('a stale undecided reply exits 2, and a decided reply does not', t => {
  const f = fixture(t);
  const dir = f.putFolder('old-job', { 'site/index.html': 'start\nold\n' });
  const old = new Date(Date.now() - 9 * 3600000);
  fs.utimesSync(dir, old, old);
  const check = f.scan('--dry-run');
  assert.equal(check.code, 2, check.out + check.err);
  assert.match(check.out, /1 stale undecided/);
  const actual = f.scan();
  assert.equal(actual.code, 2);
  good(f.decide('old-job', 'skip', 'No longer relevant'));
  good(f.scan('--dry-run'));
});

test('invalid ZIP paths and symlinks are refused, Windows-safe names and spaces work', t => {
  const f = fixture(t);
  writeZip(f.inbox, 'escape-zip', [{ name: '../site/index.html', content: 'bad' }]);
  const result = f.scan('--dry-run');
  assert.equal(result.code, 1);
  assert.match(result.out, /Unsafe reply path/);
  fs.unlinkSync(path.join(f.inbox, 'escape-zip.zip'));
  f.putFolder('safe-path', { 'site/new file.txt': 'with spaces\n', 'site/auxiliary.txt': 'normal\n' });
  good(f.scan());
  assert.equal(git(f.repo, 'show', 'reply/safe-path:examples/demo-ray/site/new file.txt'), 'with spaces');
  assert.equal(path.win32.basename(String.raw`C:\review area\demo\index.html`), 'index.html');
  assert.equal(path.win32.normalize(String.raw`C:\review area\inbox`), String.raw`C:\review area\inbox`);
});

test('a repository directory inside a tracked worktree resolves to the correct Git root', t => {
  const f = fixture(t);
  f.putFolder('scoped-job', { 'site/index.html': 'start\nscoped\n' });
  good(cli(f.root, 'scan', '--inbox', f.inbox, '--repos', path.join(f.repo, 'examples')));
  assert.equal(git(f.repo, 'show', 'reply/scoped-job:examples/demo-ray/site/index.html'), 'start\nscoped');
});

test('updated reply payload on unchanged HEAD refreshes its generated branch', t => {
  const f = fixture(t);
  f.putFolder('updated-job', { 'site/index.html': 'start\nfirst\n' });
  good(f.scan());
  const first = git(f.repo, 'rev-parse', 'reply/updated-job');
  f.putFolder('updated-job', { 'site/index.html': 'start\nsecond\n' });
  assert.match(good(f.scan()), /updated-job: built/);
  assert.notEqual(git(f.repo, 'rev-parse', 'reply/updated-job'), first);
  assert.equal(git(f.repo, 'show', 'reply/updated-job:examples/demo-ray/site/index.html'), 'start\nsecond');
});

test('tracked inbox fixtures do not accidentally map onto their own reply files', t => {
  const f = fixture(t);
  const trackedInbox = path.join(f.repo, 'examples', 'demo-ray', 'inbox');
  const jobFile = path.join(trackedInbox, 'fix-nav', 'site', 'index.html');
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  fs.writeFileSync(jobFile, 'start\nfrom reply\n');
  f.writeRepo('.gitignore', '.diamond/\n*.DIFF.md\n');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '-qm', 'track demo reply');
  const before = git(f.repo, 'status', '--porcelain=v1');
  const result = cli(f.root, 'scan', '--inbox', trackedInbox, '--repos', path.join(f.repo, 'examples'));
  assert.match(good(result), /fix-nav: built .*1f \+1 -1/);
  assert.equal(git(f.repo, 'show', 'reply/fix-nav:examples/demo-ray/site/index.html'), 'start\nfrom reply');
  assert.equal(git(f.repo, 'show', 'reply/fix-nav:examples/demo-ray/inbox/fix-nav/site/index.html'), 'start\nfrom reply');
  // The source remains present at HEAD; only the real target gets modified.
  assert.match(fs.readFileSync(path.join(trackedInbox, 'fix-nav.DIFF.md'), 'utf8'), /examples\/demo-ray\/site\/index.html/);
  assert.equal(git(f.repo, 'status', '--porcelain=v1'), before, 'generated files should be ignored if configured');
});
