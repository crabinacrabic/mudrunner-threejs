import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_user_soil_final';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9342',
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
  const targetsRes = await fetch('http://127.0.0.1:9342/json');
  const targets = await targetsRes.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.error('Page target not found'); chrome.kill(); return; }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const txt = msg.params.args.map(a => a.value || a.description || '').join(' ');
      console.log(`[BROWSER ${msg.params.type.toUpperCase()}] ${txt}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[EXCEPTION]', JSON.stringify(msg.params.exceptionDetails));
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

  console.log('=== Loading Philippines Map with User-Painted Soils ===');
  await sleep(2000);

  // Switch to Philippines map
  await send('Runtime.evaluate', {
    expression: `window.switchMap('philippines');`
  });
  await sleep(4500);

  // Check loaded soil zones and test sectors at user coordinates
  const checkRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const szList = (window.PhilippinesTracks && window.PhilippinesTracks.getSoilZones)
          ? window.PhilippinesTracks.getSoilZones() : [];
        
        // Sample points from user track
        // 1. Sand point (x: 23.9, z: 83.2)
        const pSand = typeof getSectorData === 'function' ? getSectorData(23.9, 83.2) : null;
        const outSand = { dh: 0, wet: 0, pack: 0, churn: 0 };
        if (window.SOIL) window.SOIL.sample(23.9, 83.2, outSand);

        // 2. Clay point (x: 40.5, z: -45.1)
        const pClay = typeof getSectorData === 'function' ? getSectorData(40.5, -45.1) : null;
        const outClay = { dh: 0, wet: 0, pack: 0, churn: 0 };
        if (window.SOIL) window.SOIL.sample(40.5, -45.1, outClay);

        // 3. Swamp point (x: 48.5, z: -80.8)
        const pSwamp = typeof getSectorData === 'function' ? getSectorData(48.5, -80.8) : null;
        const outSwamp = { dh: 0, wet: 0, pack: 0, churn: 0 };
        if (window.SOIL) window.SOIL.sample(48.5, -80.8, outSwamp);

        // 4. Forest point (x: 88.1, z: -98.3)
        const pForest = typeof getSectorData === 'function' ? getSectorData(88.1, -98.3) : null;
        const outForest = { dh: 0, wet: 0, pack: 0, churn: 0 };
        if (window.SOIL) window.SOIL.sample(88.1, -98.3, outForest);

        return {
          totalZones: szList.length,
          pSand, outSand,
          pClay, outClay,
          pSwamp, outSwamp,
          pForest, outForest
        };
      })()
    `,
    returnByValue: true
  });
  console.log('User Track Inspection (After Soil Priority Fix):', JSON.stringify(checkRes.result?.value, null, 2));

  // 1. Teleport truck to user's Clay mud track at (x: 40.5, z: -45.1)
  await send('Runtime.evaluate', {
    expression: `window.teleportTruck(40.5, -45.1, -2.4); cameraMode = 1; true;`
  });
  await sleep(1500);

  // Drive in clay forward for 2.5 seconds
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  await sleep(2500);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  await sleep(1000);

  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  const shot1Path = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_user_clay_trail.png';
  fs.writeFileSync(shot1Path, Buffer.from(shot1.data, 'base64'));
  console.log('Saved shot 1 (Clay Trail):', shot1Path);

  // 2. Teleport truck to user's Sand track at (x: 23.9, z: 83.2)
  await send('Runtime.evaluate', {
    expression: `window.teleportTruck(23.9, 83.2, -2.8); true;`
  });
  await sleep(1500);

  // Drive in sand for 2 seconds
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  await sleep(2000);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  await sleep(1000);

  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  const shot2Path = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_user_sand_trail.png';
  fs.writeFileSync(shot2Path, Buffer.from(shot2.data, 'base64'));
  console.log('Saved shot 2 (Sand Trail):', shot2Path);

  // 3. Teleport truck to user's Forest track at (x: 88.1, z: -98.3)
  await send('Runtime.evaluate', {
    expression: `window.teleportTruck(88.1, -98.3, -1.2); true;`
  });
  await sleep(1500);

  // Drive in forest for 2 seconds
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  await sleep(2000);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  await sleep(1000);

  const shot3 = await send('Page.captureScreenshot', { format: 'png' });
  const shot3Path = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_user_forest_trail.png';
  fs.writeFileSync(shot3Path, Buffer.from(shot3.data, 'base64'));
  console.log('Saved shot 3 (Forest Trail):', shot3Path);

  ws.close();
  chrome.kill();
  console.log('=== ALL TESTS COMPLETED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('Test error:', err);
  chrome.kill();
});
