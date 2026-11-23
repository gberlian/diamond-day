#!/usr/bin/env node
/**
 * diamond: review AI file replies on a branch based on a repository's current HEAD.
 * Node 20+, git, no packages. A temporary GIT_INDEX_FILE is the only index used.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MARK = 'diamond-reply:';
const VERSION = 'v1';
const MAX_FILES = 10000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_DIFF_LINES = 4000;
const META = /^(?:APPLY|NOTES|SUMMARY|VERIFICATION)(?:\.(?:md|txt))?$|^(?:CHANGES[\w.-]*|TEST_RESULTS[\w.-]*)\.(?:md|txt)$|^changes\.diff$|\.patch$/i;
const cache = new Map();
const slash = value => value.replace(/\\/g, '/');

function git(repo, args, { env = {}, input, allowFailure = false } = {}) {
  const result = spawnSync('git', [
    '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args
  ], {
    cwd: repo,
    env: { ...process.env, ...env },
    input,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 128 * 1024 * 1024
  });
  const out = result.stdout ?? Buffer.alloc(0);
  const err = (result.stderr ?? Buffer.alloc(0)).toString('utf8').trim();
  if ((result.error || result.status !== 0) && !allowFailure) {
    throw new Error(`git ${args[0]}: ${result.error?.message ?? err ?? 'failed'} (exit ${result.status})`);
  }
  return { code: result.status ?? 1, out, text: out.toString('utf8'), err };
}

function validJob(job) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(job) &&
    !job.includes('..') && !job.endsWith('.') && !job.endsWith('.lock');
}

function safePath(value) {
  const name = slash(value);
  const parts = name.split('/');
  if (!name || name.length > 2048 || name.startsWith('/') ||
      parts.some(part => !part || part === '.' || part === '..' ||
        part.toLowerCase() === '.git' || /[:\x00-\x1f]/.test(part) ||
        /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) {
    throw new Error(`Unsafe reply path: ${JSON.stringify(value)}`);
  }
  return name;
}
function meta(name) {
  return META.test(path.posix.basename(name));
}
function normalizeFiles(files) {
  // Bridge-format replies commonly put actual files below a "files/" directory.
  const names = [...files.keys()];
  if (names.length && names.every(name => name.startsWith('files/'))) {
    return new Map(names.map(name => [safePath(name.slice(6)), files.get(name)]));
  }
  return files;
}
function addFile(files, name, buffer, total) {
  name = safePath(name);
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`Reply file too large: ${name}`);
  if (files.has(name)) throw new Error(`Duplicate reply file: ${name}`);
  if (files.size >= MAX_FILES) throw new Error('Too many reply files');
  total.bytes += buffer.length;
  if (total.bytes > MAX_TOTAL_BYTES) throw new Error('Reply exceeds uncompressed size limit');
  files.set(name, buffer);
}
function readFolder(root) {
  const files = new Map(), total = { bytes: 0 }, pending = [{ dir: root, rel: '' }];
  while (pending.length) {
    const { dir, rel } = pending.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = safePath(rel ? `${rel}/${ent.name}` : ent.name);
      const abs = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) throw new Error(`Reply contains a symlink: ${name}`);
      if (ent.isDirectory()) pending.push({ dir: abs, rel: name });
      else if (ent.isFile()) {
        if (fs.statSync(abs).size > MAX_FILE_BYTES) throw new Error(`Reply file too large: ${name}`);
        addFile(files, name, fs.readFileSync(abs), total);
      } else throw new Error(`Unsupported reply entry: ${name}`);
    }
  }
  return normalizeFiles(files);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, idx) => {
  let crc = idx;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function need(buffer, offset, length, what) {
  if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`Truncated ZIP ${what}`);
  }
}

/** ZIP central-directory reader: stored and raw-deflate only; no external unzip. */
export function readZip(zipPath) {
  const data = fs.readFileSync(zipPath);
  if (data.length > MAX_TOTAL_BYTES) throw new Error('ZIP too large');
  let end = -1;
  const start = Math.max(0, data.length - 22 - 65535);
  for (let i = data.length - 22; i >= start; i--) {
    if (data.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP end-of-central-directory not found');
  const entries = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directoryOffset = data.readUInt32LE(end + 16);
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) ||
      data.readUInt16LE(end + 8) !== entries || entries === 0xffff ||
      directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('Multi-disk or ZIP64 archives are not supported');
  }
  if (entries > MAX_FILES * 2) throw new Error('Too many ZIP entries');
  need(data, directoryOffset, directorySize, 'directory');
  const files = new Map(), total = { bytes: 0 };
  let at = directoryOffset;
  for (let i = 0; i < entries; i++) {
    need(data, at, 46, 'central header');
    if (data.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid ZIP central header');
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const expectedCrc = data.readUInt32LE(at + 16);
    const compressed = data.readUInt32LE(at + 20);
    const uncompressed = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28);
    const extra = data.readUInt16LE(at + 30);
    const comment = data.readUInt16LE(at + 32);
    const externalMode = data.readUInt32LE(at + 38) >>> 16;
    const local = data.readUInt32LE(at + 42);
    need(data, at, 46 + nameLength + extra + comment, 'central entry');
    let name = data.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    name = slash(name.replace(/^\.\//, ''));
    at += 46 + nameLength + extra + comment;
    if (flags & 1 || (flags & 0x40)) throw new Error('Encrypted ZIP entries are not supported');
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression: ${method}`);
    if ((externalMode & 0xf000) === 0xa000) throw new Error('ZIP symlinks are not allowed');
    const isDirectory = name.endsWith('/');
    if (isDirectory) { safePath(name.slice(0, -1)); continue; }
    name = safePath(name);
    if (uncompressed > MAX_FILE_BYTES || compressed > MAX_TOTAL_BYTES) {
      throw new Error(`ZIP entry exceeds size limit: ${name}`);
    }
    need(data, local, 30, 'local header');
    if (data.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const localNameLength = data.readUInt16LE(local + 26);
    const localExtra = data.readUInt16LE(local + 28);
    const bodyAt = local + 30 + localNameLength + localExtra;
    need(data, bodyAt, compressed, 'entry data');
    const raw = data.subarray(bodyAt, bodyAt + compressed);
    const body = method === 0 ? Buffer.from(raw) :
      inflateRawSync(raw, { maxOutputLength: Math.min(MAX_FILE_BYTES, uncompressed) + 1 });
    if (body.length !== uncompressed || crc32(body) !== expectedCrc) {
      throw new Error(`Corrupt ZIP entry: ${name}`);
    }
    addFile(files, name, body, total);
  }
  if (at !== directoryOffset + directorySize) throw new Error('ZIP directory size mismatch');
  return normalizeFiles(files);
}

function repoInfo(repo) {
  const head = git(repo, ['rev-parse', 'HEAD']).text.trim();
  const cached = cache.get(repo);
  if (cached?.head === head) return cached;
  const byBase = new Map(), dirs = new Set(), dirPaths = new Set(), modes = new Map(), names = new Set();
  const raw = git(repo, ['ls-tree', '-r', '-z', 'HEAD']).out;
  for (const entry of raw.toString('utf8').split('\0')) {
    if (!entry) continue;
    const split = entry.indexOf('\t');
    if (split < 0) continue;
    const attr = entry.slice(0, split).split(' ');
    const file = entry.slice(split + 1);
    const name = path.posix.basename(file).toLowerCase();
    if (!byBase.has(name)) byBase.set(name, []);
    byBase.get(name).push(file);
    modes.set(file, attr[0]);
    names.add(file);
    const pieces = file.split('/');
    for (let j = 1; j < pieces.length; j++) {
      dirs.add(pieces.slice(0, j).join('/').toLowerCase());
      dirPaths.add(pieces.slice(0, j).join('/'));
    }
  }
  const value = { repo, head, byBase, dirs, dirPaths, modes, names };
  cache.set(repo, value);
  return value;
}

// Compare real long paths: on Windows a temp dir can arrive as an 8.3 short name (USER~1) while git reports the long one.
function real(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
function isInside(dir, candidate) {
  const rel = path.relative(real(dir), real(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
/** Match by full/suffix path overlap, considering up to two wrapper components. */
export function mapTarget(files, candidates, excludeDirs = []) {
  const scored = new Map();
  const content = [...files].filter(file => !meta(file));
  for (const repo of candidates) {
    const info = repoInfo(repo);
    for (const file of content) {
      const parts = file.split('/');
      for (let strip = 0; strip <= Math.min(2, parts.length - 1); strip++) {
        const relative = parts.slice(strip).join('/');
        for (const hit of info.byBase.get(path.posix.basename(relative).toLowerCase()) ?? []) {
          if (excludeDirs.some(dir => isInside(dir, path.resolve(repo, ...hit.split('/'))))) continue;
          const hitLow = hit.toLowerCase();
          const relLow = relative.toLowerCase();
          if (hitLow !== relLow && !hitLow.endsWith(`/${relLow}`)) continue;
          const prefix = hit.slice(0, hit.length - relative.length);
          const key = `${repo}\0${prefix}\0${strip}`;
          const entry = scored.get(key) ?? { repo, prefix, strip, score: 0, existing: 0 };
          entry.score += 1 + (strip === 0 ? 0.01 : 0) + (!prefix ? 0.01 : 0);
          entry.existing++;
          scored.set(key, entry);
        }
      }
    }
  }
  if (!scored.size) for (const repo of candidates) {
    const info = repoInfo(repo);
    for (const file of content) {
      const parts = file.split('/');
      for (let strip = 0; strip <= Math.min(2, parts.length - 2); strip++) {
        const dir = parts.slice(strip, -1).join('/').toLowerCase();
        for (const existing of info.dirPaths) {
          if (excludeDirs.some(dir => isInside(dir, path.resolve(repo, ...existing.split('/'))))) continue;
          const lower = existing.toLowerCase();
          if (lower !== dir && !lower.endsWith('/' + dir)) continue;
          const prefix = existing.slice(0, existing.length - dir.length);
          const key = `${repo}\0${prefix}\0${strip}`;
          const entry = scored.get(key) ?? { repo, prefix, strip, score: 0, existing: 0 };
          entry.score++;
          scored.set(key, entry);
        }
      }
    }
  }
  return [...scored.values()].sort((a, b) => b.score - a.score ||
    b.existing - a.existing || a.repo.localeCompare(b.repo))[0] ?? null;
}

function listRepos(specs) {
  const requested = [];
  for (const spec of specs) {
    for (const piece of spec.split(/[,;]/).map(item => item.trim()).filter(Boolean)) {
      const target = path.resolve(piece);
      if (fs.statSync(target).isFile()) {
        const sourceDir = path.dirname(target);
        for (const row of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
          const line = row.trim();
          if (line && !line.startsWith('#')) requested.push(path.resolve(sourceDir, line));
        }
      } else requested.push(target);
    }
  }
  const repos = new Set();
  function tryAdd(dir) {
    const result = git(dir, ['rev-parse', '--show-toplevel'], { allowFailure: true });
    if (result.code === 0) repos.add(fs.realpathSync(result.text.trim()));
  }
  for (const root of requested) {
    if (!fs.statSync(root).isDirectory()) throw new Error(`Not a repo directory: ${root}`);
    tryAdd(root);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '.git') {
        const child = path.join(root, entry.name);
        if (fs.existsSync(path.join(child, '.git'))) tryAdd(child);
      }
    }
  }
  if (!repos.size) throw new Error('No Git repositories found in --repos');
  return [...repos].sort();
}

export function eolLike(reply, existing) {
  if (reply.includes(0)) return reply;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(reply); }
  catch { return reply; }
  const lf = text.replace(/\r\n/g, '\n');
  const crlf = existing !== null && !existing.includes(0) && existing.includes('\r\n');
  return Buffer.from(crlf ? lf.replace(/\n/g, '\r\n') : lf);
}
function suitableMode(info, dest) {
  return info.modes.get(dest) === '100755' ? '100755' : '100644';
}

function generatedTip(repo, tip) {
  if (!tip) return false;
  const subject = git(repo, ['log', '-1', '--format=%s', tip]).text.trim();
  return subject.startsWith(`${MARK} ${VERSION} `);
}
function branchBase(repo, tip) {
  // For a human-edited branch, locate the original diamond-generated commit.
  const lines = git(repo, ['log', '-150', '--format=%H%x09%s', tip]).text.split('\n');
  const found = lines.find(line => line.includes(`\t${MARK} `));
  if (found) return git(repo, ['rev-parse', `${found.split('\t')[0]}^`]).text.trim();
  return git(repo, ['merge-base', 'HEAD', tip], { allowFailure: true }).text.trim();
}

function buildBranch(repo, job, files, target, dry) {
  const info = repoInfo(repo), head = info.head;
  const branch = `reply/${job}`, ref = `refs/heads/${branch}`;
  const hasher = createHash('sha256').update(target.prefix).update('\0').update(String(target.strip));
  for (const [name, body] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!meta(name)) hasher.update('\0').update(name).update('\0').update(body);
  }
  const digest = hasher.digest('hex').slice(0, 16);
  const found = git(repo, ['rev-parse', '--verify', '-q', ref], { allowFailure: true });
  const oldTip = found.code === 0 ? found.text.trim() : '';
  if (oldTip && !generatedTip(repo, oldTip)) {
    return { branch, base: branchBase(repo, oldTip), compare: oldTip,
      state: 'kept', note: 'Human commits on the reply branch were preserved.' };
  }
  const parent = oldTip
    ? git(repo, ['rev-parse', `${oldTip}^`], { allowFailure: true }).text.trim() : '';
  if (!dry && oldTip && parent === head &&
      git(repo, ['log', '-1', '--format=%s', oldTip]).text.includes(`digest=${digest}`)) {
    return { branch, base: head, compare: oldTip, state: 'fresh', note: '' };
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'diamond-index-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(temp, 'index') };
    if (dry) {
      const objects = path.join(temp, 'objects');
      fs.mkdirSync(objects);
      const objectPath = git(repo, ['rev-parse', '--git-path', 'objects']).text.trim();
      env.GIT_OBJECT_DIRECTORY = objects;
      env.GIT_ALTERNATE_OBJECT_DIRECTORIES = path.resolve(repo, objectPath);
    }
    git(repo, ['read-tree', head], { env });
    const seen = new Set();
    let applied = 0;
    for (const [name, body] of files) {
      if (meta(name)) continue;
      const parts = name.split('/');
      const dest = safePath(target.prefix + parts.slice(target.strip).join('/'));
      if (seen.has(dest)) throw new Error(`Reply paths collide at ${dest}`);
      seen.add(dest);
      const original = info.names.has(dest)
        ? git(repo, ['cat-file', 'blob', `${head}:${dest}`], { env }).out : null;
      const blob = git(repo, ['hash-object', '-w', '--no-filters', '--stdin'], {
        env, input: eolLike(body, original)
      }).text.trim();
      git(repo, ['update-index', '--add', '--cacheinfo', suitableMode(info, dest), blob, dest], { env });
      applied++;
    }
    if (!applied) throw new Error('Reply contains no applicable files (only metadata)');
    const tree = git(repo, ['write-tree'], { env }).text.trim();
    if (dry) return { branch, base: head, compare: tree, state: 'dry-run',
      note: '', stats: diffStats(repo, head, tree, env) };
    const commit = git(repo, ['commit-tree', tree, '-p', head, '-m',
      `${MARK} ${VERSION} digest=${digest} reply ${job} over ${head.slice(0, 8)}`], {
      env: {
        GIT_AUTHOR_NAME: 'diamond',
        GIT_AUTHOR_EMAIL: 'diamond@local',
        GIT_COMMITTER_NAME: 'diamond',
        GIT_COMMITTER_EMAIL: 'diamond@local'
      }
    }).text.trim();
    // The expected previous value prevents a concurrent human update being lost.
    git(repo, ['update-ref', ref, commit, oldTip || '0'.repeat(40)]);
    return { branch, base: head, compare: commit, state: 'built', note: '' };
  } finally {
    fs.rmSync(temp, { force: true, recursive: true });
  }
}

function diffStats(repo, base, compare, env = {}) {
  if (!base) throw new Error('Cannot find branch merge base');
  const num = git(repo, ['diff', '--no-renames', '--numstat', '-z', base, compare], { env }).out.toString('utf8');
  const files = num.split('\0').filter(Boolean).map(line => {
    const match = /^([0-9-]+)\t([0-9-]+)\t([\s\S]*)$/.exec(line);
    if (!match) throw new Error('Unexpected git numstat format');
    return { path: match[3], binary: match[1] === '-', added: +match[1] || 0, removed: +match[2] || 0 };
  });
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    stat: git(repo, ['diff', '--no-renames', '--stat', base, compare], { env }).text,
    patch: git(repo, ['diff', '--no-renames', '--no-ext-diff', '--no-textconv',
      '--no-color', '--unified=3', base, compare], { env }).text
  };
}

function markdownEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
}
function diffDocument(result, stats) {
  const out = [`# Reply ${result.job}`, '',
    `Target: \`${slash(result.repo)}\` (branch \`${result.branch}\`, base \`${result.base.slice(0, 12)}\`).`, '',
    `Files: ${stats.files.length}; +${stats.added} -${stats.removed}.`, '',
    `Review: \`git -C "${result.repo}" diff ${result.base} ${result.branch}\``, '',
    `Merge after review: \`git -C "${result.repo}" merge --no-ff ${result.branch}\``, '',
    `Or record a skip decision with \`node tools/diamond.mjs decide ${result.job} skip "reason"\`.`, ''];
  if (result.note) out.push(result.note, '');
  out.push('## Files', '', '| File | Added | Removed |', '|---|---:|---:|');
  for (const entry of stats.files) out.push(`| ${markdownEscape(entry.path)} | ${entry.binary ? 'binary' : entry.added} | ${entry.binary ? 'binary' : entry.removed} |`);
  out.push('', '## Git stat', '', '```text', stats.stat.trim() || '(no changes)', '```', '',
    '## Per-file unified diff', '');
  const sections = stats.patch.split(/^diff --git /m).slice(1);
  let used = 0;
  for (let i = 0; i < sections.length; i++) {
    const part = `diff --git ${sections[i]}`.trimEnd();
    const name = stats.files[i]?.path ?? '(unknown)';
    const lines = part.split('\n');
    out.push(`### \`${name.replace(/`/g, '\\`')}\``, '');
    if (stats.files[i]?.binary || lines.some(line => /^Binary files /.test(line))) {
      out.push('Binary file changed.', '');
      continue;
    }
    const available = Math.max(0, MAX_DIFF_LINES - used);
    const shown = lines.slice(0, available);
    used += shown.length;
    if (shown.length) out.push('````diff', ...shown, '````', '');
    if (shown.length < lines.length) out.push(`(${lines.length - shown.length} additional diff lines omitted; use the git diff command above.)`, '');
  }
  if (!sections.length) out.push('No differences from the selected base.', '');
  return out.join('\n') + '\n';
}

