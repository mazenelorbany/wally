// =============================================================================
// FLYER TEMPLATES — ready-made, data-bound starting points.
//
// These reproduce the real Myer Stocktake tickets (pure black/white type, no
// product photo) with the five fields bound to product data: SAVE %, RRP
// (struck), NOW, product name, SKU. Loading a template replaces the canvas; the
// author can then tune positions/fonts on the canvas before generating the set.
//
// Coordinates are approximate to the printed reference and meant to be nudged
// in the editor — exact trim sizes follow once Mazen confirms the size list.
// =============================================================================

import type { El, TextEl, RectEl } from './model';
import { FONT_DISPLAY } from './model';

const INK = '#0E0E0D';
const PAPER = '#FFFFFF';

interface Template {
  key: string;
  label: string;
  w: number;
  h: number;
  build: () => El[];
}

let n = 0;
const id = (p: string) => `tpl_${p}_${n++}`;

const text = (t: Partial<TextEl> & Pick<TextEl, 'x' | 'y' | 'width' | 'fontSize'>): TextEl => ({
  id: id('t'),
  type: 'text',
  height: t.fontSize * 1.2,
  rotation: 0,
  opacity: 1,
  text: t.text ?? '',
  fontFamily: FONT_DISPLAY,
  fill: t.fill ?? INK,
  align: t.align ?? 'left',
  fontStyle: t.fontStyle ?? '',
  ...t,
});

const rect = (r: Pick<RectEl, 'x' | 'y' | 'width' | 'height'> & Partial<RectEl>): RectEl => ({
  id: id('r'),
  type: 'rect',
  rotation: 0,
  opacity: 1,
  fill: r.fill ?? INK,
  cornerRadius: r.cornerRadius ?? 0,
  stroke: '',
  strokeWidth: 0,
  ...r,
});

// --- Sale ticket, portrait (the "Yellow Paper" format) ----------------------
function saleTicketPortrait(): El[] {
  const W = 397;
  return [
    // SAVE  ·  big % number  ·  % / OFF / RRP marks
    text({ text: 'SAVE', x: 24, y: 26, width: W - 48, fontSize: 78, fontStyle: 'bold' }),
    text({ bind: 'savePct', text: '75', x: 22, y: 104, width: 200, fontSize: 150, fontStyle: 'bold' }),
    text({ text: '%', x: 214, y: 120, width: 70, fontSize: 60, fontStyle: 'bold' }),
    text({ text: 'OFF', x: 268, y: 150, width: 110, fontSize: 24, fontStyle: 'bold' }),
    text({ text: 'RRP', x: 268, y: 174, width: 110, fontSize: 24, fontStyle: 'bold' }),

    // Black price band
    rect({ x: 14, y: 298, width: W - 28, height: 98, fill: INK }),
    text({ text: 'RRP', x: 44, y: 314, width: 70, fontSize: 28, fill: PAPER }),
    text({
      bind: 'rrpPrice',
      text: '$1999.99',
      x: 118,
      y: 312,
      width: 240,
      fontSize: 28,
      fill: PAPER,
      textDecoration: 'line-through',
    }),
    text({ text: 'NOW', x: 30, y: 348, width: 130, fontSize: 40, fontStyle: 'bold', fill: PAPER }),
    text({
      bind: 'nowPrice',
      text: '$499.99',
      x: 158,
      y: 343,
      width: 220,
      fontSize: 46,
      fontStyle: 'bold',
      fill: PAPER,
    }),

    // Product name (2 lines, centred) + SKU (bottom-right)
    text({ bind: 'name', text: 'Product name', x: 24, y: 424, width: W - 48, fontSize: 20, align: 'center' }),
    text({ bind: 'sku', text: '0000000', x: 24, y: 548, width: W - 48, fontSize: 12, align: 'right', fill: '#7E7D77' }),
  ];
}

// --- Sale ticket, landscape (A6 shelf strip) ---------------------------------
function saleTicketLandscape(): El[] {
  const W = 559;
  return [
    // Left column: SAVE · big % number · % / OFF / RRP marks
    text({ text: 'SAVE', x: 24, y: 22, width: 240, fontSize: 56, fontStyle: 'bold' }),
    text({ bind: 'savePct', text: '75', x: 22, y: 82, width: 160, fontSize: 118, fontStyle: 'bold' }),
    text({ text: '%', x: 168, y: 94, width: 56, fontSize: 46, fontStyle: 'bold' }),
    text({ text: 'OFF', x: 216, y: 116, width: 80, fontSize: 20, fontStyle: 'bold' }),
    text({ text: 'RRP', x: 216, y: 138, width: 80, fontSize: 20, fontStyle: 'bold' }),

    // Right column: black price band + product name
    rect({ x: 272, y: 22, width: 273, height: 92, fill: INK }),
    text({ text: 'RRP', x: 290, y: 36, width: 52, fontSize: 22, fill: PAPER }),
    text({
      bind: 'rrpPrice',
      text: '$1999.99',
      x: 344,
      y: 34,
      width: 190,
      fontSize: 22,
      fill: PAPER,
      textDecoration: 'line-through',
    }),
    text({ text: 'NOW', x: 286, y: 66, width: 96, fontSize: 30, fontStyle: 'bold', fill: PAPER }),
    text({
      bind: 'nowPrice',
      text: '$499.99',
      x: 376,
      y: 62,
      width: 160,
      fontSize: 32,
      fontStyle: 'bold',
      fill: PAPER,
    }),
    text({ bind: 'name', text: 'Product name', x: 272, y: 136, width: 273, fontSize: 16, align: 'center' }),

    text({ bind: 'sku', text: '0000000', x: 24, y: 368, width: W - 48, fontSize: 11, align: 'right', fill: '#7E7D77' }),
  ];
}

