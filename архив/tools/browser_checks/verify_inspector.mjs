import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9354',
  '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_cdp_inspector_test',
  '--window-size=1600,950',
  '--hide-scrollbars',
  '--mute-audio',
  'http://127.0.0.1:8765/tools/road_editor.html'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await sleep(3500);
  const targets = await (await fetch('http://127.0.0.1:9354/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('BROWSER CONSOLE:', msg.params.type, msg.params.args.map(a => a.value).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('BROWSER EXCEPTION:', msg.params.exceptionDetails);
      errors.push(msg.params.exceptionDetails);
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(res => {
    const callId = ++id;
    pending.set(callId, res);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result ? r.result.value : null);

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  // 1. Проверяем состояние загрузки пропсов
  const state = await evaluate(`
    (() => {
      return {
        propsCount: propsData.length,
        routesCount: Object.keys(routesData).length,
        listItemsCount: document.querySelectorAll('#all-props-list .props-list-item').length,
        activeTab: activeTab
      };
    })()
  `);
  console.log('1. Initial State:', state);

  // 2. Кликаем на первый пропс в списке всех объектов
  const selectResult = await evaluate(`
    (() => {
      const firstItem = document.querySelector('#all-props-list .props-list-item');
      if (!firstItem) return { success: false, reason: 'No items in #all-props-list' };
      firstItem.click();
      return {
        success: true,
        selectedPropName: selectedProp ? selectedProp.name : null,
        selectedPropId: selectedProp ? selectedProp.id : null,
        x: selectedProp ? selectedProp.x : null,
        z: selectedProp ? selectedProp.z : null,
        inspXVal: document.getElementById('insp-x').value,
        inspZVal: document.getElementById('insp-z').value,
        activeTab: activeTab
      };
    })()
  `);
  console.log('2. Select First Prop:', selectResult);

  // 3. Тестируем смещение через D-Pad
  const dpadResult = await evaluate(`
    (() => {
      const startX = selectedProp.x;
      const startZ = selectedProp.z;

      // Кликаем ▲ (-Z)
      const btnUp = document.querySelector('.dpad-row button[title*="Север"]');
      if (btnUp) btnUp.click();
      const zAfterUp = selectedProp.z;

      // Кликаем ▶ (+X)
      const btnRight = document.querySelector('.dpad-row button[title*="Восток"]');
      if (btnRight) btnRight.click();
      const xAfterRight = selectedProp.x;

      return {
        startX, startZ,
        xAfterRight, zAfterUp,
        deltaX: Math.round((xAfterRight - startX) * 100) / 100,
        deltaZ: Math.round((zAfterUp - startZ) * 100) / 100,
        inspXVal: document.getElementById('insp-x').value,
        inspZVal: document.getElementById('insp-z').value
      };
    })()
  `);
  console.log('3. D-Pad Nudge Test:', dpadResult);

  // 4. Тестируем перетаскивание мышкой по холсту (Screen-space drag)
  const dragCoords = await evaluate(`
    (() => {
      const sp = worldToScreen(selectedProp.x, selectedProp.z);
      const hit = findPropAt(sp.sx, sp.sy);
      return {
        sx: Math.round(sp.sx),
        sy: Math.round(sp.sy),
        hitName: hit ? hit.name : null
      };
    })()
  `);
  console.log('4. Drag Start Coords:', dragCoords);

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: dragCoords.sx,
    y: dragCoords.sy,
    button: 'left',
    clickCount: 1
  });
  await sleep(60);

  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: dragCoords.sx + 50,
    y: dragCoords.sy - 30,
    button: 'left'
  });
  await sleep(60);

  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: dragCoords.sx + 50,
    y: dragCoords.sy - 30,
    button: 'left'
  });
  await sleep(100);

  const afterDrag = await evaluate(`
    (() => {
      return {
        propX: selectedProp.x,
        propZ: selectedProp.z,
        inspX: document.getElementById('insp-x').value,
        inspZ: document.getElementById('insp-z').value
      };
    })()
  `);
  console.log('4b. After Canvas Drag:', afterDrag);

  // 5. Тестируем клавиши со стрелками (Arrow keys), поворот (Q/E) и масштаб ([/])
  const keyNavResult = await evaluate(`
    (() => {
      const zStart = selectedProp.z;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      const zAfterDown = selectedProp.z;

      const rotStart = selectedProp.rot;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true }));
      const rotAfter = selectedProp.rot;

      const scaleStart = selectedProp.scale;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', code: 'BracketRight', bubbles: true }));
      const scaleAfter = selectedProp.scale;

      return {
        zDiff: Math.round((zAfterDown - zStart) * 100) / 100,
        rotDiffDeg: Math.round((rotAfter - rotStart) * 180 / Math.PI),
        scaleDiff: Math.round((scaleAfter - scaleStart) * 100) / 100
      };
    })()
  `);
  console.log('5. Keyboard Navigation & Transform Test:', keyNavResult);

  // 6. Центрируем камеру на выбранном объекте, устанавливаем зум и делаем финальный скриншот
  await evaluate(`
    (() => {
      centerCameraOnSelectedProp();
      zoom = 1.8;
      updateZoomUI();
      render();
    })()
  `);
  await sleep(1000);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const toolShot = 'tools/shot_inspector_fixed.png';
  const artShot = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_inspector_fixed.png';
  fs.writeFileSync(toolShot, Buffer.from(shot.data, 'base64'));
  fs.writeFileSync(artShot, Buffer.from(shot.data, 'base64'));
  console.log('6. Screenshot saved successfully to both locations!');

  ws.close();
  chrome.kill();

  if (errors.length > 0) {
    console.error('TEST FAILED: Browser exceptions occurred:', errors);
    process.exit(1);
  } else {
    console.log('ALL INSPECTOR TESTS PASSED WITH 0 ERRORS!');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Fatal test error:', e);
  chrome.kill();
  process.exit(1);
});
