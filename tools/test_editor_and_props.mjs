import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_editor_test';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9340',
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
  console.log('Waiting for Chrome to initialize...');
  await sleep(3500);

  const targetsRes = await fetch('http://127.0.0.1:9340/json');
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

  console.log('1. Checking Road Editor initial state...');
  await sleep(1500);

  const stats = await evaluate(`
    ({
      routesCount: Object.keys(window.routesData || {}).length,
      propsCount: (window.propsData || []).length,
      routeNames: Object.keys(window.routesData || {}),
      activeTab: window.activeTab
    })
  `);
  console.log('Initial stats in editor:', stats);

  // 2. Switch to Props tab
  console.log('2. Switching to Props tab...');
  await evaluate(`
    window.switchTab('props');
  `);
  await sleep(600);

  // Take screenshot of Props tab
  await screenshot('tools/shot_editor_props_tab.png');

  // 3. Test stamping / dropping a palm
  console.log('3. Placing a test palm via editor API...');
  const placementResult = await evaluate(`
    (() => {
      const countBefore = (window.propsData || []).length;
      // Simulate drop of a palm
      const newPalm = {
        id: 'palm_test_' + Date.now(),
        type: 'palm',
        name: 'Пальма',
        x: 45.0,
        z: -12.5,
        rot: 0.8,
        scale: 1.25
      };
      window.propsData.push(newPalm);
      window.selectProp(newPalm);
      window.updateStats();
      window.render();
      return {
        countBefore,
        countAfter: window.propsData.length,
        selectedId: window.selectedProp?.id,
        activeTab: window.activeTab
      };
    })()
  `);
  console.log('Placement result:', placementResult);

  // 4. Inspect Inspector tab
  await sleep(500);
  await screenshot('tools/shot_editor_inspector_tab.png');

  // 5. Test saving to project
  console.log('5. Testing saveToProject()...');
  const saveRes = await evaluate(`
    window.saveToProject().then(() => 'SAVE_PROMISE_RESOLVED').catch(err => 'ERR: ' + err)
  `);
  console.log('saveToProject result:', saveRes);
  await sleep(1000);

  // Verify file on disk
  const roadsJsonOnDisk = JSON.parse(fs.readFileSync('models/philippines_roads.json', 'utf8'));
  console.log('Props count in models/philippines_roads.json on disk:', roadsJsonOnDisk.props?.length);

  // 6. Now navigate to game index.html and test 3D scene
  console.log('6. Navigating to game (index.html)...');
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' });
  await sleep(4000);

  console.log('7. Switching map to Philippines in game...');
  const switchRes = await evaluate(`
    new Promise(res => {
      if (typeof window.switchMap === 'function') {
        window.switchMap('philippines');
        setTimeout(() => {
          res({
            activeMap: window.currentMapId,
            tracksReady: !!window.philippinesTracks,
            carPos: window.carGroup ? { x: window.carGroup.position.x, y: window.carGroup.position.y, z: window.carGroup.position.z } : null
          });
        }, 3500);
      } else {
        res('switchMap not found');
      }
    })
  `);
  console.log('Game switch result:', switchRes);

  // Position camera nicely to see boulevard and palm props
  await evaluate(`
    if (window.camera && window.controls) {
      window.controls.target.set(30, 2, 0);
      window.camera.position.set(20, 18, 45);
      window.camera.lookAt(30, 2, 0);
    }
  `);
  await sleep(1000);

  await screenshot('tools/shot_game_philippines_props_active.png');

  console.log('All tests completed successfully!');
  ws.close();
  chrome.kill();
}

run().catch(err => {
  console.error('Error running test:', err);
  chrome.kill();
});