function inboxEntries(inbox) {
  const items = new Map();
  for (const ent of fs.readdirSync(inbox, { withFileTypes: true })) {
    let job, kind;
    if (ent.isDirectory() && ent.name !== '.diamond') {
      job = ent.name; kind = 'folder';
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.zip')) {
      job = ent.name.slice(0, -4); kind = 'zip';
    } else continue;
    if (!validJob(job)) throw new Error(`Invalid job name: ${job}`);
    if (items.has(job)) throw new Error(`Both a ZIP and folder (or duplicate) exist for ${job}`);
    const fullPath = path.join(inbox, ent.name);
    items.set(job, { job, kind, fullPath, modified: fs.statSync(fullPath).mtimeMs });
  }
  return [...items.values()].sort((a, b) => a.job.localeCompare(b.job));
}

function stateDir(inbox) { return path.join(inbox, '.diamond'); }
function readJson(filename, fallback) {
  if (!fs.existsSync(filename)) return fallback;
  const content = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error(`Invalid JSON store: ${filename}`);
  }
  return content;
}
function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, filename);
  } finally { fs.rmSync(temp, { force: true }); }
}
function writeIndex(filename, results) {
  const out = ['# Diamond reply index', '',
    'Each reply is a proposed change against the target repository. Decide merge or skip, with a reason.', '',
    '| Job | Repo | +/- | Files | Age | Decision |',
    '|---|---|---:|---:|---:|---|'];
  for (const r of results) {
    const link = r.diff ? `[${markdownEscape(r.job)}](${slash(path.relative(path.dirname(filename), r.diff)).split('/').map(encodeURIComponent).join('/')})` : markdownEscape(r.job);
    out.push(`| ${link} | ${markdownEscape(r.repo ? path.basename(r.repo) : 'unmapped')} | +${r.added ?? 0} / -${r.removed ?? 0} | ${r.files ?? 0} | ${(r.ageHours ?? 0).toFixed(1)}h | ${markdownEscape(r.decision || `pending (${r.state})`)} |`);
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, out.join('\n') + '\n');
}

