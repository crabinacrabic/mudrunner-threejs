import { spawn } from 'node:child_process';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9352',
  '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_cdp_check_dim3',
  '--window-size=1600,950',
  'http://127.0.0.1:8765/tools/road_editor.html'
]);

setTimeout(async () => {
  const targets = await (await fetch('http://127.0.0.1:9352/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(res => { const callId = ++id; pending.set(callId, res); ws.send(JSON.stringify({ id: callId, method, params })); });
  const evalExp = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result ? r.result.value : null);

  await new Promise(r => setTimeout(r, 2000));
  const res = await evalExp(`
    (() => {
      const v = document.getElementById('viewport').getBoundingClientRect();
      const c = document.getElementById('canvas');
      return {
        viewport: { w: v.width, h: v.height },
        canvas: { w: c.width, h: c.height },
        dpr: window.devicePixelRatio,
        zoom, panX, panY,
        img: { w: mapImg.naturalWidth, h: mapImg.naturalHeight, complete: mapImg.complete }
      };
    })()
  `);
  console.log('Result:', JSON.stringify(res, null, 2));
  ws.close();
  chrome.kill();
}, 2500);
