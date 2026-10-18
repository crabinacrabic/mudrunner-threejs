import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_closeups';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9336',
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
  const targetsRes = await fetch('http://127.0.0.1:9336/json');
  const targets = await targetsRes.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) { chrome.kill(); return; }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
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

  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : null;
  }

  async function takeScreenshot(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const p = `C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/${name}.png`;
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    console.log(`Saved ${name}.png`);
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(4000);

  // Close-up Subaru
  await evaluate('switchVehicle(10)');
  await sleep(1000);
  await evaluate(`
    cameraPos.set(truckPos.x - 3.8, truckPos.y + 1.6, truckPos.z + 3.8);
    cameraTarget.set(truckPos.x, truckPos.y + 0.7, truckPos.z);
    camera.position.copy(cameraPos);
    camera.lookAt(cameraTarget);
  `);
  await sleep(300);
  await takeScreenshot('shot_subaru_closeup');

  // Close-up Land Cruiser
  await evaluate('switchVehicle(11)');
  await sleep(1000);
  await evaluate(`
    cameraPos.set(truckPos.x - 4.5, truckPos.y + 1.8, truckPos.z + 3.5);
    cameraTarget.set(truckPos.x, truckPos.y + 0.8, truckPos.z);
    camera.position.copy(cameraPos);
    camera.lookAt(cameraTarget);
  `);
  await sleep(300);
  await takeScreenshot('shot_landcruiser_closeup');

  ws.close();
  chrome.kill();
  console.log('Closeups finished successfully!');
}

run();
