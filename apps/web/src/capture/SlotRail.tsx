import * as React from 'react';

import type { Slot } from './slots';
import { SlotStatus } from './SlotStatus';

/** The compact checklist — every fixture at a glance, tap to jump to one. */
export function SlotRail({
  slots,
  activeIndex,
  onSelect,
}: {
  slots: Slot[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {slots.map((slot, i) => {
        const active = i === activeIndex;
        return (
          <li key={slot.fixtureKey}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={active ? 'step' : undefined}
              className={[
                'tap flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left',
                active
                  ? 'border-ink bg-surface'
                  : 'border-mist/60 bg-paper hover:border-steel/60',
              ].join(' ')}
            >
              <span
                className={[
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  active ? 'bg-ink text-paper' : 'bg-surface text-steel',
                ].join(' ')}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {slot.label}
                </span>
              </span>
              <SlotStatus slot={slot} size="sm" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