/** A single scan; dry-run hashes into a disposable object directory only. */
export function scan({ inbox, repos, out, dry = false, maxAgeHours = 6 }) {
  inbox = path.resolve(inbox);
  if (!fs.statSync(inbox).isDirectory()) throw new Error('Inbox is not a directory');
  const candidates = listRepos(repos);
  const decisions = readJson(path.join(stateDir(inbox), 'decisions.json'), {});
  const previous = readJson(path.join(stateDir(inbox), 'state.json'), {});
  const results = [];
  const next = {};
  let errors = 0, stale = 0;
  for (const item of inboxEntries(inbox)) {
    const ageHours = Math.max(0, (Date.now() - item.modified) / 3600000);
    const decided = decisions[item.job];
    const result = { job: item.job, source: item.fullPath, ageHours,
      state: 'unmapped', repo: null, branch: null, base: null, files: 0,
      added: 0, removed: 0, diff: path.join(inbox, `${item.job}.DIFF.md`),
      decision: decided?.decision ?? null, note: '' };
    if (decided) {
      Object.assign(result, previous[item.job] ?? {}, {
        job: item.job, source: item.fullPath, ageHours,
        decision: `${decided.decision}${decided.reason ? `: ${decided.reason}` : ''}`
      });
      results.push(result);
      next[item.job] = result;
      console.log(`${item.job}: ${result.decision}`);
      continue;
    }
    if (ageHours > maxAgeHours) stale++;
    try {
      const files = item.kind === 'zip' ? readZip(item.fullPath) : readFolder(item.fullPath);
      const target = mapTarget([...files.keys()], candidates, [inbox]);
      if (!target) {
        result.state = 'unmapped';
        result.note = 'No path overlap or matching repository directory.';
        errors++;
      } else {
        const built = buildBranch(target.repo, item.job, files, target, dry);
        const stats = built.stats ?? diffStats(target.repo, built.base, built.compare);
        Object.assign(result, {
          repo: target.repo, branch: built.branch, base: built.base,
          state: built.state, files: stats.files.length,
          added: stats.added, removed: stats.removed, note: built.note
        });
        if (!dry) fs.writeFileSync(result.diff, diffDocument(result, stats));
      }
    } catch (error) {
      result.state = 'error';
      result.note = String(error.message ?? error);
      errors++;
    }
    results.push(result);
    next[item.job] = result;
    const summary = `${result.repo ? path.basename(result.repo) : '-'} ` +
      `${result.files}f +${result.added} -${result.removed}`;
    console.log(`${item.job}: ${result.state} ${summary}${result.note ? ` (${result.note})` : ''}`);
  }
  if (!dry) {
    writeJson(path.join(stateDir(inbox), 'state.json'), next);
    writeIndex(out ?? path.join(stateDir(inbox), 'index.md'), results);
  }
  console.log(`diamond: ${results.length} replies, ${errors} errors, ${stale} stale undecided${dry ? ' (dry run: no writes)' : ''}`);
  return errors ? 1 : stale ? 2 : 0;
}

