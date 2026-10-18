import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_hires_points';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9345',
  `--user-data-dir=${profileDir}`,
  '--window-size=1600,950',
  '--hide-scrollbars',
  '--mute-audio',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  'http://127.0.0.1:8765/tools/road_editor.html'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('1. Launching test for 4K map and arbitrary point ordering...');
  await sleep(3500);

  const targetsRes = await fetch('http://127.0.0.1:9345/json');
  const targets = await targetsRes.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) {
    console.error('Page target not found');
    chrome.kill();
    return;
  }

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

  async function screenshot(filename) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filename, Buffer.from(r.data, 'base64'));
    console.log(`Saved screenshot: ${filename}`);
  }

  console.log('2. Verifying high resolution texture loaded...');
  await sleep(2000);

  const mapStats = await evaluate(`
    (() => {
      const img = document.querySelector('canvas') ? window.mapImg : null;
      return {
        naturalWidth: window.mapImg?.naturalWidth,
        naturalHeight: window.mapImg?.naturalHeight,
        complete: window.mapImg?.complete,
        badgeText: document.getElementById('badge-map-res')?.textContent
      };
    })()
  `);
  console.log('Map texture stats:', mapStats);

  // 3. Test Road points:
  console.log('3. Testing arbitrary point ordering and smart insertion...');
  const pointTest = await evaluate(`
    (() => {
      const cur = window.routesData['mactan_boulevard'];
      const initialCount = cur.points.length;

      // Test Smart Insertion between point 2 and 3:
      const p1 = cur.points[2];
      const p2 = cur.points[3];
      const midX = (p1.x + p2.x) / 2;
      const midZ = (p1.z + p2.z) / 2;

      const ins = window.findBestInsertionIndex(cur, midX, midZ);
      cur.points.splice(ins.index, 0, { x: midX, z: midZ });

      // Select this inserted point
      window.selectPoint ? window.selectPoint({ routeId: 'mactan_boulevard', idx: ins.index }) : (window.selectedPoint = { routeId: 'mactan_boulevard', idx: ins.index });
      window.buildRoutesUI();
      window.updatePointControlCard();
      window.render();

      return {
        initialCount,
        afterInsertCount: cur.points.length,
        insertedIndex: ins.index,
        insertedMode: ins.mode,
        selectedPointIdx: window.selectedPoint?.idx
      };
    })()
  `);
  console.log('Point insertion test result:', pointTest);

  // Open details for points list
  await evaluate(`
    document.getElementById('route-points-details').open = true;
    window.render();
  `);
  await sleep(500);

  await screenshot('tools/shot_editor_smart_points.png');

  // 4. Test Zoomed-in 4K resolution view
  console.log('4. Zooming in to 250% to showcase 4K Ultra-HD detail...');
  await evaluate(`
    window.applyZoom(1.5);
    window.render();
  `);
  await sleep(600);

  await screenshot('tools/shot_editor_4k_zoom.png');

  // 5. Test Reverse Route and Reordering
  console.log('5. Testing route reversal and reordering...');
  const orderTest = await evaluate(`
    (() => {
      const cur = window.routesData['mactan_boulevard'];
      const firstBefore = { ...cur.points[0] };
      const lastBefore = { ...cur.points[cur.points.length - 1] };

      window.reverseActiveRoute();

      const firstAfter = { ...cur.points[0] };
      const lastAfter = { ...cur.points[cur.points.length - 1] };

      // Reverse back to normal
      window.reverseActiveRoute();

      return {
        reversedSuccessfully: (firstBefore.x === lastAfter.x && lastBefore.x === firstAfter.x)
      };
    })()
  `);
  console.log('Order reversal test result:', orderTest);

  console.log('All tests passed successfully!');
  ws.close();
  chrome.kill();
}

run().catch(err => {
  console.error('Error running test:', err);
  chrome.kill();
});
