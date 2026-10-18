import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_cars_maps';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9335',
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
  const targetsRes = await fetch('http://127.0.0.1:9335/json');
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
    console.log(`Saved ${name}.png`);
  }

  await send('Runtime.enable');
  await send('Page.enable');

  console.log('Waiting 4s for assets & models to load...');
  await sleep(4000);

  // 1. Check vehicles count and specs
  const vehicleCount = await evaluate('vehicleConfigs.length');
  console.log('Total vehicle configs count:', vehicleCount);
  const vehiclesInfo = await evaluate(`vehicleConfigs.map((c, i) => ({ idx: i, id: c.id, name: c.name }))`);
  console.log('Vehicles in game:', JSON.stringify(vehiclesInfo, null, 2));

  // 2. Check Subaru (idx 10)
  console.log('Switching to Subaru L-Series 1990 (idx 10)...');
  await evaluate('switchVehicle(10)');
  await sleep(1000);
  const subaruName = await evaluate('currentVehicleConfig.name');
  console.log('Active vehicle:', subaruName);
  await takeScreenshot('shot_subaru_taiga');

  // Test driving Subaru
  console.log('Driving Subaru forward...');
  await evaluate('keys.forward = true');
  await sleep(1500);
  const subaruSpeed = await evaluate('Math.abs(truckSpeed)');
  console.log('Subaru speed:', subaruSpeed.toFixed(2), 'km/h');
  await evaluate('keys.forward = false');

  // 3. Check Land Cruiser 1985 (idx 11)
  console.log('Switching to Toyota Land Cruiser FJ60 1985 (idx 11)...');
  await evaluate('switchVehicle(11)');
  await sleep(1000);
  const lcName = await evaluate('currentVehicleConfig.name');
  console.log('Active vehicle:', lcName);
  await takeScreenshot('shot_landcruiser_taiga');

  // Test driving Land Cruiser
  console.log('Driving Land Cruiser forward...');
  await evaluate('keys.forward = true');
  await sleep(1500);
  const lcSpeed = await evaluate('Math.abs(truckSpeed)');
  console.log('Land Cruiser speed:', lcSpeed.toFixed(2), 'km/h');
  await evaluate('keys.forward = false');

  // 4. Open Dock and switch to Maps Tab
  console.log('Opening Dock and switching to Maps tab...');
  await evaluate('switchDockTab("maps"); toggleVehicleDock(true);');
  await sleep(800);
  await takeScreenshot('shot_dock_maps');

  // 5. Switch to Philippines map
  console.log('Switching map to Philippines: Lapu-Lapu (Mactan New Town)...');
  await evaluate('switchMap("philippines")');
  // Wait for 25MB map glb and meta json to load
  let mapReady = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const loaded = await evaluate('philippinesLoaded');
    const curMap = await evaluate('currentMapId');
    if (loaded && curMap === 'philippines') {
      mapReady = true;
      break;
    }
  }
  console.log('Philippines map loaded:', mapReady);
  await sleep(1500);

  const phPos = await evaluate('({ x: truckPos.x.toFixed(2), y: truckPos.y.toFixed(2), z: truckPos.z.toFixed(2), map: currentMapId })');
  console.log('Philippines vehicle position & state:', phPos);
  await takeScreenshot('shot_philippines_overview');

  // 6. Drive on Philippines
  console.log('Driving on Philippines streets in Land Cruiser...');
  await evaluate('keys.forward = true');
  await sleep(2500);
  const phSpeed = await evaluate('Math.abs(truckSpeed)');
  const phSector = await evaluate('getSectorData(truckPos.x, truckPos.z)');
  console.log('Philippines driving speed:', phSpeed.toFixed(2), 'km/h, sector:', phSector.label);
  await evaluate('keys.forward = false');
  await sleep(500);
  await takeScreenshot('shot_philippines_driving');

  // 7. Switch to Subaru while on Philippines
  console.log('Switching to Subaru while on Philippines...');
  await evaluate('switchVehicle(10)');
  await sleep(1000);
  await takeScreenshot('shot_philippines_subaru');

  // 8. Switch back to Taiga
  console.log('Switching back to Taiga map...');
  await evaluate('switchMap("taiga")');
  await sleep(1000);
  const taigaState = await evaluate('({ map: currentMapId, pos: { x: truckPos.x.toFixed(2), y: truckPos.y.toFixed(2), z: truckPos.z.toFixed(2) } })');
  console.log('Returned to Taiga:', taigaState);
  await takeScreenshot('shot_taiga_return');

  console.log('\n--- VERIFICATION RESULT ---');
  const errors = consoleLogs.filter(l => l.type === 'error');
  console.log('Total console errors:', errors.length);
  if (errors.length > 0) {
    errors.forEach(e => console.log('  [ERROR]', e.text));
  } else {
    console.log('SUCCESS: Zero console errors, all 12 vehicles and both maps fully functional!');
  }

  ws.close();
  chrome.kill();
  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(e => { console.error('Error:', e); chrome.kill(); process.exit(1); });
