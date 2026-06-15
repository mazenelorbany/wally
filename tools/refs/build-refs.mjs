// Build a curated "what good looks like" reference set for the 31 base-seed
// Myer guide fixtures. Each fixture maps to a real ReStore category; fixtures
// sharing a category get DISTINCT stores' photos (rotated) so no two fixtures
// show the same image. Copies the chosen jpgs into the baked seed dir and emits
// a manifest the runtime seed reads.
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXPORT = '/Users/mazen/work/TCC/restore-myer';
const OUT = '/Users/mazen/work/TCC/wally-app/apps/api/prisma/seed-poc/reference';
mkdirSync(OUT, { recursive: true });

// base-seed fixture name -> real ReStore category (photo source)
const MAP = {
  'COOKSET BULKSTACK': 'The Cookshop Bulk Stack',
  'COOKWEAR SET BULK STACK': 'The Cookshop Bulk Stack',
  'ELECTRICAL STAND 1': 'Appliance Stand 1',
  'ELECTRICAL STAND 2': 'Appliance Stand 2',
  'FREE STANDER 1 (BACK)': 'The Custom Chef Freestanders',
  'FREE STANDER 1 (FRONT)': 'The Custom Chef Freestanders',
  'FREE STANDER 2 (BACK)': 'Gadget Freestanders',
  'FREE STANDER 2 (FRONT)': 'Gadget Freestanders',
  'FREE STANDER 3 (BACK)': 'The Custom Chef Freestanders',
  'FREE STANDER 3 (FRONT)': 'The Custom Chef Freestanders',
  'FRY WALL BAY 01': 'The Cookshop Bulk Stack',
  'KA STAND 1': 'Appliance Stand 1',
  'KA STAND 2': 'Appliance Stand 2',
  'KNIFE BLOCK BULK STACK': 'The Custom Chef Bulk Stack',
  'MINI DAIS 1': 'Display Tables',
  'MINI DAIS 10': 'Display Tables',
  'QUAD STAND 1': 'Quad Stands',
  'TCC WALL BAY 1': 'The Custom Chef',
  'TCC WALL BAY 2': 'The Custom Chef',
  'TCC WALL BAY 3': 'The Custom Chef',
  'TCC WALL BAY 4': 'The Custom Chef',
  'TCC WALL BAY 5': 'The Custom Chef',
  'TCC WALL BAY 6': 'The Custom Chef',
  'TCC WALL BAY 7': 'The Custom Chef',
  'TROLLEY 1': 'Display Tables',
  'TROLLEY 2': 'Display Tables',
  'TROLLEY 3': 'Display Tables',
  'VM TABLE 1': 'Vm Table',
  'VM TABLE 2': 'Vm Table',
  'VM TABLE 3': 'Vm Table',
  'WINDOW DISPLAY': 'Vm Update Photos',
};

const manifest = JSON.parse(readFileSync(join(EXPORT, 'manifest.json'), 'utf8'));
const safe = (x) => (x || 'unknown').replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'unknown';
const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// For each category, the stores that actually have a non-trivial photo on disk.
const storesFor = (cat) => {
  const out = [];
  for (const storeName of Object.keys(manifest.stores)) {
    const p = join(EXPORT, safe(storeName), `${safe(cat)}.jpg`);
    if (existsSync(p) && statSync(p).size > 5000) out.push({ storeName, path: p, size: statSync(p).size });
  }
  // biggest first (higher-res = better reference), stable by name after
  return out.sort((a, b) => b.size - a.size || a.storeName.localeCompare(b.storeName));
};

const catCursor = {};
const out = [];
for (const [fixture, cat] of Object.entries(MAP)) {
  const pool = storesFor(cat);
  if (pool.length === 0) { console.warn('NO PHOTO for', cat, '->', fixture); continue; }
  const idx = (catCursor[cat] ?? 0) % pool.length;
  catCursor[cat] = (catCursor[cat] ?? 0) + 1;
  const pick = pool[idx];
  const fname = `${slug(fixture)}.jpg`;
  copyFileSync(pick.path, join(OUT, fname));
  out.push({
    fixture,
    file: fname,
    caption: `${cat} — ${pick.storeName.replace(/\s*Myer\s*$/i, '').trim()} Myer (reference standard)`,
  });
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} reference photos to ${OUT}`);
let total = 0;
for (const r of out) total += statSync(join(OUT, r.file)).size;
console.log(`Total size: ${(total / 1024 / 1024).toFixed(1)} MB`);
console.log('Sample:', out.slice(0, 3));
