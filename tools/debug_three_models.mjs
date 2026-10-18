import { spawn } from 'node:child_process';

const chromePath = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/MSI/AppData/Local/Temp/mr_cdp_profile_debug';

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9336',
  `--user-data-dir=${profileDir}`,
  '--window-size=1280,720',
  '--mute-audio',
  'http://127.0.0.1:8765/index.html'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(3000);
  const targetsRes = await fetch('http://127.0.0.1:9336/json');
  const targets = await targetsRes.json();
  const page = targets.find(t => t.type === 'page');
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
    if (r.exceptionDetails) console.error('Error on expr:', r.exceptionDetails);
    return r.result ? r.result.value : null;
  }

  await send('Runtime.enable');
  await sleep(4000);

  // Inspect Subaru model
  const subaruDump = await evaluate(`
    (() => {
      const m = vehicleModelGroups[10];
      if (!m) return 'No group 10';
      const res = [];
      m.group.traverse(o => {
        const b = o.geometry ? (o.geometry.computeBoundingBox(), o.geometry.boundingBox) : null;
        res.push({
          name: o.name,
          type: o.type,
          visible: o.visible,
          pos: o.position,
          scale: o.scale,
          material: o.material ? (Array.isArray(o.material) ? o.material.map(m=>m.name) : o.material.name) : null,
          box: b ? { min: b.min, max: b.max } : null
        });
      });
      return res;
    })()
  `);
  console.log('=== SUBARU DUMP ===', JSON.stringify(subaruDump, null, 2));

  // Inspect Land Cruiser model
  const lcDump = await evaluate(`
    (() => {
      const m = vehicleModelGroups[11];
      if (!m) return 'No group 11';
      const res = [];
      m.group.traverse(o => {
        const b = o.geometry ? (o.geometry.computeBoundingBox(), o.geometry.boundingBox) : null;
        res.push({
          name: o.name,
          type: o.type,
          visible: o.visible,
          pos: o.position,
          scale: o.scale,
          material: o.material ? (Array.isArray(o.material) ? o.material.map(m=>m.name) : o.material.name) : null,
          box: b ? { min: b.min, max: b.max } : null
        });
      });
      return res;
    })()
  `);
  console.log('=== LAND CRUISER DUMP ===', JSON.stringify(lcDump, null, 2));

  // Now load Philippines map and inspect lighting and bounds
  await evaluate('switchMap("philippines")');
  await sleep(3000);

  const mapDump = await evaluate(`
    (() => {
      const res = [];
      philippinesGroup.traverse(o => {
        const b = o.geometry ? (o.geometry.computeBoundingBox(), o.geometry.boundingBox) : null;
        res.push({
          name: o.name,
          type: o.type,
          visible: o.visible,
          pos: o.position,
          material: o.material ? (Array.isArray(o.material) ? o.material.map(m=>({ name: m.name, color: m.color, roughness: m.roughness, metalness: m.metalness, map: !!m.map })) : { name: o.material.name, color: o.material.color, roughness: o.material.roughness, metalness: o.material.metalness, map: !!o.material.map }) : null,
          box: b ? { min: b.min, max: b.max } : null
        });
      });
      return {
        philippinesGroupCount: res.length,
        firstThree: res.slice(0, 3),
        sunLight: { pos: sunLight.position, color: sunLight.color, intensity: sunLight.intensity, target: sunLight.target.position },
        hemiLight: { color: hemiLight.color, groundColor: hemiLight.groundColor, intensity: hemiLight.intensity },
        camera: { pos: camera.position, far: camera.far, target: truckPos }
      };
    })()
  `);
  console.log('=== MAP & LIGHTING DUMP ===', JSON.stringify(mapDump, null, 2));

  ws.close();
  chrome.kill();
  process.exit(0);
}

run().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
