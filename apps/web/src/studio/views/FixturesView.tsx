import * as React from 'react';
import { Boxes, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import type {
  Department,
  Fixture,
  FixtureDefaultProduct,
  FixtureKind,
  MerchandiseItem,
  MerchandiseRow,
} from '@wally/types';

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
  useReorderFixturePlanogram,
  useUpdateFixture,
} from '../lib/hooks';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { ProductThumb } from '../components/ProductThumb';
import { PlanogramEditor } from '../components/PlanogramEditor';
import { useSetStudioTopBar } from '../components/StudioContext';

const KINDS: FixtureKind[] = [
  'bay',
  'table',
  'stand',
  'window',
  'dais',
  'trolley',
];

const DEPARTMENTS: Department[] = ['The Custom Chef', 'The Cook Shop'];

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
  const [editing, setEditing] = React.useState<Fixture | null>(null);
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="muted" className="uppercase tracking-brand">
                      {meta.label}
                    </Badge>
                    {f.department ? (
                      <Badge variant="outline" className="tracking-tight">
                        {f.department}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {/* leave room for the corner edit/delete buttons on admin cards */}
                {isAdmin ? (
                  <span className="w-12 shrink-0" aria-hidden="true" />
                ) : null}
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
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(f);
                      }}
                      aria-label={`Edit ${f.name}`}
                      className="rounded-md p-1.5 text-steel transition-colors hover:bg-surface hover:text-ink focus:opacity-100 focus:outline-none"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(f);
                      }}
                      aria-label={`Remove ${f.name}`}
                      className="rounded-md p-1.5 text-steel transition-colors hover:bg-surface hover:text-fail focus:opacity-100 focus:outline-none"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </Grid>
      )}

      <AddFixtureDialog open={addOpen} onOpenChange={setAddOpen} />
      <EditFixtureDialog
        fixture={editing}
        onClose={() => setEditing(null)}
      />
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
  const [department, setDepartment] = React.useState<Department | ''>('');

  const close = () => {
    setName('');
    setKind('bay');
    setDepartment('');
    create.reset();
    onOpenChange(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    create.mutate(
      { name: trimmed, kind, ...(department ? { department } : {}) },
      { onSuccess: close },
    );
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

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-graphite">
              Department
            </span>
            <select
              value={department}
              onChange={(e) =>
                setDepartment(e.target.value as Department | '')
              }
              className={fieldCls}
            >
              <option value="">Unclassified</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
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

/** Edit a library fixture — rename, re-kind, re-classify its department. */
function EditFixtureDialog({
  fixture,
  onClose,
}: {
  fixture: Fixture | null;
  onClose: () => void;
}) {
  const update = useUpdateFixture();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<FixtureKind>('bay');
  const [department, setDepartment] = React.useState<Department | ''>('');

  // Seed the form whenever a new fixture opens.
  React.useEffect(() => {
    if (fixture) {
      setName(fixture.name);
      setKind(fixture.kind);
      setDepartment(fixture.department ?? '');
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture]);

  const close = () => {
    update.reset();
    onClose();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fixture) return;
    const trimmed = name.trim();
    if (!trimmed || update.isPending) return;
    // `department` is tri-state: a value sets it, '' clears it (null).
    update.mutate(
      {
        id: fixture.id,
        name: trimmed,
        kind,
        department: department === '' ? null : department,
      },
      { onSuccess: close },
    );
  };

  return (
    <Dialog
      open={Boolean(fixture)}
      onOpenChange={(o) => {
        if (!o && !update.isPending) close();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit fixture</DialogTitle>
          <DialogDescription>
            Rename, change the type, or set the Myer department this fixture
            belongs to.
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

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-graphite">
              Department
            </span>
            <select
              value={department}
              onChange={(e) =>
                setDepartment(e.target.value as Department | '')
              }
              className={fieldCls}
            >
              <option value="">Unclassified</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          {update.isError ? (
            <p className="text-sm text-fail">{errorMessage(update.error)}</p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={update.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
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

  // Hard delete is gated: reveal it behind a disclosure, then require the admin
  // to type the fixture's exact name. When the fixture is in use we steer away
  // from delete entirely (the server returns 409 anyway) — archive is the move.
  const [showDelete, setShowDelete] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState('');
  const nameMatches = Boolean(fixture) && confirmName.trim() === fixture!.name;

  // Reset the gate whenever a different fixture opens (or it closes).
  React.useEffect(() => {
    setShowDelete(false);
    setConfirmName('');
    archive.reset();
    remove.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture]);

  const doArchive = () => {
    if (fixture) archive.mutate(fixture.id, { onSuccess: onClose });
  };
  const doDelete = () => {
    if (fixture && nameMatches) remove.mutate(fixture.id, { onSuccess: onClose });
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
            Archiving hides it from the library but keeps every existing
            placement intact — the recommended, reversible option.
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
              Not placed in any store or guide yet.
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

        {/* Hard-delete zone — only reachable when NOT in use, and only after the
            admin reveals it and types the exact name. */}
        {!usageQ.isLoading && !usageQ.isError ? (
          inUse ? (
            <p className="rounded-md border border-mist/60 bg-surface/30 px-3 py-2 text-xs text-steel">
              Permanent delete is blocked while this fixture is in use. Archive
              it, or remove its placements first.
            </p>
          ) : !showDelete ? (
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              className="self-start text-xs font-medium text-steel underline-offset-2 hover:text-fail hover:underline"
            >
              Delete permanently instead…
            </button>
          ) : (
            <div className="space-y-2 rounded-md border border-fail/40 bg-fail/5 p-3">
              <p className="text-xs text-graphite">
                This permanently removes the fixture and everything that hangs
                off it. To confirm, type its name{' '}
                <b className="text-ink">{fixture?.name}</b>.
              </p>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={fixture?.name}
                aria-label="Type the fixture name to confirm deletion"
                className={fieldCls}
              />
            </div>
          )
        ) : null}

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
          {showDelete && !inUse ? (
            <Button
              variant="signal"
              onClick={doDelete}
              disabled={busy || !nameMatches}
            >
              {remove.isPending ? 'Deleting…' : 'Delete everywhere'}
            </Button>
          ) : (
            <Button onClick={doArchive} disabled={busy}>
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </Button>
          )}
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
  const [tab, setTab] = React.useState<'products' | 'layout'>('products');
  const defaultsQ = useFixtureProducts(fixture?.id);
  const add = useAddFixtureProduct(fixture?.id ?? '');
  const remove = useRemoveFixtureProduct(fixture?.id ?? '');
  const reorder = useReorderFixturePlanogram(fixture?.id ?? '');
  const [q, setQ] = React.useState('');
  const productsQ = useProducts(fixture ? { search: q } : {});

  const defaults = defaultsQ.data ?? [];
  const defaultIds = new Set(defaults.map((d) => d.id));
  const results = (productsQ.data ?? []).slice(0, 24);
  const rows = React.useMemo(() => defaultsToRows(defaults), [defaults]);

  return (
    <Dialog
      open={Boolean(fixture)}
      onOpenChange={(o) => {
        if (!o) {
          setQ('');
          setTab('products');
          onClose();
        }
      }}
    >
      <DialogContent className={tab === 'layout' ? 'max-w-3xl' : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle>
            {fixture ? fixture.name : 'Fixture'} · default set
          </DialogTitle>
          <DialogDescription>
            The reusable starter set for this fixture. Lay it out as a planogram
            and a guide author who pre-populates inherits the shelves.
          </DialogDescription>
        </DialogHeader>

        {/* Products / Layout tabs */}
        <div className="inline-flex rounded-md border border-mist/70 p-0.5 text-xs">
          {(['products', 'layout'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 font-medium ${
                tab === t ? 'bg-ink text-paper' : 'text-graphite hover:text-ink'
              }`}
            >
              {t === 'layout' ? 'Layout / shelves' : 'Products'}
            </button>
          ))}
        </div>

        {tab === 'layout' ? (
          <div className="max-h-[65vh] overflow-y-auto">
            {defaultsQ.isLoading ? (
              <div className="grid place-items-center py-10">
                <Spinner className="text-lg text-steel" />
              </div>
            ) : fixture ? (
              <PlanogramEditor
                large
                onDone={onClose}
                adapter={{
                  rows,
                  isPersisting: reorder.isPending,
                  onReorder: (body) => reorder.mutate(body),
                  onAddProduct: (productId, row, onSuccess) =>
                    add.mutate({ productId, row }, { onSuccess }),
                  onRemoveFacing: (fixtureProductId) =>
                    remove.mutate(fixtureProductId),
                }}
              />
            ) : null}
          </div>
        ) : (
          <>
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
                  No default products yet — add some from the catalog below, then
                  open “Layout / shelves” to organise them.
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
                          {d.row ? ` · ${d.row}` : ''}
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
                            onClick={() => add.mutate({ productId: p.id })}
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
          </>
        )}

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

/** Group the flat default set into planogram rows (facing id = FixtureProduct id). */
function defaultsToRows(defaults: FixtureDefaultProduct[]): MerchandiseRow[] {
  const map = new Map<string, MerchandiseItem[]>();
  for (const d of defaults) {
    const row = d.row?.trim() || 'Unsorted';
    const arr = map.get(row) ?? [];
    arr.push({ ...d, merchandiseId: d.fixtureProductId });
    map.set(row, arr);
  }
  return [...map.entries()].map(([row, products]) => ({ row, products }));
}
