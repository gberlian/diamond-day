#!/usr/bin/env node
// Node 20+, no dependencies. Only a dedicated indented check: declaration can execute.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const INTERVAL_MS = 10 * 60_000;
export const STALE_MS = 24 * 60 * 60_000;
export const OUTPUT_BYTES = 2048;
export const HISTORY_LIMIT = 50;
const ownFile = fileURLToPath(import.meta.url);
// macOS temp folders are symlinks (/var -> /private/var): compare real paths.
const isMain = (arg) => { try { return fs.realpathSync(path.resolve(arg)) === fs.realpathSync(ownFile); } catch { return false; } };
const inside = (base, target) => {
  const rel = path.relative(base, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const safeRayName = s => typeof s === 'string' && /^[a-z][a-z0-9-]*$/.test(s) && s.length < 101;
const safeGoalId = s => typeof s === 'string' && /^[0-9]{1,12}$/.test(s);
const key = (ray, goal) => `${ray}/${goal}`;
const clip = s => Buffer.from(s, 'utf8').subarray(-OUTPUT_BYTES).toString('utf8');
const lastLine = s => s.trimEnd().split(/\r?\n/).at(-1)?.trim() || '(no output)';
const emptyHistory = () => ({ version: 1, attempts: {}, goals: {} });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class CheckError extends Error {
  constructor(status, message, retryAfterMs = 0) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function tokenizeArgv(input) {
  const out = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++;
    if (i === input.length) break;
    let word = '', quote = null, started = false;
    while (i < input.length) {
      const ch = input[i];
      if (!quote && /\s/.test(ch)) break;
      started = true;
      if (quote && ch === '\\' && input[i + 1] === quote) {
        word += quote; i += 2; continue;
      }
      if (!quote && (ch === '"' || ch === "'")) { quote = ch; i++; continue; }
      if (quote && ch === quote) { quote = null; i++; continue; }
      word += ch; i++;
    }
    if (quote || !started || /[\0\r\n]/.test(word)) return null;
    out.push(word);
  }
  return out;
}

export function parseCheckDeclaration(field) {
  // The caller extracts only literal, indented continuation lines of Check.
  const decls = field.split(/\r?\n/).map(s => /^\s+check:\s*(.*?)\s*$/.exec(s)?.[1])
    .filter(s => s !== undefined);
  if (decls.length !== 1) return null;
  const args = tokenizeArgv(decls[0]);
  if (!args?.length) return null;
  const kind = args.shift().toLowerCase();
  let timeoutMs = 60_000;
  if (args.at(-1)?.startsWith('timeout=')) {
    const t = /^timeout=(\d{1,3})s$/.exec(args.pop());
    const sec = Number(t?.[1]);
    if (!t || sec < 1 || sec > 300) return null;
    timeoutMs = sec * 1000;
  }
  if (args.some(s => s.startsWith('timeout='))) return null;
  if (kind === 'manual' && !args.length && timeoutMs === 60_000) return { kind, timeoutMs };
  if (kind === 'run' && args.length && args[0] && !args[0].startsWith('-') &&
      !args.some(s => /[\0\r\n]/.test(s))) return { kind, argv: args, timeoutMs };
  if (kind === 'http' && args.length === 3 && args[0].toUpperCase() === 'GET') {
    try {
      const url = new URL(args[1]);
      const expectedStatus = Number(args[2]);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
          !url.hash && /^\d{3}$/.test(args[2]) && expectedStatus >= 100 && expectedStatus <= 599)
        return { kind, url: url.href, expectedStatus, timeoutMs };
    } catch { /* invalid declaration remains inert */ }
  }
  if ((kind === 'file' || kind === 'file-age') && args.length === 3 && args[1] === 'younger') {
    const match = /^([1-9]\d*)([mhd])$/.exec(args[2]);
    const maxAgeMs = Number(match?.[1]) * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[match?.[2]] || 0);
    if (match && Number.isSafeInteger(maxAgeMs) && args[0] && !path.isAbsolute(args[0]) &&
        !path.win32.isAbsolute(args[0]) && !args[0].split(/[\\/]/).includes('..') &&
        !args[0].includes('\0'))
      return { kind: 'file', file: args[0], maxAgeMs, timeoutMs };
  }
  return null;
}

