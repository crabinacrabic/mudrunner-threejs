import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_hud';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9334',
  `--user-data-dir=${profileDir}`,
  '--window-size=1280,720',
  '--hide-scrollbars',
  '--mute-audio',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  'http://127.0.0.1:8765/index.html'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(3000);
  const targetsRes = await fetch('http://127.0.0.1:9334/json');
  const targets = await targetsRes.json();
  const page = targets.find(t => t.type === 'page');
  console.log('Page target:', page ? page.title : 'NOT FOUND');
  if (!page) { chrome.kill(); return; }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleLogs = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push({ type: msg.params.type, text: msg.params.args.map(a => a.value || a.description).join(' ') });
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };
  await new Promise(r => ws.onopen = r);

  function send(method, params = {}) {
    return new Promise(res => {
      const callId = ++id;
      pending.set(callId, res);
      ws.send(JSON.stringify({ id: callId, method, params }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');

  // Wait 4s for assets to load & simulation to start
  await sleep(4000);

  // Take initial screenshot
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/Users/MSI/Desktop/My Projects/AFRICAN_IT_DRIVERS/tools/test_hud_gameplay.png', Buffer.from(shot1.data, 'base64'));
  console.log('Saved test_hud_gameplay.png');

  // Press TAB to open vehicle dock
  await send('Runtime.evaluate', { expression: 'window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", key: "Tab", bubbles: true }))' });
  await sleep(600);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/Users/MSI/Desktop/My Projects/AFRICAN_IT_DRIVERS/tools/test_dock_tab.png', Buffer.from(shot2.data, 'base64'));
  console.log('Saved test_dock_tab.png');

  // Press Escape to close dock, press O to open HUD modal
  await send('Runtime.evaluate', { expression: 'window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }))' });
  await sleep(300);
  await send('Runtime.evaluate', { expression: 'window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyO", key: "o", bubbles: true }))' });
  await sleep(600);
  const shot3 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:/Users/MSI/Desktop/My Projects/AFRICAN_IT_DRIVERS/tools/test_hud_modal.png', Buffer.from(shot3.data, 'base64'));
  console.log('Saved test_hud_modal.png');

  console.log('Console logs summary (total ' + consoleLogs.length + '):');
  consoleLogs.filter(l => l.type === 'error').forEach(l => console.log('  [ERROR]', l.text));
  console.log('Browser test completed successfully!');

  ws.close();
  chrome.kill();
  process.exit(0);
}

run().catch(e => { console.error('Error:', e); chrome.kill(); process.exit(1); });
