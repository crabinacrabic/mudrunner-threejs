import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_soil';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9337',
  `--user-data-dir=${profileDir}`,
  '--window-size=1280,720',
  '--hide-scrollbars',
  '--mute-audio',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  'http://127.0.0.1:8765/tools/road_editor.html'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(3000);
  const targetsRes = await fetch('http://127.0.0.1:9337/json');
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
  await send('Page.enable');

  console.log('=== STEP 1: Verify Road Editor with Soil Brush ===');
  await sleep(2500);

  // Switch to soil tab, check UI elements, and paint a test zone
  const editorTestRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        window.switchTab('soil');
        window.setSoilBrushType('clay');
        window.updateSoilBrushRadius(16);
        const badgeText = document.getElementById('soil-count-badge')?.textContent;
        const initialCount = (window.soilZones || []).length;
        
        // Paint a clay spot near checkpoint 2
        window.applySoilBrush(26.0, 14.0);
        const afterCount = (window.soilZones || []).length;

        // Verify route surface controls
        const surfVal = document.getElementById('route-surface-select')?.value;

        return {
          tabSwitched: document.getElementById('tab-soil')?.classList.contains('active'),
          currentSoilType: window.currentSoilType,
          initialCount,
          afterCount,
          badgeText,
          surfVal
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Editor test result:', editorTestRes.result?.value);

  // Save to project via API
  await send('Runtime.evaluate', {
    expression: `window.saveToProject();`
  });
  await sleep(1500);

  // Take screenshot of road editor showing the soil tab and painted zones
  const editorShot = await send('Page.captureScreenshot', { format: 'png' });
  const editorArtifactPath = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_editor_soil_brush.png';
  fs.writeFileSync(editorArtifactPath, Buffer.from(editorShot.data, 'base64'));
  console.log('Saved editor screenshot:', editorArtifactPath);

  console.log('=== STEP 2: Verify 3D Game with SoilSim & Mud ===');
  // Navigate to main game
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' });
  await sleep(4000);

  // Switch to Philippines map
  await send('Runtime.evaluate', {
    expression: `window.switchMap('philippines');`
  });
  await sleep(4500);

  // Test SoilSim physical properties at painted coordinates
  const soilSimTest = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const out = { dh: 0, wet: 0, pack: 0, churn: 0 };
        const clayType = window.SOIL ? window.SOIL.typeAtXZ(22, 12) : null;
        if (window.SOIL) window.SOIL.sample(22, 12, out);
        const secData = typeof getSectorData === 'function' ? getSectorData(22, 12) : null;

        const outSwamp = { dh: 0, wet: 0, pack: 0, churn: 0 };
        const swampType = window.SOIL ? window.SOIL.typeAtXZ(38, 20) : null;
        if (window.SOIL) window.SOIL.sample(38, 20, outSwamp);

        const soilZonesCount = (window.PhilippinesTracks && window.PhilippinesTracks.getSoilZones) 
          ? window.PhilippinesTracks.getSoilZones().length : null;

        return {
          soilZonesCount,
          clayType,
          clayExpected: 3, // SoilSim.TYPE.clay
          claySample: out,
          swampType,
          swampExpected: 4, // SoilSim.TYPE.swamp
          swampSample: outSwamp,
          secData
        };
      })()
    `,
    returnByValue: true
  });
  console.log('SoilSim Physical Response:', soilSimTest.result?.value);

  // Position truck right at the mud pit and aim camera at the mud splash
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        // Place truck at start of mud track (x: 22, z: 12)
        if (window.truckPos) {
          window.truckPos.set(22, 11.9, 14);
          if (window.truckRot) window.truckRot.set(0, -1.8, 0);
        }
        if (window.camera) {
          window.cameraMode = 1;
          window.updateCameraView = function() {
            camera.position.set(28, 14.5, 20);
            camera.lookAt(21, 12.0, 11);
          };
        }
      })()
    `
  });
  await sleep(1000);

  // Simulate throttle driving through mud for 2.5 seconds
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  await sleep(2500);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  await sleep(500);

  // Check truck telemetry after mud drive
  const truckMudStats = await send('Runtime.evaluate', {
    expression: `
      (() => {
        return {
          truckSpeed: typeof truckSpeed !== 'undefined' ? truckSpeed : null,
          truckPos: window.truckPos ? { x: truckPos.x.toFixed(2), y: truckPos.y.toFixed(2), z: truckPos.z.toFixed(2) } : null,
          mudLevel: typeof truckDirtLevel !== 'undefined' ? truckDirtLevel : (typeof mudAccum !== 'undefined' ? mudAccum : null)
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Truck mud telemetry:', truckMudStats.result?.value);

  // Capture game screenshot showing truck in the painted mud with terrain coloring
  const gameShot = await send('Page.captureScreenshot', { format: 'png' });
  const gameArtifactPath = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_philippines_mud_track.png';
  fs.writeFileSync(gameArtifactPath, Buffer.from(gameShot.data, 'base64'));
  console.log('Saved game screenshot:', gameArtifactPath);

  ws.close();
  chrome.kill();
  console.log('=== VERIFICATION COMPLETE ===');
}

run().catch(err => {
  console.error('Test error:', err);
  chrome.kill();
});
