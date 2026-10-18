import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9338', '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_test_orient',
  '--window-size=1280,720', '--mute-audio', 'http://127.0.0.1:8765/index.html'
]);

await new Promise(r => setTimeout(r, 3000));
const targets = await (await fetch('http://127.0.0.1:9338/json')).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};

function send(method, params = {}) {
  return new Promise(res => {
    const callId = ++id;
    pending.set(callId, res);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
}

await send('Runtime.enable');
await send('Page.enable');
await new Promise(r => setTimeout(r, 4000));

// Test rotation of Philippines
await send('Runtime.evaluate', { expression: 'switchMap("philippines")' });
await new Promise(r => setTimeout(r, 2000));

const checkResult = await send('Runtime.evaluate', { expression: `
  (() => {
    const mesh = philippinesGroup.getObjectByProperty('isMesh', true);
    if (!mesh) return 'no mesh';
    mesh.geometry.computeBoundingBox();
    const bb0 = mesh.geometry.boundingBox;
    
    // Rotate root of philippines by -Math.PI / 2 around X
    mesh.rotation.x = -Math.PI / 2;
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);

    // Also move truck to 0, box.min.y, 0
    truckPos.set(0, box.min.y + 1, 0);
    truck.position.copy(truckPos);

    return {
      rawGeomBox: { min: bb0.min, max: bb0.max },
      rotatedWorldBox: { min: box.min, max: box.max },
      size: {
        width_X: box.max.x - box.min.x,
        height_Y: box.max.y - box.min.y,
        length_Z: box.max.z - box.min.z
      }
    };
  })()
`, returnByValue: true });

console.log('Philippines Rotation Test:', JSON.stringify(checkResult.result.value, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('C:/Users/MSI/Desktop/My Projects/AFRICAN_IT_DRIVERS/tools/test_rotated_philippines.png', Buffer.from(shot.data, 'base64'));
console.log('Saved test_rotated_philippines.png');

ws.close();
chrome.kill();
process.exit(0);
