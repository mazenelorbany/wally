import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Map as MapIcon,
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
import type { ProjectDto, StoreDto, StoreSegments } from '@wally/types';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

type Editing = StoreDto | 'new' | null;

/** Admin: the store roster + segmentation metadata (region, manager, type). */
export function StoreDirectoryView() {
  useSetStudioTopBar({ guideName: 'Store directory', stores: [] });
  const qc = useQueryClient();
  const toast = useToast();
  const { project: activeProject, campaignId } = useProject();
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
  const stores = storesQ.data ?? [];
  const projects = projectsQ.data ?? [];
  const segments = segmentsQ.data;
  const projectName = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
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
          {groupByVenue(stores).map((g) => (
            <VenueRow
              key={g.venue}
              group={g}
              campaignId={campaignId}
              projectName={projectName}
              onEdit={setEditing}
              lifecycle={lifecycle}
            />
          ))}
        </ul>
      )}

      <StoreFormDialog
        editing={editing}
        projects={projects}
        segments={segments}
        defaultProjectId={activeProject?.id}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/** A parent venue (e.g. "Adelaide City Myer") with its concession stores grouped. */
interface VenueGroup {
  venue: string;
  entries: { brand: string; store: StoreDto }[];
}

/** Store names are "{Venue} — {Brand}" — strip the trailing brand to get the venue. */
function venueOf(s: StoreDto): string {
  const parts = s.name.split(/\s*—\s*/);
  return parts.length > 1 ? parts.slice(0, -1).join(' — ').trim() : s.name.trim();
}

/** "The Cookshop" → "Cookshop" for the brand toggle chips. */
function brandLabel(brand: string): string {
  return brand.replace(/^The\s+/i, '');
}

/** Group the flat store list by parent venue, preserving first-seen order. */
function groupByVenue(stores: StoreDto[]): VenueGroup[] {
  const map = new Map<string, VenueGroup>();
  for (const s of stores) {
    const venue = venueOf(s);
    const g = map.get(venue) ?? { venue, entries: [] };
    g.entries.push({ brand: s.brand, store: s });
    map.set(venue, g);
  }
  return [...map.values()];
}

type LifecycleMutation = {
  isPending: boolean;
  variables?: { id: string; close: boolean };
  mutate: (v: { id: string; close: boolean }) => void;
};

/** One venue row: its name + a brand toggle (when it has more than one concession),
 *  and the selected store's segmentation + actions. */
function VenueRow({
  group,
  campaignId,
  projectName,
  onEdit,
  lifecycle,
}: {
  group: VenueGroup;
  campaignId: string | undefined;
  projectName: Map<string, string>;
  onEdit: (store: StoreDto) => void;
  lifecycle: LifecycleMutation;
}) {
  const { entries } = group;
  // Floor plan + row actions default to the Custom Chef concession (else first
  // open, else first). Brand switching now happens on the floor plan, not here.
  const active = (
    entries.find((e) => /custom chef/i.test(e.brand) && !e.store.closedAt) ??
    entries.find((e) => !e.store.closedAt) ??
    entries[0]!
  ).store;
  const closed = Boolean(active.closedAt);
  const busy = lifecycle.isPending && lifecycle.variables?.id === active.id;

  return (
    <li className={`px-5 py-3.5${closed ? ' opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-[15px] font-semibold text-ink">
              {group.venue}
            </span>
            {closed ? (
              <Badge variant="warn">
                <Archive className="h-3 w-3" aria-hidden /> Closed
              </Badge>
            ) : null}
          </div>
          {/* Concession brands — informational only. Switch concessions on the
              floor plan (defaults to Custom Chef), not in the directory. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {entries.map((e) => (
              <Badge key={e.store.id} variant={e.store.id === active.id ? 'outline' : 'muted'}>
                {brandLabel(e.brand)}
                {e.store.closedAt ? (
                  <Archive className="h-3 w-3" aria-label="closed" />
                ) : null}
              </Badge>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {active.projectId ? (
              <Badge variant="outline">
                {projectName.get(active.projectId) ?? 'Project'}
              </Badge>
            ) : (
              <Badge variant="muted" className="text-warn">
                No project
              </Badge>
            )}
            {active.region ? <Badge variant="muted">{active.region}</Badge> : null}
            {active.storeType ? (
              <Badge variant="muted">{active.storeType}</Badge>
            ) : null}
            {active.areaManager ? (
              <Badge variant="muted">AM: {active.areaManager}</Badge>
            ) : null}
            {!active.region && !active.storeType && !active.areaManager ? (
              <span className="text-xs text-steel">No segmentation set</span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!closed && campaignId ? (
            <Link to={`/studio/${campaignId}/store/${active.id}`}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Open ${active.name}'s floor plan`}
              >
                <MapIcon className="h-4 w-4" /> Floor plan
              </Button>
            </Link>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(active)}
            aria-label={`Edit ${active.name}`}
          >
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          {closed ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => lifecycle.mutate({ id: active.id, close: false })}
              aria-label={`Reactivate ${active.name}`}
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
                    `Deactivate “${active.name}”? It will be hidden from the store switcher, rosters and reports. You can reactivate it later.`,
                  )
                ) {
                  lifecycle.mutate({ id: active.id, close: true });
                }
              }}
              aria-label={`Deactivate ${active.name}`}
            >
              <Archive className="h-4 w-4" /> Deactivate
            </Button>
          )}
        </div>
      </div>
    </li>
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
