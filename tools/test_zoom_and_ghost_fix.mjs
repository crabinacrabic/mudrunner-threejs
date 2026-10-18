import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9349',
  '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_cdp_zoom_ghost',
  '--window-size=1600,950',
  '--hide-scrollbars',
  '--mute-audio',
  'http://127.0.0.1:8765/tools/road_editor.html'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await sleep(3500);
  const targets = await (await fetch('http://127.0.0.1:9349/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(res => { const callId = ++id; pending.set(callId, res); ws.send(JSON.stringify({ id: callId, method, params })); });
  const evaluate = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result ? r.result.value : null);

  await sleep(2500);

  // 1. Проверяем дефолтный режим
  const defaultMode = await evaluate(`roadToolMode`);
  console.log('1. Default roadToolMode:', defaultMode);

  // 2. Симулируем перемещение мыши по холсту в режиме 'select'
  const ghostInSelect = await evaluate(`
    (() => {
      const v = document.getElementById('viewport');
      const r = v.getBoundingClientRect();
      // Двигаем мышь в центр холста
      v.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2 + 50, clientY: r.top + r.height / 2 + 50 }));
      return ghostInsertInfo;
    })()
  `);
  console.log('2. ghostInsertInfo in select mode:', ghostInSelect);

  // 3. Тестируем зум колёсиком (отдаление) через обычный Wheel и Ctrl+Wheel
  const zoomBefore = await evaluate(`zoom`);
  console.log('3a. Zoom before wheel:', zoomBefore);

  await evaluate(`
    (() => {
      const v = document.getElementById('viewport');
      const r = v.getBoundingClientRect();
      // Имитируем Ctrl + Wheel (zoom out) 5 раз
      for (let i = 0; i < 5; i++) {
        v.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 150,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          ctrlKey: true,
          bubbles: true
        }));
      }
    })()
  `);
  const zoomAfterCtrlWheel = await evaluate(`zoom`);
  console.log('3b. Zoom after 5 Ctrl+Wheel down:', zoomAfterCtrlWheel, `(${Math.round(zoomAfterCtrlWheel * 100)}%)`);

  // Проверяем, что зум успешно опустился ниже старого лимита 0.35
  const canZoomPast35 = zoomAfterCtrlWheel < 0.35;
  console.log('3c. Can zoom out past old 0.35 limit:', canZoomPast35);

  // 4. Тестируем кнопку "🔍 Вся карта" (Fit Map to Screen)
  await evaluate(`window.fitMapToScreen()`);
  await sleep(400);
  const fitZoom = await evaluate(`zoom`);
  console.log('4. Fit Map To Screen zoom:', fitZoom, `(${Math.round(fitZoom * 100)}%)`);

  // 5. Тестируем переключение в режим рисования и выход через Escape
  await evaluate(`window.setRoadToolMode('draw')`);
  const bannerVisible = await evaluate(`document.getElementById('draw-mode-banner').style.display === 'flex'`);
  console.log('5a. Draw mode banner visible:', bannerVisible);

  // Нажимаем Escape
  await evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  `);
  const modeAfterEsc = await evaluate(`roadToolMode`);
  const ghostAfterEsc = await evaluate(`ghostInsertInfo`);
  console.log('5b. Mode after Escape:', modeAfterEsc, '| ghostInsertInfo:', ghostAfterEsc);

  // 6. Устанавливаем комфортный общий обзор (например, 70% или fit) и делаем скриншот
  await evaluate(`
    (() => {
      window.fitMapToScreen();
      window.render();
    })()
  `);
  await sleep(600);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const outPath = 'tools/shot_editor_zoom_and_ghost_fixed.png';
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('6. Screenshot saved to', outPath);

  // Копируем также в папку артефактов
  const artPath = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/shot_editor_zoom_and_ghost_fixed.png';
  fs.copyFileSync(outPath, artPath);
  console.log('Copied to artifact:', artPath);

  ws.close();
  chrome.kill();
}

main().catch(err => {
  console.error('Test error:', err);
  chrome.kill();
});
