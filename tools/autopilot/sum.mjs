import fs from 'node:fs';
const f = process.argv[2]; const verbose = process.argv[3];
const R = JSON.parse(fs.readFileSync(f, 'utf8'));
const names = ['forest','sand','clay','swamp','bridge','snow','finish'];
for (const r of R) {
  const s = r.sec; let prev = 0; const parts = [];
  for (const n of names) { if (s[n] != null) { parts.push(n.slice(0,4)+':'+s[n]); } }
  console.log(String(r.idx).padStart(1), r.id.padEnd(11), String(r.opts.tag||'').padEnd(10), r.reason.padEnd(8), 't='+String(r.t).padEnd(6), 'maxZ='+String(r.maxZ).padEnd(6), 'minZ='+String(r.minZ).padEnd(6), 'zEnd='+String(r.zEnd).padEnd(6), 'cp='+r.passed, 'rut='+r.maxRut, 'gap='+r.minGap, 'bel='+r.maxBelly, 'pit/rol='+r.maxPit+'/'+r.maxRol, 'pStep='+r.maxPitchStep, 'yStep='+r.maxYStep, 'jmp='+r.maxJump, 'nan='+r.nan, 'wn='+r.winchUsed, '|', parts.join(' '));
  if (verbose) { for (const l of r.log) if (Math.round(l.t) % +verbose === 0) console.log('   ', JSON.stringify(l)); }
}
