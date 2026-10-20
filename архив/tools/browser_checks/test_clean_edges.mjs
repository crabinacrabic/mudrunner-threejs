import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9352',
  '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_cdp_edges_test',
  '--window-size=1600,950',
  '--hide-scrollbars',
  '--mute-audio',
  'http://127.0.0.1:8765/tools/road_editor.html'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await sleep(3500);
  const targets = await (await fetch('http://127.0.0.1:9352/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(res => { const callId = ++id; pending.set(callId, res); ws.send(JSON.stringify({ id: callId, method, params })); });
  const evaluate = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result ? r.result.value : null);

  await sleep(3500);

  // Set zoom to 0.85 (zoomed out full view) and center pan
  await evaluate(`
    (() => {
      zoom = 0.82;
      panX = 0;
      panY = 0;
      requestAnimationFrame(render);
    })()
  `);
  await sleep(1500);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/shot_editor_edges_fixed.png', Buffer.from(shot.data, 'base64'));
  const artPath = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_editor_edges_fixed.png';
  fs.writeFileSync(artPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved shot_editor_edges_fixed.png to tools and artifact dir!');

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
