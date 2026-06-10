import * as React from 'react';
import { Check, ChevronDown, Search, Store as StoreIcon } from 'lucide-react';
import { cn } from '@wally/ui';

export interface StoreSwitcherStore {
  storeId: string;
  storeName: string;
}

/**
 * A searchable store picker grouped by PARENT VENUE. Store names are
 * "{Venue} — {Brand}" (e.g. "Eastgardens Myer — The Cookshop"), so we show each
 * venue once and offer its brands (The Cookshop / The Custom Chef) as toggle
 * chips inside — instead of a flat list with every venue duplicated per brand.
 * Type to filter by venue or brand. Replaces the long native <select>.
 */
export function StoreSwitcher({
  stores,
  value,
  onChange,
  disabled,
  className,
  placeholder = 'Select store',
}: {
  stores: StoreSwitcherStore[];
  value?: string;
  onChange: (storeId: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const decomposed = React.useMemo(
    () => stores.map((s) => ({ storeId: s.storeId, ...splitName(s.storeName) })),
    [stores],
  );

  const groups = React.useMemo(() => {
    const map = new Map<string, VenueGroup>();
    for (const s of decomposed) {
      const g = map.get(s.venue) ?? { venue: s.venue, brands: [] };
      g.brands.push({ storeId: s.storeId, brand: s.brand });
      map.set(s.venue, g);
    }
    return [...map.values()];
  }, [decomposed]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    const out: VenueGroup[] = [];
    for (const g of groups) {
      const venueHit = g.venue.toLowerCase().includes(q);
      const brands = venueHit
        ? g.brands
        : g.brands.filter((b) => (b.brand ?? '').toLowerCase().includes(q));
      if (venueHit || brands.length > 0) out.push({ venue: g.venue, brands });
    }
    return out;
  }, [groups, query]);

  const current = decomposed.find((s) => s.storeId === value);
  const triggerLabel = current
    ? current.brand
      ? `${current.venue} · ${brandLabel(current.brand)}`
      : current.venue
    : placeholder;

  const pick = (storeId: string) => {
    onChange(storeId);
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-mist bg-surface/60 px-3 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 disabled:opacity-60"
      >
        <StoreIcon className="h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-mist/70 bg-paper shadow-lift">
          <div className="flex items-center gap-2 border-b border-mist/60 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-steel" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stores…"
              className="w-full bg-transparent text-sm text-ink placeholder:text-steel focus:outline-none"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-steel">
                No stores match “{query}”.
              </li>
            ) : null}
            {filtered.map((g) =>
              g.brands.length === 1 ? (
                <li key={g.venue}>
                  <button
                    type="button"
                    onClick={() => pick(g.brands[0]!.storeId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                      g.brands[0]!.storeId === value
                        ? 'bg-surface font-medium text-ink'
                        : 'text-graphite hover:bg-surface/70',
                    )}
                  >
                    {g.brands[0]!.storeId === value ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-ink" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{g.venue}</span>
                    {g.brands[0]!.brand ? (
                      <span className="shrink-0 text-xs text-steel">
                        {brandLabel(g.brands[0]!.brand)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ) : (
                <li key={g.venue} className="px-2.5 py-1.5">
                  <div className="truncate text-sm font-medium text-ink">
                    {g.venue}
                  </div>
                  {/* Brand toggle — its own line under the venue, inside the row. */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {g.brands.map((b) => {
                      const active = b.storeId === value;
                      return (
                        <button
                          key={b.storeId}
                          type="button"
                          onClick={() => pick(b.storeId)}
                          aria-pressed={active}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                            active
                              ? 'bg-graphite text-paper'
                              : 'bg-surface text-graphite hover:bg-mist/40',
                          )}
                        >
                          {active ? <Check className="h-3 w-3" /> : null}
                          {brandLabel(b.brand)}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

interface VenueGroup {
  venue: string;
  brands: { storeId: string; brand: string | null }[];
}

/** Split "{Venue} — {Brand}" on the em-dash; venue-only names get a null brand. */
function splitName(name: string): { venue: string; brand: string | null } {
  const parts = name.split(/\s*—\s*/);
  if (parts.length >= 2) {
    return {
      brand: parts[parts.length - 1]!.trim(),
      venue: parts.slice(0, -1).join(' — ').trim(),
    };
  }
  return { venue: name.trim(), brand: null };
}

/** Short brand label for the chips ("The Custom Chef" → "Custom Chef"). */
function brandLabel(brand: string | null): string {
  if (!brand) return 'Store';
  return brand.replace(/^The\s+/i, '');
}
