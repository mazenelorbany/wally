import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  ListChecks,
  Map as MapIcon,
  Package,
  Receipt,
} from 'lucide-react';
import { Card, Spinner } from '@wally/ui';

import { api } from '../../lib/api';
import { ErrorState } from '../../components/states';
import { useManagerStore } from '../ManagerStoreContext';

const money = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `$${Math.round(n)}`;

export function ManagerHome() {
  const { storeId } = useManagerStore();
  const homeQ = useQuery({
    queryKey: ['manager', 'home', storeId],
    queryFn: () => api.manager.home(storeId),
  });
  // Floor-map compliance drives the capture progress (the floor map is the
  // capture surface), so Home and the floor map always agree.
  const compQ = useQuery({
    queryKey: ['manager', 'compliance', storeId],
    queryFn: () => api.manager.compliance(storeId),
  });

  if (homeQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  if (homeQ.isError) {
    return (
      <div className="px-4 py-6">
        <ErrorState
          error={homeQ.error}
          onRetry={() => homeQ.refetch()}
          title="Couldn't load your store"
        />
      </div>
    );
  }
  if (!homeQ.data) {
    return <p className="text-sm text-steel">No store assigned yet.</p>;
  }

  const h = homeQ.data;
  const comp = compQ.data ?? [];
  const total = comp.length;
  const needs = comp.filter((c) => c.needsPhoto).length;
  const done = total - needs;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const captureDone = total > 0 && needs === 0;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-[11px] uppercase tracking-brand text-steel">
          {h.campaignName}
        </p>
        <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
          {h.storeName}
        </h1>
      </header>

      {/* Floor map — the manager's main monthly job: capture each fixture */}
      <Card className="overflow-hidden">
        <Link to="/store/guide" className="block p-5 transition-colors hover:bg-surface/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className={`grid h-9 w-9 place-items-center rounded-lg ${
                  captureDone ? 'bg-ink text-paper' : 'bg-gold/15 text-gold-deep'
                }`}
              >
                {captureDone ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <MapIcon className="h-5 w-5" />
                )}
              </span>
              <div>
                <p className="font-display text-base font-semibold text-ink">
                  {captureDone ? 'Floor set up' : 'Set up your floor'}
                </p>
                <p className="text-xs text-steel">
                  {needs > 0
                    ? `${needs} fixture${needs === 1 ? '' : 's'} need a photo`
                    : `${done} of ${total} fixtures captured`}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-steel" />
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-mist/40">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                captureDone ? 'bg-graphite' : 'bg-gold'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </Link>
      </Card>

      {/* Tasks + Sales snapshot */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          to="/store/tasks"
          icon={ListChecks}
          label="Open tasks"
          value={String(h.openTasks)}
          accent={h.unseenTasks > 0}
          sub={h.unseenTasks > 0 ? `${h.unseenTasks} new` : 'All seen'}
        />
        <StatTile
          to="/store/sales"
          icon={Receipt}
          label="Sales today"
          valueTone="gold"
          value={money(h.sales.today.totalRevenue)}
          sub={`${h.sales.today.totalUnits.toLocaleString()} units · ${money(
            h.sales.campaignToDate.totalRevenue,
          )} to date`}
        />
      </div>

      {/* Open tasks preview */}
      {h.tasks.filter((t) => t.status === 'OPEN').length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-brand text-steel">
              What admin needs
            </h2>
            <Link to="/store/tasks" className="text-xs font-medium text-graphite hover:text-ink">
              See all
            </Link>
          </div>
          <div className="space-y-2">
            {h.tasks
              .filter((t) => t.status === 'OPEN')
              .slice(0, 3)
              .map((t) => (
                <Link
                  key={t.id}
                  to="/store/tasks"
                  className="flex items-center gap-3 rounded-lg border border-mist/60 bg-paper px-3.5 py-3 hover:border-steel"
                >
                  {t.seen ? null : (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{t.title}</p>
                    {t.body ? (
                      <p className="truncate text-xs text-steel">{t.body}</p>
                    ) : null}
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-mist" />
                </Link>
              ))}
          </div>
        </section>
      ) : null}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <QuickLink to="/store/products" icon={Package} title="Products" sub="The range to set" />
        <QuickLink to="/store/sales" icon={Receipt} title="Log sales" sub="By product" />
      </div>
    </div>
  );
}

function StatTile({
  to,
  icon: Icon,
  label,
  value,
  sub,
  accent,
  valueTone,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  /** Tint the headline figure with the brand gold (e.g. money). */
  valueTone?: 'gold';
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-mist/60 bg-paper p-4 transition-[transform,box-shadow,border-color] duration-base ease-out hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0 active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-brand text-steel">{label}</span>
        <Icon className="h-4 w-4 text-mist" />
      </div>
      <p
        className={`mt-2 font-display text-2xl font-semibold tracking-tight ${
          valueTone === 'gold' ? 'text-gold-deep' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className={`mt-0.5 text-xs ${accent ? 'font-medium text-signal' : 'text-steel'}`}>
        {sub}
      </p>
    </Link>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  sub,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-mist/60 bg-surface/50 p-3.5 hover:border-steel"
    >
      <Icon className="h-5 w-5 text-graphite" />
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-steel">{sub}</p>
      </div>
    </Link>
  );
}
