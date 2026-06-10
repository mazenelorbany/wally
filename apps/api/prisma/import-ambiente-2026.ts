// =============================================================================
// import-ambiente-2026 — the REAL Ambiente 2026 VM planogram, implemented 1:1.
// =============================================================================
//
// Run from apps/api:   pnpm exec tsx prisma/import-ambiente-2026.ts
//
// Source of truth: "TCC TCS Ambiente 2025 Planogram V2.pdf" (titled "VM
// PLANOGRAM AMBIENTE 2026" / "Ambiente 2026 Floor Plan" inside). Every fixture
// below was measured off page 2 (the 15.00M × 6.00M floor plan) rendered at
// 150 dpi (2481×1754 px): the booth outline spans page px x 728→2356,
// y 578→1232 — 1628×654 px for 15×6 m, i.e. ~108.7 px/m on both axes, which is
// how we know the measurements are sound. (Sanity check: the "New Table
// 1200x500mm" measures 135×60 page px = 1.24×0.55 m. ✓)
//
// What it builds (idempotent — upserts on deterministic ids / natural keys):
//   - Campaign AMBIENTE-2026 ("Ambiente 2026 — VM Planogram") on the existing
//     Ambiente TRADESHOW project.
//   - TWO concession venue stores, Myer-style ("Ambiente Stand — The Custom
//     Chef" / "… — The Cookshop"), so the floor-plan brand toggle switches
//     between the two halves of the booth instead of one crowded canvas.
//   - 42 fixtures named exactly as the floor plan labels them, placed at the
//     measured positions (uniform per-zone scale onto each 1000×640 canvas —
//     nothing is stretched; the split line is the physical partition wall).
//   - Per-fixture guide sheets carrying the planogram content VERBATIM:
//     bay assignments (TCC 9-bay, TCS 7-bay), bulk-stack face maps, the
//     Try Me Table's 12 SKUs, 4PC/6PC cookset dais position tables +
//     requirements, GWP offer/gift pairs, VM table checklists, and the global
//     notes (EXCLUDE ARTISAN, SABRE — ONLY IN BULK STACKS / ADD TO VM FILE
//     SAMARA).
//   - Reference imagery cropped straight out of the planogram PDF
//     (seed-data/ambiente-2026/*.jpg|png): per-bay crops for the two bay runs,
//     the relevant spec page(s) for everything else. Stored via the same
//     StorageService key layout the seed uses, so signed URLs resolve.
//   - Checklist templates + guide checklist items (CHECK LIST boxes verbatim
//     where the planogram prints one; layout-derived items elsewhere).
//   - Merchandise: the 12 Try-Me SKUs linked to the real Cuisine::pro catalog
//     rows. The five Baccarat PCP-codes on the cookset/GWP pages are NOT in
//     the current catalog — they stay verbatim in notes/checklists (verified-
//     data rule: we don't invent catalog rows).
//   - A FixtureCapture TODO row per scoreable fixture, so the setup-verify
//     flow starts honest: nothing photographed, nothing scored.
//   - The six SS26 placeholder fixtures ("Ambiente · Wall Left" …) are soft-
//     archived: superseded by the real planogram, placements/history kept.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { CampaignStatus, PrismaClient } from '@prisma/client';