export function parseGoals(markdown) {
  const result = [];
  let current = null, field = null, count = 0, fence = null, inComment = false;
  for (const line of markdown.split(/\r?\n/)) {
    // Documentation examples and HTML comments must never become declarations.
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.trimStart().startsWith('<!--')) {
      inComment = !line.includes('-->');
      continue;
    }
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^##\s+(?:(\d+)[.)]\s+)?(.+?)\s*$/.exec(line);
    if (h) {
      count++;
      current = { id: h[1] || String(count), title: h[2], want: '', check: '',
        now: '', next: '', declarations: [] };
      result.push(current);
      field = null;
      continue;
    }
    if (!current) continue;
    const f = /^-\s+\*\*(Want|Check|Research|Now|Next):\*\*\s*(.*)$/.exec(line);
    if (f) {
      field = f[1].toLowerCase();
      if (field !== 'research') current[field] = f[2].trim();
      continue;
    }
    // Executable continuation has to be indented AND directly under the Check field.
    // A new bullet, heading, or unindented paragraph ends that field.
    if (/^\s{2,}\S/.test(line) && !/^\s*[-*]\s/.test(line)) {
      if (field === 'check') current.declarations.push(line);
    } else if (line.trim()) field = null;
  }
  return result.map(g => ({ ...g, spec: parseCheckDeclaration(g.declarations.join('\n')) }));
}

export function rayNames(root) {
  return fs.readFileSync(path.join(root, 'rays.txt'), 'utf8')
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    .filter(safeRayName);
}

export function getRayFolder(root, ray) {
  if (!safeRayName(ray)) throw new CheckError(400, 'invalid_ray');
  let parent, folder;
  try {
    parent = fs.realpathSync(root);
    folder = fs.realpathSync(path.join(root, ray));
  } catch { throw new CheckError(404, 'ray_not_found'); }
  if (!inside(parent, folder) || !fs.statSync(folder).isDirectory())
    throw new CheckError(400, 'ray_outside_root');
  return folder;
}

export function readRayGoals(root, ray) {
  const folder = getRayFolder(root, ray);
  let file;
  try {
    file = fs.realpathSync(path.join(folder, 'GOALS.md'));
  } catch { throw new CheckError(404, 'goals_not_found'); }
  if (!inside(folder, file) || !fs.statSync(file).isFile())
    throw new CheckError(400, 'goals_outside_ray');
  return parseGoals(fs.readFileSync(file, 'utf8'));
}

function boundedFile(folder, rel) {
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || rel.split(/[\\/]/).includes('..'))
    throw Error('file path escapes ray');
  const full = path.resolve(folder, rel);
  if (!inside(folder, full)) throw Error('file path escapes ray');
  const real = fs.realpathSync(full);
  if (!inside(folder, real)) throw Error('file path escapes ray');
  return real;
}

function record(status, source, output, started, extra = {}) {
  const text = clip(output);
  return { at: new Date().toISOString(), status, source, output: text,
    lastLine: lastLine(text), durationMs: Math.max(0, Date.now() - started), ...extra };
}

async function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', shell: false });
      killer.once('error', resolve);
      killer.once('close', resolve);
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { try { child.kill('SIGKILL'); } catch {} }
  }
  try { child.kill('SIGKILL'); } catch {}
}

export async function executeCheck(spec, folder, now = Date.now()) {
  const started = Date.now();
  if (spec.kind === 'manual') throw new CheckError(409, 'manual_check');
  if (spec.kind === 'file') {
    try {
      const stat = fs.statSync(boundedFile(fs.realpathSync(folder), spec.file));
      const age = now - stat.mtimeMs;
      const ok = stat.isFile() && age >= -2000 && age < spec.maxAgeMs;
      return record(ok ? 'pass' : 'fail', 'file',
        `${spec.file}: ${ok ? 'fresh' : 'too old'} (${Math.round(age / 1000)}s; max ${Math.round(spec.maxAgeMs / 1000)}s)`, started);
    } catch (error) { return record('fail', 'file', `file check failed: ${error.message}`, started); }
  }
  if (spec.kind === 'http') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), spec.timeoutMs);
    try {
      const response = await fetch(spec.url, { method: 'GET', signal: controller.signal,
        redirect: 'manual', cache: 'no-store' });
      let tail = Buffer.alloc(0);
      const reader = response.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            tail = Buffer.concat([tail, Buffer.from(value)]).subarray(-OUTPUT_BYTES);
          }
        } finally { reader.releaseLock(); }
      }
      const ok = response.status === spec.expectedStatus;
      return record(ok ? 'pass' : 'fail', 'http',
        `HTTP ${response.status} (expected ${spec.expectedStatus})${tail.length ? '\n' + tail.toString('utf8') : ''}`, started);
    } catch (error) {
      const timedOut = controller.signal.aborted;
      return record('fail', 'http', timedOut ? `timeout after ${spec.timeoutMs}ms` : `HTTP error: ${error.message}`,
        started, { timedOut });
    } finally { clearTimeout(timer); }
  }
  let output = Buffer.alloc(0), timedOut = false, spawnError = null, killing = false;
  let child;
  try {
    child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: folder, shell: false,
      windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return record('fail', 'run', `spawn failed: ${error.message}`, started, { exitCode: null });
  }
  const collect = chunk => {
    output = Buffer.concat([output, Buffer.from(chunk)]).subarray(-OUTPUT_BYTES);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const done = new Promise(resolve => {
    child.once('error', error => { spawnError = error.message; });
    child.once('close', code => resolve(code));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    killing = true;
    void killTree(child).finally(() => { killing = false; });
  }, spec.timeoutMs);
  try {
    const exitCode = await done;
    // taskkill may still be terminating descendants after the parent's close.
    while (killing) await sleep(10);
    const prefix = timedOut ? `timeout after ${spec.timeoutMs}ms` :
      spawnError ? `spawn failed: ${spawnError}` : `exit ${exitCode ?? 'signal'}`;
    return record(!timedOut && !spawnError && exitCode === 0 ? 'pass' : 'fail',
      'run', `${prefix}${output.length ? '\n' + output.toString('utf8') : ''}`, started,
      { exitCode, timedOut });
  } finally { clearTimeout(timer); }
}

