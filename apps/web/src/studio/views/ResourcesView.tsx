import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink,
  FileText,
  GraduationCap,
  Link as LinkIcon,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button, Card, Spinner } from '@wally/ui';
import type { ResourceDto } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

export function ResourcesView() {
  const { project } = useProject();
  const qc = useQueryClient();
  const [creating, setCreating] = React.useState(false);

  useSetStudioTopBar({ guideName: 'Training & Resources', stores: [] });

  const resourcesQ = useQuery({
    queryKey: ['studio', 'resources'],
    queryFn: () => api.resources.list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['studio', 'resources'] });

  const resources = resourcesQ.data ?? [];
  const categories = React.useMemo(
    () => [...new Set(resources.map((r) => r.category))].sort(),
    [resources],
  );
  // Group by category, pinned section first (pinned items already sorted to top).
  const grouped = React.useMemo(() => {
    const pinned = resources.filter((r) => r.pinned);
    const byCat = new Map<string, ResourceDto[]>();
    for (const r of resources.filter((x) => !x.pinned)) {
      const arr = byCat.get(r.category) ?? [];
      arr.push(r);
      byCat.set(r.category, arr);
    }
    return { pinned, byCat: [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
  }, [resources]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            {project?.name ?? 'Organisation'}
          </p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink">
            <GraduationCap className="h-5 w-5 text-graphite" /> Training &amp; Resources
          </h1>
          <p className="mt-1 text-sm text-steel">
            The shared library every store draws on — guides, videos, brand docs, how-tos.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : undefined}>
          {creating ? 'Cancel' : (<><Plus className="h-4 w-4" /> New resource</>)}
        </Button>
      </header>

      {creating ? (
        <NewResourceForm
          categories={categories}
          onDone={() => {
            setCreating(false);
            void invalidate();
          }}
        />
      ) : null}

      {resourcesQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : resources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-mist/70 bg-surface/40 px-6 py-12 text-center">
          <GraduationCap className="mx-auto h-7 w-7 text-mist" />
          <p className="mt-2 text-sm font-medium text-ink">No resources yet</p>
          <p className="mt-1 text-xs text-steel">
            Add the VM standards, product guides, and training videos stores keep coming back to.
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {grouped.pinned.length > 0 ? (
            <CategorySection
              label="Pinned"
              items={grouped.pinned}
              categories={categories}
              onChanged={invalidate}
            />
          ) : null}
          {grouped.byCat.map(([cat, items]) => (
            <CategorySection
              key={cat}
              label={cat}
              items={items}
              categories={categories}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategorySection({
  label,
  items,
  categories,
  onChanged,
}: {
  label: string;
  items: ResourceDto[];
  categories: string[];
  onChanged: () => void;
}) {
  return (
    <section>
      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-brand text-steel">
        {label}
      </p>
      <div className="space-y-3">
        {items.map((r) => (
          <ResourceCard key={r.id} resource={r} categories={categories} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function ResourceCard({
  resource: r,
  categories,
  onChanged,
}: {
  resource: ResourceDto;
  categories: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const patch = useMutation({
    mutationFn: (body: { pinned?: boolean }) => api.resources.update(r.id, body),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.resources.remove(r.id),
    onSuccess: onChanged,
  });

  const href = r.url ?? r.attachmentUrl ?? null;
  const isLink = Boolean(r.url);

  if (editing) {
    return (
      <EditResourceForm
        resource={r}
        categories={categories}
        onDone={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface text-graphite">
          {isLink ? <LinkIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {r.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-signal" /> : null}
            <h3 className="truncate font-display text-base font-semibold text-ink">{r.title}</h3>
          </div>
          {r.description ? (
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-graphite">
              {r.description}
            </p>
          ) : null}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-mist/70 bg-surface px-2.5 py-1.5 text-xs font-medium text-graphite hover:border-steel hover:text-ink"
            >
              {isLink ? <ExternalLink className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              {isLink ? 'Open link' : (r.attachmentName ?? 'Open file')}
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction
            label={r.pinned ? 'Unpin' : 'Pin'}
            onClick={() => patch.mutate({ pinned: !r.pinned })}
          >
            {r.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </IconAction>
          <IconAction label="Edit" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
          </IconAction>
          <IconAction
            label="Delete"
            danger
            onClick={() => {
              if (window.confirm('Delete this resource?')) remove.mutate();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconAction>
        </div>
      </div>
    </Card>
  );
}

const SUGGESTED_CATEGORIES = [
  'VM Standards',
  'Product Knowledge',
  'How-to',
  'Safety',
  'Brand',
  'Onboarding',
];

function NewResourceForm({
  categories,
  onDone,
}: {
  categories: string[];
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [mode, setMode] = React.useState<'link' | 'file'>('link');
  const [url, setUrl] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [pinned, setPinned] = React.useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.resources.create(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          url: mode === 'link' && url.trim() ? url.trim() : undefined,
          pinned,
        },
        mode === 'file' ? file ?? undefined : undefined,
      ),
    onSuccess: onDone,
  });

  const datalistId = 'resource-categories';
  const allCats = [...new Set([...categories, ...SUGGESTED_CATEGORIES])];
  const canSave =
    title.trim().length > 0 &&
    (mode === 'link' ? url.trim().length > 0 : Boolean(file));

  return (
    <Card className="mb-6 p-5">
      <datalist id={datalistId}>
        {allCats.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Resource title (e.g. Baccarat iD3 product guide)"
        className="field mb-2.5 font-medium"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="What it covers and when to use it (optional)"
        className="field mb-2.5 resize-y"
      />
      <input
        list={datalistId}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Category (e.g. VM Standards)"
        className="field mb-3"
      />

      {/* Link vs file toggle */}
      <div className="mb-3 inline-flex rounded-md border border-mist/70 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode('link')}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${
            mode === 'link' ? 'bg-ink text-paper' : 'text-graphite hover:text-ink'
          }`}
        >
          <LinkIcon className="h-3.5 w-3.5" /> Link
        </button>
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium ${
            mode === 'file' ? 'bg-ink text-paper' : 'text-graphite hover:text-ink'
          }`}
        >
          <Upload className="h-3.5 w-3.5" /> File
        </button>
      </div>

      {mode === 'link' ? (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (video, doc, or brand site)"
          className="field mb-3"
        />
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-mist bg-paper px-2.5 py-1.5 text-xs text-graphite hover:border-steel">
            <Paperclip className="h-3.5 w-3.5" />
            {file ? file.name : 'Choose PDF / image / doc'}
            <input
              type="file"
              accept="application/pdf,image/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file ? (
            <button type="button" onClick={() => setFile(null)} aria-label="Remove file">
              <X className="h-3.5 w-3.5 text-steel hover:text-ink" />
            </button>
          ) : null}
        </div>
      )}

      <label className="mb-3 inline-flex items-center gap-1.5 text-xs text-graphite">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        <Pin className="h-3.5 w-3.5" /> Pin to the top
      </label>

      {create.isError ? (
        <p className="mb-2 text-xs text-fail">{errorMessage(create.error)}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          disabled={!canSave}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Add resource
        </Button>
      </div>
    </Card>
  );
}

function EditResourceForm({
  resource: r,
  categories,
  onDone,
  onCancel,
}: {
  resource: ResourceDto;
  categories: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = React.useState(r.title);
  const [description, setDescription] = React.useState(r.description);
  const [category, setCategory] = React.useState(r.category);
  const [url, setUrl] = React.useState(r.url ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.resources.update(r.id, {
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || undefined,
        // Only resources that were links can edit their URL inline.
        ...(r.url !== null && r.url !== undefined
          ? { url: url.trim() ? url.trim() : null }
          : {}),
      }),
    onSuccess: onDone,
  });

  const datalistId = 'resource-categories-edit';
  const allCats = [...new Set([...categories, ...SUGGESTED_CATEGORIES])];

  return (
    <Card className="p-4">
      <datalist id={datalistId}>
        {allCats.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="field mb-2.5 font-medium"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        className="field mb-2.5 resize-y"
      />
      <input
        list={datalistId}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Category"
        className="field mb-2.5"
      />
      {r.url !== null && r.url !== undefined ? (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="field mb-3"
        />
      ) : r.attachmentName ? (
        <p className="mb-3 text-xs text-steel">
          Attached file: <span className="text-graphite">{r.attachmentName}</span> (replace by
          deleting and re-adding)
        </p>
      ) : null}

      {save.isError ? (
        <p className="mb-2 text-xs text-fail">{errorMessage(save.error)}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!title.trim()}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md text-steel hover:bg-surface ${
        danger ? 'hover:text-signal' : 'hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
