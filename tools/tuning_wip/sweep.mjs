// usage: node sweep.mjs <label> <techJson> [GAME_URL]   -> writes label.json with vEnd per vehicle x sector
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const [, , label, tech] = process.argv;
const sectors = { forest: -50, sand: -22, clay: -5, swamp: 24, bridge: 49, snow: 66 };
const jobs = [];
for (const v of [0,1,2,3,4,5,6,7,8,9]) for (const [n, z] of Object.entries(sectors)) jobs.push({ v, o: { tag: n, startZ: z } });
const SP = 'C:/Users/MSI/AppData/Local/Temp/claude/C--Recompiles-VivaPinata-xbox360/781ff099-b484-454d-82c9-d5af23d04196/scratchpad/T';
const o = spawnSync('node', [`${SP}/multi.mjs`, label, JSON.stringify(jobs), JSON.stringify(Object.assign({ tmax: 4.5, logEvery: 0.5, stopZ: 999 }, JSON.parse(tech || '{}'))), '5'], { env: process.env, encoding: 'utf8', timeout: 800000 });
console.log(o.stdout.slice(-300), o.stderr.slice(-300));
const R = JSON.parse(fs.readFileSync(`${SP}/${label}.json`, 'utf8'));
const names = Object.keys(sectors);
const tab = {};
for (const r of R) { (tab[r.idx] = tab[r.idx] || { id: r.id })[r.opts.tag] = r.vEnd; }
console.log('veh'.padEnd(13) + names.map(n => n.padStart(8)).join(''));
for (const k of Object.keys(tab)) console.log((k + ' ' + tab[k].id).padEnd(13) + names.map(n => String(tab[k][n]).padStart(8)).join(''));
