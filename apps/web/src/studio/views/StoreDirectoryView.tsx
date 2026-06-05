import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Store as StoreIcon } from 'lucide-react';
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
import type { StoreDto } from '@wally/types';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

type Editing = StoreDto | 'new' | null;

/** Admin: the store roster + segmentation metadata (region, manager, type). */
export function StoreDirectoryView() {
  useSetStudioTopBar({ guideName: 'Store directory', stores: [] });
  const storesQ = useQuery({
    queryKey: ['studio', 'admin-stores'],
    queryFn: () => api.stores.list(),
  });
  const [editing, setEditing] = React.useState<Editing>(null);
  const stores = storesQ.data ?? [];

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
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add store
        </Button>
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
          {stores.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[15px] font-semibold text-ink">
                  {s.name}{' '}
                  <span className="font-normal text-steel">· {s.brand}</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(s)}
                aria-label={`Edit ${s.name}`}
              >
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      <StoreFormDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function StoreFormDialog({
  editing,
  onClose,
}: {
  editing: Editing;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const open = editing !== null;
  const store = editing && editing !== 'new' ? editing : null;

  const [name, setName] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [externalRef, setExternalRef] = React.useState('');
  const [region, setRegion] = React.useState('');
  const [areaManager, setAreaManager] = React.useState('');
  const [storeType, setStoreType] = React.useState('');

  // Seed the form whenever the dialog opens (edit = prefill; create = blank).
  React.useEffect(() => {
    if (!open) return;
    setName(store?.name ?? '');
    setBrand(store?.brand ?? '');
    setExternalRef(store?.externalRef ?? '');
    setRegion(store?.region ?? '');
    setAreaManager(store?.areaManager ?? '');
    setStoreType(store?.storeType ?? '');
  }, [open, store]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        brand: brand.trim(),
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
            ...(body.externalRef ? { externalRef: body.externalRef } : {}),
            ...(body.region ? { region: body.region } : {}),
            ...(body.areaManager ? { areaManager: body.areaManager } : {}),
            ...(body.storeType ? { storeType: body.storeType } : {}),
          });
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'admin-stores'] });
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
            Region / area manager / store type power the analytics segmentation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" value={name} onChange={setName} autoFocus />
            <Field label="Brand" value={brand} onChange={setBrand} />
            <Field label="Region" value={region} onChange={setRegion} placeholder="NSW" />
            <Field label="Store type" value={storeType} onChange={setStoreType} placeholder="Full line" />
            <Field label="Area manager" value={areaManager} onChange={setAreaManager} />
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
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
      />
    </label>
  );
}
