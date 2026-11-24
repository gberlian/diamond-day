#!/usr/bin/env node
/**
 * Diamond's Claude Code hook and command runner. Node 20+, no dependencies.
 * Bundled unchanged with tools/diamond.mjs in the independently installed plugin.
 * The scan is a child process so even blocking synchronous git calls are bounded.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCAN_TIMEOUT_MS = 7500; // shorter than the 9-second Claude Code hook limit
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const diamond = path.join(scriptDir, 'diamond.mjs');

function fail(message, event) {
  const line = `diamond: ${message}`;
  console.log(event === 'Stop' ? JSON.stringify({ systemMessage: line }) : line);
}

function getConfig(configFile) {
  const base = path.dirname(configFile);
  const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('config');
  if (typeof data.inbox !== 'string' || !data.inbox.trim()) throw Error('inbox');
  const rawRepos = typeof data.repos === 'string' ? [data.repos] : data.repos;
  if (!Array.isArray(rawRepos) || rawRepos.length === 0 ||
      !rawRepos.every(r => typeof r === 'string' && r.trim())) throw Error('repos');
  const repos = rawRepos.flatMap(r => r.split(/[,;]/).map(s => s.trim()).filter(Boolean))
    .map(r => path.resolve(base, r));
  const maxAgeHours = data.maxAgeHours === undefined ? 6 : data.maxAgeHours;
  const minAgeMinutes = data.minAgeMinutes === undefined ? 0 : data.minAgeMinutes;
  if (typeof maxAgeHours !== 'number' || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0 ||
      typeof minAgeMinutes !== 'number' || !Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
    throw Error('age');
  }
  return { inbox: path.resolve(base, data.inbox), repos, maxAgeHours, minAgeMinutes };
}

function execDiamond(args, timeout = SCAN_TIMEOUT_MS) {
  return spawnSync(process.execPath, [diamond, ...args], {
    encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true
  });
}

function runScan(config) {
  const args = ['scan', '--inbox', config.inbox, '--max-age-hours', String(config.maxAgeHours)];
  for (const repo of config.repos) args.push('--repos', repo);
  const result = execDiamond(args);
  if (result.error?.code === 'ETIMEDOUT') throw Error('scan timed out');
  if (result.error || (result.status !== 0 && result.status !== 2)) throw Error('scan failed');
  const file = path.join(config.inbox, '.diamond', 'state.json');
  const states = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!states || typeof states !== 'object' || Array.isArray(states)) throw Error('state unavailable');
  return Object.values(states)
    .filter(r => r && !r.decision && ['built', 'fresh', 'kept'].includes(r.state))
    .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0) || a.job.localeCompare(b.job));
}

function report(rows, cutoff, all = false) {
  const selected = rows.filter(r => all || (r.ageHours ?? 0) * 60 >= cutoff);
  if (!selected.length) return all ? 'diamond: no replies waiting' : '';
  const shown = all ? selected : selected.slice(0, 5);
  const out = [`diamond: ${selected.length} replies waiting${all ? '' : ` (older than ${cutoff}m)`}:`];
  for (const r of shown) {
    const age = Math.floor((r.ageHours ?? 0) * 60);
    const uri = pathToFileURL(r.diff).href;
    out.push(`- ${r.job} (${age}m, +${r.added} -${r.removed}) [DIFF](${uri})`);
  }
  if (shown.length !== selected.length) out.push(`- ... ${selected.length - shown.length} more; run /diamond:diamond-review`);
  out.push('Review DIFF before deciding: /diamond:diamond-merge or /diamond:diamond-skip (reason required).');
  return out.join('\n');
}

function parseArgs(argv) {
  let configFile;
  let event;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && i + 1 < argv.length) configFile = argv[++i];
    else if (argv[i] === '--event' && i + 1 < argv.length) event = argv[++i];
    else rest.push(argv[i]);
  }
  return { configFile: path.resolve(configFile ?? path.join(
    process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.diamond.json'
  )), event, rest };
}

function main() {
  const { configFile, event, rest } = parseArgs(process.argv.slice(2));
  const action = rest[0] ?? 'hook';
  if (event && !['SessionStart', 'Stop'].includes(event)) {
    fail('invalid event', event);
    return;
  }
  if (!fs.existsSync(configFile)) {
    if (action !== 'hook') { fail('missing .diamond.json', event); process.exitCode = 1; }
    return; // An unconfigured project is silent during lifecycle hooks.
  }
  let config;
  try {
    config = getConfig(configFile);
  } catch {
    fail('invalid .diamond.json', event);
    if (action !== 'hook') process.exitCode = 1;
    return;
  }
  if (action === 'decide') {
    const [job, decision, ...reasonWords] = rest.slice(1);
    const reason = reasonWords.join(' ').trim();
    if (!job || !['merge', 'skip'].includes(decision) || !reason) {
      fail('usage: decide JOB merge|skip REASON (reason required)', event);
      process.exitCode = 1;
      return;
    }
    const done = execDiamond(['decide', job, decision, reason, '--inbox', config.inbox], 60000);
    if (done.stdout) process.stdout.write(done.stdout);
    if (done.stderr) process.stderr.write(done.stderr);
    process.exitCode = done.status === 0 ? 0 : 1;
    return;
  }
  if (!['hook', 'review'].includes(action)) {
    fail('usage: [review|decide JOB merge|skip REASON]', event);
    process.exitCode = 1;
    return;
  }
  try {
    const rows = runScan(config);
    const message = report(rows, config.minAgeMinutes, action === 'review');
    if (message) console.log(event === 'Stop'
      ? JSON.stringify({ systemMessage: message }) : message);
  } catch (error) {
    const kind = error.message === 'scan timed out' ? 'scan timed out' : 'scan unavailable';
    fail(kind, event);
    if (action === 'review') process.exitCode = 1;
  }
}

main();
