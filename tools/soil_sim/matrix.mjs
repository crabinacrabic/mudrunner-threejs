import { spawnSync } from 'node:child_process';
const rows = [];
const vehs = (process.argv[2]||'truck,jeep,sedan,bus,racer').split(',');
const types = ['forest','sand','clay','swamp','snow'];
const combos = [['', 'normal'], ['low diff', 'low+diff']];
for (const [flags, label] of combos) for (const v of vehs) {
  if ((label==='low+diff') && !['truck','jeep','bus','j40','delica'].includes(v)) continue;
  const line = [label.padEnd(9), v.padEnd(6)];
  for (const t of types) {
    const r = spawnSync('node', ['simtest.mjs', v, t, 'T=10', ...flags.split(' ').filter(Boolean)], { encoding: 'utf-8' });
    const m = /dist=([\d.]+) m/.exec(r.stdout);
    const lines = r.stdout.trim().split('\n').filter(l => l.includes('t='));
    const last = lines[lines.length-1] || '';
    const sp = /v=\s*([\d.]+)km/.exec(last), sk = /sink\(eq\+dig\)=([\d.+]+)/.exec(last), mu = /mud=([\d.]+)/.exec(last);
    line.push(`${t}: ${(sp?sp[1]:'?').padStart(5)}km/h d=${m?(+m[1]).toFixed(0).padStart(3):'?'} sk=${sk?sk[1]:'?'} mud=${mu?mu[1]:'?'}`);
  }
  console.log(line.join(' | '));
}
