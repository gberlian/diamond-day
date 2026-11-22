import * as fs from 'node:fs';
import * as path from 'node:path';

const file = process.argv[2];
if (!file || process.argv.length > 3) {
  console.error('Usage: node tools/check-goals.mjs PATH/GOALS.md');
  process.exit(2);
}
let text;
try { text = fs.readFileSync(path.resolve(file), 'utf8'); }
catch (err) { console.error(`FAIL goals: cannot read ${file}: ${err.message}`); process.exit(1); }

const lines = text.split(/\r?\n/);
const sections = [];
let current = null;
for (const line of lines) {
  const h = line.match(/^##\s+(?:(\d+)[.)]\s+)?(.+?)\s*$/);
  if (h) {
    current = { number: h[1], title: h[2].trim(), lines: [] };
    sections.push(current);
  } else if (current) current.lines.push(line);
}
if (!sections.length) {
  console.error(`FAIL goals: ${file} has no '## Goal title' headings`);
  process.exit(1);
}
let errors = 0;
const required = ['Want', 'Check', 'Now', 'Next'];
for (const [index, section] of sections.entries()) {
  const fields = new Map();
  for (let i = 0; i < section.lines.length; i++) {
    const m = section.lines[i].match(/^\s*(?:-\s*)?\*\*(Want|Check|Research|Now|Next):\*\*\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (fields.has(key)) {
      console.error(`FAIL goal ${index + 1}: duplicate ${m[1]}`);
      errors++;
    }
    const pieces = [m[2].trim()];
    // Accept an indented continuation but not the next field or list item.
    while (i + 1 < section.lines.length &&
           /^\s+\S/.test(section.lines[i + 1]) &&
           !/^\s*-\s*\*\*/.test(section.lines[i + 1]) &&
           !/^##/.test(section.lines[i + 1])) {
      pieces.push(section.lines[++i].trim());
    }
    fields.set(key, pieces.join(' ').trim());
  }
  console.log(`GOAL ${index + 1}: ${section.title}`);
  for (const key of required) {
    const value = fields.get(key.toLowerCase());
    if (!value || value === '-' || value === '—') {
      console.error(`FAIL goal ${index + 1} "${section.title}": missing ${key}`);
      errors++;
    }
  }
}
if (errors) {
  console.error(`FAIL goals: ${errors} error(s) in ${file}`);
  process.exit(1);
}
console.log(`PASS goals: ${sections.length} goal(s) in ${file}`);
