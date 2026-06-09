import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ClipboardPlus,
  Pencil,
  Plus,
  RotateCcw,
  Store as StoreIcon,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@wally/ui';
import type { ProjectDto, StoreDto, StoreSegments, TaskKind } from '@wally/types';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

type Editing = StoreDto | 'new' | null;

/** Assigning a task: to one store, or picking a subset from the roster. */
type Assigning = { store: StoreDto } | { pick: StoreDto[] } | null;

/** Admin: the store roster + segmentation metadata (region, manager, type). */
export function StoreDirectoryView() {
  useSetStudioTopBar({ guideName: 'Store directory', stores: [] });
  const qc = useQueryClient();
  const toast = useToast();
  const { project: activeProject } = useProject();
  const storesQ = useQuery({
    queryKey: ['studio', 'admin-stores'],
    queryFn: () => api.stores.list(),
  });
  // Projects power the create/edit project picker (and the row's project label).
  const projectsQ = useQuery({
    queryKey: ['studio', 'projects'],
    queryFn: () => api.projects.list(),
  });
  // Existing distinct segmentation values back the directory comboboxes.
  const segmentsQ = useQuery({
    queryKey: ['studio', 'store-segments'],
    queryFn: () => api.stores.segments(),
  });
  const [editing, setEditing] = React.useState<Editing>(null);
  const [assigning, setAssigning] = React.useState<Assigning>(null);
  const stores = storesQ.data ?? [];
  const projects = projectsQ.data ?? [];
  const segments = segmentsQ.data;
  const projectName = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  // Active stores drive "Assign to all" — never assign a task to a closed store.
  const activeStores = React.useMemo(
    () => stores.filter((s) => !s.closedAt),
    [stores],
  );

  const lifecycle = useMutation({
    mutationFn: ({ id, close }: { id: string; close: boolean }) =>
      close ? api.stores.deactivate(id) : api.stores.reactivate(id),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'admin-stores'] });
      // Closed stores leave the venue lists / switchers — refresh them.
      void qc.invalidateQueries({ queryKey: ['studio', 'projects'] });
      toast.success(s.closedAt ? `“${s.name}” deactivated` : `“${s.name}” reactivated`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Admin</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Store directory
          </h1>
          <p className="mt-1 text-sm text-steel">
            The store roster and its segmentation — region, area manager and
            store type drive the analytics filters.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeStores.length > 0 ? (
            <Button
              variant="outline"
              onClick={() => setAssigning({ pick: activeStores })}
            >
              <ClipboardPlus className="h-4 w-4" /> Assign to stores
            </Button>
          ) : null}
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add store
          </Button>
        </div>
      </header>

      {storesQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : storesQ.isError ? (
        <ErrorState
          error={storesQ.error}
          onRetry={() => storesQ.refetch()}
          title="Couldn't load stores"
        />
      ) : stores.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title="No stores yet"
          body="Add your stores, then set their region / manager / type for segmentation."
        />
      ) : (
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {stores.map((s) => {
            const closed = Boolean(s.closedAt);
            const busy = lifecycle.isPending && lifecycle.variables?.id === s.id;
            return (
              <li
                key={s.id}
                className={`flex items-center gap-3 px-5 py-3.5${closed ? ' opacity-60' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="block truncate font-display text-[15px] font-semibold text-ink">
                      {s.name}{' '}
                      <span className="font-normal text-steel">· {s.brand}</span>
                    </span>
                    {closed ? (
                      // Colour-blind-safe: icon + explicit "Closed" label, not colour alone.
                      <Badge variant="warn">
                        <Archive className="h-3 w-3" aria-hidden /> Closed
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {s.projectId ? (
                      <Badge variant="outline">
                        {projectName.get(s.projectId) ?? 'Project'}
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="text-warn">
                        No project
                      </Badge>
                    )}
                    {s.region ? <Badge variant="muted">{s.region}</Badge> : null}
                    {s.storeType ? (
                      <Badge variant="muted">{s.storeType}</Badge>
                    ) : null}
                    {s.areaManager ? (
                      <Badge variant="muted">AM: {s.areaManager}</Badge>
                    ) : null}
                    {!s.region && !s.storeType && !s.areaManager ? (
                      <span className="text-xs text-steel">
                        No segmentation set
                      </span>
                    ) : null}
                  </span>
                </span>
                {!closed ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAssigning({ store: s })}
                    aria-label={`Assign a task to ${s.name}`}
                  >
                    <ClipboardPlus className="h-4 w-4" /> Assign
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(s)}
                  aria-label={`Edit ${s.name}`}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
                {closed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => lifecycle.mutate({ id: s.id, close: false })}
                    aria-label={`Reactivate ${s.name}`}
                  >
                    <RotateCcw className="h-4 w-4" /> Reactivate
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-fail"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Deactivate “${s.name}”? It will be hidden from the store switcher, rosters and reports. You can reactivate it later.`,
                        )
                      ) {
                        lifecycle.mutate({ id: s.id, close: true });
                      }
                    }}
                    aria-label={`Deactivate ${s.name}`}
                  >
                    <Archive className="h-4 w-4" /> Deactivate
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <StoreFormDialog
        editing={editing}
        projects={projects}
        segments={segments}
        defaultProjectId={activeProject?.id}
        onClose={() => setEditing(null)}
      />
      <AssignTaskDialog
        assigning={assigning}
        onClose={() => setAssigning(null)}
      />
    </div>
  );
}

