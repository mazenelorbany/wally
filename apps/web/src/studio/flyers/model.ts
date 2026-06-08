// =============================================================================
// FLYER MODEL — the design-document element types + data binding.
//
// A flyer/ticket is an ordered list of elements positioned in ARTBOARD space.
// A text element may carry a `bind` to a product field; when the flyer is
// rendered against a product (bulk generation, or the editor's sample), the
// bound value replaces the element's literal text. This is what turns one
// hand-designed ticket into the whole sale set.
// =============================================================================

export type ElType = 'text' | 'rect' | 'image';

/** Product fields a text element can bind to. */
export type BindKey = 'name' | 'sku' | 'rrpPrice' | 'nowPrice' | 'savePct';

export const BIND_OPTIONS: { key: BindKey; label: string }[] = [
  { key: 'name', label: 'Product name' },
  { key: 'sku', label: 'SKU' },
  { key: 'savePct', label: 'Save % (computed)' },
  { key: 'rrpPrice', label: 'RRP price' },
  { key: 'nowPrice', label: 'NOW price' },
];

export interface BaseEl {
  id: string;
  type: ElType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}
export interface TextEl extends BaseEl {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  align: 'left' | 'center' | 'right';
  fontStyle: string; // '', 'bold', 'italic', 'bold italic'
  textDecoration?: string; // '' | 'line-through' | 'underline'
  /** When set, the rendered text comes from this product field. */
  bind?: BindKey;
}
export interface RectEl extends BaseEl {
  type: 'rect';
  fill: string;
  cornerRadius: number;
  stroke: string;
  strokeWidth: number;
}
export interface ImageEl extends BaseEl {
  type: 'image';
  src: string;
}
export type El = TextEl | RectEl | ImageEl;

/** The product shape a flyer renders against (subset of ProductDto). */
export interface FlyerProduct {
  name: string;
  sku: string;
  rrp?: number;
  salePrice?: number;
}

export const FONT_DISPLAY =
  '"Century Gothic", "Questrial", "Futura", "Avenir Next", system-ui, sans-serif';

/** Save % off RRP, rounded — null when it can't be computed or isn't a discount. */
export function savePct(p: FlyerProduct): number | null {
  if (p.rrp == null || p.salePrice == null || p.rrp <= 0 || p.salePrice >= p.rrp) return null;
  return Math.round(((p.rrp - p.salePrice) / p.rrp) * 100);
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Resolve a bound element's display string for a given product. */
export function formatBound(key: BindKey, p: FlyerProduct): string {
  switch (key) {
    case 'name':
      return p.name ?? '';
    case 'sku':
      return p.sku ?? '';
    case 'savePct': {
      const pct = savePct(p);
      return pct == null ? '' : String(pct);
    }
    case 'rrpPrice':
      return p.rrp == null ? '' : money(p.rrp);
    case 'nowPrice':
      return p.salePrice == null ? '' : money(p.salePrice);
  }
}

/** Sample product used to preview bound fields while designing (no live data). */
export const SAMPLE_PRODUCT: FlyerProduct = {
  name: 'Baccarat iD3 Black Samurai\nTHE EGG Knife Block 9 Piece',
  sku: '1033658',
  rrp: 1999.99,
  salePrice: 499.99,
};

/** The text a text element should display given an optional product context. */
export function displayText(el: TextEl, product: FlyerProduct | null): string {
  if (!el.bind) return el.text;
  return formatBound(el.bind, product ?? SAMPLE_PRODUCT);
}
