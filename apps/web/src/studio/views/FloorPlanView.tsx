import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  EyeOff,
  Map,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@wally/ui';
import type { PlacedFixture } from '@wally/types';

import { EmptyState, ErrorState } from '../../components/states';
import {
  useCopyLayout,
  useFixtures,
  useFloorPlan,
  usePlacementMove,
  usePlacementPatch,
  usePublishCampaign,
} from '../lib/hooks';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';
import { sqk } from '../lib/queryKeys';
import { studio } from '../lib/sdk';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { brandLabel, splitVenueName } from '../lib/venue';
import { FloorPlanCanvas, PLAN_W, PLAN_H } from '../components/FloorPlanCanvas';
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

  // The project this floor plan belongs to — scopes the fixture palette so you
  // can only place this project's (or shared) fixtures, never another entity's.
  const { projectId } = useProject();

  // Layout builder: add/remove fixtures on the canvas.
  const [building, setBuilding] = React.useState(false);
  const fixturesQ = useFixtures(projectId);
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
      // Own the new fixture to this plan's project so it stays scoped here.
      const fixture = await studio.fixtures.create({
        ...input,
        projectId: projectId ?? null,
      });
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
  // Per-placement edits: applicable toggle, inline rename, checklist reorder.
  const patchPlacement = usePlacementPatch(campaignId, storeId);
  // Copy another store's whole layout onto this one.
  const copyLayout = useCopyLayout(campaignId, storeId);
  const [copyOpen, setCopyOpen] = React.useState(false);
  // Publish & notify.
  const publish = usePublishCampaign(campaignId);

  // Every venue in this project — populates the top-bar store switcher so you
  // can jump between venues' floor plans.
  const storesQ = useQuery({
    queryKey: ['studio', 'project-venues', projectId],
    queryFn: () => api.projects.venues(projectId!),
    enabled: Boolean(projectId),
  });

  const [selectedId, setSelectedId] = React.useState<string | undefined>();

  // The fixture the panel is for — resolve from the selected placement.
  const selected = plan?.placements.find((p) => p.id === selectedId);

  // The active venue's concessions (brand variants), for the floor-plan brand
  // toggle. Store names are "{Venue} — {Brand}"; group by venue, keep siblings.
  const venueBrands = React.useMemo(() => {
    const all = storesQ.data ?? [];
    const here = splitVenueName(
      all.find((s) => s.storeId === storeId)?.storeName ?? plan?.storeName ?? '',
    ).venue;
    return all
      .map((s) => ({ storeId: s.storeId, ...splitVenueName(s.storeName) }))
      .filter((s) => s.venue === here)
      .sort((a, b) => a.brand.localeCompare(b.brand));
  }, [storesQ.data, storeId, plan?.storeName]);

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
    publishing: publish.isPending,
    onStoreChange: (id) => {
      if (id && id !== storeId) navigate(`/studio/${campaignId}/store/${id}`);
    },
    onPublish: () => {
      if (!campaignId || publish.isPending) return;
      publish.mutate(undefined, {
        onSuccess: ({ notified }) =>
          toast.success(
            `Published — ${notified} store${notified === 1 ? '' : 's'} notified.`,
          ),
        onError: (err) => toast.error(errorMessage(err)),
      });
    },
  });

  const onMove = (id: string, x: number, y: number) => {
    const p = plan?.placements.find((pp) => pp.id === id);
    if (!p) return;
    // Keep the fixture on the canvas…
    const nx = Math.round(Math.max(0, Math.min(x, PLAN_W - p.w)));
    const ny = Math.round(Math.max(0, Math.min(y, PLAN_H - p.h)));
    // …and don't let it land on top of another fixture. Edge-touching is fine
    // (strict overlap), so neighbours can sit flush. Blocked drops snap back.
    const proposed = { x: nx, y: ny, w: p.w, h: p.h };
    const collides = (plan?.placements ?? []).some(
      (o) => o.id !== id && rectsOverlap(proposed, o),
    );
    if (collides) {
      toast.info(`${p.label} can’t overlap another fixture — kept it in place.`);
      return;
    }
    move.mutate({
      id,
      geometry: { x: nx, y: ny, w: p.w, h: p.h, rotation: p.rotation },
    });
  };

  const onResize = (
    id: string,
    box: { x: number; y: number; w: number; h: number },
  ) => {
    const p = plan?.placements.find((pp) => pp.id === id);
    if (!p) return;
    // Keep the resized box on the canvas — cap size to the plane, then clamp
    // its origin so it stays fully inside.
    const w = Math.round(Math.min(box.w, PLAN_W));
    const h = Math.round(Math.min(box.h, PLAN_H));
    const nx = Math.round(Math.max(0, Math.min(box.x, PLAN_W - w)));
    const ny = Math.round(Math.max(0, Math.min(box.y, PLAN_H - h)));
    // Same no-overlap rule as moves: a resize that lands on a neighbour snaps
    // back to the prior size.
    const proposed = { x: nx, y: ny, w, h };
    const collides = (plan?.placements ?? []).some(
      (o) => o.id !== id && rectsOverlap(proposed, o),
    );
    if (collides) {
      toast.info(`${p.label} can’t overlap another fixture — kept its size.`);
      return;
    }
    move.mutate({
      id,
      geometry: { x: nx, y: ny, w, h, rotation: p.rotation },
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
      {/* Canvas — fits the viewport (no scroll); the fixture sheet opens as a
          popup on click. Flex column: fixed header/palette/footer, canvas fills. */}
      <div className="flex h-full flex-col px-6 py-6">
        <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-brand text-steel">
              Floor plan
            </p>
            <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
              {plan.storeName}
            </h1>
            {/* Brand toggle — switch this venue's concession floor plans
                (defaults to Custom Chef from the directory). */}
            {venueBrands.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {venueBrands.map((b) => {
                  const active = b.storeId === storeId;
                  return (
                    <button
                      key={b.storeId}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (!active) navigate(`/studio/${campaignId}/store/${b.storeId}`);
                      }}
                      className={cn(
                        'inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'bg-graphite text-paper'
                          : 'bg-surface text-graphite hover:bg-mist/40',
                      )}
                    >
                      {brandLabel(b.brand)}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {applicable} fixture{applicable === 1 ? '' : 's'}
            </Badge>
            <Badge variant="muted" className="uppercase tracking-brand">
              {plan.campaignKey}
            </Badge>
            {building ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCopyOpen(true)}
              >
                <Copy className="h-4 w-4" />
                Copy layout
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={building ? undefined : 'outline'}
              onClick={() => {
                // Drop any selection made while editing — otherwise leaving
                // edit mode would immediately pop the instruction sheet open.
                setSelectedId(undefined);
                setBuilding((v) => !v);
              }}
            >
              <Plus className="h-4 w-4" />
              {building ? 'Done' : 'Edit layout'}
            </Button>
          </div>
        </header>

        {/* Fixture palette (layout builder) */}
        {building ? (
          <div className="shrink-0">
            <FixturePalette
              fixtures={fixturesQ.data ?? []}
              placedFixtureIds={new Set(plan.placements.map((p) => p.fixtureId))}
              adding={addFixture.isPending}
              creating={createAndPlace.isPending}
              onAdd={(id) => addFixture.mutate(id)}
              onCreate={(name, kind) => createAndPlace.mutate({ name, kind })}
            />
          </div>
        ) : null}

        {plan.placements.length > 0 ? (
          <>
            <div className="min-h-0 flex-1">
              <FloorPlanCanvas
                placements={plan.placements}
                selectedId={selectedId}
                editable={building}
                onSelect={setSelectedId}
                onMove={onMove}
                onResize={onResize}
                onClearSelection={() => setSelectedId(undefined)}
              />
            </div>
            <div className="mt-3 shrink-0">
              {building && selected ? (
                <PlacementControls
                  key={selected.id}
                  placement={selected}
                  placements={plan.placements}
                  busy={patchPlacement.isPending}
                  onRename={(label) =>
                    patchPlacement.mutate({ id: selected.id, label })
                  }
                  onToggleApplicable={() =>
                    patchPlacement.mutate({
                      id: selected.id,
                      applicable: !selected.applicable,
                    })
                  }
                  onReorder={(order) =>
                    patchPlacement.mutate({ id: selected.id, order })
                  }
                  onRemove={() => {
                    removePlacement.mutate(selected.id);
                    setSelectedId(undefined);
                  }}
                  removing={removePlacement.isPending}
                />
              ) : (
                <p className="text-xs text-steel">
                  {building
                    ? 'Add fixtures from the palette · drag to position · drag a selected box’s corners to resize · select one to rename, mark n/a, reorder, or remove.'
                    : 'Drag a fixture to reposition it · click to open its instruction sheet.'}
                </p>
              )}
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
          aria-describedby={undefined}
          className="flex h-[min(88vh,860px)] w-[min(1040px,95vw)] max-w-none flex-col overflow-hidden p-0"
        >
          {/* The panel renders the visible heading; this keeps Radix's
              screen-reader announcement without a second visible title. */}
          <DialogTitle className="sr-only">
            {selected?.label ?? 'Fixture instructions'}
          </DialogTitle>
          {selected ? (
            <FixtureDetailPanel
              campaignId={campaignId}
              fixtureId={selected.fixtureId}
              onClose={() => setSelectedId(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Copy another store's whole layout onto this one. */}
      <CopyLayoutDialog
        open={copyOpen}
        targetStoreId={storeId}
        otherStores={(storesQ.data ?? []).filter((s) => s.storeId !== storeId)}
        busy={copyLayout.isPending}
        error={copyLayout.error}
        onCancel={() => {
          copyLayout.reset();
          setCopyOpen(false);
        }}
        onConfirm={(fromStoreId) =>
          copyLayout.mutate(fromStoreId, {
            onSuccess: (plan) => {
              setCopyOpen(false);
              copyLayout.reset();
              const n = plan.placements.length;
              toast.success(
                `Copied ${n} fixture${n === 1 ? '' : 's'} onto ${plan.storeName}.`,
              );
            },
          })
        }
      />
    </>
  );
}

/**
 * The selected-placement edit bar (layout editor). Inline rename, a colour-blind-
 * safe applicable toggle (icon + label, never hue alone), checklist reorder
 * up/down, and remove. `order` is the placement's index in applicable order; we
 * compute the neighbour swap from the canvas order.
 */
function PlacementControls({
  placement,
  placements,
  busy,
  onRename,
  onToggleApplicable,
  onReorder,
  onRemove,
  removing,
}: {
  placement: PlacedFixture;
  placements: PlacedFixture[];
  busy: boolean;
  onRename: (label: string) => void;
  onToggleApplicable: () => void;
  onReorder: (order: number) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const [editingName, setEditingName] = React.useState(false);
  const [draft, setDraft] = React.useState(placement.label);
  React.useEffect(() => setDraft(placement.label), [placement.label]);

  // Ordered list (stable) → this placement's neighbours, for move up/down.
  const ordered = [...placements];
  const idx = ordered.findIndex((p) => p.id === placement.id);
  const prev = idx > 0 ? ordered[idx - 1] : undefined;
  const next = idx < ordered.length - 1 ? ordered[idx + 1] : undefined;

  const commitRename = () => {
    const name = draft.trim();
    setEditingName(false);
    if (name && name !== placement.label) onRename(name);
    else setDraft(placement.label);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-mist/70 bg-surface/40 px-3 py-2">
      {editingName ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              setDraft(placement.label);
              setEditingName(false);
            }
          }}
          maxLength={120}
          aria-label="Fixture label"
          className="min-w-0 flex-1 rounded-md border border-mist bg-paper px-2.5 py-1 text-sm font-medium text-ink focus:border-steel focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingName(true)}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-semibold text-ink hover:text-graphite"
          title="Rename this fixture"
        >
          <span className="truncate">{placement.label}</span>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-steel" aria-hidden="true" />
        </button>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {/* Reorder up/down — moves the fixture in the manager checklist order. */}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !prev}
          onClick={() => prev && onReorder(idx - 1)}
          aria-label="Move up in checklist"
          title="Move up in the manager checklist"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !next}
          onClick={() => next && onReorder(idx + 1)}
          aria-label="Move down in checklist"
          title="Move down in the manager checklist"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>

        {/* Applicable toggle — colour-blind-safe: distinct icon + explicit label. */}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onToggleApplicable}
          loading={busy}
        >
          {placement.applicable ? (
            <>
              <EyeOff className="h-4 w-4" />
              Mark not applicable
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Mark applicable
            </>
          )}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="text-signal"
          onClick={onRemove}
          loading={removing}
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </Button>
      </div>
    </div>
  );
}

/** Pick another store and copy its whole floor-plan layout onto this one. */
function CopyLayoutDialog({
  open,
  targetStoreId,
  otherStores,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  targetStoreId: string | undefined;
  otherStores: { storeId: string; storeName: string }[];
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (fromStoreId: string) => void;
}) {
  const [from, setFrom] = React.useState('');
  React.useEffect(() => {
    if (open) setFrom('');
  }, [open]);

  void targetStoreId;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copy layout from another store</DialogTitle>
          <DialogDescription>
            Copies every placed fixture (position, size, label) from the chosen
            store onto this one. Fixtures already here are overwritten in place,
            not duplicated.
          </DialogDescription>
        </DialogHeader>

        {otherStores.length === 0 ? (
          <p className="rounded-md border border-dashed border-mist/70 px-3 py-3 text-sm text-steel">
            No other store in this project to copy from yet.
          </p>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-graphite">
              Copy from
            </span>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink focus:border-graphite focus:outline-none"
            >
              <option value="" disabled>
                Choose a store…
              </option>
              {otherStores.map((s) => (
                <option key={s.storeId} value={s.storeId}>
                  {s.storeName}
                </option>
              ))}
            </select>
          </label>
        )}

        {error ? (
          <p className="text-sm text-fail">{errorMessage(error)}</p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => from && onConfirm(from)}
            disabled={!from || busy}
            loading={busy}
          >
            <Copy className="h-4 w-4" />
            Copy layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-6">{children}</div>;
}

/** Axis-aligned rectangle overlap (logical units). Edge-touching is NOT overlap. */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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
  // The palette is for *adding*, so only show fixtures not yet on the plan —
  // placed ones are already visible on the canvas below and just add noise.
  const available = fixtures.filter(
    (f) =>
      !placedFixtureIds.has(f.id) &&
      (!term || f.name.toLowerCase().includes(term) || f.kind.includes(term)),
  );
  const placedCount = fixtures.length - fixtures.filter((f) => !placedFixtureIds.has(f.id)).length;

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
          Add fixtures · {available.length} available
          {placedCount > 0 ? (
            <span className="text-mist"> · {placedCount} placed</span>
          ) : null}
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
        {available.map((f) => {
          const meta = fixtureKindMeta(f.kind);
          const Icon = meta.icon;
          return (
            <button
              key={f.id}
              type="button"
              disabled={adding}
              onClick={() => onAdd(f.id)}
              title={`Add ${f.name}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-mist bg-paper px-2.5 py-1.5 text-xs font-medium text-graphite transition-colors hover:border-steel hover:text-ink disabled:opacity-40"
            >
              <Icon className="h-3.5 w-3.5 text-steel" />
              {f.name}
              <Plus className="h-3 w-3 text-steel" />
            </button>
          );
        })}
        {available.length === 0 ? (
          <p className="py-2 text-xs text-steel">
            {term
              ? 'No available fixtures match — try the library search or create a new one.'
              : 'Every fixture is on the plan. Create a new one above to add more.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
