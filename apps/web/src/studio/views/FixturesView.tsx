import * as React from 'react';
import { Boxes, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import {
  Badge,
  Button,
  cn,
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
  useClearFixtureReference,
  useCreateFixture,
  useDeleteFixture,
  useFixtureProducts,
  useFixtures,
  useFixtureUsage,
  useProducts,
  useRemoveFixtureProduct,
  useReorderFixturePlanogram,
  useSetFixtureReference,
  useUpdateFixture,
} from '../lib/hooks';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { ProductThumb } from '../components/ProductThumb';
import { PlanogramEditor } from '../components/PlanogramEditor';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

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
  // Scope the library to the project the admin is working in: its own fixtures
  // plus shared ones. Myer and Ambiente keep separate libraries this way.
  const { projectId, project } = useProject();
  const fixturesQ = useFixtures(projectId);
  const fixtures = fixturesQ.data ?? [];

  useSetStudioTopBar({ guideName: 'Fixture library', stores: [] });

  const [searchInput, setSearchInput] = React.useState('');
  const [kind, setKind] = React.useState<FixtureKind | ''>('');
  // '' = all departments, '__none' = unclassified only, else a department value.
  const [department, setDepartment] = React.useState<Department | '' | '__none'>(
    '',
  );

  const hasFilters = Boolean(searchInput || kind || department);
  const clearAll = () => {
    setSearchInput('');
    setKind('');
    setDepartment('');
  };

  const filtered = React.useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return fixtures.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (kind && f.kind !== kind) return false;
      if (department === '__none' && f.department) return false;
      if (department && department !== '__none' && f.department !== department)
        return false;
      return true;
    });
  }, [fixtures, searchInput, kind, department]);

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

      {/* Controls — filter the library by name, type, and department. Hidden
          until there's something to filter (and never on error). */}
      {!fixturesQ.isLoading && !fixturesQ.isError && fixtures.length > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[14rem] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search fixtures by name…"
              aria-label="Search fixtures"
              className="h-9 w-full rounded-md border border-mist bg-surface/50 pl-9 pr-3 font-sans text-sm text-ink placeholder:text-steel transition-colors hover:bg-surface focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
            />
          </div>

          <FilterSelect
            label="Type"
            value={kind}
            onChange={(v) => setKind(v as FixtureKind | '')}
            options={[
              { value: '', label: 'All types' },
              ...KINDS.map((k) => ({
                value: k,
                label: fixtureKindMeta(k).label,
              })),
            ]}
          />
          <FilterSelect
            label="Department"
            value={department}
            onChange={(v) => setDepartment(v as Department | '' | '__none')}
            options={[
              { value: '', label: 'All departments' },
              ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
              { value: '__none', label: 'Unclassified' },
            ]}
          />

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : null}

          <span className="ml-auto text-xs text-steel">
            {`${filtered.length} of ${fixtures.length} fixture${
              fixtures.length === 1 ? '' : 's'
            }`}
          </span>
        </div>
      ) : null}

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
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No matches"
          body="No fixtures match these filters. Try a broader search or clear them."
        >
          <Button variant="outline" size="sm" onClick={clearAll}>
            Clear filters
          </Button>
        </EmptyState>
      ) : (
        <Grid>
          {filtered.map((f) => {
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
                    {!f.projectId ? (
                      <Badge
                        variant="outline"
                        className="tracking-tight text-steel"
                      >
                        Shared
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

      <AddFixtureDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        projectName={project?.name}
      />
      <EditFixtureDialog
        fixture={editing}
        onClose={() => setEditing(null)}
        projectId={projectId}
        projectName={project?.name}
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

/** Ownership control for the add/edit dialogs: own this project, or share it. */
function OwnershipField({
  shared,
  setShared,
  projectName,
}: {
  shared: boolean;
  setShared: (v: boolean) => void;
  projectName: string | undefined;
}) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-xs font-medium text-graphite">
        Availability
      </span>
      <label className="flex cursor-pointer select-none items-start gap-2 rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-mist accent-graphite"
        />
        <span className="text-graphite">
          Shared across all projects
          <span className="mt-0.5 block text-xs text-steel">
            {shared
              ? 'Appears in every project’s library and floor plans.'
              : `Belongs to ${projectName ?? 'this project'} only.`}
          </span>
        </span>
      </label>
    </div>
  );
}

/** A labelled dropdown for the library filter bar (value/label option pairs). */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-9 rounded-md border border-mist bg-surface/50 px-3 font-sans text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
        value ? 'text-ink' : 'text-steel',
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Create a new library fixture (name + kind), owned by the current project. */
function AddFixtureDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | undefined;
  projectName: string | undefined;
}) {
  const create = useCreateFixture();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<FixtureKind>('bay');
  const [department, setDepartment] = React.useState<Department | ''>('');
  // New fixtures belong to the current project by default; sharing lifts them
  // into every project's library.
  const [shared, setShared] = React.useState(false);

  const close = () => {
    setName('');
    setKind('bay');
    setDepartment('');
    setShared(false);
    create.reset();
    onOpenChange(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    create.mutate(
      {
        name: trimmed,
        kind,
        ...(department ? { department } : {}),
        // null = shared; otherwise scope to the project being viewed.
        projectId: shared ? null : projectId ?? null,
      },
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

          <OwnershipField
            shared={shared}
            setShared={setShared}
            projectName={projectName}
          />

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

/** Edit a library fixture — rename, re-kind, re-classify, re-home its project. */
function EditFixtureDialog({
  fixture,
  onClose,
  projectId,
  projectName,
}: {
  fixture: Fixture | null;
  onClose: () => void;
  projectId: string | undefined;
  projectName: string | undefined;
}) {
  const update = useUpdateFixture();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<FixtureKind>('bay');
  const [department, setDepartment] = React.useState<Department | ''>('');
  const [shared, setShared] = React.useState(false);

  // Seed the form whenever a new fixture opens.
  React.useEffect(() => {
    if (fixture) {
      setName(fixture.name);
      setKind(fixture.kind);
      setDepartment(fixture.department ?? '');
      setShared(!fixture.projectId);
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
    // Ownership: shared → null; otherwise keep the fixture in its current
    // project (falling back to the one being viewed).
    update.mutate(
      {
        id: fixture.id,
        name: trimmed,
        kind,
        department: department === '' ? null : department,
        projectId: shared ? null : fixture.projectId ?? projectId ?? null,
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

          <OwnershipField
            shared={shared}
            setShared={setShared}
            projectName={projectName}
          />

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
  const { projectId } = useProject();
  const defaultsQ = useFixtureProducts(fixture?.id);
  const add = useAddFixtureProduct(fixture?.id ?? '');
  const remove = useRemoveFixtureProduct(fixture?.id ?? '');
  const reorder = useReorderFixturePlanogram(fixture?.id ?? '');
  const update = useUpdateFixture();
  const usageQ = useFixtureUsage(fixture?.id);
  const setRef = useSetFixtureReference();
  const clearRef = useClearFixtureReference();
  const refInput = React.useRef<HTMLInputElement>(null);

  const defaults = defaultsQ.data ?? [];
  const rows = React.useMemo(() => defaultsToRows(defaults), [defaults]);
  // The fixture prop is a snapshot; reflect the latest reference / share change
  // (the mutations return the updated fixture) so the open modal updates live.
  const refFixture =
    clearRef.data?.id === fixture?.id
      ? clearRef.data
      : setRef.data?.id === fixture?.id
        ? setRef.data
        : fixture;
  const referenceUrl = refFixture?.referenceUrl ?? null;
  const shared =
    update.data && update.data.id === fixture?.id
      ? update.data.projectId == null
      : fixture
        ? fixture.projectId == null
        : false;

  const onPickReference = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && fixture) setRef.mutate({ id: fixture.id, file });
    e.target.value = '';
  };

  return (
    <Dialog
      open={Boolean(fixture)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {fixture ? fixture.name : 'Fixture'} · default set
          </DialogTitle>
          <DialogDescription>
            The reusable starter set for this fixture. Add products straight onto
            shelves; guides that use this fixture inherit the layout.
          </DialogDescription>
        </DialogHeader>

        {fixture ? (
          <div className="space-y-3 border-b border-mist/50 pb-4">
            {/* Reference image — the library-level "what good looks like". */}
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
                Reference image · what good looks like
              </p>
              <div className="flex items-start gap-3">
                {referenceUrl ? (
                  <img
                    src={referenceUrl}
                    alt=""
                    className="h-20 w-28 shrink-0 rounded-md border border-mist object-cover"
                  />
                ) : (
                  <div className="grid h-20 w-28 shrink-0 place-items-center rounded-md border border-dashed border-mist text-[10px] text-steel">
                    No reference
                  </div>
                )}
                <div className="flex flex-col items-start gap-1.5">
                  <input
                    ref={refInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPickReference}
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refInput.current?.click()}
                      loading={setRef.isPending}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {referenceUrl ? 'Replace' : 'Add reference'}
                    </Button>
                    {referenceUrl ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => clearRef.mutate(fixture.id)}
                        loading={clearRef.isPending}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <p className="max-w-[18rem] text-[10px] leading-snug text-steel">
                    The AI compares store photos against this. Guides inherit it
                    unless they upload their own.
                  </p>
                </div>
              </div>
            </div>

            {/* Shared toggle + where this fixture is placed. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-graphite">
                <input
                  type="checkbox"
                  checked={shared}
                  disabled={update.isPending}
                  onChange={(e) =>
                    update.mutate({
                      id: fixture.id,
                      projectId: e.target.checked ? null : (projectId ?? null),
                    })
                  }
                  className="h-3.5 w-3.5"
                />
                Shared across all projects
              </label>
              <span className="text-[11px] text-steel">
                {usageQ.data
                  ? usageQ.data.storeCount === 0
                    ? 'Not placed in any store yet'
                    : `In ${usageQ.data.storeCount} store${
                        usageQ.data.storeCount === 1 ? '' : 's'
                      }${
                        usageQ.data.stores.length
                          ? `: ${usageQ.data.stores
                              .slice(0, 3)
                              .map((s) => s.name)
                              .join(', ')}${
                              usageQ.data.stores.length > 3
                                ? `, +${usageQ.data.stores.length - 3} more`
                                : ''
                            }`
                          : ''
                      }`
                  : ''}
              </span>
            </div>
          </div>
        ) : null}

        <div className="max-h-[55vh] overflow-y-auto">
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
