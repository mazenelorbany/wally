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
export function FixtureBox({
  placement,
  selected,
  scale,
  onSelect,
  onMove,
}: {
  placement: PlacedFixture;
  selected: boolean;
  /** Logical-unit → screen-pixel scale, so pointer deltas map back to units. */
  scale: number;
  onSelect: (id: string) => void;
  /** Fired on drop with the committed logical x/y. */
  onMove: (id: string, x: number, y: number) => void;
}) {
  const meta = fixtureKindMeta(placement.kind);
  const Icon = meta.icon;

  // Live drag offset in *logical units*; null when not dragging.
  const [drag, setDrag] = React.useState<{ dx: number; dy: number } | null>(null);
  const startRef = React.useRef<{
    pointerX: number;
    pointerY: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Left button / touch / pen only.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(placement.id);
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
    const dx = (e.clientX - startRef.current.pointerX) / scale;
    const dy = (e.clientY - startRef.current.pointerY) / scale;
    startRef.current = null;
    setDrag(null);
    // Only commit a real move (ignore a click that didn't travel).
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      onMove(placement.id, placement.x + dx, placement.y + dy);
    }
  };

  const dragging = drag !== null;
  const tx = drag ? drag.dx * scale : 0;
  const ty = drag ? drag.dy * scale : 0;
  const rot = placement.rotation || 0;

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
        dragging
          ? 'z-20 cursor-grabbing shadow-lift transition-none'
          : 'z-10 cursor-grab transition-shadow duration-base ease-out',
        placement.applicable
          ? 'border-graphite/70 bg-surface'
          : 'border-dashed border-mist bg-surface/40',
        selected
          ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper'
          : 'hover:shadow-card',
      )}
      style={{
        left: `${placement.x * scale}px`,
        top: `${placement.y * scale}px`,
        width: `${placement.w * scale}px`,
        height: `${placement.h * scale}px`,
        transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
      }}
    >
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
