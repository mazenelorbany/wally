import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import type { CampaignSummary } from '@wally/sdk';

/** Lightweight campaign switcher — native <select> styled to brand, so it works
 *  on every device without a popover dependency. */
export function CampaignPicker({
  campaigns,
  value,
  onChange,
}: {
  campaigns: CampaignSummary[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const selected = campaigns.find((c) => c.id === value);
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Campaign</span>
      <select
        className="field h-9 cursor-pointer appearance-none py-0 pr-9 text-sm font-medium"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.storeCount} store{c.storeCount === 1 ? '' : 's'}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 h-4 w-4 text-steel"
        aria-hidden="true"
      />
      {selected ? <span className="sr-only">Selected: {selected.name}</span> : null}
    </label>
  );
}