// --- Half price ticket, portrait ----------------------------------------------
// The flat "½ PRICE" stocktake format — no computed save %, same price band.
function halfPriceTicketPortrait(): El[] {
  const W = 397;
  return [
    text({ text: '½', x: 24, y: 18, width: 200, fontSize: 230, fontStyle: 'bold' }),
    text({ text: 'PRICE', x: 214, y: 118, width: 160, fontSize: 52, fontStyle: 'bold' }),

    // Black price band (same geometry as the portrait sale ticket)
    rect({ x: 14, y: 298, width: W - 28, height: 98, fill: INK }),
    text({ text: 'RRP', x: 44, y: 314, width: 70, fontSize: 28, fill: PAPER }),
    text({
      bind: 'rrpPrice',
      text: '$1999.99',
      x: 118,
      y: 312,
      width: 240,
      fontSize: 28,
      fill: PAPER,
      textDecoration: 'line-through',
    }),
    text({ text: 'NOW', x: 30, y: 348, width: 130, fontSize: 40, fontStyle: 'bold', fill: PAPER }),
    text({
      bind: 'nowPrice',
      text: '$499.99',
      x: 158,
      y: 343,
      width: 220,
      fontSize: 46,
      fontStyle: 'bold',
      fill: PAPER,
    }),

    text({ bind: 'name', text: 'Product name', x: 24, y: 424, width: W - 48, fontSize: 20, align: 'center' }),
    text({ bind: 'sku', text: '0000000', x: 24, y: 548, width: W - 48, fontSize: 12, align: 'right', fill: '#7E7D77' }),
  ];
}

// --- Sale poster, A4 portrait --------------------------------------------------
// The portrait ticket scaled 2× for window/aisle display (A4 at 96dpi).
function salePosterA4(): El[] {
  const W = 794;
  return [
    text({ text: 'SAVE', x: 48, y: 52, width: W - 96, fontSize: 156, fontStyle: 'bold' }),
    text({ bind: 'savePct', text: '75', x: 44, y: 208, width: 400, fontSize: 300, fontStyle: 'bold' }),
    text({ text: '%', x: 428, y: 240, width: 140, fontSize: 120, fontStyle: 'bold' }),
    text({ text: 'OFF', x: 536, y: 300, width: 220, fontSize: 48, fontStyle: 'bold' }),
    text({ text: 'RRP', x: 536, y: 348, width: 220, fontSize: 48, fontStyle: 'bold' }),

    // Black price band
    rect({ x: 28, y: 596, width: W - 56, height: 196, fill: INK }),
    text({ text: 'RRP', x: 88, y: 628, width: 140, fontSize: 56, fill: PAPER }),
    text({
      bind: 'rrpPrice',
      text: '$1999.99',
      x: 236,
      y: 624,
      width: 480,
      fontSize: 56,
      fill: PAPER,
      textDecoration: 'line-through',
    }),
    text({ text: 'NOW', x: 60, y: 696, width: 260, fontSize: 80, fontStyle: 'bold', fill: PAPER }),
    text({
      bind: 'nowPrice',
      text: '$499.99',
      x: 316,
      y: 686,
      width: 440,
      fontSize: 92,
      fontStyle: 'bold',
      fill: PAPER,
    }),

    text({ bind: 'name', text: 'Product name', x: 48, y: 848, width: W - 96, fontSize: 40, align: 'center' }),
    text({ bind: 'sku', text: '0000000', x: 48, y: 1078, width: W - 96, fontSize: 24, align: 'right', fill: '#7E7D77' }),
  ];
}

export const TEMPLATES: Template[] = [
  { key: 'sale-ticket-portrait', label: 'Sale ticket (portrait)', w: 397, h: 561, build: saleTicketPortrait },
  { key: 'sale-ticket-landscape', label: 'Sale ticket (landscape)', w: 559, h: 397, build: saleTicketLandscape },
  { key: 'half-price-portrait', label: 'Half price ticket (portrait)', w: 397, h: 561, build: halfPriceTicketPortrait },
  { key: 'sale-poster-a4', label: 'Sale poster (A4)', w: 794, h: 1123, build: salePosterA4 },
];
