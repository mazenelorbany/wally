import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins, Info, Receipt, X } from 'lucide-react';
import { Spinner } from '@wally/ui';
import type { MoneyFixture, MoneyMap } from '@wally/types';

import { api } from '../../lib/api';
import { studio } from '../lib/sdk';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

const PLAN_W = 1000;
const PLAN_H = 640;

/** $131,800 -> "$131.8k". */
function money(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `$${n}`;
}

/**
 * Money Map — the store floor plan recoloured by per-fixture revenue. The ramp
 * is a single GREEN hue varied by lightness (light sage → deep emerald — the
 * "money / in-the-green" convention, kept distinct from the brand red), and
 * every fixture carries its dollar value — so it stays legible for the
 * colour-blind GRB CEO (lightness reads in greyscale; colour is never the only
 * signal). Sales are illustrative until a POS feed lands.
 */
export function MoneyMapView() {
  // The selected project's guide scopes the venues + money map.
  const { campaignId } = useProject();

  const storesQ = useQuery({
    queryKey: ['studio', 'queue-stores', campaignId],
    queryFn: () => api.campaigns.queue(campaignId!),
    enabled: Boolean(campaignId),
  });
  const stores = storesQ.data ?? [];

  const [storeId, setStoreId] = React.useState<string | undefined>();
  const activeStoreId = storeId ?? stores[0]?.storeId;

  useSetStudioTopBar({
    guideName: 'Money map',
    stores: stores.map((s) => ({
      storeId: s.storeId,
      storeName: s.storeName,
    })),
    storeId: activeStoreId,
    onStoreChange: setStoreId,
  });

  const mapQ = useQuery({
    queryKey: ['studio', 'money-map', campaignId, activeStoreId],
    queryFn: () => studio.moneyMap.get(campaignId!, activeStoreId!),
    enabled: Boolean(campaignId && activeStoreId),
  });
  const map = mapQ.data;

  const [selected, setSelected] = React.useState<string | null>(null);
  const selectedFx = map?.fixtures.find((f) => f.id === selected) ?? null;

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-brand text-steel">
                Money map
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
                {map?.storeName ?? 'Where the sales sit'}
              </h1>
            </div>
            {map && !map.illustrative ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-pass/40 bg-pass/5 px-2.5 py-1 text-[11px] font-medium text-pass">
                <Receipt className="h-3.5 w-3.5" /> Logged sales
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-mist/70 bg-surface px-2.5 py-1 text-[11px] font-medium text-steel">
                <Info className="h-3.5 w-3.5" /> Illustrative sales
              </span>
            )}
          </header>

          {/* Totals */}
          {map ? (
            <div className="mb-5 grid grid-cols-3 gap-3">
              <Stat label="Total revenue" value={money(map.totalRevenue)} />
              <Stat label="Units sold" value={map.totalUnits.toLocaleString()} />
              <Stat
                label="Fixtures"
                value={String(map.fixtures.length)}
              />
            </div>
          ) : null}

          {mapQ.isLoading || storesQ.isLoading ? (
            <div className="grid h-64 place-items-center">
              <Spinner className="text-2xl text-steel" />
            </div>
          ) : !map ? (
            <p className="text-sm text-steel">No floor plan for this store yet.</p>
          ) : (
            <MoneyCanvas
              map={map}
              selectedId={selected}
              onSelect={setSelected}
            />
          )}

          <Legend />
        </div>
      </div>

      {/* Drill panel */}
      <aside className="hidden w-[340px] shrink-0 border-l border-mist/70 bg-paper lg:block">
        {selectedFx && map ? (
          <FixtureDrill
            fx={selectedFx}
            total={map.totalRevenue}
            illustrative={map.illustrative}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <Coins className="mx-auto h-6 w-6 text-mist" />
              <p className="mt-2 text-sm font-medium text-ink">
                Select a fixture
              </p>
              <p className="mt-1 text-xs leading-relaxed text-steel">
                Click any tile to see its revenue, units, and share of the store.
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-mist/70 bg-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-brand text-steel">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
        {value}
      </p>
    </div>
  );
}