export class CheckService {
  constructor(root, { clock = Date.now } = {}) {
    this.root = path.resolve(root);
    this.dataDir = path.join(this.root, '.arpe');
    this.historyPath = path.join(this.dataDir, 'checks-history.json');
    this.clock = clock;
    this.pending = new Map();
    this.active = 0;
    this.waiters = [];
  }
  read() {
    if (!fs.existsSync(this.historyPath)) return emptyHistory();
    const data = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
    if (data?.version !== 1 || !data.goals || !data.attempts ||
        typeof data.goals !== 'object' || typeof data.attempts !== 'object')
      throw Error('invalid checks-history.json');
    return data;
  }
  async mutate(fn) {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const lock = `${this.historyPath}.lock`;
    const began = Date.now();
    let fd;
    while (fd === undefined) {
      try { fd = fs.openSync(lock, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try { if (Date.now() - fs.statSync(lock).mtimeMs > 120_000) fs.rmSync(lock, { force: true }); }
        catch { /* another process has removed the lock */ }
        if (Date.now() - began > 5000) throw new CheckError(503, 'history_locked');
        await sleep(20);
      }
    }
    let tmp;
    try {
      const data = this.read();
      const result = fn(data);
      tmp = `${this.historyPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, this.historyPath);
      return result;
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
    }
  }
  goal(ray, id) {
    if (!safeGoalId(id)) throw new CheckError(400, 'invalid_goal');
    const goal = readRayGoals(this.root, ray).find(g => g.id === id);
    if (!goal) throw new CheckError(404, 'goal_not_found');
    return goal;
  }
  light(ray, goal, history = this.read()) {
    const latest = history.goals[key(ray, goal.id)]?.at(-1);
    const state = !goal.spec ? 'never' : !latest ?
      (goal.spec.kind === 'manual' ? 'manual' : 'never') :
      this.clock() - Date.parse(latest.at) >= STALE_MS ? 'stale' : latest.status;
    return { state, kind: goal.spec?.kind ?? null, at: latest?.at ?? null,
      lastLine: latest?.lastLine ?? null, output: latest?.output ?? null,
      durationMs: latest?.durationMs ?? null, running: this.pending.has(key(ray, goal.id)),
      runnable: Boolean(goal.spec && goal.spec.kind !== 'manual') };
  }
  board() {
    const history = this.read();
    return { rays: rayNames(this.root).map(ray => ({
      name: ray, goals: readRayGoals(this.root, ray).map(g => ({
        id: g.id, title: g.title, want: g.want, check: g.check,
        now: g.now, next: g.next, ...this.light(ray, g, history)
      }))
    })) };
  }
  async report(ray, id, status, note) {
    const goal = this.goal(ray, id);
    if (goal.spec?.kind !== 'manual') throw new CheckError(409, 'not_manual');
    if (!['pass', 'fail'].includes(status) || !note?.trim() || Buffer.byteLength(note) > OUTPUT_BYTES)
      throw new CheckError(400, 'invalid_report');
    const result = record(status, 'report', note, Date.now());
    await this.mutate(h => {
      const k = key(ray, id);
      h.goals[k] = [...(h.goals[k] || []), result].slice(-HISTORY_LIMIT);
    });
    return result;
  }
  async slot() {
    if (this.active >= 2) await new Promise(resolve => this.waiters.push(resolve));
    else this.active++;
    return () => {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    };
  }
  async run(ray, id, { force = false } = {}) {
    const goal = this.goal(ray, id);
    if (!goal.spec) throw new CheckError(404, 'check_not_declared');
    if (goal.spec.kind === 'manual') throw new CheckError(409, 'manual_check');
    const k = key(ray, id);
    if (this.pending.has(k)) return this.pending.get(k);
    const task = (async () => {
      const release = await this.slot();
      try {
        const now = this.clock();
        await this.mutate(h => {
          const prior = h.attempts[k] ?? 0;
          if (!force && now - prior < INTERVAL_MS)
            throw new CheckError(429, 'check_cooldown', INTERVAL_MS - (now - prior));
          h.attempts[k] = now;
        });
        const result = await executeCheck(goal.spec, getRayFolder(this.root, ray), now);
        await this.mutate(h => {
          h.goals[k] = [...(h.goals[k] || []), result].slice(-HISTORY_LIMIT);
        });
        return result;
      } finally { release(); }
    })();
    this.pending.set(k, task);
    void task.finally(() => this.pending.delete(k)).catch(() => {});
    return task;
  }
  schedule() {
    const h = this.read();
    for (const ray of rayNames(this.root)) {
      for (const goal of readRayGoals(this.root, ray)) {
        const k = key(ray, goal.id);
        if (!goal.spec || goal.spec.kind === 'manual' || this.pending.has(k)) continue;
        if (this.clock() - (h.attempts[k] || 0) >= INTERVAL_MS)
          void this.run(ray, goal.id).catch(() => {});
      }
    }
  }
}

export async function runAll(service, ray = null, goal = null, options = {}) {
  const selected = ray ? [ray] : rayNames(service.root);
  const results = [];
  for (const name of selected) {
    for (const item of readRayGoals(service.root, name)) {
      if (goal && item.id !== goal) continue;
      if (!item.spec || item.spec.kind === 'manual') {
        results.push({ ray: name, id: item.id, status: item.spec?.kind === 'manual' ? 'manual' : 'never' });
        continue;
      }
      const result = await service.run(name, item.id, options);
      results.push({ ray: name, id: item.id, status: result.status, output: result.lastLine });
    }
  }
  if (goal && !results.length) throw new CheckError(404, 'goal_not_found');
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf('--root');
  let root = process.env.DIAMOND_DAY_ROOT || path.dirname(path.dirname(ownFile));
  if (rootFlag >= 0) {
    if (!argv[rootFlag + 1]) throw new CheckError(400, 'missing_root');
    root = argv[rootFlag + 1]; argv.splice(rootFlag, 2);
  }
  const forceAt = argv.indexOf('--force');
  const force = forceAt >= 0;
  if (force) argv.splice(forceAt, 1);
  const service = new CheckService(root);
  const [command, ray, goal, ...more] = argv;
  if (command === 'status' && !ray) {
    const data = service.board();
    console.log('RAY                 GOAL  LIGHT   LAST RUN                  LAST OUTPUT');
    for (const r of data.rays) for (const g of r.goals)
      console.log(`${r.name.padEnd(19)} ${g.id.padEnd(5)} ${g.state.toUpperCase().padEnd(7)} ${(g.at || '—').padEnd(25)} ${g.lastLine || '—'}`);
  } else if (command === 'report' && ray && goal && ['pass', 'fail'].includes(more[0]) && more.length >= 2) {
    const result = await service.report(ray, goal, more[0], more.slice(1).join(' '));
    console.log(`${result.status.toUpperCase()} ${ray}/${goal}: ${result.lastLine}`);
  } else if (command === 'run' && more.length === 0 && (!goal || ray)) {
    const results = await runAll(service, ray || null, goal || null, { force });
    for (const r of results)
      console.log(`${r.status.toUpperCase().padEnd(6)} ${r.ray}/${r.id}${r.output ? `: ${r.output}` : ''}`);
    console.log(`Completed ${results.length} goal(s).`);
    // Failed checks are normal reported results; structural/runner errors exit nonzero.
  } else {
    console.error('Usage: node tools/checks.mjs run [ray] [goal] [--force] [--root PATH]');
    console.error('       node tools/checks.mjs report <ray> <goal> pass|fail "note" [--root PATH]');
    console.error('       node tools/checks.mjs status [--root PATH]');
    process.exitCode = 2;
  }
}
if (process.argv[1] && isMain(process.argv[1])) {
  main().catch(error => {
    console.error(`FAIL checks: ${error.message}`);
    process.exitCode = 1;
  });
}
