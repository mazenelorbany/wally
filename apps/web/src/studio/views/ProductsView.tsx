import * as React from 'react';
import { Package, Search, X } from 'lucide-react';
import { Badge, Button, cn, Spinner } from '@wally/ui';

import { EmptyState, ErrorState, Skeleton } from '../../components/states';
import { useProducts } from '../lib/hooks';
import { useSetStudioTopBar } from '../components/StudioContext';
import { ProductThumb } from '../components/ProductThumb';

/**
 * The merchandising catalog: a product grid with a search box and brand /
 * category filters. Search + filters drive the server query (debounced); the
 * filter option lists are seeded from an unfiltered fetch so the dropdowns don't
 * collapse as you narrow.
 */
export function ProductsView() {
  useSetStudioTopBar({ guideName: 'Product catalog', stores: [] });

  const [searchInput, setSearchInput] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [category, setCategory] = React.useState('');

  // Debounce the free-text search so we don't fire a request per keystroke.
  const search = useDebounced(searchInput, 250);

  const productsQ = useProducts({
    search: search || undefined,
    brand: brand || undefined,
    category: category || undefined,
  });
  const products = productsQ.data ?? [];

  // A wide, unfiltered fetch purely to populate the filter dropdowns once.
  const allQ = useProducts({});
  const { brands, categories } = React.useMemo(
    () => deriveFacets(allQ.data ?? []),
    [allQ.data],
  );

  const hasFilters = Boolean(searchInput || brand || category);
  const clearAll = () => {
    setSearchInput('');
    setBrand('');
    setCategory('');
  };

  return (
    <div className="px-6 py-6">
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-brand text-steel">Catalog</p>
        <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
          Products
        </h1>
        <p className="mt-1 text-sm text-steel">
          The merchandise you place on guide fixtures.
        </p>
      </header>

      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or SKU…"
            aria-label="Search products"
            className="h-9 w-full rounded-md border border-mist bg-surface/50 pl-9 pr-3 font-sans text-sm text-ink placeholder:text-steel transition-colors hover:bg-surface focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
          />
        </div>

        <FilterSelect
          label="Brand"
          value={brand}
          options={brands}
          onChange={setBrand}
        />
        <FilterSelect
          label="Category"
          value={category}
          options={categories}
          onChange={setCategory}
        />

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        ) : null}

        <span className="ml-auto inline-flex items-center gap-2 text-xs text-steel">
          {productsQ.isFetching ? (
            <Spinner className="text-sm text-steel" />
          ) : null}
          {productsQ.data
            ? `${products.length} item${products.length === 1 ? '' : 's'}`
            : ''}
        </span>
      </div>

      {/* Grid */}
      {productsQ.isLoading ? (
        <Grid>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full rounded-lg" />
          ))}
        </Grid>
      ) : productsQ.isError ? (
        <ErrorState error={productsQ.error} onRetry={() => productsQ.refetch()} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hasFilters ? 'No matches' : 'No products yet'}
          body={
            hasFilters
              ? 'Try a broader search or clear the filters.'
              : "Your org's catalog is empty — products will appear here once added."
          }
        >
          {hasFilters ? (
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <Grid>
          {products.map((p) => (
            <article
              key={p.id}
              className="group flex flex-col overflow-hidden rounded-lg border border-mist/70 bg-paper shadow-card transition-shadow duration-base ease-out hover:shadow-lift"
            >
              <ProductThumb
                imageUrl={p.imageUrl}
                sku={p.sku}
                name={p.name}
                className="aspect-square rounded-none border-0 border-b border-mist/60"
              />
              <div className="flex min-w-0 flex-col gap-1 p-3">
                <p className="truncate font-display text-sm font-semibold text-ink">
                  {p.name}
                </p>
                <p className="truncate text-[11px] uppercase tracking-brand text-steel">
                  {p.sku}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {p.brand ? <Badge variant="muted">{p.brand}</Badge> : null}
                  {p.category ? (
                    <Badge variant="outline">{p.category}</Badge>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </Grid>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-9 rounded-md border border-mist bg-surface/50 px-3 font-sans text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
        value ? 'text-ink' : 'text-steel',
      )}
    >
      <option value="">{`All ${label.toLowerCase()}s`}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  );
}

/** Distinct, sorted brand/category values for the filter dropdowns. */
function deriveFacets(products: { brand?: string; category?: string }[]): {
  brands: string[];
  categories: string[];
} {
  const brands = new Set<string>();
  const categories = new Set<string>();
  for (const p of products) {
    if (p.brand) brands.add(p.brand);
    if (p.category) categories.add(p.category);
  }
  return {
    brands: [...brands].sort((a, b) => a.localeCompare(b)),
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
  };
}

/** Debounce a changing value by `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
