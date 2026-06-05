import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  Minus,
  Plus,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import { Spinner } from '@wally/ui';
import type { SalesFixtureGroup, SalesLine } from '@wally/sdk';

import { api } from '../../lib/api';
import { ErrorState } from '../../components/states';
import { useManagerStore } from '../ManagerStoreContext';

const money = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const priceLabel = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SalesLogView() {
  const { storeId } = useManagerStore();
  const qc = useQueryClient();

  const salesQ = useQuery({
    queryKey: ['manager', 'sales', storeId],
    queryFn: () => api.manager.salesLog(storeId),
  });

  const [draft, setDraft] = React.useState<Record<string, number>>({});
  const [saving, setSaving] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Seed the draft + open any fixture that already has logged units.
  React.useEffect(() => {
    if (!salesQ.data) return;
    const next: Record<string, number> = {};
    const openIds = new Set<string>();
    for (const g of salesQ.data.groups) {
      let any = false;
      for (const l of g.lines) {
        next[l.productId] = l.units;
        if (l.units > 0) any = true;
      }
      if (any) openIds.add(g.fixtureId);
    }
    setDraft(next);
    setOpen(openIds);
  }, [salesQ.data]);

  const save = useMutation({
    mutationFn: ({ productId, units }: { productId: string; units: number }) =>
      api.manager.logSale(productId, units, storeId),
  });

  const setUnits = (line: SalesLine, units: number) => {
    const u = Math.max(0, units);
    setDraft((d) => ({ ...d, [line.productId]: u }));
    setSaving(true);
    clearTimeout(timers.current[line.productId]);
    timers.current[line.productId] = setTimeout(() => {
      save.mutate(
        { productId: line.productId, units: u },
        {
          onSettled: () => {
            setSaving(false);
            void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
          },
        },
      );
    }, 500);
  };

  React.useEffect(
    () => () => Object.values(timers.current).forEach(clearTimeout),
    [],
  );

  if (salesQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  if (salesQ.isError) {
    return (
      <div className="px-4 py-6">
        <ErrorState
          error={salesQ.error}
          onRetry={() => void salesQ.refetch()}
          title="Couldn't load the sales log"
        />
      </div>
    );
  }
  const data = salesQ.data;
  if (!data || data.groups.length === 0) {
    return (
      <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-10 text-center">
        <Receipt className="mx-auto h-7 w-7 text-mist" />
        <p className="mt-2 text-sm font-medium text-ink">Nothing to log yet</p>
        <p className="mt-1 text-xs text-steel">
          No products are merchandised on this store's fixtures.
        </p>
      </div>
    );
  }

  // Live totals from the draft.
  let totalUnits = 0;
  let totalRevenue = 0;
  for (const g of data.groups)
    for (const l of g.lines) {
      const u = draft[l.productId] ?? l.units;
      totalUnits += u;
      totalRevenue += u * l.unitPrice;
    }

  // Search across every product, regardless of fixture.
  const term = query.trim().toLowerCase();
  const matches: { line: SalesLine; fixture: string }[] = [];
  if (term) {
    for (const g of data.groups)
      for (const l of g.lines) {
        const hay = `${l.webTitle ?? ''} ${l.name} ${l.sku} ${l.range ?? ''}`.toLowerCase();
        if (hay.includes(term)) matches.push({ line: l, fixture: g.label });
      }
  }

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Log sales
          </h1>
          <p className="mt-0.5 text-sm text-steel">
            Search a product or open a fixture, then tap units sold.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-steel">
          {saving ? (
            <>
              <Spinner className="text-sm" /> Saving
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-pass" /> Saved
            </>
          )}
        </span>
      </header>

      {/* Sticky search + running total */}
      <div className="sticky top-0 z-10 -mx-4 space-y-2.5 border-b border-mist/60 bg-paper/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products to log… (e.g. French Oven, iD3, SKU)"
            className="field pl-9 pr-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-steel hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-brand text-steel">
            Period total
          </span>
          <span className="font-display text-lg font-semibold tabular-nums text-ink">
            {money(totalRevenue)}
            <span className="ml-2 text-sm font-normal text-steel">
              {totalUnits.toLocaleString()} units
            </span>
          </span>
        </div>
      </div>

      {term ? (
        /* Search results — flat list across all fixtures */
        <div>
          <p className="mb-2 text-xs text-steel">
            {matches.length} match{matches.length === 1 ? '' : 'es'}
          </p>
          <div className="divide-y divide-mist/40 overflow-hidden rounded-xl border border-mist/60 bg-paper">
            {matches.map(({ line, fixture }) => (
              <SaleLine
                key={line.productId}
                line={line}
                units={draft[line.productId] ?? line.units}
                fixture={fixture}
                onSet={(u) => setUnits(line, u)}
              />
            ))}
            {matches.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-steel">
                No products match “{query}”.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        /* Collapsible fixture groups */
        <div className="space-y-2.5">
          {data.groups.map((g) => (
            <FixtureGroup
              key={g.fixtureId}
              group={g}
              draft={draft}
              open={open.has(g.fixtureId)}
              onToggle={() => toggle(g.fixtureId)}
              onSet={setUnits}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FixtureGroup({
  group,
  draft,
  open,
  onToggle,
  onSet,
}: {
  group: SalesFixtureGroup;
  draft: Record<string, number>;
  open: boolean;
  onToggle: () => void;
  onSet: (line: SalesLine, units: number) => void;
}) {
  const units = group.lines.reduce((a, l) => a + (draft[l.productId] ?? l.units), 0);
  const revenue = group.lines.reduce(
    (a, l) => a + (draft[l.productId] ?? l.units) * l.unitPrice,
    0,
  );

  return (
    <section className="overflow-hidden rounded-xl border border-mist/60 bg-paper">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface/40"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-steel transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {group.label}
            {group.department ? (
              <span className="ml-2 text-[11px] font-normal uppercase tracking-brand text-steel">
                {group.department === 'The Custom Chef' ? 'Custom Chef' : 'Cook Shop'}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-steel">{group.lines.length} products</p>
        </div>
        <span className="shrink-0 text-right text-xs tabular-nums text-steel">
          {money(revenue)}
          <span className="ml-1.5">· {units}u</span>
        </span>
      </button>
      {open ? (
        <div className="divide-y divide-mist/40 border-t border-mist/40">
          {group.lines.map((l) => (
            <SaleLine
              key={l.productId}
              line={l}
              units={draft[l.productId] ?? l.units}
              onSet={(u) => onSet(l, u)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SaleLine({
  line,
  units,
  fixture,
  onSet,
}: {
  line: SalesLine;
  units: number;
  fixture?: string;
  onSet: (units: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-mist/50 bg-surface">
        {line.imageUrl ? (
          <img src={line.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="text-[9px] font-medium text-mist">No image</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight text-ink">
          {line.webTitle ?? line.name}
        </p>
        <p className="text-xs tabular-nums text-steel">
          {priceLabel(line.unitPrice)}
          {units > 0 ? (
            <span className="ml-2 font-medium text-graphite">
              = {priceLabel(units * line.unitPrice)}
            </span>
          ) : null}
          {fixture ? <span className="ml-2 text-mist">· {fixture}</span> : null}
        </p>
      </div>
      <Stepper value={units} onChange={onSet} />
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        className="grid h-8 w-8 place-items-center rounded-md border border-mist text-graphite transition-transform active:scale-95 disabled:opacity-30"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
          onChange(Number.isNaN(n) ? 0 : n);
        }}
        className="w-10 rounded-md border border-mist bg-paper py-1 text-center text-sm font-semibold tabular-nums text-ink focus:border-steel focus:outline-none"
        aria-label="Units sold"
      />
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(value + 1)}
        className="grid h-8 w-8 place-items-center rounded-md border border-mist bg-ink text-paper transition-transform active:scale-95"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
