#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(join(root, 'index.html'))) {
  console.error('FAIL links: build first with node checks/build.mjs');
  process.exit(1);
}
function walk(folder) {
  return readdirSync(folder).flatMap(name => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk(root).filter(path => path.endsWith('.html'));
let count = 0;
const errors = [];
for (const page of files) {
  const html = readFileSync(page, 'utf8');
  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1];
    if (/^(?:https?:|mailto:|data:|\/\/)/i.test(raw)) continue;
    const [url, fragment] = raw.split('#', 2);
    const clean = decodeURIComponent(url.split('?')[0]);
    const target = clean ? resolve(dirname(page), clean) : page;
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || !existsSync(target)) {
      errors.push(`${page}: unresolved ${raw}`);
      continue;
    }
    if (fragment) {
      const content = readFileSync(target, 'utf8');
      const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\bid\\s*=\\s*["']${escaped}["']`).test(content)) {
        errors.push(`${page}: missing fragment ${raw}`);
        continue;
      }
    }
    count++;
  }
}
if (errors.length) {
  for (const error of errors) console.error(`FAIL links: ${error}`);
  process.exit(1);
}
console.log(`PASS links: ${count} local references verified across ${files.length} HTML pages`);
