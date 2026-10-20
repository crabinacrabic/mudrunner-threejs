import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9348',
  '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_cdp_pt_card',
  '--window-size=1600,950',
  '--hide-scrollbars',
  '--mute-audio',
  'http://127.0.0.1:8765/tools/road_editor.html'
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await sleep(3500);
  const targets = await (await fetch('http://127.0.0.1:9348/json')).json();
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

  await sleep(2000);
  await evaluate(`
    (() => {
      window.selectPoint({ routeId: 'mactan_boulevard', idx: 3 });
      const det = document.getElementById('route-points-details');
      if (det) det.open = true;
      const tabRoads = document.getElementById('tab-roads');
      if (tabRoads) tabRoads.scrollTop = 320;
      window.render();
    })()
  `);
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/shot_editor_selected_point_card.png', Buffer.from(shot.data, 'base64'));
  console.log('Saved shot_editor_selected_point_card.png');
  ws.close();
  chrome.kill();
}
main().catch(console.error);
