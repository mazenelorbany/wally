import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Map, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Spinner } from '@wally/ui';

import { EmptyState, ErrorState } from '../../components/states';
import { useFixtures, useFloorPlan, usePlacementMove } from '../lib/hooks';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';
import { sqk } from '../lib/queryKeys';
import { studio } from '../lib/sdk';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { fixtureKindMeta } from '../lib/fixtureKind';
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

  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const planQ = useFloorPlan(campaignId, storeId);
  const move = usePlacementMove(campaignId, storeId);
  const plan = planQ.data;

  // Layout builder: add/remove fixtures on the canvas.
  const [building, setBuilding] = React.useState(false);
  const fixturesQ = useFixtures();
  const invalidatePlan = () => {
    if (campaignId && storeId) {
      void qc.invalidateQueries({ queryKey: sqk.floorplan(campaignId, storeId) });
    }
  };
  const addFixture = useMutation({
    mutationFn: (fixtureId: string) =>
      studio.placements.create(campaignId!, storeId!, { fixtureId }),
    onSuccess: invalidatePlan,
  });
  // Create a brand-new library fixture and drop it straight onto this plan.
  const createAndPlace = useMutation({
    mutationFn: async (input: { name: string; kind: import('@wally/types').FixtureKind }) => {
      const fixture = await studio.fixtures.create(input);
      await studio.placements.create(campaignId!, storeId!, { fixtureId: fixture.id });
    },
    onSuccess: () => {
      invalidatePlan();
      void qc.invalidateQueries({ queryKey: sqk.fixtures });
    },
  });
  const removePlacement = useMutation({
    mutationFn: (id: string) => studio.placements.remove(id),
    onSuccess: invalidatePlan,
  });

  // Every venue in this project — populates the top-bar store switcher so you
  // can jump between venues' floor plans.
  const { projectId } = useProject();
  const storesQ = useQuery({
    queryKey: ['studio', 'project-venues', projectId],
    queryFn: () => api.projects.venues(projectId!),
    enabled: Boolean(projectId),
  });

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
    stores: (storesQ.data ?? []).map((s) => ({
      storeId: s.storeId,
      storeName: s.storeName,
    })),
    storeId,
    onStoreChange: (id) => {
      if (id && id !== storeId) navigate(`/studio/${campaignId}/store/${id}`);
    },
    onPublish: () => {
      // Publish/notify pipeline is a separate build; until then give honest,
      // app-native feedback instead of a browser alert.
      toast.info('Publish & notify stores — coming soon.');
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
    <>
      {/* Canvas — full width; the fixture sheet opens as a popup on click */}
      <div className="h-full overflow-y-auto px-6 py-6">
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
            <Button
              size="sm"
              variant={building ? undefined : 'outline'}
              onClick={() => setBuilding((v) => !v)}
            >
              <Plus className="h-4 w-4" />
              {building ? 'Done' : 'Edit layout'}
            </Button>
          </div>
        </header>

        {/* Fixture palette (layout builder) */}
        {building ? (
          <FixturePalette
            fixtures={fixturesQ.data ?? []}
            placedFixtureIds={new Set(plan.placements.map((p) => p.fixtureId))}
            adding={addFixture.isPending}
            creating={createAndPlace.isPending}
            onAdd={(id) => addFixture.mutate(id)}
            onCreate={(name, kind) => createAndPlace.mutate({ name, kind })}
          />
        ) : null}

        {plan.placements.length > 0 ? (
          <>
            <FloorPlanCanvas
              placements={plan.placements}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={onMove}
              onClearSelection={() => setSelectedId(undefined)}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-steel">
                {building
                  ? 'Add fixtures from the palette · drag to position · select one to remove.'
                  : 'Drag a fixture to reposition it · click to open its instruction sheet.'}
              </p>
              {building && selected ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-signal"
                  onClick={() => {
                    removePlacement.mutate(selected.id);
                    setSelectedId(undefined);
                  }}
                  loading={removePlacement.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove {selected.label}
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState
            icon={Map}
            title="No fixtures placed yet"
            body="This venue's floor plan is empty. Click “Build layout”, then add walls, bays, and tables from the library."
          />
        )}
      </div>

      {/* The fixture's whole instruction sheet (notes, references, planogram)
          opens in one roomy popup when you click a fixture. */}
      <Dialog
        open={Boolean(selected) && !building}
        onOpenChange={(o) => {
          if (!o) setSelectedId(undefined);
        }}
      >
        <DialogContent
          hideClose
          className="flex h-[min(88vh,860px)] w-[min(1040px,95vw)] max-w-none flex-col overflow-hidden p-0"
        >
          {selected ? (
            <FixtureDetailPanel
              campaignId={campaignId}
              fixtureId={selected.fixtureId}
              onClose={() => setSelectedId(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-6">{children}</div>;
}

const FIXTURE_KINDS: import('@wally/types').FixtureKind[] = [
  'bay',
  'table',
  'stand',
  'window',
  'dais',
  'trolley',
];

/** The layout editor's palette: add library fixtures, or create a brand-new one. */
function FixturePalette({
  fixtures,
  placedFixtureIds,
  adding,
  creating,
  onAdd,
  onCreate,
}: {
  fixtures: import('@wally/types').Fixture[];
  placedFixtureIds: Set<string>;
  adding: boolean;
  creating: boolean;
  onAdd: (fixtureId: string) => void;
  onCreate: (name: string, kind: import('@wally/types').FixtureKind) => void;
}) {
  const [q, setQ] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [newKind, setNewKind] = React.useState<import('@wally/types').FixtureKind>('bay');
  const term = q.trim().toLowerCase();
  const list = fixtures.filter(
    (f) => !term || f.name.toLowerCase().includes(term) || f.kind.includes(term),
  );

  const submitNew = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name, newKind);
    setNewName('');
  };

  return (
    <div className="mb-4 rounded-lg border border-mist/70 bg-surface/40 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-brand text-steel">
          Add fixtures · {list.length}
        </p>
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the library…"
            className="w-48 rounded-md border border-mist bg-paper px-2.5 py-1 text-xs text-ink placeholder:text-steel focus:border-steel focus:outline-none"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="Clear"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-steel hover:text-ink"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Create a brand-new fixture, then drop it on the plan */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-mist bg-paper/60 p-2">
        <span className="text-[11px] font-medium uppercase tracking-brand text-steel">
          New fixture
        </span>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitNew()}
          placeholder="Name (e.g. Brand Wall)"
          className="min-w-0 flex-1 rounded-md border border-mist bg-paper px-2.5 py-1 text-xs text-ink placeholder:text-steel focus:border-steel focus:outline-none"
        />
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as import('@wally/types').FixtureKind)}
          className="rounded-md border border-mist bg-paper px-2 py-1 text-xs capitalize text-graphite focus:border-steel focus:outline-none"
        >
          {FIXTURE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={submitNew} loading={creating} disabled={!newName.trim()}>
          <Plus className="h-3.5 w-3.5" /> Create &amp; place
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {list.map((f) => {
          const meta = fixtureKindMeta(f.kind);
          const Icon = meta.icon;
          const placed = placedFixtureIds.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              disabled={placed || adding}
              onClick={() => onAdd(f.id)}
              title={placed ? 'Already on the plan' : `Add ${f.name}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-mist bg-paper px-2.5 py-1.5 text-xs font-medium text-graphite transition-colors hover:border-steel hover:text-ink disabled:opacity-40"
            >
              <Icon className="h-3.5 w-3.5 text-steel" />
              {f.name}
              {placed ? (
                <span className="text-[10px] uppercase tracking-brand text-pass">
                  ✓
                </span>
              ) : (
                <Plus className="h-3 w-3 text-steel" />
              )}
            </button>
          );
        })}
        {list.length === 0 ? (
          <p className="py-2 text-xs text-steel">No fixtures match.</p>
        ) : null}
      </div>
    </div>
  );
}
