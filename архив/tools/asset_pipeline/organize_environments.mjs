import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const baseDir = 'Новы окружения';

const rules = {
  'Африка': [
    'African_Acacia_Tree',
    'African_Env_Pack',
    'African_Slum',
    'Desert_House_Pack',
    'Luo_First_Wife'
  ],
  'Филиппины': [
    'Philippines',
    'philippines',
    'Meshy_AI'
  ],
  'Служебные': [
    'rip_',
    'fssort.ini'
  ]
};

const entries = fs.readdirSync(baseDir);

for (const entry of entries) {
  const fullPath = path.join(baseDir, entry);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) continue; // skip already created category folders

  let targetCategory = null;
  for (const [category, patterns] of Object.entries(rules)) {
    if (patterns.some(p => entry.includes(p))) {
      targetCategory = category;
      break;
    }
  }

  if (!targetCategory) {
    targetCategory = 'Европа_и_Тайга';
  }

  const targetDir = path.join(baseDir, targetCategory);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const destPath = path.join(targetDir, entry);
  fs.renameSync(fullPath, destPath);
  console.log(`[SORT] ${entry} -> ${targetCategory}/`);
}

// Extract essential GLB models for Africa so they can be previewed and used
const africaDir = path.join(baseDir, 'Африка');
const unzippedDir = path.join(africaDir, 'распакованные_модели');
if (!fs.existsSync(unzippedDir)) fs.mkdirSync(unzippedDir, { recursive: true });

const africaZips = fs.readdirSync(africaDir).filter(f => f.endsWith('.zip') && !f.includes('(1)'));

for (const zip of africaZips) {
  const zipPath = path.join(africaDir, zip);
  console.log(`Extracting GLB from ${zip}...`);
  try {
    // List files and extract only .glb
    const out = execSync(`tar -tf "${zipPath}"`, { encoding: 'utf8' });
    const glbFiles = out.split('\n').filter(l => l.trim().endsWith('.glb'));
    for (const glb of glbFiles) {
      const trimmed = glb.trim();
      if (!trimmed) continue;
      console.log(`  -> Extracting ${trimmed}`);
      execSync(`tar -xf "${zipPath}" "${trimmed}" -C "${unzippedDir}"`);
    }
  } catch (e) {
    console.error(`Error extracting ${zip}:`, e.message);
  }
}

console.log('\n--- Sorting & Extraction Complete! ---');
