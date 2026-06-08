import * as React from 'react';
import type { PlacedFixture } from '@wally/types';

import { FixtureBox } from './FixtureBox';

/** Logical floor-plan dimensions. Geometry from the API is in these units. */
export const PLAN_W = 1000;
export const PLAN_H = 640;

/**
 * The floor-plan canvas: a fixed logical 1000×640 plane that scales to fit its
 * container, with each placed fixture drawn as a draggable box.
 *
 * Scaling: we measure the container's width AND height and derive a single
 * `scale = min(w/PLAN_W, h/PLAN_H)` so the whole plane fits on screen (no
 * scroll) while keeping its aspect ratio, then centre it in the space. Pointer
 * deltas in `FixtureBox` divide by this scale to map screen px → logical units.
 */
export function FloorPlanCanvas({
  placements,
  selectedId,
  editable = false,
  onSelect,
  onMove,
  onResize,
  onClearSelection,
}: {
  placements: PlacedFixture[];
  selectedId?: string;
  /** Edit-layout mode: enables drag-to-resize handles on the selected box. */
  editable?: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, box: { x: number; y: number; w: number; h: number }) => void;
  onClearSelection: () => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setScale(Math.min(w / PLAN_W, h / PLAN_H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="grid h-full w-full place-items-center">
      <div
        role="application"
        aria-label="Floor plan canvas"
        onPointerDown={(e) => {
          // A bare-canvas press deselects (boxes stopPropagation).
          if (e.target === e.currentTarget) onClearSelection();
        }}
        className="relative overflow-hidden rounded-xl border border-mist/70 bg-paper shadow-card"
        style={{
          width: `${PLAN_W * scale}px`,
          height: `${PLAN_H * scale}px`,
          // Subtle grid — reads as a floor plan, stays calm.
          backgroundImage:
            'linear-gradient(to right, rgba(190,189,182,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(190,189,182,0.16) 1px, transparent 1px)',
          backgroundSize: `${40 * scale}px ${40 * scale}px`,
        }}
      >
        {placements.map((p) => (
          <FixtureBox
            key={p.id}
            placement={p}
            selected={p.id === selectedId}
            scale={scale}
            editable={editable}
            onSelect={onSelect}
            onMove={onMove}
            onResize={onResize}
          />
        ))}
      </div>
    </div>
  );
}
