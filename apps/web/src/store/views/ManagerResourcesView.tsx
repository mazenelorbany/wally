import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  GraduationCap,
  Link as LinkIcon,
  Pin,
  Search,
} from 'lucide-react';
import { Card, Spinner } from '@wally/ui';
import type { ResourceDto } from '@wally/sdk';

import { api } from '../../lib/api';

interface Topic {
  topic: string;
  count: number;
  subtopics: string[];
}

/** Build the topic index: one entry per topic with its count + sub-topic names. */
function buildTopics(resources: ResourceDto[]): Topic[] {
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

export function ManagerResourcesView() {
  const [q, setQ] = React.useState('');
  const [topic, setTopic] = React.useState<string | null>(null);

  const resourcesQ = useQuery({
    queryKey: ['manager', 'resources'],
    queryFn: () => api.resources.list(),
  });

  if (resourcesQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }

  const resources = resourcesQ.data ?? [];

  // A topic is selected → show that topic's page.
  if (topic) {
    return (
      <TopicPage
        topic={topic}
        resources={resources.filter((r) => r.category === topic)}
        onBack={() => setTopic(null)}
      />
    );
  }

  // Index: search across everything, or browse by topic.
  const term = q.trim().toLowerCase();
  const matches = term
    ? resources.filter(
        (r) =>
          r.title.toLowerCase().includes(term) ||
          r.description.toLowerCase().includes(term) ||
          r.category.toLowerCase().includes(term) ||
          r.subtopic.toLowerCase().includes(term),
      )
    : [];
  const topics = buildTopics(resources);
  const pinned = resources.filter((r) => r.pinned);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink">
          <GraduationCap className="h-5 w-5 text-graphite" /> Training &amp; Resources
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          Pick a topic, or search across every guide, video, and brand doc.
        </p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search resources…"
          className="field pl-9"
        />
      </div>

      {resources.length === 0 ? (
        <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-10 text-center">
          <GraduationCap className="mx-auto h-7 w-7 text-mist" />
          <p className="mt-2 text-sm font-medium text-ink">Nothing here yet</p>
          <p className="mt-1 text-xs text-steel">
            Head office hasn't added any resources for your store yet.
          </p>
        </div>
      ) : term ? (
        // Flat search results across all topics.
        matches.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-steel">No resources match "{q}".</p>
        ) : (
          <div className="space-y-2.5">
            <p className="px-1 text-[11px] uppercase tracking-brand text-steel">
              {matches.length} result{matches.length === 1 ? '' : 's'}
            </p>
            {matches.map((r) => (
              <ResourceCard key={r.id} resource={r} showBreadcrumb />
            ))}
          </div>
        )
      ) : (
        <>
          {pinned.length > 0 ? (
            <section>
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-brand text-steel">
                Pinned
              </p>
              <div className="space-y-2.5">
                {pinned.map((r) => (
                  <ResourceCard key={r.id} resource={r} showBreadcrumb />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-brand text-steel">
              Topics
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {topics.map((t) => (
                <TopicTile key={t.topic} topic={t} onOpen={() => setTopic(t.topic)} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TopicTile({ topic: t, onOpen }: { topic: Topic; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
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
  );
}

function TopicPage({
  topic,
  resources,
  onBack,
}: {
  topic: string;
  resources: ResourceDto[];
  onBack: () => void;
}) {
  const groups = bySubtopic(resources);
  return (
    <div className="space-y-5">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-steel hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> All topics
        </button>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink">
          <GraduationCap className="h-5 w-5 text-graphite" /> {topic}
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          {resources.length} resource{resources.length === 1 ? '' : 's'} in this topic.
        </p>
      </div>

      <div className="space-y-6">
        {groups.map(([subtopic, items]) => (
          <section key={subtopic || '__none__'}>
            {subtopic ? (
              <div className="mb-2.5 flex items-center gap-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-brand text-steel">
                  {subtopic}
                </h2>
                <div className="h-px flex-1 bg-mist/60" />
              </div>
            ) : null}
            <div className="space-y-2.5">
              {items.map((r) => (
                <ResourceCard key={r.id} resource={r} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ResourceCard({
  resource: r,
  showBreadcrumb,
}: {
  resource: ResourceDto;
  showBreadcrumb?: boolean;
}) {
  const href = r.url ?? r.attachmentUrl ?? null;
  const isLink = Boolean(r.url);
  const body = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface text-graphite">
        {isLink ? <LinkIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {r.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-signal" /> : null}
          <h3 className="truncate font-display text-base font-semibold text-ink">{r.title}</h3>
        </div>
        {showBreadcrumb ? (
          <p className="mt-0.5 text-[11px] uppercase tracking-brand text-steel">
            {r.category}
            {r.subtopic ? <span className="text-mist"> · {r.subtopic}</span> : null}
          </p>
        ) : null}
        {r.description ? (
          <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-graphite">
            {r.description}
          </p>
        ) : null}
        {!isLink && r.attachmentName ? (
          <p className="mt-1 truncate text-xs text-steel">{r.attachmentName}</p>
        ) : null}
      </div>
      {href ? (
        <span className="mt-1 shrink-0 text-steel">
          {isLink ? <ExternalLink className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
      ) : null}
    </div>
  );

  if (!href) {
    return <Card className="p-4">{body}</Card>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block">
      <Card className="p-4 transition-colors hover:border-steel">{body}</Card>
    </a>
  );
}