function loadEntry(inbox, job) {
  if (!validJob(job)) throw new Error(`Invalid job: ${job}`);
  const entry = readJson(path.join(stateDir(inbox), 'state.json'), {})[job];
  if (!entry) throw new Error(`No scanned reply "${job}" in ${inbox}; run scan first`);
  return entry;
}
export function show(inbox, job) {
  const entry = loadEntry(inbox, job);
  const decision = readJson(path.join(stateDir(inbox), 'decisions.json'), {})[job];
  console.log(`Job: ${job}; state: ${entry.state}; decision: ${decision?.decision ?? 'pending'}`);
  if (decision?.reason) console.log(`Reason: ${decision.reason}`);
  if (fs.existsSync(entry.diff)) console.log(fs.readFileSync(entry.diff, 'utf8'));
  else console.log(entry.note || 'No DIFF page; rerun scan to create one.');
}

export function decide(inbox, job, action, reason = '') {
  inbox = path.resolve(inbox);
  const entry = loadEntry(inbox, job);
  if (!['merge', 'skip'].includes(action)) throw new Error('Decision must be merge or skip');
  reason = reason.trim();
  if (action === 'skip' && !reason) throw new Error('A skip reason is required');
  const filename = path.join(stateDir(inbox), 'decisions.json');
  const decisions = readJson(filename, {});
  if (decisions[job]) throw new Error(`Reply ${job} already decided: ${decisions[job].decision}`);
  if (action === 'merge') {
    if (!entry.repo || !entry.branch || !['built', 'fresh', 'kept'].includes(entry.state)) {
      throw new Error('This reply has no mergeable branch; run scan');
    }
    if (git(entry.repo, ['status', '--porcelain=v1', '--untracked-files=all']).out.length) {
      throw new Error('Working tree or index is dirty; commit, stash, or clean changes before merge');
    }
    const branchRef = `refs/heads/${entry.branch}`;
    const tip = git(entry.repo, ['rev-parse', '--verify', branchRef]).text.trim();
    if (entry.state !== 'kept' && !generatedTip(entry.repo, tip)) {
      throw new Error('Branch changed since scan; inspect and rerun scan before merging');
    }
    const head = git(entry.repo, ['rev-parse', 'HEAD']).text.trim();
    if (head !== entry.base) {
      throw new Error('Repository HEAD moved since scan; rerun scan before merging');
    }
    git(entry.repo, ['merge', '--no-ff', '--no-edit', entry.branch]);
  }
  decisions[job] = { decision: action, reason, decidedAt: new Date().toISOString(),
    repo: entry.repo, branch: entry.branch };
  writeJson(filename, decisions);
  console.log(`${job}: ${action}${reason ? ` (${reason})` : ''}`);
}

