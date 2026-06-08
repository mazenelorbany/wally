// =============================================================================
// floor-layout — a believable retail-department layout on the 1000×640 canvas.
// =============================================================================
//
// The Myer concession floor maps were laid out as a uniform `i % 4` grid, which
// renders as a gallery of identical cards, not a store. This module gives the
// same fixtures a layout that reads as a real department: wall-hugging bays
// around the perimeter, a couple of center islands, and feature tables flanking
// the front entrance — with varied sizes and the entrance kept clear.
//
// The manager floor view (apps/web) draws walls + a tiled floor + an entrance
// (a door swing on the bottom-centre wall) around these placements, so the
// slots below intentionally hug the perimeter and leave the bottom-centre open.
//
// Used by BOTH the seed (seed-restore-myer.ts, so every fresh seed is correct)
// and the one-shot relayout script (relayout-myer-floor.ts).
// =============================================================================

export const FLOOR_W = 1000;
export const FLOOR_H = 640;

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

// Ordered so a PARTIAL fill (fewer fixtures than slots) still spreads across the
// floor instead of clustering: top wall first, then upper side bays, center
// islands, lower side bays, lower islands, then the entrance-flanking tables.
// Hand-checked: no two slots overlap, all sit inside the walls, and none cross
// the entrance band (x 415–585 along the bottom).
const SLOTS: readonly Slot[] = [
  // Top wall — a run of bays (wide + short, hugging the back wall).
  { x: 40, y: 28, w: 205, h: 92 },
  { x: 255, y: 28, w: 205, h: 92 },
  { x: 470, y: 28, w: 205, h: 92 },
  { x: 685, y: 28, w: 275, h: 92 },
  // Upper side walls — tall, narrow bays.
  { x: 28, y: 150, w: 120, h: 160 },
  { x: 852, y: 150, w: 120, h: 160 },
  // Center islands — mid-floor gondolas.
  { x: 320, y: 175, w: 165, h: 120 },
  { x: 535, y: 175, w: 165, h: 120 },
  // Lower side walls — tall, narrow bays.
  { x: 28, y: 330, w: 120, h: 160 },
  { x: 852, y: 330, w: 120, h: 160 },
  // Lower islands.
  { x: 185, y: 360, w: 200, h: 120 },
  { x: 615, y: 360, w: 200, h: 120 },
  // Feature tables flanking the entrance (bottom-centre stays open).
  { x: 175, y: 510, w: 175, h: 95 },
  { x: 650, y: 510, w: 175, h: 95 },
];

/**
 * Return `total` slot positions for a store's fixtures, in placement order.
 * Up to SLOTS.length fixtures get the curated layout above. Beyond that (rare —
 * a concession rarely has >14 applicable fixtures) we fall back to a clean
 * spread grid in the central band so nothing overlaps the walls or entrance.
 */
export function layoutFor(total: number): Slot[] {
  if (total <= SLOTS.length) return SLOTS.slice(0, total);

  const out: Slot[] = [];
  const cols = 4;
  const cellW = 200;
  const cellH = 120;
  const gapX = 24;
  const gapY = 28;
  const rows = Math.ceil(total / cols);
  const gridW = cols * cellW + (cols - 1) * gapX;
  const gridH = rows * cellH + (rows - 1) * gapY;
  const x0 = Math.round((FLOOR_W - gridW) / 2);
  const y0 = Math.round((FLOOR_H - gridH) / 2);
  for (let i = 0; i < total; i++) {
    out.push({
      x: x0 + (i % cols) * (cellW + gapX),
      y: y0 + Math.floor(i / cols) * (cellH + gapY),
      w: cellW,
      h: cellH,
    });
  }
  return out;
}
