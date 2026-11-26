import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = path.join(root, 'plugins', 'diamond');
const hook = path.join(root, 'tools', 'diamond-hook.mjs');
const bundledHook = path.join(plugin, 'scripts', 'diamond-hook.mjs');
const bundledDiamond = path.join(plugin, 'scripts', 'diamond.mjs');

function run(program, args, cwd = root, timeout = 12000) {
  return spawnSync(program, args, {
    cwd, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024
  });
}

function git(dir, ...args) {
  const result = run('git', args, dir);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'diamond-plugin-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));
  const repo = path.join(folder, 'repo with spaces');
  const inbox = path.join(folder, 'inbox with spaces');
  fs.mkdirSync(repo);
  fs.mkdirSync(inbox);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Diamond Test');
  git(repo, 'config', 'user.email', 'test@local');
  fs.mkdirSync(path.join(repo, 'site'));
  fs.writeFileSync(path.join(repo, 'site', 'index.txt'), 'original\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  const configFile = path.join(folder, '.diamond.json');
  const config = { inbox: './inbox with spaces', repos: ['./repo with spaces'], maxAgeHours: 1, minAgeMinutes: 30 };
  const saveConfig = () => fs.writeFileSync(configFile, JSON.stringify(config));
  const addReply = (job, text, ageMinutes) => {
    const reply = path.join(inbox, job);
    fs.mkdirSync(path.join(reply, 'site'), { recursive: true });
    fs.writeFileSync(path.join(reply, 'site', 'index.txt'), text);
    if (ageMinutes !== undefined) {
      const time = new Date(Date.now() - ageMinutes * 60 * 1000);
      fs.utimesSync(reply, time, time);
    }
    return reply;
  };
  saveConfig();
  const invoke = (...args) => run(process.execPath, [hook, '--config', configFile, ...args], folder);
  return { folder, repo, inbox, config, configFile, saveConfig, addReply, invoke };
}

test('manifest, marketplace and hook fields match the documented Claude Code formats', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.match(manifest.name, /^[a-z]+(?:-[a-z]+)*$/);
  assert.equal(manifest.name, 'diamond');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof manifest.description, 'string');
  assert.equal(typeof manifest.author.name, 'string');
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(marketplace.plugins[0].source, './plugins/diamond');
  assert.equal(marketplace.plugins[0].name, manifest.name);
  assert.ok(marketplace.owner.name);
  const wrapper = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(typeof wrapper.description, 'string');
  assert.deepEqual(Object.keys(wrapper.hooks).sort(), ['SessionStart', 'Stop']);
  for (const event of ['SessionStart', 'Stop']) {
    assert.equal(wrapper.hooks[event].length, 1);
    const group = wrapper.hooks[event][0];
    assert.deepEqual(Object.keys(group), ['hooks']);
    assert.equal(group.hooks.length, 1);
    const handler = group.hooks[0];
    assert.deepEqual(Object.keys(handler).sort(), ['args', 'command', 'timeout', 'type']);
    assert.equal(handler.type, 'command');
    assert.equal(handler.command, 'node');
    assert.equal(handler.timeout, 9); // documented seconds; Claude cancels after this
    assert.deepEqual(handler.args, [
      '${CLAUDE_PLUGIN_ROOT}/scripts/diamond-hook.mjs',
      '--config', '${CLAUDE_PROJECT_DIR}/.diamond.json',
      '--event', event
    ]);
  }
  for (const cmd of ['diamond-review', 'diamond-merge', 'diamond-skip']) {
    const body = fs.readFileSync(path.join(plugin, 'commands', `${cmd}.md`), 'utf8');
    assert.match(body, /^---\r?\ndescription: .+\r?\n/);
    assert.match(body, /diamond-hook\.mjs/);
  }
  assert.equal(fs.readFileSync(hook, 'utf8'), fs.readFileSync(bundledHook, 'utf8'));
  assert.equal(fs.readFileSync(path.join(root, 'tools', 'diamond.mjs'), 'utf8'),
    fs.readFileSync(bundledDiamond, 'utf8'));
});

test('unconfigured projects, empty inboxes and too-new replies produce no output', t => {
  const f = fixture(t);
  const missing = run(process.execPath, [hook, '--config', path.join(f.folder, 'missing.json')], f.folder);
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, '');
  const empty = f.invoke();
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
  assert.equal(empty.stdout, '');
  const emptyStop = f.invoke('--event', 'Stop');
  assert.equal(emptyStop.status, 0);
  assert.equal(emptyStop.stdout, '');
  f.addReply('new-job', 'updated\n', 2);
  const tooNew = f.invoke('--event', 'SessionStart');
  assert.equal(tooNew.status, 0, tooNew.stdout + tooNew.stderr);
  assert.equal(tooNew.stdout, '');
  assert.equal(tooNew.stderr, '');
  assert.ok(fs.existsSync(path.join(f.inbox, 'new-job.DIFF.md')), 'scan still ran');
});

