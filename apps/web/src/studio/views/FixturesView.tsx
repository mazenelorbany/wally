import * as React from 'react';
import { Boxes } from 'lucide-react';
import { Badge, Card } from '@wally/ui';

import { EmptyState, ErrorState, Skeleton } from '../../components/states';
import { useFixtures } from '../lib/hooks';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { useSetStudioTopBar } from '../components/StudioContext';

/** The org's fixture library — a clean reference grid of reusable fixtures. */
export function FixturesView() {
  const fixturesQ = useFixtures();
  const fixtures = fixturesQ.data ?? [];

  useSetStudioTopBar({ guideName: 'Fixture library', stores: [] });

  return (
    <div className="px-6 py-6">
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-brand text-steel">Library</p>
        <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
          Fixtures
        </h1>
        <p className="mt-1 text-sm text-steel">
          The reusable fixtures your guides place on store floor plans.
        </p>
      </header>

      {fixturesQ.isLoading ? (
        <Grid>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </Grid>
      ) : fixturesQ.isError ? (
        <ErrorState error={fixturesQ.error} onRetry={() => fixturesQ.refetch()} />
      ) : fixtures.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No fixtures yet"
          body="Once fixtures are added to your org's library, they'll appear here."
        />
      ) : (
        <Grid>
          {fixtures.map((f) => {
            const meta = fixtureKindMeta(f.kind);
            const Icon = meta.icon;
            return (
              <Card
                key={f.id}
                className="flex items-start gap-3 p-4 transition-shadow duration-base ease-out hover:shadow-lift"
              >
                <span
                  aria-hidden="true"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-surface text-graphite"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-semibold text-ink">
                    {f.name}
                  </p>
                  <Badge variant="muted" className="mt-1.5 uppercase tracking-brand">
                    {meta.label}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </Grid>
      )}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}