function usage() {
  return `Usage:
  node tools/diamond.mjs scan --inbox DIR --repos DIR[,DIR...] [--repos DIR] [--out index.md] [--dry-run] [--max-age-hours 6] [--watch SEC]
  node tools/diamond.mjs show JOB [--inbox DIR]
  node tools/diamond.mjs decide JOB merge|skip ["reason"] [--inbox DIR]

Default inbox for show/decide: ./inbox (or DIAMOND_INBOX).
--repos also accepts a text file with one repository path per line.`;
}
function parseOptions(argv) {
  const values = new Map(), args = [];
  const valued = new Set(['--inbox', '--repos', '--out', '--dry-run', '--watch', '--max-age-hours']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { args.push(token); continue; }
    if (!valued.has(token)) throw new Error(`Unknown option ${token}`);
    if (token === '--dry-run') { values.set(token, ['true']); continue; }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${token}`);
    values.set(token, [...(values.get(token) ?? []), argv[++i]]);
  }
  return { args, values, one: key => values.get(key)?.at(-1) };
}
async function main() {
  const { args, values, one } = parseOptions(process.argv.slice(2));
  const command = args[0];
  if (command === 'scan') {
    if (!one('--inbox') || !values.has('--repos') || args.length !== 1) throw new Error(usage());
    const maxAgeHours = Number(one('--max-age-hours') ?? 6);
    const watch = Number(one('--watch') ?? 0);
    if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 ||
        !Number.isFinite(watch) || watch < 0) throw new Error('Invalid age or watch seconds');
    const options = { inbox: one('--inbox'), repos: values.get('--repos'),
      out: one('--out') ? path.resolve(one('--out')) : undefined,
      dry: values.has('--dry-run'), maxAgeHours };
    if (!watch) return scan(options);
    let stop = false;
    process.on('SIGINT', () => { stop = true; });
    let code = 0;
    do {
      code = scan(options);
      if (stop) break;
      await new Promise(resolve => {
        const onSigint = () => { clearTimeout(timer); process.off('SIGINT', onSigint); resolve(); };
        process.once('SIGINT', onSigint);
        const timer = setTimeout(() => { process.off('SIGINT', onSigint); resolve(); }, watch * 1000);
      });
    } while (!stop);
    return code;
  }
  const inbox = path.resolve(one('--inbox') ?? process.env.DIAMOND_INBOX ?? 'inbox');
  if (command === 'show' && args.length === 2) { show(inbox, args[1]); return 0; }
  if (command === 'decide' && (args.length === 3 || args.length === 4)) {
    decide(inbox, args[1], args[2], args[3] ?? ''); return 0;
  }
  throw new Error(usage());
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`diamond: ${error.message}`);
    process.exitCode = 1;
  }
}
