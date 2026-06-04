import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Map } from 'lucide-react';
import { Badge, Spinner } from '@wally/ui';

import { EmptyState, ErrorState } from '../../components/states';
import { useFloorPlan, usePlacementMove } from '../lib/hooks';
import { useSetStudioTopBar } from '../components/StudioContext';
import { FloorPlanCanvas } from '../components/FloorPlanCanvas';
import { FixtureDetailPanel } from '../components/FixtureDetailPanel';

/**
 * The keystone: route /studio/:campaignId/store/:storeId. Renders the store's
 * floor plan for the guide, lets you drag fixtures to reposition them (persisted
 * via the placements API), and opens an instruction sheet for the clicked
 * fixture.
 */
export function FloorPlanView() {
  const { campaignId, storeId } = useParams<{
    campaignId: string;
    storeId: string;
  }>();

  const planQ = useFloorPlan(campaignId, storeId);
  const move = usePlacementMove(campaignId, storeId);
  const plan = planQ.data;

  const [selectedId, setSelectedId] = React.useState<string | undefined>();

  // The fixture the panel is for — resolve from the selected placement.
  const selected = plan?.placements.find((p) => p.id === selectedId);

  // Feed the top bar. With a single store per floor plan, the selector still
  // shows the active store (and stays meaningful even with one option).
  useSetStudioTopBar({
    guideName: plan?.storeName
      ? `${plan.storeName} — floor plan`
      : 'Floor plan',
    guideKey: plan?.campaignKey,
    stores: plan
      ? [{ storeId: plan.storeId, storeName: plan.storeName }]
      : [],
    storeId: plan?.storeId,
    onPublish: () => {
      // No-op for the demo; wired to the notify pipeline later.
      // eslint-disable-next-line no-alert
      window.alert('Publish & notify stores — coming soon.');
    },
  });

  const onMove = (id: string, x: number, y: number) => {
    const p = plan?.placements.find((pp) => pp.id === id);
    if (!p) return;
    move.mutate({
      id,
      geometry: { x, y, w: p.w, h: p.h, rotation: p.rotation },
    });
  };

  if (!campaignId || !storeId) {
    return (
      <Pad>
        <EmptyState
          icon={Map}
          title="Pick a store to lay out"
          body="Open a campaign's store to start placing fixtures on its floor plan."
        />
      </Pad>
    );
  }

  if (planQ.isLoading) {
    return (
      <Pad>
        <div className="grid h-[60vh] place-items-center">
          <Spinner className="text-3xl text-steel" />
        </div>
      </Pad>
    );
  }

  if (planQ.isError) {
    return (
      <Pad>
        <ErrorState error={planQ.error} onRetry={() => planQ.refetch()} />
      </Pad>
    );
  }

  if (!plan) return null;

  const applicable = plan.placements.filter((p) => p.applicable).length;

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* Canvas column */}
      <div className="min-w-0 overflow-y-auto px-6 py-6">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-brand text-steel">
              Floor plan
            </p>
            <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
              {plan.storeName}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {applicable} fixture{applicable === 1 ? '' : 's'}
            </Badge>
            <Badge variant="muted" className="uppercase tracking-brand">
              {plan.campaignKey}
            </Badge>
          </div>
        </header>

        {plan.placements.length > 0 ? (
          <>
            <FloorPlanCanvas
              placements={plan.placements}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={onMove}
              onClearSelection={() => setSelectedId(undefined)}
            />
            <p className="mt-3 text-xs text-steel">
              Drag a fixture to reposition it · click to open its instruction
              sheet.
            </p>
          </>
        ) : (
          <EmptyState
            icon={Map}
            title="No fixtures placed yet"
            body="This store's floor plan is empty. Add fixtures from the library to lay out the guide."
          />
        )}
      </div>

      {/* Detail rail */}
      <div className="hidden min-h-0 lg:block">
        {selected ? (
          <FixtureDetailPanel
            campaignId={campaignId}
            fixtureId={selected.fixtureId}
            onClose={() => setSelectedId(undefined)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 border-l border-mist/60 bg-surface/30 px-8 text-center">
            <Map className="h-6 w-6 text-mist" aria-hidden="true" />
            <p className="font-display text-sm font-medium text-graphite">
              Select a fixture
            </p>
            <p className="max-w-[16rem] text-xs text-steel">
              Click any box on the floor plan to see its VM notes, reference
              images, and merchandise.
            </p>
          </div>
        )}
      </div>

      {/* Mobile: slide-over overlay */}
      {selected ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]"
            onClick={() => setSelectedId(undefined)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 right-0 w-[min(26rem,90vw)] animate-fade-up">
            <FixtureDetailPanel
              campaignId={campaignId}
              fixtureId={selected.fixtureId}
              onClose={() => setSelectedId(undefined)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-6">{children}</div>;
}
