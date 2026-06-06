import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
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

const SUGGESTED_TOPICS = [
  'VM Standards',
  'Product Knowledge',
  'How-to',
  'Safety',
  'Brand',
  'Onboarding',
];

interface TopicSummary {
  topic: string;
  count: number;
  subtopics: string[];
}

function buildTopics(resources: ResourceDto[]): TopicSummary[] {
  const map = new Map<string, { count: number; subs: Set<string> }>();
  for (const r of resources) {
    const e = map.get(r.category) ?? { count: 0, subs: new Set<string>() };
    e.count += 1;
    if (r.subtopic) e.subs.add(r.subtopic);
    map.set(r.category, e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([topic, e]) => ({
      topic,
      count: e.count,
      subtopics: [...e.subs].sort((a, b) => a.localeCompare(b)),
    }));
}

/** Group a topic's resources into sub-topic → items ("" bucket first). */
function bySubtopic(resources: ResourceDto[]) {
  const map = new Map<string, ResourceDto[]>();
  for (const r of resources) {
    const arr = map.get(r.subtopic) ?? [];
    arr.push(r);
    map.set(r.subtopic, arr);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === '') return -1;
    if (b[0] === '') return 1;
    return a[0].localeCompare(b[0]);
  });
}

export function ResourcesView() {
  const { project } = useProject();
  const qc = useQueryClient();
  const [creating, setCreating] = React.useState(false);
  const [topic, setTopic] = React.useState<string | null>(null);

  useSetStudioTopBar({ guideName: 'Training & Resources', stores: [] });

  const resourcesQ = useQuery({
    queryKey: ['studio', 'resources'],
    queryFn: () => api.resources.list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['studio', 'resources'] });

  const resources = resourcesQ.data ?? [];
  const topics = React.useMemo(
    () => [...new Set(resources.map((r) => r.category))].sort(),
    [resources],
  );
  const subtopics = React.useMemo(
    () => [...new Set(resources.map((r) => r.subtopic).filter(Boolean))].sort(),
    [resources],
  );

  // ── Topic detail (manage one topic) ───────────────────────────────────────
  if (topic) {
    const topicResources = resources.filter((r) => r.category === topic);
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button
          type="button"
          onClick={() => {
            setTopic(null);
            setCreating(false);
          }}
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-steel hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> All topics
        </button>
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink">
              <GraduationCap className="h-5 w-5 text-graphite" /> {topic}
            </h1>
            <p className="mt-1 text-sm text-steel">
              {topicResources.length} resource{topicResources.length === 1 ? '' : 's'} in this topic.
            </p>
          </div>
          <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : undefined}>
            {creating ? 'Cancel' : (<><Plus className="h-4 w-4" /> Add resource</>)}
          </Button>
        </header>

        {creating ? (
          <NewResourceForm
            topics={topics}
            subtopics={subtopics}
            presetTopic={topic}
            onDone={() => {
              setCreating(false);
              void invalidate();
            }}
          />
        ) : null}

        <div className="space-y-6">
          {bySubtopic(topicResources).map(([subtopic, items]) => (
            <section key={subtopic || '__none__'}>
              {subtopic ? (
                <div className="mb-2.5 flex items-center gap-2.5">
                  <h2 className="text-xs font-semibold uppercase tracking-brand text-steel">
                    {subtopic}
                  </h2>
                  <div className="h-px flex-1 bg-mist/60" />
                </div>
              ) : null}
              <div className="space-y-3">
                {items.map((r) => (
                  <ResourceCard
                    key={r.id}
                    resource={r}
                    topics={topics}
                    subtopics={subtopics}
                    onChanged={invalidate}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // ── Topic index ───────────────────────────────────────────────────────────
  const topicList = buildTopics(resources);
  const pinned = resources.filter((r) => r.pinned);

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
            The shared library every store draws on — organised by topic and sub-topic.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : undefined}>
          {creating ? 'Cancel' : (<><Plus className="h-4 w-4" /> New resource</>)}
        </Button>
      </header>

      {creating ? (
        <NewResourceForm
          topics={topics}
          subtopics={subtopics}
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
          {pinned.length > 0 ? (
            <section>
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-brand text-steel">
                Pinned
              </p>
              <div className="space-y-3">
                {pinned.map((r) => (
                  <ResourceCard
                    key={r.id}
                    resource={r}
                    topics={topics}
                    subtopics={subtopics}
                    onChanged={invalidate}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-brand text-steel">
              Topics
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {topicList.map((t) => (
                <button
                  key={t.topic}
                  type="button"
                  onClick={() => setTopic(t.topic)}
                  className="group flex w-full items-start gap-3 rounded-xl border border-mist/70 bg-paper p-4 text-left transition-colors hover:border-steel hover:shadow-card"
                >
                  <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface text-graphite">
                    <FolderOpen className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-base font-semibold text-ink">{t.topic}</h3>
                    <p className="mt-0.5 text-xs text-steel">
                      {t.count} resource{t.count === 1 ? '' : 's'}
                      {t.subtopics.length > 0 ? ` · ${t.subtopics.length} sub-topics` : ''}
                    </p>
                    {t.subtopics.length > 0 ? (
                      <p className="mt-1.5 truncate text-xs text-graphite">
                        {t.subtopics.join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-mist transition-colors group-hover:text-steel" />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ResourceCard({
  resource: r,
  topics,
  subtopics,
  onChanged,
}: {
  resource: ResourceDto;
  topics: string[];
  subtopics: string[];
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
        topics={topics}
        subtopics={subtopics}
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
          <p className="mt-0.5 text-[11px] uppercase tracking-brand text-steel">
            {r.category}
            {r.subtopic ? <span className="text-mist"> · {r.subtopic}</span> : null}
          </p>
          {r.description ? (
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-graphite">
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

function NewResourceForm({
  topics,
  subtopics,
  presetTopic,
  onDone,
}: {
  topics: string[];
  subtopics: string[];
  presetTopic?: string;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [topic, setTopic] = React.useState(presetTopic ?? '');
  const [subtopic, setSubtopic] = React.useState('');
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
          category: topic.trim() || undefined,
          subtopic: subtopic.trim() || undefined,
          url: mode === 'link' && url.trim() ? url.trim() : undefined,
          pinned,
        },
        mode === 'file' ? file ?? undefined : undefined,
      ),
    onSuccess: onDone,
  });

  const topicList = [...new Set([...topics, ...SUGGESTED_TOPICS])];
  const canSave =
    title.trim().length > 0 &&
    (mode === 'link' ? url.trim().length > 0 : Boolean(file));

  return (
    <Card className="mb-6 p-5">
      <datalist id="resource-topics">
        {topicList.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="resource-subtopics">
        {subtopics.map((c) => (
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
      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-brand text-steel">
            Topic
          </span>
          <input
            list="resource-topics"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. VM Standards"
            className="field"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-brand text-steel">
            Sub-topic
          </span>
          <input
            list="resource-subtopics"
            value={subtopic}
            onChange={(e) => setSubtopic(e.target.value)}
            placeholder="e.g. Knife wall (optional)"
            className="field"
          />
        </label>
      </div>

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
  topics,
  subtopics,
  onDone,
  onCancel,
}: {
  resource: ResourceDto;
  topics: string[];
  subtopics: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = React.useState(r.title);
  const [description, setDescription] = React.useState(r.description);
  const [topic, setTopic] = React.useState(r.category);
  const [subtopic, setSubtopic] = React.useState(r.subtopic);
  const [url, setUrl] = React.useState(r.url ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.resources.update(r.id, {
        title: title.trim(),
        description: description.trim(),
        category: topic.trim() || undefined,
        subtopic: subtopic.trim(),
        ...(r.url !== null && r.url !== undefined
          ? { url: url.trim() ? url.trim() : null }
          : {}),
      }),
    onSuccess: onDone,
  });

  const topicList = [...new Set([...topics, ...SUGGESTED_TOPICS])];

  return (
    <Card className="p-4">
      <datalist id="resource-topics-edit">
        {topicList.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="resource-subtopics-edit">
        {subtopics.map((c) => (
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
      <div className="mb-2.5 grid grid-cols-2 gap-2.5">
        <input
          list="resource-topics-edit"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic"
          className="field"
        />
        <input
          list="resource-subtopics-edit"
          value={subtopic}
          onChange={(e) => setSubtopic(e.target.value)}
          placeholder="Sub-topic (optional)"
          className="field"
        />
      </div>
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
