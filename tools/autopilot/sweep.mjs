// Sector sweep: every vehicle starts from standstill at the beginning of each sector and holds the throttle for tmax seconds.
// Prints the speed at the end (km/h) - a quick "can it pull away here" table.
// usage: node tools/autopilot/sweep.mjs <label> '<opts json>' [workers=5]
//   e.g. node tools/autopilot/sweep.mjs none '{"tech":"none"}'                      no diff lock / low gear (casual player)
//        node tools/autopilot/sweep.mjs tech '{"diffFrom":-999,"lowFrom":-999}'     diff lock + low gear everywhere
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , label = 'sweep', tech = '{}', workers = '5'] = process.argv;
const sectors = { forest: -50, sand: -22, clay: -5, swamp: 24, bridge: 49, snow: 66 };
const jobs = [];
for (let v = 0; v < 10; v++) for (const [n, z] of Object.entries(sectors)) jobs.push({ v, o: { tag: n, startZ: z } });
const opts = Object.assign({ tmax: 4.5, logEvery: 0.5, stopZ: 999 }, JSON.parse(tech));
const o = spawnSync('node', [path.join(HERE, 'multi.mjs'), label, JSON.stringify(jobs), JSON.stringify(opts), workers],
  { env: process.env, encoding: 'utf8', timeout: 900000 });
console.log((o.stdout || '').slice(-300), (o.stderr || '').slice(-300));
const R = JSON.parse(fs.readFileSync(path.join(HERE, 'out', label + '.json'), 'utf8'));
const names = Object.keys(sectors);
const tab = {};
for (const r of R) (tab[r.idx] = tab[r.idx] || { id: r.id })[r.opts.tag] = r.vEnd;
console.log('veh'.padEnd(14) + names.map(n => n.padStart(8)).join(''));
for (const k of Object.keys(tab)) console.log((k + ' ' + tab[k].id).padEnd(14) + names.map(n => String(tab[k][n]).padStart(8)).join(''));
