// =============================================================================
// FLYER GENERATE — render a data-bound design against many products at once.
//
// Builds an off-DOM Konva stage, draws the template once per product (with
// bound fields hydrated), and stitches each render into a multi-page PDF — one
// ticket per page. This is the "design one → get the whole sale set" engine.
//
// Runs client-side (fine for a campaign's worth of tickets); the same template
// + product list can move to a server-side node-canvas renderer later for very
// large batches without changing the design format.
// =============================================================================

import Konva from 'konva';
import jsPDF from 'jspdf';

import type { El, FlyerProduct } from './model';
import { displayText } from './model';

const PDF_SCALE = 3; // ~290dpi from a 96dpi artboard
// Embed pages as JPEG, not PNG: many high-res PNG pages concatenated into one
// jsPDF document overflow V8's max string length ("Invalid string length").
// For mostly-white line-art tickets at this DPI, JPEG q0.92 is visually
// indistinguishable but ~10x smaller, so the set scales to hundreds of pages.
const JPEG_QUALITY = 0.92;

/** Add one element to a Konva layer, hydrating bound text against `product`. */
function addNode(layer: Konva.Layer, el: El, product: FlyerProduct) {
  const common = { x: el.x, y: el.y, rotation: el.rotation, opacity: el.opacity };
  if (el.type === 'text') {
    layer.add(
      new Konva.Text({
        ...common,
        text: displayText(el, product),
        width: el.width,
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
        fontStyle: el.fontStyle,
        textDecoration: el.textDecoration ?? '',
        fill: el.fill,
        align: el.align,
      }),
    );
  } else if (el.type === 'rect') {
    layer.add(
      new Konva.Rect({
        ...common,
        width: el.width,
        height: el.height,
        fill: el.fill,
        cornerRadius: el.cornerRadius,
        stroke: el.stroke || undefined,
        strokeWidth: el.strokeWidth,
      }),
    );
  }
  // Images are skipped in bulk generation for now (tickets are type-only).
}

export interface GenerateResult {
  pages: number;
}

/**
 * Render `template` once per product into a multi-page PDF and trigger a
 * download. `onProgress` reports completed pages for a progress bar.
 */
export async function generateTicketsPdf(opts: {
  template: El[];
  artW: number;
  artH: number;
  products: FlyerProduct[];
  fileName: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<GenerateResult> {
  const { template, artW, artH, products, fileName, onProgress } = opts;
  if (products.length === 0) return { pages: 0 };

  const orientation = artW > artH ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'px', format: [artW, artH] });

  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-99999px;top:0;';
  document.body.appendChild(container);
  const stage = new Konva.Stage({ container, width: artW, height: artH });
  const layer = new Konva.Layer();
  stage.add(layer);

  try {
    for (let i = 0; i < products.length; i++) {
      const product = products[i]!;
      layer.destroyChildren();
      layer.add(new Konva.Rect({ x: 0, y: 0, width: artW, height: artH, fill: '#FFFFFF' }));
      for (const el of template) addNode(layer, el, product);
      layer.draw();

      const uri = stage.toDataURL({
        pixelRatio: PDF_SCALE,
        mimeType: 'image/jpeg',
        quality: JPEG_QUALITY,
      });
      if (i > 0) pdf.addPage([artW, artH], orientation);
      pdf.addImage(uri, 'JPEG', 0, 0, artW, artH, undefined, 'FAST');
      onProgress?.(i + 1, products.length);
      // Yield so the progress bar can paint between heavy renders.
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    pdf.save(fileName);
    return { pages: products.length };
  } finally {
    stage.destroy();
    container.remove();
  }
}
