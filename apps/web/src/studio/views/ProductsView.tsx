import * as React from 'react';
import { Gift, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import {
  Badge,
  Button,
  cn,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@wally/ui';
import { activeSaleWave, autoSaleWave, isOnSale } from '@wally/types';
import type { ProductDto, SaleMode, SaleWave } from '@wally/types';

import { EmptyState, ErrorState, Skeleton } from '../../components/states';
import { errorMessage } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  useArchiveProduct,
  useCreateProduct,
  useDeleteProduct,
  useOrg,
  useProducts,
  useUnarchiveProduct,
  useUpdateProduct,
  useUpdateSaleMode,
} from '../lib/hooks';
import { useSetStudioTopBar } from '../components/StudioContext';
import { ProductThumb } from '../components/ProductThumb';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

/**
 * The merchandising catalog: a product grid with a search box and brand /
 * category filters. Search + filters drive the server query (debounced); the
 * filter option lists are seeded from an unfiltered fetch so the dropdowns don't
 * collapse as you narrow. Admins can add, edit, archive, and (when nothing
 * depends on it) delete products — the source of truth for merchandising
 * placement and the sales-log unit price.
 */
export function ProductsView() {
  useSetStudioTopBar({ guideName: 'Product catalog', stores: [] });

  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';

  const [searchInput, setSearchInput] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [saleFilter, setSaleFilter] = React.useState('');
  const [showArchived, setShowArchived] = React.useState(false);

  // The active sale wave drives which products show their promo price.
  const orgQ = useOrg();
  const saleMode: SaleMode = orgQ.data?.saleMode ?? 'AUTO';

  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProductDto | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ProductDto | null>(
    null,
  );
  // The product being marked as a gift — opens the "free with…" picker.
  const [gwpFor, setGwpFor] = React.useState<ProductDto | null>(null);

  // Debounce the free-text search so we don't fire a request per keystroke.
  const search = useDebounced(searchInput, 250);

  const productsQ = useProducts({
    search: search || undefined,
    brand: brand || undefined,
    category: category || undefined,
    includeArchived: showArchived || undefined,
  });
  const products = React.useMemo(
    () => filterBySale(productsQ.data ?? [], saleFilter, saleMode),
    [productsQ.data, saleFilter, saleMode],
  );

  // A wide, unfiltered fetch purely to populate the filter dropdowns once.
  const allQ = useProducts({ includeArchived: showArchived || undefined });
  const { brands, categories } = React.useMemo(
    () => deriveFacets(allQ.data ?? []),
    [allQ.data],
  );

  const hasFilters = Boolean(searchInput || brand || category || saleFilter);
  const clearAll = () => {
    setSearchInput('');
    setBrand('');
    setCategory('');
    setSaleFilter('');
  };

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            Catalog
          </p>
          <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
            Products
          </h1>
          <p className="mt-1 text-sm text-steel">
            The merchandise you place on guide fixtures — and the prices the
            sales log revenue against.
          </p>
        </div>
        {isAdmin ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add product
          </Button>
        ) : null}
      </header>

      <SaleModeBar mode={saleMode} loaded={Boolean(orgQ.data)} isAdmin={isAdmin} />

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
        <select
          aria-label="Sale"
          value={saleFilter}
          onChange={(e) => setSaleFilter(e.target.value)}
          className={cn(
            'h-9 rounded-md border border-mist bg-surface/50 px-3 font-sans text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
            saleFilter ? 'text-ink' : 'text-steel',
          )}
        >
          <option value="">All sale states</option>
          <option value="now">On sale now</option>
          <option value="SALE_1">Sale 1 wave</option>
          <option value="SALE_2">Sale 2 wave</option>
          <option value="none">Never on promo</option>
          <option value="gwp">Gift with purchase</option>
        </select>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        ) : null}

        {isAdmin ? (
          <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-steel">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-mist accent-graphite"
            />
            Show archived
          </label>
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
              : isAdmin
                ? "Your org's catalog is empty — add your first product to start merchandising guides and logging sales."
                : "Your org's catalog is empty — products will appear here once added."
          }
        >
          {hasFilters ? (
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          ) : isAdmin ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add product
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <Grid>
          {products.map((p) => {
            const archived = Boolean(p.archivedAt);
            const onSale = isOnSale(p, saleMode);
            return (
              <Card
                key={p.id}
                className={cn(
                  'group relative flex flex-col overflow-hidden p-0 transition-shadow duration-base ease-out hover:shadow-lift',
                  archived && 'opacity-70',
                )}
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
                    {archived ? (
                      <Badge variant="outline" className="text-steel">
                        Archived
                      </Badge>
                    ) : null}
                    {p.range ? <Badge variant="muted">{p.range}</Badge> : null}
                    {onSale ? (
                      <Badge variant="signal">On sale</Badge>
                    ) : p.saleWave ? (
                      <Badge variant="outline">{waveLabel(p.saleWave)}</Badge>
                    ) : null}
                    {p.gwp ? (
                      <Badge
                        variant="default"
                        title={
                          p.gwpWith ? `Free with ${p.gwpWith.name}` : undefined
                        }
                      >
                        <Gift className="h-3 w-3" aria-hidden="true" />
                        GWP
                      </Badge>
                    ) : null}
                  </div>
                  {onSale && p.salePrice != null ? (
                    <p className="mt-0.5 text-xs text-graphite">
                      <span className="font-semibold text-signal">
                        {formatPrice(p.salePrice)}
                      </span>
                      {p.rrp != null ? (
                        <span className="ml-1.5 text-steel line-through">
                          {formatPrice(p.rrp)}
                        </span>
                      ) : null}
                      {p.rrp != null && p.rrp > p.salePrice ? (
                        <span className="ml-1.5 text-steel">
                          −{Math.round(((p.rrp - p.salePrice) / p.rrp) * 100)}%
                        </span>
                      ) : null}
                    </p>
                  ) : p.rrp != null || p.salePrice != null ? (
                    <p className="mt-0.5 text-xs text-graphite">
                      <span className="font-medium text-ink">
                        {formatPrice((p.rrp ?? p.salePrice) as number)}
                      </span>
                    </p>
                  ) : null}
                  {p.gwp && p.gwpWith ? (
                    <p
                      className="truncate text-[11px] text-steel"
                      title={`Free with ${p.gwpWith.name} (${p.gwpWith.sku})`}
                    >
                      Free with {p.gwpWith.name}
                    </p>
                  ) : null}
                  {isAdmin && !archived ? (
                    <SaleQuickControls product={p} onPickGwp={setGwpFor} />
                  ) : null}
                </div>

                {isAdmin ? (
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      aria-label={`Edit ${p.name}`}
                      className="rounded-md bg-paper/90 p-1.5 text-steel shadow-card transition-colors hover:bg-surface hover:text-ink focus:opacity-100 focus:outline-none"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {archived ? (
                      <UnarchiveButton product={p} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(p)}
                        aria-label={`Remove ${p.name}`}
                        className="rounded-md bg-paper/90 p-1.5 text-steel shadow-card transition-colors hover:bg-surface hover:text-fail focus:opacity-100 focus:outline-none"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </Grid>
      )}

      <ProductFormDialog
        mode="create"
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />
      <ProductFormDialog
        mode="edit"
        product={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
      />
      <DeleteProductDialog
        product={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
      <GwpPickerDialog gift={gwpFor} onClose={() => setGwpFor(null)} />
    </div>
  );
}

/** The Unarchive control on an archived card — restores it to the catalog. */
function UnarchiveButton({ product }: { product: ProductDto }) {
  const toast = useToast();
  const unarchive = useUnarchiveProduct();
  return (
    <button
      type="button"
      disabled={unarchive.isPending}
      onClick={() =>
        unarchive.mutate(product.id, {
          onSuccess: () => toast.success(`“${product.name}” restored`),
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
      aria-label={`Restore ${product.name}`}
      className="rounded-md bg-paper/90 px-2 py-1.5 text-xs font-medium text-graphite shadow-card transition-colors hover:bg-surface hover:text-ink focus:opacity-100 focus:outline-none disabled:opacity-50"
    >
      {unarchive.isPending ? 'Restoring…' : 'Unarchive'}
    </button>
  );
}

/** Human label for a promo-wave value. */
function waveLabel(wave: SaleWave): string {
  return wave === 'SALE_1' ? 'Sale 1' : wave === 'SALE_2' ? 'Sale 2' : 'Sale 1 + 2';
}

const SALE_MODE_OPTIONS: { value: SaleMode; label: (auto: SaleWave) => string }[] = [
  { value: 'AUTO', label: (auto) => `Auto (${waveLabel(auto)})` },
  { value: 'SALE_1', label: () => 'Sale 1' },
  { value: 'SALE_2', label: () => 'Sale 2' },
  { value: 'ALL', label: () => 'All on sale' },
];

/**
 * The sale-schedule banner: which promo wave is selling right now, and (for
 * admins) the switch between Auto (the TCC calendar: odd months = Sale 1, even
 * = Sale 2), a pinned wave, or the whole catalog on sale.
 */
function SaleModeBar({
  mode,
  loaded,
  isAdmin,
}: {
  mode: SaleMode;
  loaded: boolean;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const updateMode = useUpdateSaleMode();
  const autoWave = autoSaleWave();
  const active = activeSaleWave(mode);
  const monthName = new Date().toLocaleString('en-US', { month: 'long' });

  const summary = !loaded
    ? 'Loading…'
    : active === 'ALL'
      ? 'Entire catalog on sale — every product shows its promo price.'
      : mode === 'AUTO'
        ? `${waveLabel(active)} pricing is live (auto — ${monthName} is a ${
            active === 'SALE_1' ? 'Sale 1' : 'Sale 2'
          } month).`
        : `${waveLabel(active)} pricing is pinned on.`;

  const pick = (value: SaleMode) => {
    if (value === mode || updateMode.isPending) return;
    updateMode.mutate(value, {
      onSuccess: (org) => {
        const now = activeSaleWave(org.saleMode);
        toast.success(
          now === 'ALL'
            ? 'Entire catalog is now on sale'
            : `${waveLabel(now)} pricing is now live`,
        );
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-mist/60 bg-surface/40 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-brand text-steel">
          Sale schedule
        </p>
        <p className="mt-0.5 text-sm font-medium text-ink">{summary}</p>
      </div>
      {isAdmin ? (
        <div
          role="group"
          aria-label="Active sale"
          className="ml-auto inline-flex rounded-md border border-mist bg-paper p-0.5"
        >
          {SALE_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={!loaded || updateMode.isPending}
              aria-pressed={mode === opt.value}
              onClick={() => pick(opt.value)}
              className={cn(
                'rounded px-2.5 py-1 font-sans text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 disabled:opacity-60',
                mode === opt.value
                  ? 'bg-ink text-paper'
                  : 'text-steel hover:bg-surface hover:text-ink',
              )}
            >
              {opt.label(autoWave)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Inline admin controls on a card: promo-wave select + gift-with-purchase
 * toggle. Turning GWP ON opens the qualifying-product picker (a gift is always
 * free WITH something); turning it OFF clears both the flag and the target.
 */
function SaleQuickControls({
  product,
  onPickGwp,
}: {
  product: ProductDto;
  onPickGwp: (gift: ProductDto) => void;
}) {
  const toast = useToast();
  const update = useUpdateProduct();

  const setWave = (raw: string) =>
    update.mutate(
      { id: product.id, body: { saleWave: (raw || null) as SaleWave | null } },
      { onError: (e) => toast.error(errorMessage(e)) },
    );
  const toggleGwp = () => {
    if (!product.gwp) {
      onPickGwp(product);
      return;
    }
    update.mutate(
      { id: product.id, body: { gwp: false, gwpWithId: null } },
      { onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <div className="mt-2 flex items-center gap-1.5 border-t border-mist/50 pt-2">
      <select
        aria-label={`Sale wave for ${product.name}`}
        value={product.saleWave ?? ''}
        disabled={update.isPending}
        onChange={(e) => setWave(e.target.value)}
        className="h-7 min-w-0 flex-1 rounded-md border border-mist bg-surface/50 px-1.5 font-sans text-[11px] text-graphite transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 disabled:opacity-60"
      >
        <option value="">No promo</option>
        <option value="SALE_1">Sale 1</option>
        <option value="SALE_2">Sale 2</option>
        <option value="BOTH">Sale 1 + 2</option>
      </select>
      <button
        type="button"
        onClick={toggleGwp}
        disabled={update.isPending}
        aria-pressed={product.gwp}
        title="Gift with purchase"
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 font-sans text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 disabled:opacity-60',
          product.gwp
            ? 'border-ink/30 bg-ink/10 text-ink'
            : 'border-mist bg-surface/50 text-steel hover:bg-surface hover:text-ink',
        )}
      >
        <Gift className="h-3 w-3" aria-hidden="true" />
        GWP
      </button>
    </div>
  );
}

/**
 * "Free with…" picker: choose the qualifying product a gift comes free with.
 * Opens when GWP is being turned on; choosing a product sets gwp + gwpWithId
 * in one mutation. Search drives the same server-side product query.
 */
function GwpPickerDialog({
  gift,
  onClose,
}: {
  gift: ProductDto | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const update = useUpdateProduct();
  const [searchInput, setSearchInput] = React.useState('');
  const search = useDebounced(searchInput, 250);

  // Reset the search whenever a new gift opens the picker.
  React.useEffect(() => {
    if (gift) setSearchInput('');
  }, [gift]);

  const productsQ = useProducts({ search: search || undefined });
  const candidates = (productsQ.data ?? []).filter(
    (p) => p.id !== gift?.id && !p.archivedAt,
  );

  const choose = (target: ProductDto) => {
    if (!gift || update.isPending) return;
    update.mutate(
      { id: gift.id, body: { gwp: true, gwpWithId: target.id } },
      {
        onSuccess: () => {
          toast.success(`“${gift.name}” is now free with “${target.name}”`);
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Dialog
      open={Boolean(gift)}
      onOpenChange={(o) => {
        if (!o && !update.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Free with which product?</DialogTitle>
          <DialogDescription>
            “{gift?.name}” becomes a gift with purchase — choose the qualifying
            product it ships free alongside.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel"
            aria-hidden="true"
          />
          <input
            autoFocus
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or SKU…"
            aria-label="Search qualifying products"
            className="h-9 w-full rounded-md border border-mist bg-surface/50 pl-9 pr-3 font-sans text-sm text-ink placeholder:text-steel transition-colors hover:bg-surface focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border border-mist/60">
          {productsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-steel">
              <Spinner className="text-sm" /> Loading catalog…
            </div>
          ) : candidates.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-steel">
              No matching products.
            </p>
          ) : (
            <ul className="divide-y divide-mist/50">
              {candidates.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={update.isPending}
                    onClick={() => choose(p)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none disabled:opacity-60"
                  >
                    <ProductThumb
                      imageUrl={p.imageUrl}
                      sku={p.sku}
                      name={p.name}
                      className="h-9 w-9 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {p.name}
                      </span>
                      <span className="block truncate text-[11px] uppercase tracking-brand text-steel">
                        {p.sku}
                      </span>
                    </span>
                    {p.rrp != null || p.salePrice != null ? (
                      <span className="shrink-0 text-xs text-graphite">
                        {formatPrice((p.rrp ?? p.salePrice) as number)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button" disabled={update.isPending}>
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Client-side sale facet over the server-filtered catalog page. */
function filterBySale(
  products: ProductDto[],
  filter: string,
  mode: SaleMode,
): ProductDto[] {
  switch (filter) {
    case 'now':
      return products.filter((p) => isOnSale(p, mode));
    case 'SALE_1':
    case 'SALE_2':
      return products.filter(
        (p) => p.saleWave === filter || p.saleWave === 'BOTH',
      );
    case 'none':
      return products.filter((p) => !p.saleWave);
    case 'gwp':
      return products.filter((p) => p.gwp);
    default:
      return products;
  }
}

/** Editable form fields shared by create + edit. */
interface ProductForm {
  sku: string;
  name: string;
  webTitle: string;
  brand: string;
  range: string;
  category: string;
  color: string;
  imageUrl: string;
  rrp: string;
  salePrice: string;
  /** '' = never on promo; otherwise a SaleWave value. */
  saleWave: string;
  gwp: boolean;
  /** Qualifying product id the gift is free with ('' = unset). */
  gwpWithId: string;
}

const EMPTY_FORM: ProductForm = {
  sku: '',
  name: '',
  webTitle: '',
  brand: '',
  range: '',
  category: '',
  color: '',
  imageUrl: '',
  rrp: '',
  salePrice: '',
  saleWave: '',
  gwp: false,
  gwpWithId: '',
};

function toForm(p: ProductDto): ProductForm {
  return {
    sku: p.sku,
    name: p.name,
    webTitle: p.webTitle ?? '',
    brand: p.brand ?? '',
    range: p.range ?? '',
    category: p.category ?? '',
    color: p.color ?? '',
    imageUrl: p.imageUrl ?? '',
    rrp: p.rrp != null ? String(p.rrp) : '',
    salePrice: p.salePrice != null ? String(p.salePrice) : '',
    saleWave: p.saleWave ?? '',
    gwp: Boolean(p.gwp),
    gwpWithId: p.gwpWith?.id ?? '',
  };
}

/**
 * Add or edit a product. On create, every blank optional field is omitted; on
 * edit, a cleared field sends `null` so the column is wiped. rrp/salePrice are
 * parsed as non-negative money — editing them only affects FUTURE sales (the
 * sales log snapshots the unit price at log time, so history is never rewritten).
 */
function ProductFormDialog({
  mode,
  product,
  open,
  onClose,
}: {
  mode: 'create' | 'edit';
  product?: ProductDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const pending = create.isPending || update.isPending;
  const [form, setForm] = React.useState<ProductForm>(EMPTY_FORM);
  const [error, setError] = React.useState<string | null>(null);

  // Catalog list for the GWP qualifying-product select (cached; shared query).
  const gwpOptionsQ = useProducts({});
  const gwpOptions = (gwpOptionsQ.data ?? []).filter(
    (p) => !p.archivedAt && p.id !== product?.id,
  );

  // Seed the form whenever the dialog opens (create → blank, edit → the row).
  React.useEffect(() => {
    if (open) {
      setForm(mode === 'edit' && product ? toForm(product) : EMPTY_FORM);
      setError(null);
      create.reset();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product, mode]);

  const set =
    (key: keyof ProductForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const close = () => {
    create.reset();
    update.reset();
    onClose();
  };

  // Parse a money field: '' → undefined; reject negatives / non-numbers.
  const parseMoney = (raw: string): number | undefined | 'invalid' => {
    const t = raw.trim();
    if (t === '') return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return 'invalid';
    return n;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const sku = form.sku.trim();
    const name = form.name.trim();
    if (!sku || !name) {
      setError('SKU and name are required.');
      return;
    }
    const rrp = parseMoney(form.rrp);
    const salePrice = parseMoney(form.salePrice);
    if (rrp === 'invalid' || salePrice === 'invalid') {
      setError('Prices must be zero or a positive number.');
      return;
    }
    if (form.gwp && !form.gwpWithId) {
      setError('Choose the product this gift is free with.');
      return;
    }
    setError(null);

    const opt = (v: string) => v.trim();
    if (mode === 'create') {
      create.mutate(
        {
          sku,
          name,
          ...(opt(form.webTitle) ? { webTitle: opt(form.webTitle) } : {}),
          ...(opt(form.brand) ? { brand: opt(form.brand) } : {}),
          ...(opt(form.range) ? { range: opt(form.range) } : {}),
          ...(opt(form.category) ? { category: opt(form.category) } : {}),
          ...(opt(form.color) ? { color: opt(form.color) } : {}),
          ...(opt(form.imageUrl) ? { imageUrl: opt(form.imageUrl) } : {}),
          ...(rrp !== undefined ? { rrp } : {}),
          ...(salePrice !== undefined ? { salePrice } : {}),
          ...(form.saleWave ? { saleWave: form.saleWave as SaleWave } : {}),
          ...(form.gwp ? { gwp: true, gwpWithId: form.gwpWithId } : {}),
        },
        {
          onSuccess: () => {
            toast.success(`“${name}” added`);
            close();
          },
          onError: (err) => setError(errorMessage(err)),
        },
      );
    } else if (product) {
      // On edit, a blank optional field clears the column (null).
      const orNull = (v: string) => (opt(v) ? opt(v) : null);
      update.mutate(
        {
          id: product.id,
          body: {
            sku,
            name,
            webTitle: orNull(form.webTitle),
            brand: orNull(form.brand),
            range: orNull(form.range),
            category: orNull(form.category),
            color: orNull(form.color),
            imageUrl: orNull(form.imageUrl),
            rrp: rrp ?? null,
            salePrice: salePrice ?? null,
            saleWave: (form.saleWave || null) as SaleWave | null,
            gwp: form.gwp,
            gwpWithId: form.gwp ? form.gwpWithId : null,
          },
        },
        {
          onSuccess: () => {
            toast.success(`“${name}” updated`);
            close();
          },
          onError: (err) => setError(errorMessage(err)),
        },
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !pending) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Add product' : 'Edit product'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'A product in your merchandising catalog. SKU + name are required.'
              : 'Editing the price affects future sales only — logged sales keep the price they were recorded at.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="mt-2 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" required>
              <input
                autoFocus
                value={form.sku}
                onChange={set('sku')}
                placeholder="1029075"
                maxLength={80}
                className={fieldCls}
              />
            </Field>
            <Field label="Brand">
              <input
                value={form.brand}
                onChange={set('brand')}
                placeholder="Cuisine::pro"
                maxLength={120}
                className={fieldCls}
              />
            </Field>
          </div>

          <Field label="Name (VM-guide label)" required>
            <input
              value={form.name}
              onChange={set('name')}
              placeholder="CP CLASSIC SER PAR KNIFE"
              maxLength={200}
              className={fieldCls}
            />
          </Field>

          <Field label="Web title (full retail title)">
            <input
              value={form.webTitle}
              onChange={set('webTitle')}
              placeholder="Cuisine::pro® CLASSIC 4in Serrated Paring Knife"
              maxLength={200}
              className={fieldCls}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Range">
              <input
                value={form.range}
                onChange={set('range')}
                placeholder="Damashiro®"
                maxLength={120}
                className={fieldCls}
              />
            </Field>
            <Field label="Category">
              <input
                value={form.category}
                onChange={set('category')}
                placeholder="Cookware"
                maxLength={120}
                className={fieldCls}
              />
            </Field>
            <Field label="Colour">
              <input
                value={form.color}
                onChange={set('color')}
                placeholder="Teal"
                maxLength={120}
                className={fieldCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="RRP (recommended retail)">
              <input
                value={form.rrp}
                onChange={set('rrp')}
                inputMode="decimal"
                placeholder="49.95"
                className={fieldCls}
              />
            </Field>
            <Field label="Sale price (sales-log unit price)">
              <input
                value={form.salePrice}
                onChange={set('salePrice')}
                inputMode="decimal"
                placeholder="39.95"
                className={fieldCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Sale wave (when the promo price applies)">
              <select
                value={form.saleWave}
                onChange={(e) =>
                  setForm((f) => ({ ...f, saleWave: e.target.value }))
                }
                className={fieldCls}
              >
                <option value="">Never on promo</option>
                <option value="SALE_1">Sale 1 (odd months)</option>
                <option value="SALE_2">Sale 2 (even months)</option>
                <option value="BOTH">Both waves</option>
              </select>
            </Field>
            <label className="inline-flex cursor-pointer select-none items-center gap-2 pb-2.5 text-sm text-graphite">
              <input
                type="checkbox"
                checked={form.gwp}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    gwp: e.target.checked,
                    // Clearing the flag also clears the qualifying product.
                    gwpWithId: e.target.checked ? f.gwpWithId : '',
                  }))
                }
                className="h-4 w-4 rounded border-mist accent-graphite"
              />
              Gift with purchase
            </label>
          </div>

          {form.gwp ? (
            <Field label="Free with (qualifying product)" required>
              <select
                value={form.gwpWithId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, gwpWithId: e.target.value }))
                }
                className={fieldCls}
              >
                <option value="">Choose a product…</option>
                {gwpOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="Image URL">
            <input
              value={form.imageUrl}
              onChange={set('imageUrl')}
              placeholder="https://…"
              maxLength={2048}
              className={fieldCls}
            />
          </Field>

          {error ? <p className="text-sm text-fail">{error}</p> : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={pending || !form.sku.trim() || !form.name.trim()}
            >
              {pending
                ? mode === 'create'
                  ? 'Adding…'
                  : 'Saving…'
                : mode === 'create'
                  ? 'Add product'
                  : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Remove a product — Archive (the reversible, recommended move that keeps
 * merchandise placements + sales history) or, when nothing depends on it, a
 * permanent hard-delete. A merchandised / sold product can't be hard-deleted
 * (the server returns 409), so we steer to Archive there.
 */
function DeleteProductDialog({
  product,
  onClose,
}: {
  product: ProductDto | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const archive = useArchiveProduct();
  const remove = useDeleteProduct();
  const busy = archive.isPending || remove.isPending;
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    archive.reset();
    remove.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  const doArchive = () => {
    if (!product) return;
    archive.mutate(product.id, {
      onSuccess: () => {
        toast.success(`“${product.name}” archived`);
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };
  const doDelete = () => {
    if (!product) return;
    remove.mutate(product.id, {
      onSuccess: () => {
        toast.success(`“${product.name}” deleted`);
        onClose();
      },
      // A merchandised / sold product 409s — keep the dialog open and explain.
      onError: (e) => setError(errorMessage(e)),
    });
  };

  return (
    <Dialog
      open={Boolean(product)}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove “{product?.name}”?</DialogTitle>
          <DialogDescription>
            Archiving removes it from the working catalog and the product picker
            but keeps every merchandise placement and sales record intact — the
            recommended, reversible option.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border border-mist/60 bg-surface/30 px-3 py-2 text-xs text-steel">
          Permanent delete is only possible for a product that isn't placed on
          any guide/fixture and has no logged sales. Otherwise, archive it.
        </p>

        {error ? <p className="text-sm text-fail">{error}</p> : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={doDelete}
            className="text-steel hover:text-fail"
          >
            {remove.isPending ? 'Deleting…' : 'Delete permanently'}
          </Button>
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={doArchive} disabled={busy}>
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-graphite">
        {label}
        {required ? <span className="ml-0.5 text-fail">*</span> : null}
      </span>
      {children}
    </label>
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

/** US$ price formatting — catalog prices are cuisinepro.com USD MSRP/MAP. */
function formatPrice(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
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
