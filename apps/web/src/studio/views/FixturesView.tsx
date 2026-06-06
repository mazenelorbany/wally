import * as React from 'react';
import { Boxes, Plus, Search, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@wally/ui';
import type { Fixture, FixtureKind } from '@wally/types';

import { EmptyState, ErrorState, Skeleton } from '../../components/states';
import { errorMessage } from '../../lib/api';
import { useSession } from '../../lib/auth';
import {
  useAddFixtureProduct,
  useArchiveFixture,
  useCreateFixture,
  useDeleteFixture,
  useFixtureProducts,
  useFixtures,
  useFixtureUsage,
  useProducts,
  useRemoveFixtureProduct,
} from '../lib/hooks';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { ProductThumb } from '../components/ProductThumb';
import { useSetStudioTopBar } from '../components/StudioContext';

const KINDS: FixtureKind[] = [
  'bay',
  'table',
  'stand',
  'window',
  'dais',
  'trolley',
];

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

/** The org's fixture library — add, browse, and remove reusable fixtures. */
export function FixturesView() {
  const fixturesQ = useFixtures();
  const fixtures = fixturesQ.data ?? [];

  useSetStudioTopBar({ guideName: 'Fixture library', stores: [] });

  const [addOpen, setAddOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<Fixture | null>(
    null,
  );
  const [managing, setManaging] = React.useState<Fixture | null>(null);
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            Library
          </p>
          <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
            Fixtures
          </h1>
          <p className="mt-1 text-sm text-steel">
            The reusable fixtures your guides place on store floor plans.
          </p>
        </div>
        {isAdmin ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add fixture
          </Button>
        ) : null}
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
          body="Add your first fixture and it'll be available to place on any store's floor plan."
        />
      ) : (
        <Grid>
          {fixtures.map((f) => {
            const meta = fixtureKindMeta(f.kind);
            const Icon = meta.icon;
            const inner = (
              <>
                <span
                  aria-hidden="true"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-surface text-graphite"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-semibold text-ink">
                    {f.name}
                  </p>
                  <Badge
                    variant="muted"
                    className="mt-1.5 uppercase tracking-brand"
                  >
                    {meta.label}
                  </Badge>
                </div>
                {/* leave room for the corner delete button on admin cards */}
                {isAdmin ? <span className="w-6 shrink-0" aria-hidden="true" /> : null}
              </>
            );
            return (
              <Card
                key={f.id}
                className="group relative p-0 transition-shadow duration-base ease-out hover:shadow-lift"
              >
                {isAdmin ? (
                  // The whole card opens the fixture (manage its default products).
                  <button
                    type="button"
                    onClick={() => setManaging(f)}
                    aria-label={`Open ${f.name} — manage default products`}
                    className="flex w-full items-start gap-3 rounded-[inherit] p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                  >
                    {inner}
                  </button>
                ) : (
                  <div className="flex items-start gap-3 p-4">{inner}</div>
                )}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(f);
                    }}
                    aria-label={`Remove ${f.name}`}
                    className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-steel opacity-0 transition-opacity hover:bg-surface hover:text-fail focus:opacity-100 focus:outline-none group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </Card>
            );
          })}
        </Grid>
      )}

      <AddFixtureDialog open={addOpen} onOpenChange={setAddOpen} />
      <DeleteFixtureDialog
        fixture={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
      <FixtureProductsDialog
        fixture={managing}
        onClose={() => setManaging(null)}
      />
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

/** Create a new library fixture (name + kind). */
function AddFixtureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateFixture();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<FixtureKind>('bay');

  const close = () => {
    setName('');
    setKind('bay');
    create.reset();
    onOpenChange(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    create.mutate({ name: trimmed, kind }, { onSuccess: close });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add fixture</DialogTitle>
          <DialogDescription>
            A reusable fixture your guides can place on any store's floor plan.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="mt-2 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-graphite">
              Name
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. TCC Wall Bay 8"
              maxLength={120}
              className={fieldCls}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-graphite">
              Type
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as FixtureKind)}
              className={fieldCls}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {fixtureKindMeta(k).label}
                </option>
              ))}
            </select>
          </label>

          {create.isError ? (
            <p className="text-sm text-fail">{errorMessage(create.error)}</p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Adding…' : 'Add fixture'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Remove a fixture — shows where it's used, then offers Archive or Delete. */
function DeleteFixtureDialog({
  fixture,
  onClose,
}: {
  fixture: Fixture | null;
  onClose: () => void;
}) {
  const usageQ = useFixtureUsage(fixture?.id);
  const archive = useArchiveFixture();
  const remove = useDeleteFixture();
  const busy = archive.isPending || remove.isPending;
  const usage = usageQ.data;
  const inUse = usage ? usage.storeCount > 0 || usage.guideCount > 0 : false;

  const doArchive = () => {
    if (fixture) archive.mutate(fixture.id, { onSuccess: onClose });
  };
  const doDelete = () => {
    if (fixture) remove.mutate(fixture.id, { onSuccess: onClose });
  };

  return (
    <Dialog
      open={Boolean(fixture)}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove “{fixture?.name}”?</DialogTitle>
          <DialogDescription>
            Archive keeps existing placements and just hides it from the
            library. Delete removes it everywhere.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 rounded-md border border-mist/60 bg-surface/40 p-3 text-sm">
          {usageQ.isLoading ? (
            <p className="text-steel">Checking where it's used…</p>
          ) : usageQ.isError ? (
            <p className="text-fail">
              Couldn't check usage — {errorMessage(usageQ.error)}
            </p>
          ) : !inUse ? (
            <p className="text-steel">
              Not placed in any store or guide yet — safe to delete.
            </p>
          ) : (
            <div className="text-graphite">
              <p>
                In use:{' '}
                <b className="text-ink">
                  {usage!.storeCount} store
                  {usage!.storeCount === 1 ? '' : 's'}
                </b>{' '}
                ·{' '}
                <b className="text-ink">
                  {usage!.guideCount} guide
                  {usage!.guideCount === 1 ? '' : 's'}
                </b>
              </p>
              {usage!.stores.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {usage!.stores.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <Badge variant="muted">{s.name}</Badge>
                    </li>
                  ))}
                  {usage!.stores.length > 8 ? (
                    <li>
                      <Badge variant="muted">
                        +{usage!.stores.length - 8} more
                      </Badge>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        {archive.isError ? (
          <p className="text-sm text-fail">{errorMessage(archive.error)}</p>
        ) : null}
        {remove.isError ? (
          <p className="text-sm text-fail">{errorMessage(remove.error)}</p>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="ghost" type="button" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="outline" onClick={doArchive} disabled={busy}>
            {archive.isPending ? 'Archiving…' : 'Archive'}
          </Button>
          <Button variant="signal" onClick={doDelete} disabled={busy}>
            {remove.isPending ? 'Deleting…' : 'Delete everywhere'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Manage a fixture's default product set — its reusable "starter" list. */
function FixtureProductsDialog({
  fixture,
  onClose,
}: {
  fixture: Fixture | null;
  onClose: () => void;
}) {
  const defaultsQ = useFixtureProducts(fixture?.id);
  const add = useAddFixtureProduct(fixture?.id ?? '');
  const remove = useRemoveFixtureProduct(fixture?.id ?? '');
  const [q, setQ] = React.useState('');
  const productsQ = useProducts(fixture ? { search: q } : {});

  const defaults = defaultsQ.data ?? [];
  const defaultIds = new Set(defaults.map((d) => d.id));
  const results = (productsQ.data ?? []).slice(0, 24);

  return (
    <Dialog
      open={Boolean(fixture)}
      onOpenChange={(o) => {
        if (!o) {
          setQ('');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Default products{fixture ? ` · ${fixture.name}` : ''}
          </DialogTitle>
          <DialogDescription>
            The starter set for this fixture. When it's added to a guide, the
            author can pre-populate from this set or start from scratch.
          </DialogDescription>
        </DialogHeader>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-brand text-steel">
            In the set{defaults.length ? ` · ${defaults.length}` : ''}
          </p>
          {defaultsQ.isLoading ? (
            <div className="grid place-items-center py-6">
              <Spinner className="text-lg text-steel" />
            </div>
          ) : defaults.length === 0 ? (
            <p className="rounded-md border border-dashed border-mist/70 px-3 py-3 text-xs text-steel">
              No default products yet — add some from the catalog below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {defaults.map((d) => (
                <li
                  key={d.fixtureProductId}
                  className="flex items-center gap-2.5 rounded-md px-1.5 py-1"
                >
                  <ProductThumb
                    imageUrl={d.imageUrl}
                    sku={d.sku}
                    name={d.name}
                    className="h-9 w-9 shrink-0 rounded"
                  />
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-xs font-medium text-ink">
                      {d.name}
                    </p>
                    <p className="truncate text-[10px] uppercase tracking-brand text-steel">
                      {d.sku}
                      {d.brand ? ` · ${d.brand}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${d.name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(d.fixtureProductId)}
                    className="shrink-0 rounded-md p-1.5 text-steel hover:text-fail disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-mist/70 bg-surface/40 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the catalog by name, brand or SKU…"
              className="w-full rounded-md border border-mist bg-paper py-2 pl-8 pr-3 text-sm text-ink placeholder:text-steel focus:border-steel focus:outline-none"
            />
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto">
            {productsQ.isLoading ? (
              <div className="grid place-items-center py-6">
                <Spinner className="text-lg text-steel" />
              </div>
            ) : results.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-steel">
                No products match.
              </p>
            ) : (
              <ul className="flex flex-col">
                {results.map((p) => {
                  const inSet = defaultIds.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={inSet || add.isPending}
                        onClick={() => add.mutate(p.id)}
                        className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-paper disabled:opacity-50"
                      >
                        <ProductThumb
                          imageUrl={p.imageUrl}
                          sku={p.sku}
                          name={p.name}
                          className="h-9 w-9 shrink-0 rounded"
                        />
                        <div className="min-w-0 flex-1 leading-tight">
                          <p className="truncate text-xs font-medium text-ink">
                            {p.name}
                          </p>
                          <p className="truncate text-[10px] uppercase tracking-brand text-steel">
                            {p.sku}
                            {p.brand ? ` · ${p.brand}` : ''}
                          </p>
                        </div>
                        {inSet ? (
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-brand text-pass">
                            In set
                          </span>
                        ) : (
                          <Plus className="h-4 w-4 shrink-0 text-steel" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
