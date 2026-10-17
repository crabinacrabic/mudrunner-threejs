// Calibrate zRef (sinkage at 40 kPa) so that the truck reaches a design sinkage on each soil at base wetness.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SoilSim = require('../../js/soil.js');
const P = SoilSim.PARAMS, TYPE = SoilSim.TYPE;
const PREF = 40000;
const contactLen = (R, z) => Math.sqrt((0.55*R)**2 + 8*R*z);
function solve(pr, zr, F, R, b) {
  const k = PREF / Math.pow(zr, pr.n);
  let lo = 0, hi = pr.maxDepth;
  if (k*Math.pow(hi, pr.n) - F/(b*contactLen(R,hi)) < 0) return hi;
  for (let i=0;i<40;i++){ const mid=.5*(lo+hi); if (k*Math.pow(mid,pr.n) - F/(b*contactLen(R,mid)) < 0) lo=mid; else hi=mid; }
  return .5*(lo+hi);
}
const targets = { forest: 0.035, grass: 0.025, sand: 0.085, clay: 0.17, swamp: 0.34, snow: 0.20 };
const veh = {
  truck:{m:5400,R:.64,b:.50,n:6,fp:1.0}, jeep:{m:1750,R:.46,b:.38,n:4,fp:Math.pow(.85,.8)}, sedan:{m:1050,R:.36,b:.28,n:4,fp:Math.pow(1.85,.8)},
  bus:{m:4200,R:.46,b:.34,n:4,fp:Math.pow(1.35,.8)}, racer:{m:1100,R:.35,b:.30,n:4,fp:Math.pow(2.0,.8)} };
for (const [name, tgt] of Object.entries(targets)) {
  const pr = P[TYPE[name]];
  const v = veh.truck; const F = v.m*9.81/v.n;
  let lo = 0.001, hi = 20;
  for (let i=0;i<60;i++){ const mid=Math.sqrt(lo*hi); const z = solve(pr, mid, F, v.R, v.b); if (z < tgt) lo = mid; else hi = mid; }
  const zr = Math.sqrt(lo*hi);
  const row = Object.entries(veh).map(([vn, vv]) => `${vn}=${solve(pr, zr, vv.m*9.81/vv.n*vv.fp, vv.R, vv.b).toFixed(3)}`).join(' ');
  console.log(name.padEnd(7), 'zRef=', zr.toFixed(3), ' | ', row);
}
