import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink,
  FileText,
  GraduationCap,
  Link as LinkIcon,
  Pin,
  Search,
} from 'lucide-react';
import { Card, Spinner } from '@wally/ui';
import type { ResourceDto } from '@wally/sdk';

import { api } from '../../lib/api';

export function ManagerResourcesView() {
  const [q, setQ] = React.useState('');
  const [activeCat, setActiveCat] = React.useState<string | null>(null);

  const resourcesQ = useQuery({
    queryKey: ['manager', 'resources'],
    queryFn: () => api.resources.list(),
  });

  const resources = resourcesQ.data ?? [];
  const categories = React.useMemo(
    () => [...new Set(resources.map((r) => r.category))].sort(),
    [resources],
  );

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return resources.filter((r) => {
      if (activeCat && r.category !== activeCat) return false;
      if (!term) return true;
      return (
        r.title.toLowerCase().includes(term) ||
        r.description.toLowerCase().includes(term) ||
        r.category.toLowerCase().includes(term)
      );
    });
  }, [resources, q, activeCat]);

  // Group filtered results by category (pinned bubble to the top within each).
  const grouped = React.useMemo(() => {
    const byCat = new Map<string, ResourceDto[]>();
    for (const r of filtered) {
      const arr = byCat.get(r.category) ?? [];
      arr.push(r);
      byCat.set(r.category, arr);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (resourcesQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink">
          <GraduationCap className="h-5 w-5 text-graphite" /> Training &amp; Resources
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          Guides, videos, and brand docs to help you set the floor right.
        </p>
      </header>

      {resources.length === 0 ? (
        <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-10 text-center">
          <GraduationCap className="mx-auto h-7 w-7 text-mist" />
          <p className="mt-2 text-sm font-medium text-ink">Nothing here yet</p>
          <p className="mt-1 text-xs text-steel">
            Head office hasn't added any resources for your store yet.
          </p>
        </div>
      ) : (
        <>
          {/* Search + category chips */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search resources…"
                className="field pl-9"
              />
            </div>
            {categories.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                <Chip active={activeCat === null} onClick={() => setActiveCat(null)}>
                  All
                </Chip>
                {categories.map((c) => (
                  <Chip key={c} active={activeCat === c} onClick={() => setActiveCat(c)}>
                    {c}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-steel">
              No resources match "{q}".
            </p>
          ) : (
            <div className="space-y-6">
              {grouped.map(([cat, items]) => (
                <section key={cat}>
                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-brand text-steel">
                    {cat}
                  </p>
                  <div className="space-y-2.5">
                    {items.map((r) => (
                      <ResourceCard key={r.id} resource={r} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResourceCard({ resource: r }: { resource: ResourceDto }) {
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-mist/70 bg-surface text-graphite hover:border-steel hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
