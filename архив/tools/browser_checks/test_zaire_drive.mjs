import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_zaire_drive';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9338',
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
  try {
    await sleep(3000);
    const targetsRes = await fetch('http://127.0.0.1:9338/json');
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

    async function takeScreenshot(filename) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      if (r && r.data) {
        const buf = Buffer.from(r.data, 'base64');
        fs.writeFileSync(filename, buf);
        console.log(`Saved screenshot to ${filename} (${buf.length} bytes)`);
      }
    }

    await send('Runtime.enable');
    await send('Page.enable');

    await sleep(3500);

    // Switch to Zaire map
    await evaluate("switchMap('zaire')");
    await sleep(3500);

    // Simulate holding 'KeyW' (driving forward)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
    await sleep(2500); // drive forward 2.5s

    // Turn slightly towards village
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' });
    await sleep(800);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
    await sleep(2000);

    // Release throttle
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
    await sleep(1000);

    const pos = await evaluate(`({
      x: truckPos.x,
      y: truckPos.y,
      z: truckPos.z,
      speed: Math.round(truckSpeed * 3.6),
      gear: currentGear,
      passedCount: passedCount
    })`);
    console.log('Driving status:', pos);

    const shotDrive = 'screenshot_zaire_driving.png';
    await takeScreenshot(shotDrive);
    const artifactPath = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/screenshot_zaire_driving.png';
    fs.copyFileSync(shotDrive, artifactPath);

    // Switch camera to cinematic side view
    await evaluate(`
      cameraMode = 0;
      camOffset.set(7.5, 3.2, 10.0);
    `);
    await sleep(500);
    const shotClose = 'screenshot_zaire_landcruiser_close.png';
    await takeScreenshot(shotClose);
    const artifactPathClose = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/screenshot_zaire_landcruiser_close.png';
    fs.copyFileSync(shotClose, artifactPathClose);

    ws.close();
  } catch (e) {
    console.error('Error:', e);
  } finally {
    chrome.kill();
    process.exit(0);
  }
}

run();
