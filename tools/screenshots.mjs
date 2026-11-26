#!/usr/bin/env node
// Real local-Chromium CDP screenshots without Puppeteer, npm, or third-party modules.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBoardServer } from './board.mjs';
import { CheckService, runAll } from './checks.mjs';

const LOCALHOST_IP = [127, 0, 0, 1].join('.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function findBrowser() {
  const env = process.env;
  const pf = env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = env.LOCALAPPDATA || '';
  const candidates = [
    env.CHROME_PATH, env.CHROME_BIN, env.EDGE_PATH,
    ...(process.platform === 'win32' ? [
      path.join(pf, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
      path.join(local, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf86, 'Microsoft/Edge/Application/msedge.exe')
    ] : process.platform === 'darwin' ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ] : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable',
      'microsoft-edge', '/usr/bin/chromium'])
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { timeout: 4000,
      windowsHide: true, encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw Error('No local Chrome/Edge/Chromium found. Install a browser or set CHROME_PATH to its executable.');
}

// Cold CI runners start Chrome slowly (Ubuntu runner took over 20 s on 23 Nov).
async function waitChrome(profile, child) {
  const activePort = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 750; i++) {
    if (fs.existsSync(activePort)) {
      const [port] = fs.readFileSync(activePort, 'utf8').split(/\r?\n/);
      if (/^\d+$/.test(port)) return Number(port);
    }
    if (child.exitCode !== null) throw Error(`Browser exited before DevTools became ready (exit ${child.exitCode})`);
    await sleep(80);
  }
  throw Error('Chrome/Edge DevTools did not start within 60s. Try CHROME_PATH with a desktop browser.');
}
const getJSON = url => new Promise((resolve, reject) => {
  http.get(url, res => {
    let result = '';
    res.on('data', data => result += data);
    res.once('end', () => {
      try { resolve(JSON.parse(result)); } catch (error) { reject(error); }
    });
  }).once('error', reject);
});

// A fresh tab answers sooner than the start-up tab on slow CI machines (Windows runners timed out on Page.enable).
const newTarget = port => new Promise((resolve, reject) => {
  const req = http.request({ host: LOCALHOST_IP, port, method: 'PUT', path: '/json/new?about:blank' }, res => {
    let result = '';
    res.on('data', data => result += data);
    res.once('end', () => { try { resolve(JSON.parse(result)); } catch (error) { reject(error); } });
  });
  req.once('error', reject);
  req.end();
});

