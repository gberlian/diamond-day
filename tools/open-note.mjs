import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const arg = process.argv[2];
if (!arg || process.argv.length > 3) {
  console.error('Usage: node tools/open-note.mjs FILE.md (or board.html)');
  process.exit(2);
}
const file = path.resolve(arg);
if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
  console.error(`FAIL open: no such file: ${file}`);
  process.exit(1);
}
const program = process.platform === 'win32' ? 'explorer.exe'
  : process.platform === 'darwin' ? 'open' : 'xdg-open';
const result = cp.spawnSync(program, [file], { stdio: 'ignore', timeout: 5000, windowsHide: true });
if (result.error || result.status !== 0) {
  console.error(`Could not open automatically. Open this file in your Markdown or browser app:\n${file}`);
  process.exit(1);
}
console.log(`Opened ${file}`);
