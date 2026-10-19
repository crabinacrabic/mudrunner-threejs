import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_zaire_test';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9337',
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
    const targetsRes = await fetch('http://127.0.0.1:9337/json');
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
        const txt = msg.params.args.map(a => a.value || a.description || '').join(' ');
        consoleLogs.push({ type: msg.params.type, text: txt });
        console.log(`[BROWSER ${msg.params.type.toUpperCase()}] ${txt}`);
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

    async function evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        console.error('Eval error on:', expr, r.exceptionDetails);
      }
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

    console.log('Waiting for initial engine start...');
    await sleep(3500);

    const initialMap = await evaluate('currentMapId');
    console.log('Initial map:', initialMap);

    console.log('Switching to Zaire map...');
    await evaluate("switchMap('zaire')");

    await sleep(4000); // Give time for sat texture, json, and props to load

    const zaireStatus = await evaluate(`({
      currentMapId: currentMapId,
      truckPos: { x: truckPos.x, y: truckPos.y, z: truckPos.z },
      currentVehicle: currentVehicleConfig ? currentVehicleConfig.name : null,
      currentVehicleId: currentVehicleConfig ? currentVehicleConfig.id : null,
      checkpointsCount: window.ZaireVillageMap ? window.ZaireVillageMap.getCheckpoints().length : 0,
      isLoaded: window.ZaireVillageMap ? window.ZaireVillageMap.isLoaded() : false,
      groundHeightAtCar: window.ZaireVillageMap ? window.ZaireVillageMap.getGroundHeight(truckPos.x, truckPos.z) : null,
      soilAtCar: window.ZaireVillageMap ? window.ZaireVillageMap.getSoilZoneAt(truckPos.x, truckPos.z) : null
    })`);

    console.log('Zaire status in game:', JSON.stringify(zaireStatus, null, 2));

    const shotPath = 'screenshot_zaire_in_game.png';
    await takeScreenshot(shotPath);

    // Also copy to artifacts dir
    const artifactPath = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/screenshot_zaire_in_game.png';
    if (fs.existsSync(shotPath)) {
      fs.copyFileSync(shotPath, artifactPath);
      console.log(`Copied to artifact dir: ${artifactPath}`);
    }

    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    chrome.kill();
    process.exit(0);
  }
}

run();
