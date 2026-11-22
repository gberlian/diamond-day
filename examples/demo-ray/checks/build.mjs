#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'site');
const out = join(root, 'dist');
const names = ['index.html', 'about.html', 'assets/style.css'];

for (const name of names) {
  const path = join(src, name);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing input: ${name}`);
}
for (const name of names.filter(n => n.endsWith('.html'))) {
  const html = readFileSync(join(src, name), 'utf8');
  if (!/<!doctype html>/i.test(html) || !/<title>[^<]+<\/title>/i.test(html)) {
    throw new Error(`Invalid HTML document: ${name}`);
  }
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
const outputs = readdirSync(out).sort();
if (!outputs.includes('index.html') || !outputs.includes('about.html')) {
  throw new Error('Build output is incomplete');
}
console.log('PASS build: 2 HTML pages and 1 stylesheet copied to dist/');