class CDP {
  constructor(socket, head) {
    this.socket = socket; this.buffer = head || Buffer.alloc(0);
    this.pending = new Map(); this.nextId = 1; this.fragments = [];
    socket.on('data', data => { this.buffer = Buffer.concat([this.buffer, data]); this.consume(); });
    socket.on('error', error => this.rejectAll(error));
    socket.on('close', () => this.rejectAll(Error('CDP socket closed')));
    this.consume();
  }
  rejectAll(error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
  writeFrame(opcode, payload) {
    payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const header = payload.length <= 125 ? 2 : payload.length <= 65535 ? 4 : 10;
    const frame = Buffer.alloc(header + 4 + payload.length);
    frame[0] = 0x80 | opcode;
    if (header === 2) frame[1] = 0x80 | payload.length;
    else if (header === 4) {
      frame[1] = 0x80 | 126; frame.writeUInt16BE(payload.length, 2);
    } else {
      frame[1] = 0x80 | 127; frame.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const mask = crypto.randomBytes(4);
    mask.copy(frame, header);
    for (let i = 0; i < payload.length; i++) frame[header + 4 + i] = payload[i] ^ mask[i % 4];
    this.socket.write(frame);
  }
  consume() {
    for (;;) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0], second = this.buffer[1];
      let size = second & 127, pos = 2;
      if (size === 126) {
        if (this.buffer.length < 4) return;
        size = this.buffer.readUInt16BE(2); pos = 4;
      } else if (size === 127) {
        if (this.buffer.length < 10) return;
        const large = this.buffer.readBigUInt64BE(2);
        if (large > 40_000_000n) throw Error('CDP frame too large');
        size = Number(large); pos = 10;
      }
      const masked = (second & 0x80) !== 0;
      if (this.buffer.length < pos + (masked ? 4 : 0) + size) return;
      let body;
      if (masked) {
        const mask = this.buffer.subarray(pos, pos + 4); pos += 4;
        body = Buffer.from(this.buffer.subarray(pos, pos + size));
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
      } else body = this.buffer.subarray(pos, pos + size);
      this.buffer = this.buffer.subarray(pos + size);
      const op = first & 15;
      if (op === 0x9) { this.writeFrame(0xA, body); continue; }
      if (op === 0x8) { this.socket.end(); return; }
      if (op === 0x1 || op === 0x0) {
        this.fragments.push(body);
        if (!(first & 0x80)) continue;
        try {
          const item = JSON.parse(Buffer.concat(this.fragments).toString('utf8'));
          if (item.id && this.pending.has(item.id)) {
            const { resolve, reject } = this.pending.get(item.id);
            this.pending.delete(item.id);
            item.error ? reject(Error(item.error.message)) : resolve(item.result);
          }
        } catch (error) { this.rejectAll(error); }
        this.fragments = [];
      }
    }
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(Error(`CDP timeout: ${method}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: data => { clearTimeout(timer); resolve(data); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.writeFrame(1, JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.destroy(); }
  static connect(uri) {
    return new Promise((resolve, reject) => {
      const url = new URL(uri);
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({ hostname: url.hostname, port: url.port,
        path: url.pathname + url.search, method: 'GET',
        headers: { connection: 'Upgrade', upgrade: 'websocket',
          'sec-websocket-version': '13', 'sec-websocket-key': key } });
      req.once('upgrade', (response, socket, head) => {
        const expected = crypto.createHash('sha1').update(key +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        if (response.headers['sec-websocket-accept'] !== expected) {
          socket.destroy(); reject(Error('Invalid CDP websocket upgrade')); return;
        }
        resolve(new CDP(socket, head));
      });
      req.once('response', res => reject(Error(`CDP websocket returned HTTP ${res.statusCode}`)));
      req.once('error', reject);
      req.end();
    });
  }
}

async function capture(cdp, url, filename) {
  await cdp.call('Page.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
  });
  const navigation = await cdp.call('Page.navigate', { url });
  if (navigation.errorText) {
    // Some CI/sandbox browser policies prohibit browser-initiated loopback navigation.
    // Retrieve the actual board response through Node and render those exact bytes in
    // the browser instead. No colors or results are synthesized.
    if (navigation.errorText !== 'net::ERR_BLOCKED_BY_ADMINISTRATOR')
      throw Error(`Browser navigation failed: ${navigation.errorText}`);
    const response = await fetch(url);
    if (!response.ok) throw Error(`Board HTTP request failed: ${response.status}`);
    const html = await response.text();
    await cdp.call('Page.navigate', { url: 'about:blank' });
    const tree = await cdp.call('Page.getFrameTree');
    await cdp.call('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html });
    console.log('INFO screenshot: browser policy blocked loopback navigation; rendered real board HTML from its local HTTP response');
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const result = await cdp.call('Runtime.evaluate',
      { expression: 'document.readyState === "complete" && document.querySelectorAll(".goal").length >= 3', returnByValue: true });
    if (result?.result?.value) { ready = true; break; }
    await sleep(80);
  }
  if (!ready) {
    const diag = await cdp.call('Runtime.evaluate', {
      expression: 'JSON.stringify({url:location.href,title:document.title,ready:document.readyState,count:document.querySelectorAll(".goal").length,body:document.body?.innerText?.slice(0,350)})',
      returnByValue: true
    });
    throw Error(`Board did not finish rendering in the browser: ${diag?.result?.value || JSON.stringify(diag)}`);
  }
  const metrics = await cdp.call('Page.getLayoutMetrics');
  const height = Math.min(4000, Math.ceil(metrics.cssContentSize?.height || 1000) + 28);
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: Math.max(1000, height), deviceScaleFactor: 1, mobile: false
  });
  const shot = await cdp.call('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, fromSurface: true
  });
  const png = Buffer.from(shot.data, 'base64');
  if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    throw Error('CDP did not return a PNG');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, png);
  console.log(`PASS screenshot: ${path.relative(repo, filename)} (${png.length} bytes)`);
}

async function main() {
  const browserPath = findBrowser(); // Fail before changing docs if no browser installed.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diamond-day-screenshots-'));
  const root = path.join(tmp, 'demo-root');
  const profile = path.join(tmp, 'chrome-profile');
  const out = path.join(repo, 'docs', 'img');
  let chrome, board, cdp;
  try {
    const command = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const args = process.platform === 'win32' ?
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'install.ps1'), '-Legacy', '-Root', root, '-Demo'] :
      [path.join(repo, 'install.sh'), '--legacy', '--root', root, '--demo'];
    const installed = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    if (installed.status !== 0)
      throw Error(`Demo install failed: ${installed.stderr || installed.stdout || installed.error}`);
    const service = new CheckService(root);
    const checked = await runAll(service);
    if (!checked.some(x => x.ray === 'demo' && x.status === 'pass') ||
        !checked.some(x => x.ray === 'demo' && x.status === 'fail') ||
        !checked.some(x => x.ray === 'demo' && x.status === 'manual'))
      throw Error('Expected demo PASS, FAIL and MANUAL states were not produced');
    board = await createBoardServer(root, { port: 0, schedule: false });
    const flags = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--no-default-browser-check', '--disable-dev-shm-usage',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--window-size=1440,1000', 'about:blank'
    ];
    if (process.platform === 'linux' && process.getuid?.() === 0) flags.unshift('--no-sandbox');
    chrome = spawn(browserPath, flags, { stdio: 'ignore', windowsHide: true });
    const port = await waitChrome(profile, chrome);
    for (let attempt = 1; ; attempt++) {
      let target = await newTarget(port).catch(() => null);
      if (!target?.webSocketDebuggerUrl) {
        const pages = await getJSON(`http://${LOCALHOST_IP}:${port}/json/list`);
        target = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
      }
      if (!target) throw Error('Browser did not expose a CDP page target');
      cdp = await CDP.connect(target.webSocketDebuggerUrl);
      try { await cdp.call('Page.enable'); break; } catch (error) {
        cdp.close?.();
        if (attempt >= 3) throw error;
        await sleep(2000);
      }
    }
    await capture(cdp, board.url, path.join(out, 'board-failing.png'));
    const index = path.join(root, 'demo/site/index.html');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('href="missing.html"', 'href="about.html#purpose"'));
    const build = await service.run('demo', '1', { force: true });
    const links = await service.run('demo', '2', { force: true });
    if (build.status !== 'pass' || links.status !== 'pass')
      throw Error(`Broken link repair failed: ${build.status}, ${links.lastLine}`);
    const goalsPath = path.join(root, 'demo/GOALS.md');
    fs.writeFileSync(goalsPath, fs.readFileSync(goalsPath, 'utf8').replace(
      '- **Now:** An intentionally broken link in site/index.html makes this check FAIL.',
      '- **Now:** The link was repaired and the latest verification passed.'));
    await capture(cdp, board.url, path.join(out, 'board-repaired.png'));
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await Promise.race([
        new Promise(resolve => chrome.once('exit', resolve)),
        sleep(3000)
      ]);
    }
    if (board) await new Promise(resolve => board.server.close(resolve));
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        break;
      } catch (error) {
        if (attempt === 9) console.error(`WARN temporary screenshot cleanup: ${error.message}`);
        await sleep(250);
      }
    }
  }
}
main().catch(e => { console.error(`FAIL screenshots: ${e.message}`); process.exitCode = 1; });
