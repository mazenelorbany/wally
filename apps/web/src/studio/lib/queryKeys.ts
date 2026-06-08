// Studio-scoped react-query cache keys. Kept separate from the compliance app's
// `qk` (apps/web/src/lib/queryKeys.ts) so guide-authoring invalidations never
// collide with reviewer-queue ones.

export const sqk = {
  /** Prefix for every fixture-library query — invalidate to refresh all scopes. */
  fixtures: ['studio', 'fixtures'] as const,
  /** The library scoped to a project (its own + shared); 'all' = org-wide. */
  fixturesList: (projectId?: string) =>
    ['studio', 'fixtures', projectId ?? 'all'] as const,
  fixtureUsage: (id: string) => ['studio', 'fixture-usage', id] as const,
  fixtureProducts: (id: string) =>
    ['studio', 'fixture-products', id] as const,
  floorplan: (campaignId: string, storeId: string) =>
    ['studio', 'floorplan', campaignId, storeId] as const,
  guideFixture: (campaignId: string, fixtureId: string) =>
    ['studio', 'guide-fixture', campaignId, fixtureId] as const,
  products: (filters: {
    search?: string;
    brand?: string;
    category?: string;
    color?: string;
    includeArchived?: boolean;
  }) =>
    [
      'studio',
      'products',
      filters.search ?? '',
      filters.brand ?? '',
      filters.category ?? '',
      filters.color ?? '',
      filters.includeArchived ? 'incl-archived' : '',
    ] as const,
  /** Prefix for every products query — invalidate to refresh all catalog views. */
  productsAll: ['studio', 'products'] as const,
};
