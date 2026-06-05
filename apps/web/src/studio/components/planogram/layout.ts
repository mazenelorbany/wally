// Pure, React-free planogram layout operations — easy to reason about and test.
// A planogram is an ordered list of shelves (top → bottom); each shelf is an
// ordered list of facings (left → right). The server owns the persisted `order`
// integer; here we only ever reorder arrays.

import type { MerchandiseItem, MerchandiseRow } from '@wally/types';

export type Facing = MerchandiseItem;

export interface Shelf {
  /** Stable client key (survives renames + empty shelves for React identity). */
  id: string;
  /** Display label / server row value. */
  row: string;
  facings: Facing[];
}

/** Build editor shelves from the server's grouped merchandise, in server order. */
export function seedShelves(merchandise: MerchandiseRow[]): Shelf[] {
  return merchandise.map((r) => ({ id: r.row, row: r.row, facings: r.products }));
}

/** The PATCH payload — drop empty shelves (the server only stores placed facings). */
export function toBody(shelves: Shelf[]): {
  shelves: { row: string; merchandiseIds: string[] }[];
} {
  return {
    shelves: shelves
      .filter((s) => s.facings.length > 0)
      .map((s) => ({
        row: s.row.trim(),
        merchandiseIds: s.facings.map((f) => f.merchandiseId),
      })),
  };
}

/** Content signature of the persisted layout (non-empty shelves only). */
export function sigFromRows(merchandise: MerchandiseRow[]): string {
  return JSON.stringify(
    merchandise
      .filter((r) => r.products.length > 0)
      .map((r) => [r.row.trim(), r.products.map((p) => p.merchandiseId)]),
  );
}

/** Same signature, computed from editor shelves — must match an echoed server read. */
export function sigFromShelves(shelves: Shelf[]): string {
  return JSON.stringify(
    shelves
      .filter((s) => s.facings.length > 0)
      .map((s) => [s.row.trim(), s.facings.map((f) => f.merchandiseId)]),
  );
}

/** Move a facing to (toShelfId, toIndex). Removes it from its current shelf first. */
export function moveFacing(
  shelves: Shelf[],
  facingId: string,
  toShelfId: string,
  toIndex: number,
): Shelf[] {
  let facing: Facing | undefined;
  const without = shelves.map((s) => {
    const idx = s.facings.findIndex((f) => f.merchandiseId === facingId);
    if (idx === -1) return s;
    facing = s.facings[idx];
    return { ...s, facings: s.facings.filter((_, i) => i !== idx) };
  });
  if (!facing) return shelves;
  return without.map((s) => {
    if (s.id !== toShelfId) return s;
    const next = s.facings.slice();
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, facing!);
    return { ...s, facings: next };
  });
}

/** Move a shelf to a new vertical position. */
export function reorderShelf(shelves: Shelf[], shelfId: string, toIndex: number): Shelf[] {
  const idx = shelves.findIndex((s) => s.id === shelfId);
  if (idx === -1) return shelves;
  const next = shelves.slice();
  const [s] = next.splice(idx, 1);
  if (!s) return shelves;
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, s);
  return next;
}

/** Nudge a shelf up/down by one. */
export function shiftShelf(shelves: Shelf[], shelfId: string, dir: -1 | 1): Shelf[] {
  const idx = shelves.findIndex((s) => s.id === shelfId);
  if (idx === -1) return shelves;
  return reorderShelf(shelves, shelfId, idx + dir);
}

/** Nudge a facing left/right within its shelf. */
export function shiftFacing(shelves: Shelf[], facingId: string, dir: -1 | 1): Shelf[] {
  const shelf = shelves.find((s) => s.facings.some((f) => f.merchandiseId === facingId));
  if (!shelf) return shelves;
  const idx = shelf.facings.findIndex((f) => f.merchandiseId === facingId);
  return moveFacing(shelves, facingId, shelf.id, idx + dir);
}

/** Rename a shelf; renaming onto an existing label MERGES the two shelves. */
export function renameShelf(shelves: Shelf[], shelfId: string, newRow: string): Shelf[] {
  const label = newRow.trim();
  if (!label) return shelves;
  const target = shelves.find(
    (s) => s.id !== shelfId && s.row.toLowerCase() === label.toLowerCase(),
  );
  if (target) {
    const src = shelves.find((s) => s.id === shelfId);
    if (!src) return shelves;
    return shelves
      .filter((s) => s.id !== shelfId)
      .map((s) =>
        s.id === target.id ? { ...s, facings: [...s.facings, ...src.facings] } : s,
      );
  }
  return shelves.map((s) => (s.id === shelfId ? { ...s, row: label } : s));
}

export function addShelf(shelves: Shelf[], label = 'New shelf'): Shelf[] {
  const row = uniqueLabel(label, shelves.map((s) => s.row));
  return [...shelves, { id: `new-${row}-${shelves.length}-${Date.now()}`, row, facings: [] }];
}

export function removeShelf(shelves: Shelf[], shelfId: string): Shelf[] {
  return shelves.filter((s) => s.id !== shelfId);
}

/** Move every facing of a shelf into the "Unsorted" catch-all, then drop the shelf. */
export function emptyShelfToUnsorted(shelves: Shelf[], shelfId: string): Shelf[] {
  const src = shelves.find((s) => s.id === shelfId);
  if (!src || src.facings.length === 0) return removeShelf(shelves, shelfId);
  let next = shelves;
  let unsorted = next.find((s) => s.row.toLowerCase() === 'unsorted');
  if (!unsorted) {
    unsorted = { id: 'Unsorted', row: 'Unsorted', facings: [] };
    next = [...next, unsorted];
  }
  const target = unsorted.id;
  for (const f of src.facings) {
    next = moveFacing(next, f.merchandiseId, target, Number.MAX_SAFE_INTEGER);
  }
  return removeShelf(next, shelfId);
}

export function uniqueLabel(base: string, taken: string[]): string {
  const set = new Set(taken.map((t) => t.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  let i = 2;
  while (set.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}
