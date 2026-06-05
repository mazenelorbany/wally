import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, Search } from 'lucide-react';
import { Spinner } from '@wally/ui';

import { api } from '../../lib/api';
import { useManagerStore } from '../ManagerStoreContext';

export function ManagerProductsView() {
  const { storeId } = useManagerStore();
  const productsQ = useQuery({
    queryKey: ['manager', 'products', storeId],
    queryFn: () => api.manager.products(storeId),
  });
  const [q, setQ] = React.useState('');

  const products = React.useMemo(() => {
    const all = productsQ.data ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.brand ?? '').toLowerCase().includes(term) ||
        (p.sku ?? '').toLowerCase().includes(term),
    );
  }, [productsQ.data, q]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Products
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          The range merchandised across your fixtures this campaign.
        </p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products, brand, SKU"
          className="field pl-9"
        />
      </div>

      {productsQ.isLoading ? (
        <div className="grid h-48 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : products.length === 0 ? (
        <p className="py-8 text-center text-sm text-steel">No products found.</p>
      ) : (
        <>
          <p className="text-xs text-steel">{products.length} products</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {products.map((p) => (
              <div
                key={p.id}
                className="overflow-hidden rounded-xl border border-mist/60 bg-paper"
              >
                <div className="grid aspect-square place-items-center bg-surface">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <ImageOff className="h-6 w-6 text-mist" />
                  )}
                </div>
                <div className="p-2.5">
                  <p className="line-clamp-2 text-xs font-medium leading-tight text-ink">
                    {p.name}
                  </p>
                  {p.brand ? (
                    <p className="mt-0.5 truncate text-[11px] text-steel">{p.brand}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
