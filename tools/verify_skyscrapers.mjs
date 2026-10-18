import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_skyscrapers';

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
  if (!page) { console.error('Page target not found'); chrome.kill(); return; }

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

  await send('Runtime.enable');

  console.log('--- Switching to Philippines map ---');
  await send('Runtime.evaluate', {
    expression: `
      window.switchMap('philippines');
    `
  });

  await sleep(4000);

  // Check scene objects
  const statsRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        return {
          skyscrapersVisible: !!window.skyscrapersMesh || !!window.photogrammetryMesh,
          photogrammetryMeshVisible: window.photogrammetryMesh ? window.photogrammetryMesh.visible : null,
          roadsCount: window.philippinesTracks ? window.philippinesTracks.activeRoads?.length : null,
          propsCount: window.philippinesTracks ? window.philippinesTracks.activeProps?.length : null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Scene status:', statsRes.result?.value);

  // Set camera to look at the boulevard and skyscrapers (same view as user screenshot)
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        // Place truck on Mactan Boulevard near the towers (x: 22, z: 25)
        if (window.truckPos) {
          window.truckPos.set(20, 11.8, 30);
          if (window.truckRot) window.truckRot.set(0, 2.8, 0);
        }
        if (window.camera) {
          window.cameraMode = 1; // chase or custom
          // Position camera behind truck looking towards downtown skyscrapers
          window.updateCameraView = function() {
            camera.position.set(23, 16.5, 52);
            camera.lookAt(18, 14, 5);
          };
        }
      })()
    `
  });

  await sleep(1500);

  // Take screenshot 1: Driving on Boulevard towards Skyscraper District
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/shot_skyscrapers_boulevard.png', Buffer.from(shot1.data, 'base64'));
  console.log('Saved tools/shot_skyscrapers_boulevard.png');

  // Take screenshot 2: High angle panoramic overview of the towers and island
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        window.updateCameraView = function() {
          camera.position.set(95, 45, 90);
          camera.lookAt(30, 15, -20);
        };
      })()
    `
  });

  await sleep(1500);

  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/shot_skyscrapers_panorama.png', Buffer.from(shot2.data, 'base64'));
  console.log('Saved tools/shot_skyscrapers_panorama.png');

  ws.close();
  chrome.kill();
  console.log('SUCCESS!');
}

run().catch(e => {
  console.error('Test error:', e);
  chrome.kill();
});
