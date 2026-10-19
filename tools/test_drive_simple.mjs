import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9340',
  '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_cdp_drive_simple',
  '--window-size=1280,720',
  '--mute-audio',
  'http://127.0.0.1:8765/index.html'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await sleep(2500);
  const targets = await (await fetch('http://127.0.0.1:9340/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => {
    const cid = ++id; pend.set(cid, r); ws.send(JSON.stringify({ id: cid, method, params }));
  });
  const evalJS = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true });

  await evalJS('switchMap("zaire")');
  await sleep(3500);
  const before = (await evalJS('({ x: truckPos.x, z: truckPos.z, speed: truckSpeed })')).result.value;
  console.log('Pos before drive:', before);

  // Drive forward
  await evalJS('keys.forward = true');
  await sleep(3500);
  const during = (await evalJS('({ x: truckPos.x, z: truckPos.z, speed: Math.round(truckSpeed * 3.6), passedCount: passedCount })')).result.value;
  console.log('Pos while driving:', during);

  await evalJS('keys.forward = false');
  await sleep(1000);

  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('screenshot_zaire_cruising.png', Buffer.from(r.data, 'base64'));
  fs.copyFileSync('screenshot_zaire_cruising.png', 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/screenshot_zaire_cruising.png');
  console.log('Screenshot saved!');
  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
