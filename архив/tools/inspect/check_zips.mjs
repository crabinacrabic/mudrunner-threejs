import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const dir = 'Новы окружения';
const files = fs.readdirSync(dir);

for (const file of files) {
  const full = path.join(dir, file);
  const stat = fs.statSync(full);
  if (file.endsWith('.zip')) {
    console.log(`\n========================================`);
    console.log(`ZIP: ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
    try {
      // Use tar or powershell
      const out = execSync(`tar -tf "${full}"`, { encoding: 'utf8' });
      const lines = out.split('\n').filter(Boolean);
      console.log(`Total files in zip: ${lines.length}`);
      lines.slice(0, 15).forEach(l => console.log('  ' + l));
      if (lines.length > 15) console.log(`  ... and ${lines.length - 15} more`);
    } catch (e) {
      console.error('Error reading zip:', e.message);
    }
  } else if (!stat.isDirectory()) {
    console.log(`FILE: ${file} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}
