import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@wally/ui';
import type { GalleryItem, Overall } from '@wally/types';

import { api } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';

const BAND: Record<Overall, { icon: string; label: string; cls: string }> = {
  perfect: { icon: '✓', label: 'Perfect', cls: 'text-pass' },
  good: { icon: '✓', label: 'Good', cls: 'text-pass' },
  not_good: { icon: '✕', label: 'Not good', cls: 'text-fail' },
  needs_review: { icon: '◐', label: 'Review', cls: 'text-graphite' },
};

/** Every execution image across the guide's stores, filterable. */
export function GalleryView() {
  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const campaign =
    campaignsQ.data?.find((c) => c.status === 'ACTIVE') ?? campaignsQ.data?.[0];

  useSetStudioTopBar({ guideName: 'Gallery', guideKey: campaign?.key, stores: [] });

  const galleryQ = useQuery({
    queryKey: ['studio', 'gallery', campaign?.id],
    queryFn: () => api.campaigns.gallery(campaign!.id),
    enabled: Boolean(campaign?.id),
  });
  const items = galleryQ.data ?? [];

  const [store, setStore] = React.useState('all');
  const [fixture, setFixture] = React.useState('all');

  const stores = React.useMemo(
    () => [...new Map(items.map((i) => [i.storeId, i.storeName])).entries()],
    [items],
  );
  const fixtures = React.useMemo(
    () => [...new Set(items.map((i) => i.fixtureKey))].sort(),
    [items],
  );
  const shown = items.filter(
    (i) =>
      (store === 'all' || i.storeId === store) &&
      (fixture === 'all' || i.fixtureKey === fixture),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-brand text-steel">Operations</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Gallery {campaign ? <span className="text-steel">· {campaign.key}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-steel">
          Every store execution image — filter by store or fixture.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select value={store} onChange={setStore} label="All stores">
          {stores.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Select value={fixture} onChange={setFixture} label="All fixtures">
          {fixtures.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <span className="text-xs text-steel">{shown.length} images</span>
      </div>

      {campaignsQ.isLoading || galleryQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-steel">No execution images yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((it) => (
            <GalleryCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryCard({ item }: { item: GalleryItem }) {
  const band = item.overall ? BAND[item.overall] : null;
  return (
    <figure className="overflow-hidden rounded-lg border border-mist/60 bg-paper">
      <div className="aspect-[4/3] bg-surface">
        <img
          src={item.url}
          alt={`${item.storeName} · ${item.fixtureKey}`}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <figcaption className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-ink">
            {item.storeName}
          </span>
          <span className="block truncate text-[11px] text-steel">{item.fixtureKey}</span>
        </span>
        {band ? (
          <span className={`shrink-0 text-xs font-medium ${band.cls}`} title={band.label}>
            {band.icon}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-graphite outline-none focus:border-graphite"
    >
      <option value="all">{label}</option>
      {children}
    </select>
  );
}
