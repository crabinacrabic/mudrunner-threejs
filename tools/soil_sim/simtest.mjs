// Headless scenario test for SoilSim (flat uniform soil strips, no THREE).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SoilSim = require('../../js/soil.js');
const TYPE = SoilSim.TYPE;

const VEH = {
  j40: { mass: 1750, power: 22, maxSpeed: 40, lowMaxSpeed: 17, torqueMult: 2.6, sinkFactor: 0.55, tireBite: 0.95, hasAWD: true, clearance: 0.22,
    wheels: [[-0.737, 1.505, true], [0.737, 1.505, true], [-0.737, -1.505, false], [0.737, -1.505, false]], R: 0.358, b: 0.30, drivenAll: true },
  delica: { mass: 1900, power: 21, maxSpeed: 40, lowMaxSpeed: 16, torqueMult: 2.3, sinkFactor: 0.7, tireBite: 0.8, hasAWD: true, clearance: 0.21,
    wheels: [[-0.676, 1.095, true], [0.676, 1.095, true], [-0.676, -1.095, false], [0.676, -1.095, false]], R: 0.36, b: 0.30, drivenAll: true },

  truck: { mass: 5400, power: 20, maxSpeed: 28, lowMaxSpeed: 11, torqueMult: 3.0, sinkFactor: 1.0, tireBite: 1.0, hasAWD: true, clearance: 0.72,
    wheels: [[-1.18, 1.68, true], [1.18, 1.68, true], [-1.18, -1.07, false], [1.18, -1.07, false], [-1.18, -2.26, false], [1.18, -2.26, false]], R: 0.64, b: 0.50, drivenAll: true },
  jeep: { mass: 1750, power: 24, maxSpeed: 44, lowMaxSpeed: 18, torqueMult: 2.5, sinkFactor: 0.85, tireBite: 0.95, hasAWD: true, clearance: 0.58,
    wheels: [[-0.95, 1.40, true], [0.95, 1.40, true], [-0.95, -1.40, false], [0.95, -1.40, false]], R: 0.46, b: 0.38, drivenAll: true },
  sedan: { mass: 1050, power: 17, maxSpeed: 52, lowMaxSpeed: 20, torqueMult: 1.8, sinkFactor: 1.85, tireBite: 0.50, hasAWD: false, clearance: 0.28,
    wheels: [[-0.80, 1.45, true], [0.80, 1.45, true], [-0.80, -1.35, false], [0.80, -1.35, false]], R: 0.36, b: 0.28, drivenAll: false },
  bus: { mass: 4200, power: 19, maxSpeed: 34, lowMaxSpeed: 14, torqueMult: 2.6, sinkFactor: 1.35, tireBite: 0.75, hasAWD: false, clearance: 0.42,
    wheels: [[-0.90, 1.80, true], [0.90, 1.80, true], [-0.90, -2.19, false], [0.90, -2.19, false]], R: 0.46, b: 0.34, drivenAll: false },
  racer: { mass: 1100, power: 28, maxSpeed: 64, lowMaxSpeed: 24, torqueMult: 2.2, sinkFactor: 2.0, tireBite: 0.40, hasAWD: false, clearance: 0.25,
    wheels: [[-0.80, 1.35, true], [0.80, 1.35, true], [-0.80, -1.50, false], [0.80, -1.50, false]], R: 0.35, b: 0.30, drivenAll: false }
};

function run(vehName, typeName, opts = {}) {
  const cfg = VEH[vehName];
  const type = TYPE[typeName];
  const soil = new SoilSim({ originX: -6, originZ: 0, sizeX: 12, sizeZ: 80, cellsPerMeter: 10, typeAt: () => type });
  const wheels = cfg.wheels.map(([lx, lz, front], idx) => ({
    localX: lx, localZ: lz, isFront: front, radius: cfg.R, width: cfg.b,
    driven: cfg.drivenAll ? true : !front, axle: 0, s: SoilSim.newWheelState(), x: 0, z: 0, hdg: 0
  }));
  // axle ids by localZ
  const zs = [...new Set(wheels.map(w => w.localZ.toFixed(2)))].sort();
  wheels.forEach(w => { w.axle = zs.indexOf(w.localZ.toFixed(2)); });
  const V = { mass: cfg.mass, speed: 0, slope: 0, belly: 0, accelPrev: 0, winch: 0 };
  const I = { throttle: 0, brake: false, handbrake: false, awd: opts.awd !== false, diffLock: !!opts.diff, lowGear: !!opts.low };
  const out = SoilSim.makeStepOut();
  let px = 0, pz = 3, hdg = 0;
  const dt = 1 / 60;
  const log = [];
  const T = opts.T || 24;
  let maxStep = 0;
  for (let step = 0; step < T * 60; step++) {
    const sinH = Math.sin(hdg), cosH = Math.cos(hdg);
    for (const w of wheels) {
      w.x = px + cosH * w.localX + sinH * w.localZ;
      w.z = pz - sinH * w.localX + cosH * w.localZ;
      w.hdg = hdg;
    }
    I.throttle = Math.min(1, I.throttle + 1.6 * dt);
    soil.vehicleStep(V, wheels, I, cfg, dt, out);
    V.speed = out.speed;
    pz += cosH * V.speed * dt; px += sinH * V.speed * dt;
    for (const w of wheels) {
      w.x = px + cosH * w.localX + sinH * w.localZ;
      w.z = pz - sinH * w.localX + cosH * w.localZ;
      const s = w.s;
      const surf = Math.abs(V.speed) + s.slip * 5.0;
      soil.updateMud(s, dt, surf, s.slip, 0, true);
      soil.stamp(s, w.x, w.z, hdg, w.radius, w.width, s.slip, dt);
    }
    const t0 = performance.now();
    soil.relax(dt);
    maxStep = Math.max(maxStep, performance.now() - t0);
    soil.flushDirty(() => {});
    if (pz > 78) break;
    if (step % 120 === 119) {
      const ws = wheels.map(w => w.s);
      const mean = k => (ws.reduce((a, b) => a + b[k], 0) / ws.length);
      log.push({ t: ((step + 1) / 60).toFixed(0), v: (V.speed * 3.6).toFixed(1), z: pz.toFixed(1), sink: mean('zEq').toFixed(2) + '+' + mean('dig').toFixed(2), slip: mean('slip').toFixed(2), mud: mean('mud').toFixed(2), thr: (out.thrust / 1000).toFixed(1), res: (out.resist / 1000).toFixed(1), cap: (out.cap / 1000).toFixed(1), rho: out.dragCoef.toFixed(2) });
    }
  }
  return { log, maxRelaxMs: maxStep.toFixed(3), dist: pz - 3, vFinal: V.speed };
}

const args = process.argv.slice(2);
const veh = args[0] || 'truck';
const types = (args[1] || 'concrete,forest,sand,clay,swamp,snow').split(',');
const opts = { diff: args.includes('diff'), low: args.includes('low'), awd: !args.includes('2wd'), T: +(args.find(a => /^T=/.test(a)) || 'T=24').slice(2) };
for (const t of types) {
  const r = run(veh, t, opts);
  console.log(`\n== ${veh} on ${t} ${JSON.stringify(opts)}  dist=${r.dist.toFixed(1)} m  relaxMax=${r.maxRelaxMs}ms`);
  r.log.forEach(l => console.log(`  t=${l.t.padStart(2)}s v=${l.v.padStart(5)}km/h z=${l.z.padStart(5)} sink(eq+dig)=${l.sink} slip=${l.slip} mud=${l.mud} thrust=${l.thr}kN resist=${l.res}kN cap=${l.cap}kN rho=${l.rho}`));
}
