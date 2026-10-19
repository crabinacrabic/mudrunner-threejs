import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const africaDir = path.join('Новы окружения', 'Африка');
const unzippedDir = path.join(africaDir, 'распакованные_модели');
if (!fs.existsSync(unzippedDir)) fs.mkdirSync(unzippedDir, { recursive: true });

const africaZips = fs.readdirSync(africaDir).filter(f => f.endsWith('.zip') && !f.includes('(1)'));

for (const zip of africaZips) {
  const zipPath = path.join(africaDir, zip);
  try {
    const out = execSync(`tar -tf "${zipPath}"`, { encoding: 'utf8' });
    const glbFiles = out.split('\n').map(s => s.trim()).filter(s => s.endsWith('.glb'));
    for (const glb of glbFiles) {
      console.log(`Extracting ${glb} from ${zip}...`);
      execSync(`tar -C "${unzippedDir}" -xf "${zipPath}" "${glb}"`);
    }
  } catch (e) {
    console.error(`Error on ${zip}:`, e.message);
  }
}

console.log('Extracted models:');
fs.readdirSync(unzippedDir).forEach(f => {
  const stat = fs.statSync(path.join(unzippedDir, f));
  console.log(` - ${f} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
});
