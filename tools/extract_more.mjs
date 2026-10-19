import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// 1. Philippines
const philDir = path.join('Новы окружения', 'Филиппины');
const philUnzipped = path.join(philDir, 'распакованные_модели');
if (!fs.existsSync(philUnzipped)) fs.mkdirSync(philUnzipped, { recursive: true });

const philZips = fs.readdirSync(philDir).filter(f => f.endsWith('.zip'));
for (const zip of philZips) {
  const zipPath = path.join(philDir, zip);
  try {
    const out = execSync(`tar -tf "${zipPath}"`, { encoding: 'utf8' });
    const glbFiles = out.split('\n').map(s => s.trim()).filter(s => s.endsWith('.glb'));
    for (const glb of glbFiles) {
      console.log(`Extracting ${glb} from ${zip}...`);
      execSync(`tar -C "${philUnzipped}" -xf "${zipPath}" "${glb}"`);
    }
  } catch (e) {
    console.error(`Error on ${zip}:`, e.message);
  }
}

// 2. Check Europe & Models folder
const europeDir = path.join('Новы окружения', 'Европа_и_Тайга');
const modelsDir = 'Новые модели';

if (fs.existsSync(modelsDir)) {
  const modelsZips = fs.readdirSync(modelsDir).filter(f => f.endsWith('.zip'));
  for (const zip of modelsZips) {
    // If it's Soviet / European truck (like GAZ-66, military truck), copy or note it
    console.log(`Found in 'Новые модели': ${zip}`);
  }
}

console.log('\n--- Done unpacking all! ---');
