#!/usr/bin/env node
// Real local-Chromium CDP screenshots without Puppeteer, npm, or third-party modules.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

async function main() {
  const base = new URL(process.argv[2] || 'http://localhost:5195');
  if (base.hostname !== 'localhost' || base.protocol !== 'http:') throw Error('Use the installed local board URL');
  const out = path.join(repo, 'docs', 'img');
  const check = await fetch(new URL('/api/board/project/demo/card?result=1&step=0&view=check',base)).then(r=>r.json());
  if (!['pass','fail'].includes(check.last?.state)) throw Error('The installed demo must have a real check result');
  const browser = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'arpe-managed-capture-'));
  let child, cdp;
  try {
    const flags = ['--headless=new','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1280,800','about:blank'];
    if (process.platform==='linux' && process.getuid?.()===0) flags.unshift('--no-sandbox');
    child=spawn(browser,flags,{stdio:'ignore',windowsHide:true});
    const port=await waitChrome(profile,child);
    const target=await newTarget(port);
    cdp=await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    const evaluate=async expression=>(await cdp.call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
    const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await sleep(100);}throw Error('UI did not render: '+expression);};
    const navigate=async route=>{const r=await cdp.call('Page.navigate',{url:new URL(route,base).href});if(r.errorText)throw Error(r.errorText);};
    const pending=[];
    const capture=async name=>{await sleep(500);const shot=await cdp.call('Page.captureScreenshot',{format:'png',fromSurface:true});const png=Buffer.from(shot.data,'base64');if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG');pending.push([name,png]);};
    await navigate('/board'); await wait('document.querySelector(".prow .name")?.textContent?.includes("demo")'); await capture('kit-home.png');
    await navigate('/board/p/demo'); await wait('!!document.querySelector("#rpm .card")'); await capture('kit-project.png');
    await evaluate('document.querySelector("#rpm .card").click()'); await wait('[...document.querySelectorAll("[data-card-tab]")].some(b=>b.textContent==="Check")');
    await evaluate('[...document.querySelectorAll("[data-card-tab]")].find(b=>b.textContent==="Check").click()');
    await wait('!!document.querySelector(".check-state.pass,.check-state.fail")'); await capture('kit-card-check.png');
    fs.mkdirSync(out,{recursive:true});for(const [name,png] of pending){fs.writeFileSync(path.join(out,name),png);console.log('PASS screenshot: docs/img/'+name+' ('+png.length+' bytes)');}
  } finally {cdp?.close();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000)]);}fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
main().catch(e=>{console.error('FAIL managed screenshots: '+e.message);process.exitCode=1;});