function StoreFormDialog({
  editing,
  projects,
  segments,
  defaultProjectId,
  onClose,
}: {
  editing: Editing;
  projects: ProjectDto[];
  segments: StoreSegments | undefined;
  defaultProjectId: string | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const open = editing !== null;
  const store = editing && editing !== 'new' ? editing : null;

  const [name, setName] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [externalRef, setExternalRef] = React.useState('');
  const [region, setRegion] = React.useState('');
  const [areaManager, setAreaManager] = React.useState('');
  const [storeType, setStoreType] = React.useState('');

  // Seed the form whenever the dialog opens (edit = prefill; create = blank).
  // New stores default to the studio's current project, else the only/first one.
  React.useEffect(() => {
    if (!open) return;
    setName(store?.name ?? '');
    setBrand(store?.brand ?? '');
    // Edit → the store's own project; create → the studio's current project,
    // else the first project in the list (covers the common single-project org).
    setProjectId(store?.projectId ?? defaultProjectId ?? projects[0]?.id ?? '');
    setExternalRef(store?.externalRef ?? '');
    setRegion(store?.region ?? '');
    setAreaManager(store?.areaManager ?? '');
    setStoreType(store?.storeType ?? '');
  }, [open, store, defaultProjectId, projects]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        brand: brand.trim(),
        projectId: projectId || null,
        externalRef: externalRef.trim() || null,
        region: region.trim() || null,
        areaManager: areaManager.trim() || null,
        storeType: storeType.trim() || null,
      };
      return store
        ? api.stores.update(store.id, body)
        : api.stores.create({
            name: body.name,
            brand: body.brand,
            ...(body.projectId ? { projectId: body.projectId } : {}),
            ...(body.externalRef ? { externalRef: body.externalRef } : {}),
            ...(body.region ? { region: body.region } : {}),
            ...(body.areaManager ? { areaManager: body.areaManager } : {}),
            ...(body.storeType ? { storeType: body.storeType } : {}),
          });
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'admin-stores'] });
      // A store joining/leaving a project changes venue lists + segments.
      void qc.invalidateQueries({ queryKey: ['studio', 'projects'] });
      void qc.invalidateQueries({ queryKey: ['studio', 'store-segments'] });
      toast.success(store ? `“${s.name}” updated` : `“${s.name}” added`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !brand.trim() || save.isPending) return;
    save.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{store ? 'Edit store' : 'Add store'}</DialogTitle>
          <DialogDescription>
            Project scopes the store's campaign and venue list; region / area
            manager / store type power the analytics segmentation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-1 space-y-3">
          {/* Project picker — a project-less store resolves the wrong campaign
              and never appears in its venue list, so surface it prominently. */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-graphite">
              Project
            </span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={fieldCls}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!projectId ? (
              <span className="mt-1 block text-xs text-warn">
                Without a project this store won't appear in any venue list and
                resolves the org's fallback campaign.
              </span>
            ) : null}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" value={name} onChange={setName} autoFocus />
            <Field label="Brand" value={brand} onChange={setBrand} />
            <Field
              label="Region"
              value={region}
              onChange={setRegion}
              placeholder="NSW"
              list="store-region-options"
              options={segments?.regions}
            />
            <Field
              label="Store type"
              value={storeType}
              onChange={setStoreType}
              placeholder="Full line"
              list="store-type-options"
              options={segments?.storeTypes}
            />
            <Field
              label="Area manager"
              value={areaManager}
              onChange={setAreaManager}
              list="store-am-options"
              options={segments?.areaManagers}
            />
            <Field label="External ref" value={externalRef} onChange={setExternalRef} />
          </div>
          {save.isError ? (
            <p className="text-sm text-fail">{errorMessage(save.error)}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!name.trim() || !brand.trim() || save.isPending}
            >
              {save.isPending ? 'Saving…' : store ? 'Save changes' : 'Add store'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TASK_KINDS: { value: TaskKind; label: string }[] = [
  { value: 'GENERAL', label: 'General ask' },
  { value: 'UPLOAD_PHOTO', label: 'Upload a fixture photo' },
  { value: 'LOG_SALES', label: 'Log sales' },
];

/** Assign one task to a single store, or in bulk to the whole listed roster. */
function AssignTaskDialog({
  assigning,
  onClose,
}: {
  assigning: Assigning;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const open = assigning !== null;
  const single = assigning && 'store' in assigning ? assigning.store : null;
  // Bulk mode opens with the whole active roster as candidates; admin narrows it.
  const candidates = assigning && 'pick' in assigning ? assigning.pick : [];

  const [kind, setKind] = React.useState<TaskKind>('GENERAL');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [fixtureKey, setFixtureKey] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');
  // Bulk only: the selected store ids and the store filter query.
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [storeFilter, setStoreFilter] = React.useState('');

  // Reset the form each time the dialog opens; bulk starts with all selected.
  React.useEffect(() => {
    if (!open) return;
    setKind('GENERAL');
    setTitle('');
    setBody('');
    setFixtureKey('');
    setDueAt('');
    setStoreFilter('');
    setSelected(new Set(candidates.map((s) => s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = single ? 1 : selected.size;
  const label = single
    ? single.name
    : `${count} ${count === 1 ? 'store' : 'stores'}`;

  // Filter the candidate list by name / brand / segmentation for quick narrowing.
  const filtered = React.useMemo(() => {
    const q = storeFilter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((s) =>
      `${s.name} ${s.brand} ${s.region ?? ''} ${s.areaManager ?? ''} ${s.storeType ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [candidates, storeFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const assign = useMutation({
    mutationFn: () => {
      const base = {
        kind,
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
        // <input type="date"> gives YYYY-MM-DD; the API wants a full ISO datetime.
        ...(dueAt ? { dueAt: new Date(`${dueAt}T00:00:00`).toISOString() } : {}),
        ...(kind === 'UPLOAD_PHOTO' && fixtureKey.trim()
          ? { fixtureKey: fixtureKey.trim() }
          : {}),
      };
      if (single) {
        return api.adminTasks.create(single.id, base).then(() => 1);
      }
      return api.adminTasks
        .bulkCreate({ storeIds: [...selected], ...base })
        .then((r) => r.created);
    },
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: ['manager', 'tasks'] });
      void qc.invalidateQueries({ queryKey: ['manager', 'home'] });
      toast.success(n === 1 ? 'Task assigned' : `Task assigned to ${n} stores`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || count === 0 || assign.isPending) return;
    assign.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign a task</DialogTitle>
          <DialogDescription>
            To {label}. It appears on the store manager's home and Tasks list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-1 space-y-3">
          {single ? null : (
            <div className="block">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-graphite">
                  Stores ({selected.size}/{candidates.length})
                </span>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-steel transition-colors hover:text-ink"
                    onClick={() =>
                      setSelected(new Set(candidates.map((s) => s.id)))
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-steel transition-colors hover:text-ink"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <input
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                placeholder="Filter by name, brand, region…"
                className={fieldCls}
              />
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-mist/70 bg-paper p-1">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-mist/30">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggle(s.id)}
                        className="h-4 w-4 shrink-0 rounded border-mist accent-graphite"
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {s.name} <span className="text-steel">· {s.brand}</span>
                      </span>
                      {s.region ? (
                        <Badge variant="muted">{s.region}</Badge>
                      ) : null}
                    </label>
                  </li>
                ))}
                {filtered.length === 0 ? (
                  <li className="px-2 py-3 text-center text-xs text-steel">
                    No stores match “{storeFilter}”.
                  </li>
                ) : null}
              </ul>
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-graphite">
              Type
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskKind)}
              className={fieldCls}
            >
              {TASK_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Title"
            value={title}
            onChange={setTitle}
            autoFocus
            placeholder="e.g. Re-shoot the storefront"
          />
          {kind === 'UPLOAD_PHOTO' ? (
            <Field
              label="Fixture key (optional)"
              value={fixtureKey}
              onChange={setFixtureKey}
              placeholder="storefront"
            />
          ) : null}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-graphite">
              Details (optional)
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className={fieldCls}
              placeholder="What you're asking the manager to do."
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-graphite">
              Due date (optional)
            </span>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className={fieldCls}
            />
          </label>
          {assign.isError ? (
            <p className="text-sm text-fail">{errorMessage(assign.error)}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!title.trim() || count === 0 || assign.isPending}
            >
              {assign.isPending
                ? 'Assigning…'
                : count > 1
                  ? `Assign to ${count} stores`
                  : 'Assign task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  list,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** When set with `options`, renders a combobox (free entry + suggestions). */
  list?: string;
  options?: string[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-graphite">
        {label}
      </span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={fieldCls}
        list={list}
      />
      {/* Datalist nudges reuse of existing segment values; free entry still works. */}
      {list && options && options.length > 0 ? (
        <datalist id={list}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
