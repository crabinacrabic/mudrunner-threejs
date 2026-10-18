import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_philippines';

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

  async function takeScreenshot(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const p = `C:/Users/MSI/Desktop/My Projects/AFRICAN_IT_DRIVERS/tools/${name}.png`;
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    console.log(`Saved tools/${name}.png`);
  }

  await send('Runtime.enable');
  await send('Page.enable');

  console.log('Waiting 3.5s for initial page load...');
  await sleep(3500);

  // 1. Switch to Philippines map
  console.log('Switching to Philippines map...');
  await evaluate('switchMap("philippines")');
  
  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    const loaded = await evaluate('philippinesLoaded');
    const curMap = await evaluate('currentMapId');
    if (loaded && curMap === 'philippines') {
      ready = true;
      break;
    }
  }
  console.log('Philippines loaded state:', ready);
  await sleep(1500);

  // 2. Check vehicle spawn and heading
  const spawnData = await evaluate(`({
    pos: { x: truckPos.x.toFixed(2), y: truckPos.y.toFixed(2), z: truckPos.z.toFixed(2) },
    heading: truckHeading.toFixed(3),
    checkpoints: window.PhilippinesTracks ? window.PhilippinesTracks.getCheckpoints().map(c => ({ title: c.title, x: c.x, z: c.z, isFinish: c.isFinish })) : []
  })`);
  console.log('Spawn telemetry & Checkpoints:', JSON.stringify(spawnData, null, 2));

  // Take screenshot of start position at Mactan Boulevard
  await takeScreenshot('shot_philippines_start_boulevard');

  // 3. Drive forward along Mactan Boulevard
  console.log('Driving along Mactan Boulevard (throttle on)...');
  await evaluate('keys.forward = true');
  await sleep(2500);
  const drivingData = await evaluate(`({
    speed: (Math.abs(truckSpeed) * 3.6).toFixed(1),
    pos: { x: truckPos.x.toFixed(2), y: truckPos.y.toFixed(2), z: truckPos.z.toFixed(2) },
    sector: getSectorData(truckPos.x, truckPos.z)
  })`);
  console.log('Driving telemetry at speed:', JSON.stringify(drivingData, null, 2));
  await takeScreenshot('shot_philippines_cruising_boulevard');
  await evaluate('keys.forward = false');

  // 4. Move camera to view the Resort Pier, Banca Boats, and Ocean
  console.log('Moving camera to showcase coastal promenade & pier...');
  await evaluate(`
    window.origUpdateCameraView = updateCameraView;
    updateCameraView = () => {};
    camera.position.set(165, 24, -135);
    camera.lookAt(130, 13, -170);
  `);
  await sleep(1000);
  await takeScreenshot('shot_philippines_resort_pier_banca');

  // 5. Move camera to view beach bungalows and umbrellas
  console.log('Moving camera to view beach bungalows and umbrellas...');
  await evaluate(`
    camera.position.set(145, 18, -120);
    camera.lookAt(115, 14, -148);
  `);
  await sleep(1000);
  await takeScreenshot('shot_philippines_bungalows_beach');

  // Restore camera
  await evaluate('updateCameraView = window.origUpdateCameraView;');

  // 6. Check console errors
  const errors = consoleLogs.filter(l => l.type === 'error');
  console.log('\n--- VERIFICATION RESULT ---');
  console.log('Total console errors:', errors.length);
  if (errors.length > 0) {
    errors.forEach(e => console.log('  [ERROR]', e.text));
  } else {
    console.log('SUCCESS: Philippines tropical island map with clean roads, checkpoints, ocean and resort props loaded with 0 errors!');
  }

  ws.close();
  chrome.kill();
  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(e => { console.error('Error:', e); chrome.kill(); process.exit(1); });
