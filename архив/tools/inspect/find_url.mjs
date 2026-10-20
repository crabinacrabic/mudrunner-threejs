import fs from 'node:fs';
import readline from 'node:readline';

const file = 'C:/Users/MSI/.gemini/antigravity/brain/36f37e40-a893-4e45-90a8-72a13c535227/.system_generated/logs/transcript.jsonl';
const rl = readline.createInterface({ input: fs.createReadStream(file) });

const foundUrls = new Set();

for await (const line of rl) {
  if (line.includes('zaire_village_map') || line.includes('Mutshatsha') || line.includes('arcgis') || line.includes('satellite') || line.includes('mapbox') || line.includes('osm')) {
    const urls = line.match(/https?:\/\/[^\s"'\\<>]+/g);
    if (urls) {
      for (const u of urls) {
        if (!foundUrls.has(u)) {
          foundUrls.add(u);
          console.log(u);
        }
      }
    }
  }
}
