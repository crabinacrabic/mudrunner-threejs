// Minimal Chrome DevTools driver (no npm deps; Node >= 22 for global WebSocket).
// Usage:
//   node cdp.mjs start [url]            launch headless Chrome on port 9333 (detached) and open url
//   node cdp.mjs eval "<js>"            evaluate JS in the page, print JSON result
//   node cdp.mjs shot out.png [w h]     screenshot (optionally resize viewport first)
//   node cdp.mjs key down|up|tap Code   dispatch a keyboard event (e.g. KeyW, Space, KeyC)
//   node cdp.mjs hold Code ms           key down, wait ms, key up
//   node cdp.mjs reload [url]           navigate again
//   node cdp.mjs stop                   kill Chrome
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = +(process.env.CDP_PORT || 9333);
const CHROME = fs.existsSync('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'mr_cdp_profile_' + PORT);
const DEFAULT_URL = 'http://127.0.0.1:8765/index.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return r.json();
}

async function pageTarget() {
  const t = (await targets()).find(x => x.type === 'page');
  if (!t) throw new Error('no page target');
  return t;
}

class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
      else this.events.push(m); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  close() { try { this.ws.close(); } catch {} }
}

async function connect() {
  const t = await pageTarget();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return new Session(ws);
}

async function evalJs(s, expr) {
  const r = await s.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

async function keyEvent(s, type, code) {
  // Dispatch DOM events directly: the game listens on window keydown/keyup using e.code.
  const expr = `window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { code: ${JSON.stringify(code)}, key: ${JSON.stringify(code)}, bubbles: true, cancelable: true })); true`;
  return evalJs(s, expr);
}

const [, , cmd, ...args] = process.argv;

if (cmd === 'start') {
  const url = args[0] || DEFAULT_URL;
  try { await targets(); console.log('already running'); }
  catch {
    const child = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
      '--window-size=1280,720', '--hide-scrollbars', '--mute-audio', '--no-first-run',
      '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required',
      url
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 60; i++) { try { await targets(); break; } catch { await sleep(250); } }
    console.log('started');
  }
} else if (cmd === 'stop') {
  try { execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*mr_cdp_profile_${PORT}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`); } catch {}
  console.log('stopped');
} else {
  const s = await connect();
  try {
    if (cmd === 'eval') {
      console.log(JSON.stringify(await evalJs(s, args.join(' ')), null, 1));
    } else if (cmd === 'shot') {
      const out = args[0] || 'shot.png';
      if (args[1] && args[2]) {
        await s.send('Emulation.setDeviceMetricsOverride', { width: +args[1], height: +args[2], deviceScaleFactor: 1, mobile: false });
      }
      const r = await s.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log('saved', out);
    } else if (cmd === 'key') {
      const [mode, code] = args;
      if (mode === 'tap') { await keyEvent(s, 'keydown', code); await sleep(80); await keyEvent(s, 'keyup', code); }
      else await keyEvent(s, mode === 'down' ? 'keydown' : 'keyup', code);
      console.log('ok');
    } else if (cmd === 'hold') {
      await keyEvent(s, 'keydown', args[0]); await sleep(+args[1] || 1000); await keyEvent(s, 'keyup', args[0]);
      console.log('ok');
    } else if (cmd === 'errs') {
      console.log(JSON.stringify(await evalJs(s, 'JSON.stringify(window.__errs || [])')));
    } else if (cmd === 'reload') {
      await s.send('Page.enable');
      await s.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];
        window.addEventListener('error', e => window.__errs.push('ERR ' + e.message + ' @' + (e.filename||'').split('/').pop() + ':' + e.lineno));
        window.addEventListener('unhandledrejection', e => window.__errs.push('REJ ' + (e.reason && e.reason.message || e.reason)));
        const _ce = console.error.bind(console), _cw = console.warn.bind(console);
        console.error = (...a) => { window.__errs.push('console.error ' + a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); _ce(...a); };
        console.warn = (...a) => { window.__errs.push('console.warn ' + a.map(x => String(x)).join(' ').slice(0, 300)); _cw(...a); };` });
      await s.send('Page.navigate', { url: args[0] || DEFAULT_URL });
      await sleep(+args[1] || 4000);
      console.log('reloaded');
    } else {
      console.log('unknown command');
    }
  } finally { s.close(); }
}
process.exit(0);