test('pending replies are oldest first, filtered, capped at five, with counts and DIFF links', t => {
  const f = fixture(t);
  for (let i = 1; i <= 6; i++) f.addReply(`job-${i}`, `change ${i}\n`, i * 60);
  f.addReply('recent', 'new\n', 5);
  const reply = f.invoke();
  assert.equal(reply.status, 0, reply.stdout + reply.stderr);
  assert.match(reply.stdout, /^diamond: 6 replies waiting \(older than 30m\):/);
  assert.match(reply.stdout, /job-6 .* \+1 -1\) \[DIFF\]\(file:\/\//);
  assert.ok(reply.stdout.indexOf('job-6') < reply.stdout.indexOf('job-5'));
  assert.ok(!reply.stdout.includes('job-1 ('), 'only oldest five are shown');
  assert.ok(!reply.stdout.includes('recent'), 'recent reply below age cutoff');
  assert.match(reply.stdout, /1 more/);
  assert.equal(reply.stderr, '');
  const bundled = run(process.execPath, [bundledHook, '--config', f.configFile], f.folder);
  assert.equal(bundled.status, 0, bundled.stdout + bundled.stderr);
  assert.match(bundled.stdout, /6 replies waiting/);
  const all = f.invoke('review');
  assert.equal(all.status, 0, all.stdout + all.stderr);
  assert.match(all.stdout, /diamond: 7 replies waiting:/);
  assert.match(all.stdout, /job-1/);
  assert.match(all.stdout, /recent/);
  assert.match(all.stdout, /\[DIFF\]\(file:\/\//);
  const stop = f.invoke('--event', 'Stop');
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  assert.equal(stop.stdout.trim().split('\n').length, 1);
  const message = JSON.parse(stop.stdout);
  assert.match(message.systemMessage, /6 replies waiting/);
  assert.match(message.systemMessage, /\[DIFF\]/);
});

test('decide skip records a reason; decide merge changes Git HEAD, and neither reply remains waiting', t => {
  const f = fixture(t);
  f.config.minAgeMinutes = 0;
  f.saveConfig();
  f.addReply('skip-this', 'skip\n', 70);
  const scan = f.invoke();
  assert.match(scan.stdout, /skip-this/);
  const noReason = f.invoke('decide', 'skip-this', 'skip');
  assert.equal(noReason.status, 1);
  assert.match(noReason.stdout, /reason required/);
  const skip = f.invoke('decide', 'skip-this', 'skip', 'Not applicable to this change');
  assert.equal(skip.status, 0, skip.stderr + skip.stdout);
  const decisions = JSON.parse(fs.readFileSync(path.join(f.inbox, '.diamond', 'decisions.json'), 'utf8'));
  assert.equal(decisions['skip-this'].decision, 'skip');
  assert.equal(decisions['skip-this'].reason, 'Not applicable to this change');
  assert.equal(f.invoke().stdout, '');
  f.addReply('merge-this', 'merged\n', 65);
  assert.match(f.invoke().stdout, /merge-this/);
  const before = git(f.repo, 'rev-parse', 'HEAD');
  const merge = f.invoke('decide', 'merge-this', 'merge', 'DIFF reviewed');
  assert.equal(merge.status, 0, merge.stderr + merge.stdout);
  assert.notEqual(git(f.repo, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(path.join(f.repo, 'site', 'index.txt'), 'utf8'), 'merged\n');
  assert.equal(f.invoke().stdout, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.inbox, '.diamond', 'decisions.json'), 'utf8'))
    ['merge-this'].reason, 'DIFF reviewed');
});

test('broken config and scanner failures print exactly one nonblocking diagnostic', t => {
  const f = fixture(t);
  fs.writeFileSync(f.configFile, '{bad json');
  const broken = f.invoke('--event', 'SessionStart');
  assert.equal(broken.status, 0);
  assert.equal(broken.stdout.trim(), 'diamond: invalid .diamond.json');
  assert.equal(broken.stderr, '');
  f.saveConfig();
  f.config.repos = ['./not-a-git-repo'];
  f.saveConfig();
  f.addReply('unmapped-job', 'bad\n', 120);
  const error = f.invoke();
  assert.equal(error.status, 0);
  assert.equal(error.stdout.trim(), 'diamond: scan unavailable');
  assert.equal(error.stderr, '');
});

test('scanner timeout is enforced before the nine-second hook deadline', t => {
  const f = fixture(t);
  const fake = path.join(f.folder, 'fake-tools');
  fs.mkdirSync(fake);
  fs.copyFileSync(hook, path.join(fake, 'diamond-hook.mjs'));
  fs.writeFileSync(path.join(fake, 'diamond.mjs'), 'setTimeout(() => {}, 20000);\n');
  const start = Date.now();
  const result = run(process.execPath, [
    path.join(fake, 'diamond-hook.mjs'), '--config', f.configFile
  ], f.folder, 9800);
  const elapsed = Date.now() - start;
  assert.equal(result.status, 0, `${elapsed}ms, ${result.error?.message}`);
  assert.ok(elapsed < 9500, `hook took ${elapsed}ms`);
  assert.equal(result.stdout.trim(), 'diamond: scan timed out');
  assert.equal(result.stderr, '');
});
