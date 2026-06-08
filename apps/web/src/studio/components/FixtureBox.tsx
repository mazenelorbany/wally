import * as React from 'react';
import { cn } from '@wally/ui';
import type { PlacedFixture } from '@wally/types';

import { fixtureKindMeta } from '../lib/fixtureKind';

/**
 * One placed fixture on the floor-plan canvas: an absolutely-positioned,
 * labelled box at its x/y/w/h/rotation. Draggable via pointer events — the move
 * is transform-based while dragging (snappy, GPU-friendly) and committed to
 * x/y on drop.
 *
 * `applicable: false` fixtures render greyed and dashed (in the guide but not
 * on this store's floor) — meaning carried by treatment + an italic "n/a" note,
 * never hue alone.
 */
/** Smallest a fixture can be dragged down to, in logical units. */
const MIN_SIZE = 40;

/** The four corner handles and the resize axes each one drives. */
const RESIZE_CORNERS = [
  { corner: 'nw', pos: '-left-1.5 -top-1.5', cursor: 'cursor-nwse-resize' },
  { corner: 'ne', pos: '-right-1.5 -top-1.5', cursor: 'cursor-nesw-resize' },
  { corner: 'sw', pos: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
  { corner: 'se', pos: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' },
] as const;

type Box = { x: number; y: number; w: number; h: number };

export function FixtureBox({
  placement,
  selected,
  scale,
  editable,
  onSelect,
  onMove,
  onResize,
}: {
  placement: PlacedFixture;
  selected: boolean;
  /** Logical-unit → screen-pixel scale, so pointer deltas map back to units. */
  scale: number;
  /** Edit-layout mode: enables drag-to-resize handles on the selected box. */
  editable: boolean;
  onSelect: (id: string) => void;
  /** Fired on drop with the committed logical x/y. */
  onMove: (id: string, x: number, y: number) => void;
  /** Fired on resize end with the committed logical x/y/w/h. */
  onResize: (id: string, box: Box) => void;
}) {
  const meta = fixtureKindMeta(placement.kind);
  const Icon = meta.icon;

  // Live drag offset in *logical units*; null when not dragging.
  const [drag, setDrag] = React.useState<{ dx: number; dy: number } | null>(null);
  const startRef = React.useRef<{
    pointerX: number;
    pointerY: number;
  } | null>(null);

  // Live box geometry in *logical units* while resizing; null otherwise. When
  // set, it overrides the placement's x/y/w/h so the box tracks the handle.
  const [resize, setResize] = React.useState<Box | null>(null);
  const resizeRef = React.useRef<
    | (Box & { pointerX: number; pointerY: number; corner: string })
    | null
  >(null);

  const onResizeDown =
    (corner: string) => (e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.button !== 0) return;
      // Keep the box's own drag-to-move from also firing.
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
        corner,
      };
      setResize({ x: placement.x, y: placement.y, w: placement.w, h: placement.h });
      // Route subsequent move/up to this handle even if the pointer leaves it.
      // setPointerCapture can throw for a non-active pointer; never let that
      // abort the resize we just armed.
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nice-to-have; the move math works without it */
      }
    };

  const onResizeMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const s = resizeRef.current;
    if (!s) return;
    const dx = (e.clientX - s.pointerX) / scale;
    const dy = (e.clientY - s.pointerY) / scale;
    let { x, y, w, h } = s;
    if (s.corner.includes('e')) w = s.w + dx;
    if (s.corner.includes('s')) h = s.h + dy;
    if (s.corner.includes('w')) {
      w = s.w - dx;
      x = s.x + dx;
    }
    if (s.corner.includes('n')) {
      h = s.h - dy;
      y = s.y + dy;
    }
    // Floor the size; west/north edges pin their opposite side when clamped.
    if (w < MIN_SIZE) {
      if (s.corner.includes('w')) x = s.x + (s.w - MIN_SIZE);
      w = MIN_SIZE;
    }
    if (h < MIN_SIZE) {
      if (s.corner.includes('n')) y = s.y + (s.h - MIN_SIZE);
      h = MIN_SIZE;
    }
    setResize({ x, y, w, h });
  };

  const endResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    const s = resizeRef.current;
    const next = resize;
    resizeRef.current = null;
    setResize(null);
    if (!s || !next) return;
    e.stopPropagation();
    if (next.w !== s.w || next.h !== s.h || next.x !== s.x || next.y !== s.y) {
      onResize(placement.id, next);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Left button / touch / pen only. Don't select yet — we can't tell a click
    // from a drag until the pointer lifts, and selecting here would pop the
    // instruction sheet open on every drag.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = { pointerX: e.clientX, pointerY: e.clientY };
    setDrag({ dx: 0, dy: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!startRef.current) return;
    const dx = (e.clientX - startRef.current.pointerX) / scale;
    const dy = (e.clientY - startRef.current.pointerY) / scale;
    setDrag({ dx, dy });
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!startRef.current) return;
    // Decide click vs. drag on raw pointer travel (px) so a few px of tremor
    // still reads as a click.
    const pxDx = e.clientX - startRef.current.pointerX;
    const pxDy = e.clientY - startRef.current.pointerY;
    startRef.current = null;
    setDrag(null);
    if (Math.hypot(pxDx, pxDy) > 4) {
      // A real drag commits the move and leaves the sheet closed.
      onMove(placement.id, placement.x + pxDx / scale, placement.y + pxDy / scale);
    } else {
      // A click selects — which opens the instruction sheet in read mode.
      onSelect(placement.id);
    }
  };

  const dragging = drag !== null;
  const resizing = resize !== null;
  // While resizing the box follows the live geometry; otherwise the placement.
  const geo = resize ?? placement;
  // The move transform is suppressed during a resize (handles drive x/y directly).
  const tx = drag && !resizing ? drag.dx * scale : 0;
  const ty = drag && !resizing ? drag.dy * scale : 0;
  const rot = placement.rotation || 0;
  // Resize handles: only when this box is selected in edit mode and applicable.
  const showHandles = editable && selected && placement.applicable;

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-pressed={selected}
      aria-label={`${placement.label} — ${meta.label}${placement.applicable ? '' : ' (not applicable)'}`}
      className={cn(
        'group absolute flex touch-none select-none flex-col items-center justify-center rounded-md border text-center outline-none',
        dragging || resizing
          ? 'z-20 shadow-lift transition-none'
          : 'z-10 transition-shadow duration-base ease-out',
        dragging ? 'cursor-grabbing' : resizing ? '' : 'cursor-grab',
        placement.applicable
          ? 'border-graphite/70 bg-surface'
          : 'border-dashed border-mist bg-surface/40',
        selected
          ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper'
          : 'hover:shadow-card',
      )}
      style={{
        left: `${geo.x * scale}px`,
        top: `${geo.y * scale}px`,
        width: `${geo.w * scale}px`,
        height: `${geo.h * scale}px`,
        transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
      }}
    >
      {showHandles
        ? RESIZE_CORNERS.map((h) => (
            <span
              key={h.corner}
              role="presentation"
              onPointerDown={onResizeDown(h.corner)}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              className={cn(
                'absolute z-30 h-3 w-3 rounded-full border border-ink bg-paper shadow-card',
                h.pos,
                h.cursor,
              )}
            />
          ))
        : null}
      <Icon
        className={cn(
          'mb-0.5 h-4 w-4 shrink-0',
          placement.applicable ? 'text-graphite' : 'text-mist',
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          'px-1 font-display text-[11px] font-semibold leading-tight tracking-tight',
          placement.applicable ? 'text-ink' : 'text-steel',
        )}
      >
        {placement.label}
      </span>
      {!placement.applicable ? (
        <span className="text-[9px] italic leading-none text-steel">n/a here</span>
      ) : null}
    </button>
  );
}
