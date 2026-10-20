import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_mactan_views';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9337',
  `--user-data-dir=${profileDir}`,
  '--window-size=1600,900',
  '--hide-scrollbars',
  '--mute-audio',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  'http://127.0.0.1:8765/index.html'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  await sleep(4000);
  const targetsRes = await fetch('http://127.0.0.1:9337/json');
  const targets = await targetsRes.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.error('Page not found'); chrome.kill(); return; }

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

  // 1. Switch to Philippines map
  console.log('Switching to Philippines...');
  await evaluate(`
    new Promise(res => {
      switchMap('philippines');
      setTimeout(res, 3500);
    })
  `);
  await sleep(3500);

  // 2. Select Land Cruiser FJ60
  await evaluate(`switchVehicle(11); true`);
  await sleep(1000);

  // 3. View A: Starting Boulevard with Chase Camera
  console.log('Shooting Boulevard Start...');
  await evaluate(`
    const spX = 29.12;
    const spZ = 149.59;
    const h = getPhilippinesGroundHeight(spX, spZ);
    truckPos.set(spX, h + 0.35, spZ);
    truckHeading = 2.14; // вдоль полосы бульвара на север
    truckSpeed = 0;
    truck.position.copy(truckPos);
    truck.rotation.set(0, truckHeading, 0);
    true;
  `);
  await sleep(600);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/shot_mactan_boulevard_view.png', Buffer.from(shot.data, 'base64'));
  console.log('Saved shot_mactan_boulevard_view.png');

  // 4. View B: Driving on Coastal Loop (Набережная)
  console.log('Shooting Coastal Loop...');
  await evaluate(`
    const cpX = 95.05;
    const cpZ = -123.61;
    const h = getPhilippinesGroundHeight(cpX, cpZ);
    truckPos.set(cpX, h + 0.35, cpZ);
    truckHeading = -2.4; // вдоль набережной к морю
    truckSpeed = 0;
    truck.position.copy(truckPos);
    truck.rotation.set(0, truckHeading, 0);
    true;
  `);
  await sleep(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/shot_mactan_coastal_road.png', Buffer.from(shot.data, 'base64'));
  console.log('Saved shot_mactan_coastal_road.png');

  // 5. View C: Ocean Pier, Banca Boat & Resort Beach
  console.log('Shooting Ocean Pier & Resort Beach...');
  await evaluate(`
    const pX = 137.14;
    const pZ = -166.33;
    const h = getPhilippinesGroundHeight(pX, pZ);
    truckPos.set(pX, h + 0.35, pZ);
    truckHeading = -Math.PI * 0.9; // к пирсу и воде
    truckSpeed = 0;
    truck.position.copy(truckPos);
    truck.rotation.set(0, truckHeading, 0);
    true;
  `);
  await sleep(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/shot_mactan_ocean_pier.png', Buffer.from(shot.data, 'base64'));
  console.log('Saved shot_mactan_ocean_pier.png');

  ws.close();
  chrome.kill();
  console.log('Finished capturing all views!');
}

run().catch(err => {
  console.error(err);
  try { chrome.kill(); } catch {}
});
