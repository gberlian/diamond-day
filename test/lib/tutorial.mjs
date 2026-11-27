// Node 22.13+, no npm dependencies. All installation changes are child-local.
const LOOPBACK = [127, 0, 0, 1].join('.');
// Published output must not carry this machine's folders: temp and home paths become placeholders.
const redact = (t) => {
  let out = String(t);
  for (const [p, r] of [[process.env.TEMP, '<temp>'], [process.env.TMP, '<temp>'], [process.env.LOCALAPPDATA, '<local-app-data>'], [process.env.USERPROFILE, '<home>'], [process.env.HOME, '<home>']])
    if (p && p.length > 3) for (const v of [p, p.replaceAll('\\', '/'), p.replaceAll('\\', '\\\\')]) out = out.split(v).join(r);
  return out.replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/gi, '<home>');
};
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const repo = fileURLToPath(new URL('../../', import.meta.url)), out = path.join(repo, 'docs/tutorial');
const steps = JSON.parse(fs.readFileSync(path.join(out, 'STEPS.json'), 'utf8'));
const win = process.platform === 'win32', shell = win ? 'powershell' : 'bash';
const sleep = ms => new Promise(r => setTimeout(r, ms)), log = [];
function say(s) { log.push(s); console.log(s); }
function find(candidates) { for (const c of candidates.filter(Boolean)) {
    if (path.isAbsolute(c)) {
        if (fs.existsSync(c))
            return c;
        continue;
    }
    const r = spawnSync(win ? 'where.exe' : 'which', [c], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0)
        return r.stdout.trim().split(/\r?\n/)[0];
} }
async function until(label, fn, timeout = 20000) { const end = Date.now() + timeout; let error; do {
    try {
        const v = await fn();
        if (v)
            return v;
    }
    catch (e) {
        error = e;
    }
    await sleep(150);
} while (Date.now() < end); throw Error(`Timed out: ${label}${error ? ' — ' + error.message : ''}`); }
async function freePort() { const s = createServer(); await new Promise((r, j) => { s.once('error', j); s.listen(0, 'localhost', r); }); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function run(command, cwd, env) { say('$ ' + command); const r = spawnSync(win ? 'pwsh' : 'bash', win ? ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${command}; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`] : ['-c', command], { cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }); const output = (r.stdout || '') + (r.stderr || ''); if (output)
    say(output.trimEnd()); say(`exit ${r.status ?? 'unavailable'}`); if (r.status !== 0 || r.error)
    throw Error(`Command failed: ${command}; exit ${r.status ?? 'unavailable'}; ${r.error?.message || ''}`); return { command, output }; }
class Browser {
    constructor(chrome, profile, env) { Object.assign(this, { chrome, profile, env }); this.pending = new Map(); this.id = 0; this.stderr = ''; }
    async start() { this.child = spawn(this.chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${this.profile}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { env: this.env, stdio: ['ignore','ignore','pipe'], windowsHide: true }); this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-12000); }); this.child.on('error', e => { this.error = e; }); const port = await until('Chrome DevTools port', () => { if (this.error)
        throw this.error; if (this.child.exitCode !== null || this.child.signalCode !== null)
        throw Error(`Chrome exited ${this.child.exitCode ?? this.child.signalCode}`); return Number(fs.readFileSync(path.join(this.profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); }); const tab = await until('Chrome page target', async () => (await (await fetch(`http://${LOOPBACK}:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()).find(t => t.type === 'page')); this.ws = new WebSocket(tab.webSocketDebuggerUrl); this.ws.addEventListener('message', e => { const m = JSON.parse(e.data), p = this.pending.get(m.id); if (p) {
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    } }); await new Promise((r, j) => { const t = setTimeout(() => j(Error('CDP connection timeout')), 10000); this.ws.addEventListener('open', () => { clearTimeout(t); r(); }, { once: true }); this.ws.addEventListener('error', () => { clearTimeout(t); j(Error('CDP connection failed')); }, { once: true }); }); }
    call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.id, timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000); this.pending.set(id, { resolve, reject, timer }); try {
        this.ws.send(JSON.stringify({ id, method, params }));
    }
    catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
    } }); }
    async eval(expression) { const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails)
        throw Error('Page evaluation failed: ' + expression); return r.result.value; }
    async navigate(url, width, height) { await this.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); const r = await this.call('Page.navigate', { url }); if (r.errorText)
        throw Error(r.errorText); await until('page ' + url, () => this.eval(`location.href===${JSON.stringify(url)} && document.readyState==='complete'`)); }
    visible(selector, text = '') { return this.eval(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && e.innerText.includes(${JSON.stringify(text)}))`); }
    async click(selector) { await until('click target ' + selector, () => this.eval(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`)); await this.eval(`document.querySelector(${JSON.stringify(selector)}).click()`); }
    async shot(file) { await this.eval('document.fonts.ready.then(()=>true)'); const { data } = await this.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(file, Buffer.from(data, 'base64')); }
    async close() { if (this.ws?.readyState === WebSocket.OPEN) {
        try {
            await Promise.race([this.call('Browser.close'), sleep(800)]);
        }
        catch { }
        this.ws.close();
    } for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error('Browser closed'));
    } this.pending.clear(); const c = this.child; if (c?.pid && c.exitCode === null && c.signalCode === null) {
        const done = new Promise(r => c.once('exit', r));
        c.kill();
        await Promise.race([done, sleep(2500)]);
        if (c.exitCode === null && c.signalCode === null) {
            c.kill('SIGKILL');
            await Promise.race([done, sleep(2500)]);
        }
    } }
}
function fence(s, lang = '') { const ticks = '`'.repeat(Math.max(3, ...Array.from(s.matchAll(/`+/g), m => m[0].length + 1))); return `${ticks}${lang}\n${s.trimEnd()}\n${ticks}`; }
function markdown(records, runtime, video) { const lines = ['# Getting started with ARPE — recorded tutorial', '', `Recorded on ${process.platform} (${shell}), ${new Date().toISOString()}; runtime: ${runtime}.`, '', 'This is an actual disposable installation. Follow [Guide sections 2–4](../GUIDE.md) for the full explanation. The paths and free port in the output belong to this run; use your own printed address. On Linux open a new login shell or run `source ~/.profile`; on Windows open a new terminal. The recorder suppresses persistent Windows PATH changes. No AI account or publishing service is used. This records the manual Guide path, choosing local approval; it omits the optional intentionally failing starter check, external publication, and live agent launch (which requires separate sign-in).', '', ...(runtime === 'node' ? ['This sample explicitly used the documented offline fallback (`RAY_RUNTIME=node`, Node 22.13+), not the default Bun installation. With Bun, the replay commands use `bun` instead.', ''] : []), video ? '[Watch the captioned MP4 walkthrough](tutorial.mp4) (desktop and phone frames side by side).' : 'Video skipped: ffmpeg was not found.', '', '## Re-record', '', fence('bash test/record-tutorial.sh', 'bash'), '', fence('pwsh -NoProfile -File test/record-tutorial.ps1', 'powershell'), '', 'Requires Node 22.13+, installed Chrome/Edge/Chromium (or `CHROME_PATH`), and optionally ffmpeg with H.264 and drawtext support. Bun is the default installer runtime.', '', '## Recorded steps', '']; for (const [i, r] of records.entries()) {
    lines.push(`### ${i + 1}. ${r.step.title}`, '', r.step.show, '');
    if (r.cwd)
        lines.push(`From the installed project folder (normally ~/rays/arpe-demo). Recorded working directory: \`${r.cwd}\`.`, '');
    for (const c of r.commands)
        lines.push(fence(c.command, shell), '', 'Actual terminal output (exit 0):', '', fence(c.output || '(no output)'), '');
    if (r.action)
        lines.push(`Browser action: ${r.action}. No terminal command was entered for this step.`, '');
    lines.push(`Verified: HTTP 200; visible board state${r.step.waitFor.done !== undefined ? `; ${r.step.waitFor.done} done cards` : ''}${r.step.action === 'answer' ? '; persisted local answer' : ''}.`, '', `![${r.step.title} — desktop](frames/${r.name}-1280.png)`, '', `![${r.step.title} — phone](frames/${r.name}-390.png)`, '');
} lines.push('The installer stopped the board and purged the disposable project root. The temporary home was deleted. See [run log](run.log).', ''); return lines.join('\n'); }
function makeVideo(ffmpeg, stage, records, env) {
    if (!ffmpeg) {
        say('SKIP video: ffmpeg not found');
        return false;
    }
    const fonts = win ? [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'arial.ttf'), path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'segoeui.ttf')] : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'];
    const font = fonts.find(f => fs.existsSync(f));
    if (font)
        fs.copyFileSync(font, path.join(stage, 'caption.ttf'));
    const segments = [];
    function ff(args) { const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd: stage, env, encoding: 'utf8', timeout: 120000, windowsHide: true }); if (r.status !== 0 || r.error)
        throw Error(`ffmpeg ${args.join(' ')}; exit ${r.status ?? 'unavailable'}; ${r.stderr || r.error}`); }
    for (const [i, r] of records.entries()) {
        const name = `segment-${i}.mp4`;
        segments.push(name);
        fs.writeFileSync(path.join(stage, 'caption.txt'), `${i + 1}. ${r.step.title}\nDesktop (1280 px)                             Phone (390 px)`);
        const filter = `[0:v]scale=960:600,setsar=1[a];[1:v]scale=276:600,setsar=1[b];[a][b]hstack,pad=1280:720:22:20:color=black,drawtext=${font ? 'fontfile=caption.ttf:' : ''}textfile=caption.txt:expansion=none:fontcolor=white:fontsize=24:line_spacing=7:x=24:y=636`;
        ff(['-loop', '1', '-framerate', '10', '-i', `frames/${r.name}-1280.png`, '-loop', '1', '-framerate', '10', '-i', `frames/${r.name}-390.png`, '-filter_complex_threads', '1', '-filter_complex', filter, '-t', '4', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', name]);
    }
    fs.writeFileSync(path.join(stage, 'concat.txt'), segments.map(s => `file '${s}'`).join('\n') + '\n');
    ff(['-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', 'tutorial.mp4']);
    say(`PASS video: ${records.length} captioned segments, ${records.length * 4}s`);
    return true;
}
async function main() {
    if (typeof WebSocket !== 'function')
        throw Error('A runtime with WebSocket is required (Node 22+ or Bun)');
    const chrome = find([process.env.CHROME_PATH, process.env.CHROME, ...(win ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(p => [path.join(p, 'Google/Chrome/Application/chrome.exe'), path.join(p, 'Microsoft/Edge/Application/msedge.exe')]) : []), 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'msedge', 'microsoft-edge']);
    if (!chrome)
        throw Error('Chrome/Edge/Chromium not found; set CHROME_PATH');
    const ffmpeg = find(['ffmpeg']);
    if (!ffmpeg) say('Video will be skipped: ffmpeg not found');
    const oldPath = process.env.PATH, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arpe-tutorial-')), home = path.join(tmp, 'home with spaces'), temp = path.join(home, 'tmp'), stage = path.join(home, 'recording');
    const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: temp, TMP: temp, TEMP: temp, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data'), XDG_STATE_HOME: path.join(home, 'state'), APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'), RAY_TEST_NO_USER_PATH: '1', RAY_NO_BROWSER: '1', RAY_RESTORE_MANUAL: '1', CHROME_PATH: chrome, CHROME: chrome };
    for (const k of ['RAYS_ROOT', 'BUN_INSTALL', 'BUN_INSTALL_CACHE_DIR', 'BASH_ENV', 'ENV', 'RAY_BROWSER_BIN', 'RAY_WINDOW_SCRIPT', 'RAY_AUTOHOTKEY_BIN', 'RAY_AGENT_BIN', 'RAY_TERMINAL_BIN', 'RAY_TERMINAL_ARGS', 'NODE_OPTIONS', 'NODE_COMPILE_CACHE'])
        delete env[k];
    if (win) {
        for (const key of Object.keys(env))
            if (key.toLowerCase() === 'path' && key !== 'PATH')
                delete env[key];
        env.PATH = oldPath;
        env.HOMEDRIVE = path.parse(home).root.slice(0, 2);
        env.HOMEPATH = home.slice(2);
    }
    const install = win ? 'pwsh -NoProfile -ExecutionPolicy Bypass -File ./install.ps1' : 'bash install.sh', uninstall = install + (win ? ' -Uninstall -Purge' : ' --uninstall --purge'), managed = path.join(home, '.arpe'), bin = path.join(managed, 'bin');
    let board, browser, attempted = false, failure, records = [], video = false, runtime, cli, rt, ts, stepName = 'setup';
    try {
        for (const dir of [home, temp, stage, path.join(stage, 'frames'), env.APPDATA, env.LOCALAPPDATA])
            fs.mkdirSync(dir, { recursive: true });
        env.RAY_BOARD_PORT = String(await freePort());
        board = `http://localhost:${env.RAY_BOARD_PORT}`;
        say(`Recorder: ${process.platform}; Node ${process.versions.node}; browser ${chrome}; port ${env.RAY_BOARD_PORT}`);
        for (const [i, step] of steps.entries()) {
            stepName = `${i + 1}. ${step.title}`;
            say('\nSTEP ' + stepName);
            const record = { step, name: `${String(i + 1).padStart(2, '0')}-${step.id}`, commands: [] };
            const cwd = step.cwd === 'example' ? path.join(home, 'rays', 'arpe-demo') : repo;
            if (step.cwd)
                record.cwd = cwd;
            if (step.id === 'install') {
                attempted = true;
                record.commands.push(run(step.command[shell], repo, env));
                const settings = JSON.parse(fs.readFileSync(path.join(managed, 'settings.json'), 'utf8'));
                assert.equal(settings.root, path.join(home, 'rays'));
                assert.equal(settings.port, Number(env.RAY_BOARD_PORT));
                const candidates = fs.readdirSync(bin, { withFileTypes: true }).filter(e => e.isFile() && !/^(bun|node)(\.cmd|\.exe)?$/i.test(e.name) && (!win || /\.cmd$/i.test(e.name)));
                // The kit installs `arpe` and keeps `ray` as an alias; record with `arpe` when present.
                const preferred = candidates.filter(e => /^arpe(\.cmd)?$/i.test(e.name));
                if (preferred.length) candidates.splice(0, candidates.length, ...preferred);
                assert.equal(candidates.length, 1, 'Expected exactly one installed CLI launcher');
                cli = candidates[0].name.replace(/\.cmd$/i, '');
                assert.match(cli, /^[a-zA-Z0-9_-]+$/);
                env.PATH = bin + path.delimiter + oldPath;
                const check = win ? run(`(Get-Command ${cli} -ErrorAction Stop).Source`, repo, env) : run(`source ~/.profile && command -v ${cli}`, repo, { ...env, PATH: oldPath });
                const normalize = p => win ? path.resolve(p).toLowerCase() : path.resolve(p);
                assert.equal(normalize(check.output.trim()), normalize(path.join(bin, candidates[0].name))); 
                record.commands.push(check);
                runtime = settings.runtimeArgs.length ? 'node' : 'bun';
                const q = win ? `& '${settings.runtime.replaceAll("'", "''")}'` : "'" + settings.runtime.replaceAll("'", "'\\''") + "'";
                const found = find([runtime]);
                rt = (runtime === 'bun' && fs.existsSync(path.join(bin, win ? 'bun.cmd' : 'bun'))) || (found && path.resolve(found) === path.resolve(settings.runtime)) ? runtime : q;
                ts = [rt, ...settings.runtimeArgs].join(' ');
                say(`PASS installed CLI: ${cli}; runtime: ${runtime}`);
                browser = new Browser(chrome, path.join(home, 'browser-profile'), env);
            }
            else {
                for (const c of step.command || []) {
                    const command = c.replace(/\$\{(cli|runtime|tsRuntime)\}/g, (_, k) => ({ cli, runtime: rt, tsRuntime: ts })[k]);
                    record.commands.push(run(command, cwd, env));
                }
                for (const expected of step.outputIncludes || [])
                    assert.ok(record.commands.map(c => c.output).join('\n').includes(expected), 'Missing terminal output: ' + expected);
            }
            const wait = step.waitFor, url = board + wait.url;
            await until('HTTP 200 ' + url, async () => { const r = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' }); assert.equal(r.status, 200); return true; });
            say('PASS HTTP 200 ' + url);
            if (step.id === 'install') await browser.start();
            for (const [width, height] of [[1280, 800], [390, 844]]) {
                await browser.navigate(url, width, height);
                if (step.action) {
                    await browser.click('.running .card');
                    record.action = 'click the running card';
                    if (step.action === 'answer') {
                        record.action = 'open the owner-review card, select “Looks right, keep it local”, click Answer';
                        if (width === 1280) {
                            await browser.click('#card-decision-form input[value=local]');
                            await browser.click('#card-decision-form button[type=submit]');
                        }
                        const answer = path.join(home, 'rays/arpe-demo/decisions/countdown-review.answer.json');
                        await until('persisted local answer', () => JSON.parse(fs.readFileSync(answer, 'utf8')).key === 'local');
                    }
                }
                await until('visible ' + wait.text, () => browser.visible(wait.selector || 'body', wait.text || ''));
                if (wait.done !== undefined)
                    await until(`${wait.done} done cards`, () => browser.eval(`document.querySelectorAll('.done .card').length===${wait.done}`));
                if (step.action === 'review')
                    await browser.eval(`Promise.all([...document.querySelectorAll('#card-decision-form img')].map(i=>{i.loading='eager';return i.decode();})).then(()=>true)`);
                await browser.shot(path.join(stage, 'frames', `${record.name}-${width}.png`));
                say(`PASS HTTP 200 + visible state; frame ${record.name}-${width}.png`);
            }
            records.push(record);
        }
        stepName = 'video';
        video = makeVideo(ffmpeg, stage, records, env);
    }
    catch (e) {
        failure = e;
        say(`FAIL ${stepName}: ${e.message}`);
        if (browser?.stderr) say('Browser stderr (tail):\n' + browser.stderr.trimEnd());
    }
    finally {
        try {
            await browser?.close();
        }
        catch (e) {
            failure ||= e;
            say('FAIL browser cleanup: ' + e.message);
        }
        try {
            if (attempted && fs.existsSync(managed)) {
                try {
                    run(uninstall, repo, env);
                }
                catch (e) {
                    failure ||= e;
                    say('FAIL installer cleanup: ' + e.message);
                    const f = path.join(managed, 'settings.json');
                    if (fs.existsSync(f)) {
                        const settings = JSON.parse(fs.readFileSync(f, 'utf8'));
                        try {
                            const h = await fetch(board + '/health', { headers: { authorization: 'Bearer ' + settings.token }, signal: AbortSignal.timeout(2000) });
                            if (h.ok && (await h.json()).owned === true) {
                                const stop = await fetch(board + '/shutdown', { method: 'POST', headers: { authorization: 'Bearer ' + settings.token }, signal: AbortSignal.timeout(2000) });
                                assert.ok(stop.ok, 'Authenticated shutdown failed');
                                say('PASS fallback authenticated board shutdown');
                            }
                        }
                        catch (err) {
                            say('Fallback shutdown: ' + err.message);
                        }
                    }
                }
            }
            if (attempted && board) {
                await until('board stopped', async () => { try {
                    await fetch(board + '/health', { signal: AbortSignal.timeout(1000) });
                    return false;
                }
                catch {
                    return true;
                } });
                say('PASS cleanup: board stopped');
            }
        }
        catch (e) {
            failure ||= e;
            say('FAIL uninstall: ' + e.message);
        }
        try {
            assert.equal(process.env.PATH, oldPath);
            say('PASS parent process PATH unchanged (Windows user PATH writes disabled)');
            if (!failure) {
                fs.writeFileSync(path.join(stage, 'README.md'), redact(markdown(records, runtime, video)));
                fs.rmSync(path.join(out, 'frames'), { recursive: true, force: true });
                fs.cpSync(path.join(stage, 'frames'), path.join(out, 'frames'), { recursive: true });
                fs.copyFileSync(path.join(stage, 'README.md'), path.join(out, 'README.md'));
                if (video)
                    fs.copyFileSync(path.join(stage, 'tutorial.mp4'), path.join(out, 'tutorial.mp4'));
                else
                    fs.rmSync(path.join(out, 'tutorial.mp4'), { force: true });
            }
        }
        catch (e) {
            failure ||= e;
            say('FAIL publish: ' + e.message);
        }
        try {
            fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
            say('PASS temporary home deleted');
        }
        catch (e) {
            failure ||= e;
            say('FAIL temporary home cleanup: ' + e.message);
        }
        say(failure ? 'FAIL tutorial recorder' : `PASS tutorial recorder: ${records.length} steps, ${records.length * 2} frames`);
        fs.writeFileSync(path.join(out, failure ? 'failed-run.log' : 'run.log'), redact(log.join('\n')) + '\n');
        if (!failure)
            fs.rmSync(path.join(out, 'failed-run.log'), { force: true });
        else if (!fs.existsSync(path.join(out, 'README.md')) || fs.readFileSync(path.join(out, 'README.md'), 'utf8').startsWith('# Getting started with ARPE — recording incomplete'))
            fs.writeFileSync(path.join(out, 'README.md'), ['# Getting started with ARPE — recording incomplete', '', 'The recorder did not complete on this machine. No tutorial screenshots or video are claimed.', '', `Failed stage: ${stepName}.`, '', fence(log.join('\n')), '', 'See [failed-run.log](failed-run.log) and [STEPS.json](STEPS.json). Re-run with Node 22.13+ and an installed Chrome, Edge or Chromium that permits the local board.', '', fence('bash test/record-tutorial.sh', 'bash'), '', fence('pwsh -NoProfile -File test/record-tutorial.ps1', 'powershell'), ''].join('\n'));
    }
    if (failure)
        throw failure;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