// ───────────────────────────────────────────── env / clients
const __envPath = join(__dirname, '..', '.env');
if (
  !process.env.DATABASE_URL &&
  existsSync(__envPath) &&
  typeof process.loadEnvFile === 'function'
) {
  process.loadEnvFile(__envPath);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set — export it or fill apps/api/.env');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const STORAGE_DIR = resolve(process.env.WALLY_STORAGE_DIR ?? './storage');
const ASSET_DIR = join(__dirname, 'seed-data', 'ambiente-2026');

// Stable anchors from seed.ts (the Ambiente project + venue already exist).
const PROJECT_ID = 'seed-project-ambiente';
const CAMPAIGN_KEY = 'AMBIENTE-2026';

// The booth is ONE physical stand but TWO concessions — exactly like a Myer
// location. Stores follow the "{Venue} — {Brand}" convention the floor-plan
// brand toggle groups on, so the studio shows a Custom Chef ↔ Cookshop toggle
// instead of cramming both halves into one canvas. The original seed store id
// is kept for the Custom Chef side (the setup-crew dev user is bound to it).
const VENUE = 'Ambiente Stand';
const CC_STORE_ID = 'seed-store-AMBIENTE-BOOTH'; // … — The Custom Chef
const CS_STORE_ID = 'seed-store-AMBIENTE-BOOTH-CS'; // … — The Cookshop
const CC_FASCIA = 'The Custom Chef';
const CS_FASCIA = 'The Cookshop';

// ───────────────────────────────────────────── storage (mirror StorageService)
// Same `${prefix}/${day}/${id}${ext}` key layout as StorageService.put / seed.ts
// storeSample, so the API serves these with no extra plumbing.
async function storeAsset(file: string, prefix: string): Promise<string | null> {
  const abs = join(ASSET_DIR, file);
  if (!existsSync(abs)) {
    console.warn(`  ! asset missing, skipped: ${file}`);
    return null;
  }
  const bytes = readFileSync(abs);
  const ext = file.endsWith('.png') ? '.png' : '.jpg';
  const day = new Date().toISOString().slice(0, 10);
  const id = randomBytes(16).toString('hex');
  const key = `${prefix}/${day}/${id}${ext}`;
  const dest = join(STORAGE_DIR, key);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return key;
}

// ───────────────────────────────────────────── geometry
// Floor-plan page (150 dpi) → 1000×640 canvas, PER CONCESSION ZONE. The booth
// splits at the partition wall (page x ≈ 1400–1460): The Custom Chef shop on
// the left, The Cook Shop on the right. Each zone gets its own uniform scale
// (no stretch) so each brand's floor plan fills its canvas, with a small
// breathing margin. Measured positions stay exactly per the planogram.
const ZONES = {
  [CC_FASCIA]: { x0: 728, y0: 578, x1: 1490, y1: 1232 }, // knife shop half
  [CS_FASCIA]: { x0: 1405, y0: 578, x1: 2356, y1: 1232 }, // cook shop half (incl. BOH rooms)
} as const;
const CANVAS = { w: 1000, h: 640, margin: 16 } as const;

/** A rect measured on the floor-plan page (150 dpi px) → canvas rect, in its zone. */
function toCanvas(
  zone: { x0: number; y0: number; x1: number; y1: number },
  r: { x: number; y: number; w: number; h: number },
) {
  const zw = zone.x1 - zone.x0;
  const zh = zone.y1 - zone.y0;
  const scale = Math.min(
    (CANVAS.w - 2 * CANVAS.margin) / zw,
    (CANVAS.h - 2 * CANVAS.margin) / zh,
  );
  const xOff = Math.round((CANVAS.w - zw * scale) / 2);
  const yOff = Math.round((CANVAS.h - zh * scale) / 2);
  return {
    x: Math.round(xOff + (r.x - zone.x0) * scale),
    y: Math.round(yOff + (r.y - zone.y0) * scale),
    w: Math.max(10, Math.round(r.w * scale)),
    h: Math.max(10, Math.round(r.h * scale)),
  };
}

// ───────────────────────────────────────────── planogram-global notes (verbatim)
const NINE_BAY_NOTES =
  'NOTES (9 BAY LAYOUT, verbatim): EXCLUDE ARTISAN, SABRE - ONLY IN BULK STACKS. ' +
  'Orange-flagged items: ADD TO VM FILE SAMARA.';

const TRY_ME_SKUS: { sku: string; name: string }[] = [
  { sku: '1032393', name: 'CP DM ALL PURPOSE TM KNIFE 14.5CM' },
  { sku: '1034462', name: 'CP DM MINI SANTOKU+CLEAVER TM 12CM' },
  { sku: '1030433', name: 'CP DM EMPEROR SANTOKU TM 12.5CM' },
  { sku: '1034464', name: 'CP ICONIX ALL PURPOSE TM KNIFE 14.5CM' },
  { sku: '1034465', name: 'CP ICONIX SANTOKU TM 12.5CM' },
  { sku: '1031734', name: 'CP ICONIX SANTOKU TM 12.5CM WHT' },
  { sku: '1029280', name: 'CP ID3 SANTOKU TM 12.5CM' },
  { sku: '1034463', name: 'CP ID3 BLK SMR SANTOKU TM 12.5' },
  { sku: '1034408', name: 'CP KIYOSHI SANTOKU TM 12.5CM' },
  { sku: '1036491', name: 'CP WS SANTOKU TM KNIFE 12.5CM' },
  { sku: '1029085', name: 'CP DM SANTOKU TM 12.5CM' },
  { sku: '7000195', name: 'CP KUROI KIBA MOON TM 12.5CM' },
];

// The GWP CHECK LIST box, printed verbatim on the GWP page.
const GWP_CHECKLIST = [
  { label: 'Display cooksets match sale', required: true },
  { label: 'Frypan stands are used to display product as per guide', required: true },
  { label: 'A3 Call is on display', required: true },
  { label: 'FREE GIFT is wrapped with red ribbon - refer to example', required: true },
];

// ───────────────────────────────────────────── the fixtures, exactly per plan
interface AmbienteFixture {
  slug: string; // deterministic id suffix
  /** Placement label — the EXACT text on the floor plan. */
  label: string;
  /** Library name (org-unique, prefixed so it never collides with Myer's). */
  name: string;
  kind: string; // bay | table | stand | window | dais | room
  department: 'The Custom Chef' | 'The Cook Shop' | null;
  /** Rect measured on the floor-plan page at 150 dpi. */
  page: { x: number; y: number; w: number; h: number };
  notes: string;
  instructions?: string[];
  checklist?: { label: string; required?: boolean }[];
  /** Reference images (first = library reference + best-in-class example). */
  images: { file: string; caption: string }[];
  /** Merchandise rows to link by catalog sku, when the SKUs exist. */
  merch?: { sku: string; row: string }[];
  /** false → no FixtureCapture TODO row (back-of-house rooms etc.). */
  scoreable?: boolean;
}

/** Shared checklist for the nine TCC knife-wall bays (from the 9-bay notes). */
function nineBayChecklist(bayContents: string): { label: string; required?: boolean }[] {
  return [
    { label: `Bay set to 9-bay planogram — ${bayContents} only`, required: true },
    { label: 'NO Artisan or Sabre on this bay (bulk stacks only)', required: true },
    { label: 'Orange-flagged items added to VM file (Samara)' },
  ];
}

const FIXTURES: AmbienteFixture[] = [
  // ═══════════════════════════ THE CUSTOM CHEF — 9-bay knife wall
  // Floor plan: ACC #1/#2 on the left wall, Loose Knives #1–5 along the top
  // wall, Blocks #1/#2 on the inner partition — nine wall positions, mapped to
  // the "9 BAY LAYOUT" page in walking order (Bay 1 → Bay 9).
  // Legend (verbatim): "THE CUSTOM CHEF™ — Loose Knives x 5, Knife Block Bays
  // x 2 (6 Block Cabinets)".
  {
    slug: 'acc-1',
    label: 'ACC #1',
    name: 'Ambiente 2026 · ACC #1 (Bay 1)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 738, y: 765, w: 52, h: 100 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 1: KNIFE SETS & STEAK KNIVES. Left wall, lower bay. ' +
      'Knife sets top rows, steak-knife sets mid (orange-flagged sets → VM file Samara), ' +
      'bulk knife base in the red tray. ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 1 to the reference crop: knife sets & steak knives only.',
      'Flag the orange-boxed steak-knife sets to the VM file (Samara).',
      'Keep Artisan and Sabre OFF the wall — bulk stacks only.',
    ],
    checklist: nineBayChecklist('Knife Sets & Steak Knives'),
    images: [
      { file: 'tcc-bay-1.jpg', caption: 'BAY 1 — KNIFE SETS & STEAK KNIVES (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'acc-2',
    label: 'ACC #2',
    name: 'Ambiente 2026 · ACC #2 (Bay 2)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 738, y: 665, w: 52, h: 95 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 2: KNIFE SETS & STEAK KNIVES. Left wall, upper bay. ' +
      'Sets + cleavers/shears rows, boxed block sets on the base. ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 2 to the reference crop: knife sets & steak knives only.',
      'Keep Artisan and Sabre OFF the wall — bulk stacks only.',
    ],
    checklist: nineBayChecklist('Knife Sets & Steak Knives'),
    images: [
      { file: 'tcc-bay-2.jpg', caption: 'BAY 2 — KNIFE SETS & STEAK KNIVES (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'loose-knives-1',
    label: 'Loose Knives #1',
    name: 'Ambiente 2026 · Loose Knives #1 (Bay 3)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 788, y: 598, w: 104, h: 47 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 3: ICONIX & WOLFGANG STARKE, with the LOOSE KNIVES ' +
      'glass case mid-bay. ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 3 to the reference crop: Iconix & Wolfgang Starke.',
      'Loose-knives glass case mid-bay, stocked and locked.',
    ],
    checklist: nineBayChecklist('Iconix & Wolfgang Starke + loose-knives case'),
    images: [
      { file: 'tcc-bay-3.jpg', caption: 'BAY 3 — ICONIX & WOLFGANG STARKE (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'loose-knives-2',
    label: 'Loose Knives #2',
    name: 'Ambiente 2026 · Loose Knives #2 (Bay 4)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 897, y: 598, w: 103, h: 47 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 4: ID3, with the LOOSE KNIVES glass case mid-bay. ' +
      NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 4 to the reference crop: iD3 range.',
      'Loose-knives glass case mid-bay, stocked and locked.',
    ],
    checklist: nineBayChecklist('iD3 + loose-knives case'),
    images: [
      { file: 'tcc-bay-4.jpg', caption: 'BAY 4 — ID3 (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'loose-knives-3',
    label: 'Loose Knives #3',
    name: 'Ambiente 2026 · Loose Knives #3 (Bay 5)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 1005, y: 598, w: 103, h: 47 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 5: ID3 SAMURAI & BLACK SAMURAI, with the LOOSE ' +
      'KNIVES glass case mid-bay. Orange-flagged row → VM file Samara. ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 5 to the reference crop: iD3 Samurai & Black Samurai.',
      'Loose-knives glass case mid-bay, stocked and locked.',
      'Flag the orange-boxed row to the VM file (Samara).',
    ],
    checklist: nineBayChecklist('iD3 Samurai & Black Samurai + loose-knives case'),
    images: [
      { file: 'tcc-bay-5.jpg', caption: 'BAY 5 — ID3 SAMURAI & BLACK SAMURAI (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'loose-knives-4',
    label: 'Loose Knives #4',
    name: 'Ambiente 2026 · Loose Knives #4 (Bay 6)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 1110, y: 598, w: 105, h: 47 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 6: LE CONN & KIYOSHI, with the LOOSE KNIVES glass ' +
      'case mid-bay. ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 6 to the reference crop: Le Conn & Kiyoshi.',
      'Loose-knives glass case mid-bay, stocked and locked.',
    ],
    checklist: nineBayChecklist('Le Conn & Kiyoshi + loose-knives case'),
    images: [
      { file: 'tcc-bay-6.jpg', caption: 'BAY 6 — LE CONN & KIYOSHI (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'loose-knives-5',
    label: 'Loose Knives #5',
    name: 'Ambiente 2026 · Loose Knives #5 (Bay 7)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 1218, y: 598, w: 102, h: 47 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 7: DAMASHIRO & DM EMPEROR, with the LOOSE KNIVES ' +
      'glass case mid-bay. ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 7 to the reference crop: Damashiro & DM Emperor.',
      'Loose-knives glass case mid-bay, stocked and locked.',
    ],
    checklist: nineBayChecklist('Damashiro & DM Emperor + loose-knives case'),
    images: [
      { file: 'tcc-bay-7.jpg', caption: 'BAY 7 — DAMASHIRO & DM EMPEROR (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'blocks-1',
    label: 'Blocks #1',
    name: 'Ambiente 2026 · Blocks #1 (Bay 8)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 1335, y: 655, w: 65, h: 110 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 8: KNIFE BLOCKS (block cabinets, LIFETIME GUARANTEE ' +
      'shelf strips). Part of "Knife Block Bays x 2 (6 Block Cabinets)". ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 8 to the reference crop: knife blocks in cabinets.',
      'LIFETIME GUARANTEE strips on every block shelf.',
    ],
    checklist: nineBayChecklist('Knife Blocks (cabinets)'),
    images: [
      { file: 'tcc-bay-8.jpg', caption: 'BAY 8 — KNIFE BLOCKS (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },
  {
    slug: 'blocks-2',
    label: 'Blocks #2',
    name: 'Ambiente 2026 · Blocks #2 (Bay 9)',
    kind: 'bay',
    department: 'The Custom Chef',
    page: { x: 1335, y: 765, w: 65, h: 105 },
    notes:
      'TCC 9 BAY LAYOUT — BAY 9: KNIFE BLOCKS (block cabinets, LIFETIME GUARANTEE ' +
      'shelf strips). Part of "Knife Block Bays x 2 (6 Block Cabinets)". ' + NINE_BAY_NOTES,
    instructions: [
      'Dress Bay 9 to the reference crop: knife blocks in cabinets.',
      'LIFETIME GUARANTEE strips on every block shelf.',
    ],
    checklist: nineBayChecklist('Knife Blocks (cabinets)'),
    images: [
      { file: 'tcc-bay-9.jpg', caption: 'BAY 9 — KNIFE BLOCKS (planogram crop).' },
      { file: 'nine-bay-overview.jpg', caption: 'THE CUSTOM CHEF™ 9 BAY LAYOUT — full wall.' },
    ],
  },

  // ═══════════════════════════ THE CUSTOM CHEF — block bulk stacks + podiums
  {
    slug: 'bulk-stack-1-wall',
    label: 'Knife Blocks',
    name: 'Ambiente 2026 · Block Bulk Stack 1 — LHS (wall run)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 730, y: 972, w: 60, h: 213 },
    notes:
      'BLOCK BULK STACK 1 (LHS) — boxed knife-block pallet stack, 3 boxes high. ' +
      'FRONT face (L→R): EGG · SAKAI · SYO · PODIUM. ' +
      'WALK WAY face (L→R): PODIUM · KEI · KIYO · GOZEN2 · SYO · BODO · MIZU. ' +
      'Artisan & Sabre live ONLY in bulk stacks (9-bay note).',
    instructions: [
      'Build the stack 3 boxes high, faces exactly per the stack map.',
      'FRONT: EGG, SAKAI, SYO, then the MAKE IT PERSONAL podium panel.',
      'WALK WAY: PODIUM, KEI, KIYO, GOZEN2, SYO, BODO, MIZU.',
    ],
    checklist: [
      { label: 'Front face L→R: EGG · SAKAI · SYO · PODIUM', required: true },
      { label: 'Walk-way face L→R: PODIUM · KEI · KIYO · GOZEN2 · SYO · BODO · MIZU', required: true },
      { label: 'Stack 3 boxes high, faces flush and level', required: true },
    ],
    images: [
      { file: 'bulk-stack-lhs.jpg', caption: 'BLOCK BULK STACK (LHS) — Stack 1 front + walk-way face maps.' },
    ],
  },
  {
    slug: 'podium-stack-1',
    label: 'Podium',
    name: 'Ambiente 2026 · Podium — Stack 1 (wall end)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 735, y: 920, w: 50, h: 50 },
    notes:
      'PODIUM panel at the end of Block Bulk Stack 1 — THE CUSTOM CHEF "MAKE IT ' +
      'PERSONAL" kendo-mask artwork panel (as drawn in the stack face maps).',
    checklist: [{ label: 'Podium panel upright, clean, artwork facing the aisle', required: true }],
    images: [
      { file: 'bulk-stack-lhs.jpg', caption: 'Stack 1 face maps — podium panel position.' },
    ],
  },
  {
    slug: 'bulk-stack-1-front',
    label: 'Knife Blocks',
    name: 'Ambiente 2026 · Block Bulk Stack 1 — LHS (front run)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 730, y: 1183, w: 105, h: 42 },
    notes:
      'BLOCK BULK STACK 1 (LHS) — front-corner run of the LHS bulk stack group ' +
      '(see the Stack 1 face maps). Artisan & Sabre live ONLY in bulk stacks.',
    checklist: [
      { label: 'Boxes stacked per Stack 1 face map, 3 high, flush', required: true },
    ],
    images: [
      { file: 'bulk-stack-lhs.jpg', caption: 'BLOCK BULK STACK (LHS) — Stack 1 face maps.' },
    ],
  },
  {
    slug: 'podium-stack-1-front',
    label: 'Podium',
    name: 'Ambiente 2026 · Podium — Stack 1 (front end)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 838, y: 1170, w: 52, h: 58 },
    notes: 'PODIUM panel at the front end of the LHS bulk-stack run (per Stack 1 face maps).',
    checklist: [{ label: 'Podium panel upright, clean, artwork facing the aisle', required: true }],
    images: [
      { file: 'bulk-stack-lhs.jpg', caption: 'Stack 1 face maps — podium panel position.' },
    ],
  },
  {
    slug: 'bulk-stack-2-laser',
    label: 'Knife Blocks',
    name: 'Ambiente 2026 · Block Bulk Stack 2 — RHS (laser side)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 1238, y: 872, w: 130, h: 30 },
    notes:
      'BLOCK BULK STACK 2 (RHS) — LASER MACHINE face (L→R): STRAUB · HOLZ · ' +
      'KUTCHIN · KLAR · SABRE 14 · SABRE 20. 3 boxes high. This run sits beside ' +
      'Blocks #2 facing the Personalization Laser Display. Artisan & Sabre live ' +
      'ONLY in bulk stacks.',
    instructions: [
      'Build 3 boxes high; laser-machine face L→R: STRAUB, HOLZ, KUTCHIN, KLAR, SABRE 14, SABRE 20.',
    ],
    checklist: [
      { label: 'Laser-machine face L→R: STRAUB · HOLZ · KUTCHIN · KLAR · SABRE 14 · SABRE 20', required: true },
      { label: 'Stack 3 boxes high, faces flush and level', required: true },
    ],
    images: [
      { file: 'bulk-stack-rhs.jpg', caption: 'BLOCK BULK STACK (RHS) — Stack 2 front + laser-machine face maps.' },
    ],
  },
  {
    slug: 'bulk-stack-2-front',
    label: 'Knife Blocks',
    name: 'Ambiente 2026 · Block Bulk Stack 2 — RHS (front run)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 1100, y: 1185, w: 130, h: 40 },
    notes:
      'BLOCK BULK STACK 2 (RHS) — FRONT face (L→R): PODIUM · HISA · HIKARI · ' +
      'MAKOTO · HAUTE · EPICURE, with the FREE STANDER at the end of the run ' +
      '(as drawn on the RHS stack page). 3 boxes high.',
    instructions: [
      'Build 3 boxes high; front face L→R: PODIUM, HISA, HIKARI, MAKOTO, HAUTE, EPICURE.',
      'Free Stander (Stand 3) butts the end of this run.',
    ],
    checklist: [
      { label: 'Front face L→R: PODIUM · HISA · HIKARI · MAKOTO · HAUTE · EPICURE', required: true },
      { label: 'Free Stander positioned at the end of the run', required: true },
      { label: 'Stack 3 boxes high, faces flush and level', required: true },
    ],
    images: [
      { file: 'bulk-stack-rhs.jpg', caption: 'BLOCK BULK STACK (RHS) — Stack 2 front + laser-machine face maps.' },
    ],
  },
  {
    slug: 'podium-stack-2',
    label: 'Podium',
    name: 'Ambiente 2026 · Podium — Stack 2 (front end)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 1048, y: 1172, w: 50, h: 56 },
    notes: 'PODIUM panel at the front-left end of Block Bulk Stack 2 (per Stack 2 front face map).',
    checklist: [{ label: 'Podium panel upright, clean, artwork facing the aisle', required: true }],
    images: [
      { file: 'bulk-stack-rhs.jpg', caption: 'Stack 2 face maps — podium panel position.' },
    ],
  },

  // ═══════════════════════════ THE CUSTOM CHEF — feature units
  {
    slug: 'free-stander',
    label: 'Freestander',
    name: 'Ambiente 2026 · Free Stander (Short) — Stand 3',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 1230, y: 1137, w: 112, h: 88 },
    notes:
      'FREE STANDER (SHORT) — STAND 3. FRONT: loose-knives glass case (top) · ' +
      'KUROI KIBA range cards (mid) · Baccarat Le Connoisseur knife line-up ' +
      '(bottom, 9 cards). BACK: COMPLETED LASER KNIVES (top shelf) · PENDING ' +
      'LASER KNIVES (mid shelf) · KUROI KIBA Sakura 7-piece knife-block cards ' +
      '(bottom). THE CUSTOM CHEF™ header board both sides.',
    instructions: [
      'FRONT top: loose-knives glass case, stocked + locked.',
      'FRONT mid: Kuroi Kiba artwork + knife cards. FRONT bottom: Le Connoisseur 9-knife line-up.',
      'BACK: COMPLETED laser knives top shelf, PENDING laser knives mid shelf — keep the two separated.',
      'BACK bottom: Kuroi Kiba Sakura block cards.',
    ],
    checklist: [
      { label: 'Front: glass case + Kuroi Kiba + Le Connoisseur tiers per reference', required: true },
      { label: 'Back: COMPLETED laser knives shelf (top)', required: true },
      { label: 'Back: PENDING laser knives shelf (mid) — separated from completed', required: true },
      { label: 'Header boards on both sides', required: true },
    ],
    images: [
      { file: 'free-stander.jpg', caption: 'FREE STANDER (SHORT) — Stand 3 front + back (planogram page).' },
    ],
  },
  {
    slug: 'personalization-laser',
    label: 'Personalization Laser Display',
    name: 'Ambiente 2026 · Personalization Laser Display (Personalised Pod B)',
    kind: 'stand',
    department: 'The Custom Chef',
    page: { x: 1238, y: 918, w: 150, h: 52 },
    notes:
      'PERSONALISED POD (B) + laser machine. Front panel (verbatim): "MAKE IT ' +
      'PERSONAL — Step 1. Choose your Knife. Huge range of quality Japanese or ' +
      'German Steel blades to choose from. Step 2. Choose your Design. Add an ' +
      'exclusive piece of artwork to your knife - designs to suit any chef! ' +
      'Step 3. Choose your Mark. Make it personal with initials, lucky numbers, ' +
      'or your name." Window (front + back) filled with personalised display ' +
      'knives; glass bench (front + back) with personalised knives laid flat; ' +
      'screen running TCC content; under-lighting on.',
    instructions: [
      'Pod window FRONT + BACK: personalised cleavers/knives racked per reference photos.',
      'Glass bench FRONT + BACK: personalised knives laid flat under glass.',
      'MAKE IT PERSONAL step panel lit; screen playing TCC content.',
    ],
    checklist: [
      { label: 'MAKE IT PERSONAL 3-step panel on display and lit', required: true },
      { label: 'Window front + back filled with personalised knives', required: true },
      { label: 'Bench front + back: personalised knives under glass', required: true },
      { label: 'Screen on and playing TCC content', required: true },
    ],
    images: [
      { file: 'pod-front.jpg', caption: 'PERSONALISED POD (B) — front, window-front, bench-front.' },
      { file: 'pod-back.jpg', caption: 'PERSONALISED POD (B) — back, window-back, bench-back.' },
    ],
  },
  {
    slug: 'try-me-table',
    label: 'New Table 1200x500mm',
    name: 'Ambiente 2026 · Try Me Table (Tryme & CDU Displays)',
    kind: 'table',
    department: 'The Custom Chef',
    page: { x: 1342, y: 1165, w: 135, h: 60 },
    notes:
      'TRY ME TABLE — new table 1200×500 mm, "Tryme & CDU Displays" (plan label). ' +
      'Top shelf: TM card stands (Damashiro/Kuroi Kiba/Kiyoshi artwork cards) + ' +
      'the Cuisine::pro Kolori try-rack CDU. Bottom shelf: ICONIX · WOLFGANG ' +
      'STARKE · iD3 · BLACK SAMURAI try-me boxes with TRY ME flashes. ' +
      'TRY-ME SKU LIST (verbatim, 12): ' +
      TRY_ME_SKUS.map((s) => `${s.sku} ${s.name}`).join(' · ') +
      '. The two chopping-board TM units (DM + bread knife on boards) hang top-right.',
    instructions: [
      'Top shelf: TM artwork card stands + Kolori try-rack CDU.',
      'Bottom shelf: Iconix, Wolfgang Starke, iD3, Black Samurai TRY ME boxes.',
      'All 12 try-me SKUs present and out for handling.',
    ],
    checklist: [
      { label: 'All 12 Try-Me SKUs out on display (see SKU list in notes)', required: true },
      { label: 'Top shelf: TM card stands + Kolori try-rack CDU', required: true },
      { label: 'Bottom shelf: Iconix / Wolfgang Starke / iD3 / Black Samurai TM boxes', required: true },
      { label: 'TRY ME flashes visible on every unit' },
    ],
    images: [
      { file: 'try-me-table.jpg', caption: 'TRY ME TABLE — layout + 12-SKU list + 2025 example photo.' },
    ],
    merch: TRY_ME_SKUS.map((s) => ({ sku: s.sku, row: 'Try Me' })),
  },
  {
    slug: 'centre-unit',
    label: 'Centre unit',
    name: 'Ambiente 2026 · Centre unit (unlabelled on plan)',
    kind: 'table',
    department: 'The Custom Chef',
    page: { x: 985, y: 775, w: 140, h: 80 },
    notes:
      'Centre floor unit inside The Custom Chef area. Drawn on the floor plan ' +
      'but UNLABELLED — confirm contents with VM (likely demo/wrap counter). ' +
      'Position implemented exactly as drawn.',
    scoreable: false,
    images: [{ file: 'floor-plan.png', caption: 'Ambiente 2026 floor plan — unit drawn centre-left, unlabelled.' }],
  },

  // ═══════════════════════════ back-of-house rooms (on-plan, not scored)
  {
    slug: 'coffee-station',
    label: 'Coffee Station and Personables Storage',
    name: 'Ambiente 2026 · Coffee Station and Personables Storage',
    kind: 'room',
    department: null,
    page: { x: 1405, y: 590, w: 395, h: 110 },
    notes:
      'Back-of-house room (plan label verbatim): "Coffee Station and Personables ' +
      'Storage". Door onto the walkway. Keep closed during show hours; no stock ' +
      'or personal items visible from the floor.',
    scoreable: false,
    images: [{ file: 'floor-plan.png', caption: 'Ambiente 2026 floor plan — back-of-house rooms.' }],
  },
  {
    slug: 'goods-storage',
    label: 'Goods Storage',
    name: 'Ambiente 2026 · Goods Storage',
    kind: 'room',
    department: null,
    page: { x: 2020, y: 578, w: 336, h: 192 },
    notes:
      'Back-of-house room (plan label verbatim): "Goods Storage". Door at the ' +
      'left wall. Keep closed during show hours.',
    scoreable: false,
    images: [{ file: 'floor-plan.png', caption: 'Ambiente 2026 floor plan — back-of-house rooms.' }],
  },

  // ═══════════════════════════ THE COOK SHOP — cookware wall (7-bay + fry)
  // Legend (verbatim): "THE COOK SHOP™ — Cookware x 8 bays, Tools 7 Gadets x 1
  // Bay" (8 = Fry + the 7 named loose-cookware bays).
  {
    slug: 'fry',
    label: 'Fry',
    name: 'Ambiente 2026 · Fry Wall Bay',
    kind: 'bay',
    department: 'The Cook Shop',
    page: { x: 1460, y: 770, w: 58, h: 110 },
    notes:
      'THE COOK SHOP™ FRY WALL BAY — Baccarat Flame frypans top rows (26/28/30cm ' +
      'then 24/20cm), stainless frypans mid, Baccarat ItaliCo lower rows, iD3 ' +
      'boxed frypans on the base. Sale tickets on every hook row.',
    instructions: [
      'Top: Flame 26/28/30cm, then 24/20cm row.',
      'Mid: stainless frypans. Lower: ItaliCo. Base: iD3 boxed.',
      'Ticket every hook row.',
    ],
    checklist: [
      { label: 'Flame range top rows, fronted, ticketed', required: true },
      { label: 'ItaliCo rows mid/lower per reference', required: true },
      { label: 'iD3 boxed stock on the base', required: true },
    ],
    images: [{ file: 'fry-wall.jpg', caption: 'THE COOK SHOP™ FRY WALL BAY (planogram photo).' }],
  },
  ...(
    [
      ['stone', 'Stone', 1, { x: 1520, y: 710, w: 105, h: 60 }],
      ['granite', 'Granite', 2, { x: 1630, y: 710, w: 105, h: 60 }],
      ['rock', 'Rock', 3, { x: 1742, y: 710, w: 106, h: 60 }],
      ['id3', 'ID3', 4, { x: 1855, y: 710, w: 95, h: 60 }],
      ['id3ss', 'ID3SS', 5, { x: 1960, y: 710, w: 105, h: 60 }],
      ['iconix', 'Iconix', 6, { x: 2072, y: 710, w: 108, h: 60 }],
      ['green-stone', 'Green Stone', 7, { x: 2185, y: 710, w: 90, h: 60 }],
    ] as [string, string, number, { x: number; y: number; w: number; h: number }][]
  ).map(([slug, label, bay, page]): AmbienteFixture => {
    const RANGES: Record<number, string> = {
      1: 'STONE', 2: 'GRANITE', 3: 'ROCK', 4: 'ID3', 5: 'ID3 SS', 6: 'ICONIX', 7: 'GREEN STONE',
    };
    return {
      slug: `tcs-${slug}`,
      label,
      name: `Ambiente 2026 · Cookware Bay ${bay} — ${RANGES[bay]}`,
      kind: 'bay',
      department: 'The Cook Shop',
      page,
      notes:
        `THE COOK SHOP™ 7 BAY — LOOSE COOKWARE. BAY ${bay}: ${RANGES[bay]} ` +
        '(Baccarat range). Hung loose cookware top rows, range shelf-talker strip ' +
        'mid, shelf stock below, boxed stock on the base. Set exactly to the ' +
        '7-bay reference.',
      instructions: [
        `Dress Bay ${bay} to the reference crop: Baccarat ${RANGES[bay]} only.`,
        'Range strip talker mid-bay; boxed stock base.',
      ],
      checklist: [
        { label: `Bay ${bay} = Baccarat ${RANGES[bay]} only, set to reference`, required: true },
        { label: 'Range shelf-talker strip in place', required: true },
        { label: 'Base boxed stock faced and level' },
      ],
      images: [
        { file: `tcs-bay-${bay}.jpg`, caption: `BAY ${bay} — ${RANGES[bay]} (planogram crop).` },
        { file: 'seven-bay-overview.jpg', caption: 'THE COOK SHOP™ 7 BAY — LOOSE COOKWARE (full wall).' },
      ],
    };
  }),
  {
    slug: 'tools-gadgets',
    label: 'Tools & Gadgets',
    name: 'Ambiente 2026 · Tools & Gadgets Bay (A-Series & Kolori)',
    kind: 'bay',
    department: 'The Cook Shop',
    page: { x: 2280, y: 765, w: 68, h: 110 },
    notes:
      'THE COOK SHOP™ A-SERIES & KOLORI — tools & gadgets bay. Top: 3 mini ' +
      'frypans with red Kolori tools. A-Series stainless/nylon tools hung in ' +
      'columns mid. Kolori colour-blocked tools below: red · navy · teal · ' +
      'yellow · grey rows.',
    instructions: [
      'Top shelf: 3 mini frypans + red Kolori tools.',
      'Mid: A-Series tools in straight columns.',
      'Below: Kolori colour rows — red, navy, teal, yellow, grey.',
    ],
    checklist: [
      { label: 'A-Series columns straight and fully hung', required: true },
      { label: 'Kolori colour-blocked rows in order (red/navy/teal/yellow/grey)', required: true },
    ],
    images: [{ file: 'tools-gadgets.jpg', caption: 'A-SERIES & KOLORI tools & gadgets bay (planogram photo).' }],
  },

  // ═══════════════════════════ THE COOK SHOP — floor units
  {
    slug: 'quad-stand',
    label: 'Quad Stand',
    name: 'Ambiente 2026 · Quad Stand',
    kind: 'stand',
    department: 'The Cook Shop',
    page: { x: 1445, y: 913, w: 100, h: 100 },
    notes:
      'THE COOK SHOP™ QUAD STAND — four-arm castor stand, one range per arm: ' +
      'BIO PLUS · CERAMIX · CULINARIX · SWISSTEC. Pans hung graduated, smallest ' +
      'top → largest bottom, header card on each arm (pink block on the page = ' +
      'header position).',
    instructions: [
      'One range per arm: Bio Plus, Ceramix, Culinarix, SwissTec.',
      'Graduate pan sizes top→bottom; header card each arm; lock castors.',
    ],
    checklist: [
      { label: 'Arms dressed: BIO PLUS / CERAMIX / CULINARIX / SWISSTEC', required: true },
      { label: 'Header card on each arm', required: true },
      { label: 'Castors locked' },
    ],
    images: [{ file: 'quad-stand.jpg', caption: 'QUAD STAND — Bio Plus · Ceramix · Culinarix · SwissTec.' }],
  },
  ...[1, 2, 3].map((n): AmbienteFixture => {
    const POSITIONS: Record<number, string> = {
      1: 'Position 1 — PCP-1023758 BC GRANITE COOKSET 4PC (Granite)',
      2: 'Position 2 — PCP-1045009 BC GREENSTONE COOKSET 4PC (GREEN STONE)',
      3: 'Position 3 — PCP-1045297 BC ID3 SS COOKSET 4PC (iD3 SS)',
    };
    return {
      slug: `dais-b-${n}`,
      label: 'Dais B',
      name: `Ambiente 2026 · Dais B ${n} — 4pc Cooksets`,
      kind: 'dais',
      department: 'The Cook Shop',
      page: { x: [1635, 1698, 1762][n - 1], y: 905, w: 63, h: 70 },
      notes:
        `THE COOK SHOP™ 4PC COOKSET — ${POSITIONS[n]}. VM ORDER L - R (verbatim). ` +
        'Birds-eye: 4 PIECE COOKSET footprint 56.58×30 per face, twin rows. ' +
        'Boxed cooksets stacked on the dais, display board on top with the live ' +
        'set + SAVE % ticket. REQUIREMENTS (page, verbatim): 3 X DIAS B · 3 X ' +
        'COOKSET DISPLAY BOARDS · 3 X A6 ACRYLIC TICKET HOLDER · 2 X DOUBLE ' +
        'FRYPAN STAND.',
      instructions: [
        `Stack ${POSITIONS[n].split('— ')[1]} boxes on this dais (VM order L→R).`,
        'Cookset display board on top, live set built, SAVE ticket up.',
        'A6 acrylic ticket holder at the front edge.',
      ],
      checklist: [
        { label: POSITIONS[n], required: true },
        { label: 'Cookset display board fitted on top with live set', required: true },
        { label: 'A6 acrylic ticket holder with ticket', required: true },
        { label: 'Frypan-stand build per guide (2 double stands across the 3 dais)' },
      ],
      images: [{ file: 'cookset-4pc.jpg', caption: '4PC COOKSET — dais layout, position table, requirements.' }],
    };
  }),
  ...[1, 2, 3].map((n): AmbienteFixture => ({
    slug: `dais-a-${n}`,
    label: 'Dais A',
    name: `Ambiente 2026 · Dais A ${n} — 6pc Cooksets`,
    kind: 'dais',
    department: 'The Cook Shop',
    page: { x: [1935, 1998, 2062][n - 1], y: 905, w: 64, h: 70 },
    notes:
      'THE COOK SHOP™ 6PC COOKSET — Dais A group (front faces L→R: Baccarat ' +
      'STONE value pack · iROCK 6-piece · Baccarat/ICONIX stainless). Birds-eye: ' +
      '6 PIECE COOKSET footprint 66×39.8 per face, twin rows. Boxed cooksets ' +
      'stacked, display board on top with live set + SAVE % ticket. REQUIREMENTS ' +
      '(page, verbatim): 4 X DIAS A · 4 X COOKSET DISPLAY BOARDS · 4 X A6 ' +
      'ACRYLIC TICKET HOLDER · 4 X SINGLE FRYPAN STAND · 4 X DOUBLE FRYPAN ' +
      'STAND. (Floor plan draws 3 Dais A here + 2 Dais A GWP at the front — ' +
      'spec sheet calls for 4; confirm the 4th with VM.)',
    instructions: [
      'Stack 6pc cookset boxes per the reference; one range per face.',
      'Display board on top: live set + single & double frypan stands.',
      'A6 acrylic ticket holder at the front edge.',
    ],
    checklist: [
      { label: '6pc cookset boxes stacked per reference (STONE / iROCK / ICONIX faces)', required: true },
      { label: 'Cookset display board fitted with live set', required: true },
      { label: 'A6 acrylic ticket holder with ticket', required: true },
      { label: 'Single + double frypan stands used per guide' },
    ],
    images: [{ file: 'cookset-6pc.jpg', caption: '6PC COOKSET — dais layout, birds-eye, requirements.' }],
  })),
  {
    slug: 'dais-gwp-1',
    label: 'Dais A GWP',
    name: 'Ambiente 2026 · Dais A GWP 1 — Stone 10pc + Mokuzai gift',
    kind: 'dais',
    department: 'The Cook Shop',
    page: { x: 1575, y: 1148, w: 85, h: 77 },
    notes:
      "THE COOK SHOP™ GWP'S — DAIS (1). SALE 2 (21.10 - 09.11), verbatim: OFFER " +
      'PCP-1026851 BC STONE COOKSET 10PC · GIFT PCP-1032440 BC DM EMP MOKUZAI ' +
      'KNF BL 7PC. FRONT: Stone 10pc value-pack boxes stacked, FREE GIFT A3 call ' +
      '("Mokuzai 7 Piece Knife Block Set — SAVE 86% — WHEN YOU PURCHASE 10 Piece ' +
      'Cookset NOW ONLY $399.99"), gift blocks wrapped in red ribbon. BACK: The ' +
      'Healthy Fry 9L/9.5QT air fryer boxes + Granite 6-piece cookset gift ' +
      'display with FREE GIFT call. 1 X DIAS A REQUIRED (page, verbatim).',
    instructions: [
      'Front: BC STONE COOKSET 10PC boxes stacked; A3 FREE GIFT call on display.',
      'Gift Mokuzai knife blocks wrapped with red ribbon — refer to example photo.',
      'Back: Healthy Fry air-fryer + Granite 6pc gift display per reference.',
    ],
    checklist: GWP_CHECKLIST,
    images: [
      { file: 'gwp1-front.jpg', caption: "GWP'S — FRONT (1): Stone 10pc offer + Mokuzai gift, checklist." },
      { file: 'gwp1-back.jpg', caption: "GWP'S — BACK (1): Healthy Fry + Granite 6pc gift." },
    ],
  },
  {
    slug: 'dais-gwp-2',
    label: 'Dais A GWP',
    name: 'Ambiente 2026 · Dais A GWP 2 — iD3 / IronRoc + knife-block gifts',
    kind: 'dais',
    department: 'The Cook Shop',
    page: { x: 1665, y: 1148, w: 87, h: 77 },
    notes:
      "THE COOK SHOP™ GWP'S — DAIS (2). FRONT: iD3 6pc/9pc cookset boxes stacked " +
      'with live iD3 set on top; gift iD3 knife-block boxes ribboned in red, FREE ' +
      'GIFT call up. BACK: IRONROC 6-piece cookset boxes with red ribbon + ' +
      'Mokuzai knife-block gift panel, FREE GIFT call ("7 Piece Mokuzai Knife ' +
      'Block … NOW ONLY $399.99").',
    instructions: [
      'Front: iD3 cookset boxes + knife-block gifts ribboned in red; FREE GIFT call up.',
      'Back: IronRoc cooksets + Mokuzai gift panel per reference.',
    ],
    checklist: GWP_CHECKLIST,
    images: [
      { file: 'gwp2-front.jpg', caption: "GWP'S — FRONT (2): iD3 cooksets + knife-block gift." },
      { file: 'gwp2-back.jpg', caption: "GWP'S — BACK (2): IronRoc cooksets + Mokuzai gift." },
    ],
  },
  {
    slug: 'vm-table-1',
    label: 'VM Table 1 — Nook Display',
    name: 'Ambiente 2026 · VM Table 1 — Nook Display',
    kind: 'table',
    department: 'The Cook Shop',
    page: { x: 1753, y: 1105, w: 187, h: 127 },
    notes:
      'THE COOK SHOP™ VM TABLE 1 — NOOK (pages marked EXAMPLE ONLY). Three-tier ' +
      'table colour-blocked by shelf: cream (top) · blue (mid) · green (bottom); ' +
      'boxed NOOK flat-packs with live pieces on top of each stack; NOOK ' +
      '"DESIGNED TO BE DISPLAYED" header graphic; A3 call out ("SAVE 50% OFF RRP ' +
      'ALL NOOK"); A4 NOOK menu board with price list; glass VM jars + utensil ' +
      'props on the top tier.',
    instructions: [
      'Colour-block tiers: cream top, blue mid, green bottom; live piece on each stack.',
      'A3 SAVE 50% call + A4 NOOK menu board placed per reference.',
      'Glass VM jars + props on the top tier.',
    ],
    checklist: [
      { label: 'A7 SALE TICKETS', required: true },
      { label: 'A3 CALL OUT', required: true },
      { label: 'A4 MENU BOARD', required: true },
      { label: '2 x TABLE EXTENDERS', required: true },
      { label: '3 X GLASS VM JARS', required: true },
      { label: 'VM PROPS (VARIES BY STORE)' },
    ],
    images: [
      { file: 'vm-table-1-front.jpg', caption: 'VM TABLE 1 — NOOK front (EXAMPLE ONLY) + A3/A4 + checklist.' },
      { file: 'vm-table-1-back.jpg', caption: 'VM TABLE 1 — NOOK back (EXAMPLE ONLY).' },
    ],
  },
  {
    slug: 'vm-table-2',
    label: 'VM Table 2 — Le Conn Display',
    name: 'Ambiente 2026 · VM Table 2 — Le Connoisseur Display',
    kind: 'table',
    department: 'The Cook Shop',
    page: { x: 2058, y: 1100, w: 187, h: 132 },
    notes:
      'THE COOK SHOP™ VM TABLE 2 — BACCARAT LE CONNOISSEUR (pages marked EXAMPLE ' +
      'ONLY). "A Lifetime of French Cooking" header; French-ovens + colour pieces ' +
      'on the top tier; tricolore boxed bakers mid tier with SHELF TALKER X 2 ' +
      '(Baccarat LE CONNOISSEUR strips) between tiers; boxed ovens/frypans base ' +
      'tier; A4 Le Connoisseur menu board with price list; SAVE 50% calls.',
    instructions: [
      'Build tiers per reference: live ovens top, boxed bakers mid, boxed ovens base.',
      'Fit BOTH Le Connoisseur shelf-talker strips between tiers.',
      'A4 menu board + SAVE 50% calls placed per reference.',
    ],
    checklist: [
      { label: 'A7 SALE TICKETS', required: true },
      { label: 'A4 MENU BOARD', required: true },
      { label: '2 x TABLE EXTENDERS', required: true },
      { label: '2 x VM TABLE RISERS', required: true },
      { label: 'SHELF TALKER X 2', required: true },
      { label: 'VM PROPS (VARIES BY STORE)' },
    ],
    images: [
      { file: 'vm-table-2-front.jpg', caption: 'VM TABLE 2 — LE CONNOISSEUR front (EXAMPLE ONLY) + shelf talkers + checklist.' },
      { file: 'vm-table-2-back.jpg', caption: 'VM TABLE 2 — LE CONNOISSEUR back (EXAMPLE ONLY).' },
    ],
  },
];

// The six SS26 placeholder fixtures, superseded by the real planogram.
const PLACEHOLDER_FIXTURE_IDS = [
  'seed-fixture-ambiente-wall-left',
  'seed-fixture-ambiente-wall-right',
  'seed-fixture-ambiente-hero-table',
  'seed-fixture-ambiente-display-bay-1',
  'seed-fixture-ambiente-display-bay-2',
  'seed-fixture-ambiente-demo-counter',
];

// ───────────────────────────────────────────── main
async function main(): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID } });
  if (!project) throw new Error(`project ${PROJECT_ID} not found — run pnpm db:seed first`);
  const orgId = project.orgId;

  console.log('Importing AMBIENTE 2026 VM planogram (1:1 from the PDF)…');

  // --- Venue stores (one per concession, Myer-style naming) -----------------
  for (const [id, fascia] of [
    [CC_STORE_ID, CC_FASCIA],
    [CS_STORE_ID, CS_FASCIA],
  ] as const) {
    await prisma.store.upsert({
      where: { id },
      update: {
        orgId,
        projectId: PROJECT_ID,
        name: `${VENUE} — ${fascia}`,
        brand: fascia,
        externalRef: id.replace('seed-store-', ''),
      },
      create: {
        id,
        orgId,
        projectId: PROJECT_ID,
        name: `${VENUE} — ${fascia}`,
        brand: fascia,
        externalRef: id.replace('seed-store-', ''),
      },
    });
  }
  console.log(`  venues: "${VENUE} — ${CC_FASCIA}" + "${VENUE} — ${CS_FASCIA}"`);

  // --- Campaign -------------------------------------------------------------
  // Ambiente 2026, Frankfurt: 6–10 Feb 2026 (the show window the planogram is for).
  const campaign = await prisma.campaign.upsert({
    where: { orgId_key: { orgId, key: CAMPAIGN_KEY } },
    update: {
      projectId: PROJECT_ID,
      name: 'Ambiente 2026 — VM Planogram',
      status: CampaignStatus.ACTIVE,
      startsAt: new Date('2026-02-06T00:00:00Z'),
      endsAt: new Date('2026-02-10T23:59:59Z'),
    },
    create: {
      orgId,
      projectId: PROJECT_ID,
      key: CAMPAIGN_KEY,
      name: 'Ambiente 2026 — VM Planogram',
      status: CampaignStatus.ACTIVE,
      startsAt: new Date('2026-02-06T00:00:00Z'),
      endsAt: new Date('2026-02-10T23:59:59Z'),
    },
  });
  console.log(`  campaign: ${campaign.key} — "${campaign.name}" (${campaign.status})`);

  // --- Fixtures · placements · guides · checklists · captures ---------------
  const products = await prisma.product.findMany({
    where: { orgId, sku: { in: TRY_ME_SKUS.map((s) => s.sku) } },
    select: { id: true, sku: true },
  });
  const productBySku = new Map(products.map((p) => [p.sku, p.id]));

  let nFixtures = 0;
  let nImages = 0;
  let nChecks = 0;
  let nMerch = 0;

  for (let i = 0; i < FIXTURES.length; i++) {
    const f = FIXTURES[i];
    // Concession routing: Cook Shop fixtures + the back-of-house rooms (which
    // sit in the right half of the booth) go to the Cookshop plan; everything
    // else is the Custom Chef shop.
    const fascia = f.department === 'The Cook Shop' || f.department === null ? CS_FASCIA : CC_FASCIA;
    const storeId = fascia === CS_FASCIA ? CS_STORE_ID : CC_STORE_ID;
    const c = toCanvas(ZONES[fascia], f.page);
    const instructions = f.instructions?.map((text, n) => ({ id: `amb26-${f.slug}-step-${n + 1}`, text }));

    // Library reference image = first image (per-fixture crop / spec page).
    const refKey = await storeAsset(f.images[0].file, 'references');

    const fixture = await prisma.fixture.upsert({
      where: { orgId_name: { orgId, name: f.name } },
      update: {
        kind: f.kind,
        department: f.department,
        projectId: PROJECT_ID,
        referenceKey: refKey,
        referenceCaption: f.images[0].caption,
        defaultNotes: f.notes,
        defaultInstructions: instructions ?? undefined,
        archivedAt: null,
      },
      create: {
        id: `amb26-fixture-${f.slug}`,
        orgId,
        name: f.name,
        kind: f.kind,
        department: f.department,
        projectId: PROJECT_ID,
        referenceKey: refKey,
        referenceCaption: f.images[0].caption,
        defaultNotes: f.notes,
        defaultInstructions: instructions ?? undefined,
      },
    });
    nFixtures++;

    // Library checklist template (authored once, flows into future guides).
    await prisma.fixtureChecklistTemplate.deleteMany({ where: { fixtureId: fixture.id } });
    for (let n = 0; n < (f.checklist?.length ?? 0); n++) {
      const item = f.checklist![n];
      await prisma.fixtureChecklistTemplate.create({
        data: { orgId, fixtureId: fixture.id, label: item.label, required: item.required ?? false, order: n },
      });
    }

    // Placement — measured straight off the floor plan, on its concession's
    // plan only (drop any stale placement on the sibling store from earlier
    // single-canvas runs).
    await prisma.placement.deleteMany({
      where: { campaignId: campaign.id, fixtureId: fixture.id, storeId: { not: storeId } },
    });
    await prisma.placement.upsert({
      where: {
        storeId_campaignId_fixtureId: {
          storeId,
          campaignId: campaign.id,
          fixtureId: fixture.id,
        },
      },
      update: { label: f.label, x: c.x, y: c.y, w: c.w, h: c.h, rotation: 0, applicable: true, order: i },
      create: {
        orgId,
        storeId,
        campaignId: campaign.id,
        fixtureId: fixture.id,
        label: f.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        rotation: 0,
        applicable: true,
        order: i,
      },
    });

    // Guide sheet + example images + guide checklist items.
    const guide = await prisma.guideFixture.upsert({
      where: { campaignId_fixtureId: { campaignId: campaign.id, fixtureId: fixture.id } },
      update: { notes: f.notes, instructions: instructions ?? undefined, order: i },
      create: {
        orgId,
        campaignId: campaign.id,
        fixtureId: fixture.id,
        notes: f.notes,
        instructions: instructions ?? undefined,
        order: i,
      },
    });

    await prisma.exampleImage.deleteMany({ where: { guideFixtureId: guide.id } });
    for (let n = 0; n < f.images.length; n++) {
      const img = f.images[n];
      const key = await storeAsset(img.file, 'examples');
      if (!key) continue;
      await prisma.exampleImage.create({
        data: { orgId, guideFixtureId: guide.id, storageKey: key, caption: img.caption, bestInClass: n === 0 },
      });
      nImages++;
    }

    await prisma.guideFixtureChecklistItem.deleteMany({ where: { guideFixtureId: guide.id } });
    for (let n = 0; n < (f.checklist?.length ?? 0); n++) {
      const item = f.checklist![n];
      await prisma.guideFixtureChecklistItem.create({
        data: {
          orgId,
          guideFixtureId: guide.id,
          label: item.label,
          required: item.required ?? false,
          order: n,
        },
      });
      nChecks++;
    }

    // Merchandise — only SKUs that exist in the real catalog.
    if (f.merch?.length) {
      await prisma.merchandise.deleteMany({ where: { guideFixtureId: guide.id } });
      for (let n = 0; n < f.merch.length; n++) {
        const m = f.merch[n];
        const productId = productBySku.get(m.sku);
        if (!productId) {
          console.warn(`  ! sku not in catalog, merch skipped: ${m.sku}`);
          continue;
        }
        await prisma.merchandise.create({
          data: { orgId, guideFixtureId: guide.id, productId, row: m.row, order: n },
        });
        nMerch++;
      }
    }

    // Setup-verify TODO — honest zero state (nothing photographed or scored),
    // on the same concession store as the placement.
    await prisma.fixtureCapture.deleteMany({
      where: { campaignId: campaign.id, fixtureId: fixture.id, storeId: { not: storeId } },
    });
    if (f.scoreable !== false) {
      await prisma.fixtureCapture.upsert({
        where: {
          storeId_campaignId_fixtureId: {
            storeId,
            campaignId: campaign.id,
            fixtureId: fixture.id,
          },
        },
        update: {},
        create: {
          orgId,
          storeId,
          campaignId: campaign.id,
          fixtureId: fixture.id,
          needsPhoto: true,
        },
      });
    }
  }

  // --- Archive the SS26 placeholder fixtures --------------------------------
  const archived = await prisma.fixture.updateMany({
    where: { id: { in: PLACEHOLDER_FIXTURE_IDS }, archivedAt: null },
    data: { archivedAt: new Date() },
  });

  console.log(
    `  fixtures: ${nFixtures} placed · ${nImages} example images · ${nChecks} checklist items · ${nMerch} merch links`,
  );
  if (archived.count > 0) {
    console.log(`  archived ${archived.count} SS26 placeholder fixtures (superseded)`);
  }
  console.log('\nDone — Ambiente 2026 planogram implemented 1:1.');
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
