// Parallel autopilot runs in several headless Chromes (see README.md).
// usage: node tools/autopilot/multi.mjs <label> '<jobs>' '<opts json>' [workers=5]
//   jobs: CSV of vehicle indexes ("0,1,2") or JSON [{"v":0,"o":{"tag":"sand","startZ":-22}}, ...]
//   result: tools/autopilot/out/<label>.json  (summarise with: node tools/autopilot/sum.mjs out/<label>.json)
// env: GAME_URL (default http://127.0.0.1:8765/index.html), CDP_PORT_BASE (default 9461)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CDP = path.join(HERE, '..', 'cdp.mjs');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const [, , label, jobsArg, opts, wk] = process.argv;
const jobList = jobsArg.trim().startsWith('[') ? JSON.parse(jobsArg) : jobsArg.split(',').map(v => ({ v: +v }));
const K = +(wk || 5);
const BASE = +(process.env.CDP_PORT_BASE || 9461);
const groups = Array.from({ length: K }, () => []);
jobList.forEach((j, i) => groups[i % K].push(j));
const used = groups.map((g, i) => ({ g, port: BASE + i })).filter(x => x.g.length);

for (const u of used) {
  try { execFileSync('node', [CDP, 'start', 'about:blank'], { env: { ...process.env, CDP_PORT: String(u.port) }, timeout: 40000 }); }
  catch (e) { console.log('chrome start failed on port', u.port); }
}
const outs = await Promise.all(used.map(u => new Promise(res => {
  const f = path.join(OUT, `${label}_${u.port}.json`);
  const p = spawn('node', [path.join(HERE, 'run.mjs'), JSON.stringify(u.g), opts || '{}', f], { env: { ...process.env, CDP_PORT: String(u.port) } });
  let buf = ''; p.stdout.on('data', d => buf += d); p.stderr.on('data', d => buf += d);
  p.on('close', () => res({ f, buf }));
})));

let all = [];
for (const o of outs) {
  try { all = all.concat(JSON.parse(fs.readFileSync(o.f, 'utf8'))); fs.unlinkSync(o.f); }
  catch (e) { console.log('missing', o.f, o.buf.slice(-300)); }
}
all.sort((a, b) => a.idx - b.idx || (String(a.opts.tag) > String(b.opts.tag) ? 1 : -1));
fs.writeFileSync(path.join(OUT, label + '.json'), JSON.stringify(all));
console.log('saved', path.join(OUT, label + '.json'), all.length);
for (const o of outs) { const m = o.buf.split('\n').filter(l => !l.startsWith('{')); if (m.join('').trim()) console.log('NOTE', m.join(' | ').slice(0, 300)); }
for (const u of used) { try { execFileSync('node', [CDP, 'stop'], { env: { ...process.env, CDP_PORT: String(u.port) }, timeout: 20000 }); } catch (e) {} }
