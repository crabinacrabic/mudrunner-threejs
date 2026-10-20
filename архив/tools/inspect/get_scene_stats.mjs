import { spawn } from 'node:child_process';

const chrome = spawn('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', [
  '--headless=new',
  '--remote-debugging-port=9335',
  '--user-data-dir=C:/Users/MSI/AppData/Local/Temp/mr_cdp_info',
  '--window-size=1280,720',
  'http://127.0.0.1:8765/index.html'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(3500);
  const targets = await (await fetch('http://127.0.0.1:9335/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
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
  await sleep(4000);

  const stats = await send('Runtime.evaluate', {
    expression: `(() => {
      let terrainTris = 0;
      let totalSceneTris = 0;
      let propsTris = 0;
      let waterTris = 0;
      let vehicleTris = 0;

      scene.traverse(o => {
        if (o.isMesh && o.geometry) {
          let count = 0;
          if (o.geometry.index) count = o.geometry.index.count / 3;
          else if (o.geometry.attributes && o.geometry.attributes.position) count = o.geometry.attributes.position.count / 3;
          
          totalSceneTris += count;
          if (o === terrainMesh) terrainTris += count;
          else if (o === waterMesh) waterTris += count;
          else if (o.name && (o.name.includes('vehicle') || o.name.includes('chassis') || o.name.includes('wheel'))) vehicleTris += count;
          else propsTris += count;
        }
      });

      return {
        renderInfoTriangles: renderer.info.render.triangles,
        renderInfoGeometries: renderer.info.memory.geometries,
        renderInfoTextures: renderer.info.memory.textures,
        totalSceneTris,
        terrainTris,
        waterTris,
        propsTris,
        vehicleTris
      };
    })()`,
    returnByValue: true
  });

  console.log('LIVE SCENE STATS:', JSON.stringify(stats.result.value, null, 2));

  ws.close();
  chrome.kill();
  process.exit(0);
}

run().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