function MoneyCanvas({
  map,
  selectedId,
  onSelect,
}: {
  map: MoneyMap;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth > 0 ? el.clientWidth / PLAN_W : 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-mist/70 bg-paper shadow-card"
        style={{ width: `${PLAN_W * scale}px`, height: `${PLAN_H * scale}px` }}
      >
        {map.fixtures.map((f) => (
          <MoneyTile
            key={f.id}
            fx={f}
            maxRevenue={map.maxRevenue}
            scale={scale}
            selected={f.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function MoneyTile({
  fx,
  maxRevenue,
  scale,
  selected,
  onSelect,
}: {
  fx: MoneyFixture;
  maxRevenue: number;
  scale: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  // Green revenue ramp: light sage (low) → deep emerald (high). Single hue,
  // varied by LIGHTNESS only, so it stays colour-blind-safe; the $ label means
  // colour is never the only signal. "Money green," premium over the old grey.
  const t = maxRevenue > 0 ? fx.revenue / maxRevenue : 0;
  const fill = revenueRamp(t);
  const dark = t > 0.42;

  return (
    <button
      type="button"
      onClick={() => onSelect(fx.id)}
      aria-label={`${fx.label} — ${money(fx.revenue)}, ${fx.sharePct}% of store`}
      className="absolute flex flex-col items-center justify-center rounded-md border text-center transition-shadow duration-150 ease-out hover:shadow-lift"
      style={{
        left: `${fx.x * scale}px`,
        top: `${fx.y * scale}px`,
        width: `${fx.w * scale}px`,
        height: `${fx.h * scale}px`,
        transform: fx.rotation ? `rotate(${fx.rotation}deg)` : undefined,
        backgroundColor: fill,
        borderColor: selected ? '#B23A2E' : 'rgba(46,93,67,0.28)',
        borderWidth: selected ? 2 : 1,
      }}
    >
      <span
        className="px-1 text-[10px] font-semibold leading-tight"
        style={{ color: dark ? '#FCFCFD' : '#14171F' }}
      >
        {fx.label}
      </span>
      <span
        className="px-1 text-[10px] font-semibold tabular-nums"
        style={{ color: dark ? '#FCFCFD' : '#3E4654' }}
      >
        {money(fx.revenue)} · {fx.sharePct}%
      </span>
    </button>
  );
}

function FixtureDrill({
  fx,
  total,
  illustrative,
  onClose,
}: {
  fx: MoneyFixture;
  total: number;
  illustrative: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b border-mist/70 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-brand text-steel">
            Fixture
          </p>
          <h2 className="mt-0.5 font-display text-lg font-semibold tracking-tight text-ink">
            {fx.label}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-steel hover:bg-surface"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 px-5 py-5">
        <DrillStat label="Revenue" value={money(fx.revenue)} />
        <DrillStat label="Units sold" value={fx.units.toLocaleString()} />
        <DrillStat label="Share of store" value={`${fx.sharePct}%`} />
        <DrillStat
          label="Avg $ / unit"
          value={fx.units > 0 ? `$${Math.round(fx.revenue / fx.units)}` : '—'}
        />
        <div className="rounded-md bg-surface px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-brand text-steel">
            <span>Share of store</span>
            <span>{fx.sharePct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-mist/50">
            <div
              className="h-full rounded-full bg-ink"
              style={{ width: `${Math.min(100, fx.sharePct)}%` }}
            />
          </div>
        </div>
        <p className="pt-1 text-[11px] leading-relaxed text-steel">
          {illustrative
            ? 'Illustrative sample data — not a live POS feed. '
            : 'Logged by the store from per-product sales. '}
          {money(total)} total across this store.
        </p>
      </div>
    </div>
  );
}

function DrillStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-mist/40 pb-2">
      <span className="text-sm text-steel">{label}</span>
      <span className="font-display text-base font-semibold tabular-nums text-ink">
        {value}
      </span>
    </div>
  );
}

/**
 * Revenue → colour. Lerps light sage (low) → deep emerald (high) — the universal
 * "money / in-the-green" convention, kept separate from the brand red (which
 * means brand + stop). Single hue varied by LIGHTNESS only, so it's colour-blind
 * safe; every tile also carries its $ figure, so colour is never the only signal.
 */
function revenueRamp(t: number): string {
  const lo = [230, 240, 232]; // #E6F0E8 — light sage (low revenue)
  const hi = [46, 93, 67]; //    #2E5D43 — deep emerald (high revenue)
  const k = Math.max(0, Math.min(1, t));
  const c = (i: number) => Math.round(lo[i]! + (hi[i]! - lo[i]!) * k);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

function Legend() {
  return (
    <div className="mt-4 flex items-center gap-3 text-[11px] text-steel">
      <span>Lower revenue</span>
      <div className="flex h-3 w-40 overflow-hidden rounded-full border border-mist/70">
        {[0.05, 0.275, 0.5, 0.725, 0.95].map((t) => (
          <div key={t} className="flex-1" style={{ backgroundColor: revenueRamp(t) }} />
        ))}
      </div>
      <span>Higher</span>
    </div>
  );
}
