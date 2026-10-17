// usage: CDP_PORT=9361 node run.mjs <vehicles csv> '<opts json>' <out.json> [url]
import fs from 'node:fs';
const PORT = +(process.env.CDP_PORT || 9361);
const [, , jobsJson, optsJson, outFile, urlArg] = process.argv;
const jobs = JSON.parse(jobsJson);
const URL_ = urlArg || process.env.GAME_URL || 'http://127.0.0.1:8793/index.html';
const opts0 = JSON.parse(optsJson || '{}');
const apSrc = fs.readFileSync(new URL('./ap.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
await send('Page.enable');
const results = [];
for (const job of jobs) {
  const idx = +job.v;
  const o = Object.assign({ tmax: 240, rock: false, rockAfter: 4, rockRev: 3, logEvery: 1 }, opts0, job.o || {});
  let ok = false;
  for (let att = 0; att < 3 && !ok; att++) {
  await send('Page.navigate', { url: URL_ + '?r=' + Math.random() });
  for (let i = 0; i < 60; i++) { await sleep(500); try { ok = await ev('typeof animate==="function" && typeof vehicleModelGroups!=="undefined" && vehicleModelGroups.length>=10 && vehicleModelGroups.every(m=>!m.pending)'); } catch { ok = false; } if (ok) break; }
  }
  if (!ok) { console.log('load failed for', idx); continue; }
  await sleep(1500);
  await ev(apSrc);
  const st = await ev(`AP.setup(${idx}, ${JSON.stringify(o)})`);
  const t0 = Date.now();
  let r;
  for (;;) { r = await ev('AP.step(600)'); if (r.done) break; }
  const res = await ev('AP.result()');
  res.wall = ((Date.now() - t0) / 1000).toFixed(1);
  res.opts = o;
  res.errs = await ev('JSON.stringify((window.__errs||[]).slice(0,5))');
  results.push(res);
  { const { log, ...sum } = res; console.log(JSON.stringify(sum)); }
  for (let lap = 2; lap <= (o.laps || 1); lap++) {
    const o2 = Object.assign({}, o, { keepSoil: true, tag: (o.tag || '') + '_lap' + lap });
    await ev(`AP.setup(${idx}, ${JSON.stringify(o2)})`);
    for (;;) { const rr = await ev('AP.step(600)'); if (rr.done) break; }
    const res2 = await ev('AP.result()'); res2.opts = o2; res2.wall = 0; results.push(res2);
    const { log, ...sum2 } = res2; console.log(JSON.stringify(sum2));
  }
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results));
ws.close(); process.exit(0);
