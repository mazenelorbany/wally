import * as React from 'react';
import { Link } from 'react-router-dom';
import { PhoneCall } from 'lucide-react';

import type { StoreScore } from '@wally/types';
import { humanizeKey } from '../lib/format';

/**
 * The chase list — at-a-glance "who still owes what". Stores with unsubmitted
 * fixtures, so a reviewer can nudge managers without opening each store.
 */
export function ChaseList({ stores }: { stores: StoreScore[] }) {
  const chase = stores
    .map((s) => ({ store: s, missing: s.expected - s.submitted }))
    .filter((x) => x.missing > 0)
    .sort((a, b) => b.missing - a.missing);

  return (
    <div className="rounded-lg border border-mist/60 bg-surface/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <PhoneCall className="h-4 w-4 text-graphite" aria-hidden="true" />
        <h2 className="font-display text-sm font-semibold text-ink">Chase list</h2>
      </div>

      {chase.length === 0 ? (
        <p className="text-sm text-steel">
          Every store has submitted in full. Nothing to chase.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {chase.map(({ store, missing }) => (
            <li key={store.storeId}>
              <Link
                to={`/console/store/${encodeURIComponent(store.storeId)}`}
                className="tap block rounded-md px-2 py-1.5 hover:bg-paper"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {store.storeName}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-signal">
                    {missing} missing
                  </span>
                </div>
                {store.missing.length > 0 ? (
                  <p className="mt-0.5 truncate text-xs text-steel">
                    {store.missing.map(humanizeKey).join(', ')}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
