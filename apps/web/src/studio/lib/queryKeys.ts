// Studio-scoped react-query cache keys. Kept separate from the compliance app's
// `qk` (apps/web/src/lib/queryKeys.ts) so guide-authoring invalidations never
// collide with reviewer-queue ones.

export const sqk = {
  fixtures: ['studio', 'fixtures'] as const,
  floorplan: (campaignId: string, storeId: string) =>
    ['studio', 'floorplan', campaignId, storeId] as const,
  guideFixture: (campaignId: string, fixtureId: string) =>
    ['studio', 'guide-fixture', campaignId, fixtureId] as const,
  products: (filters: {
    search?: string;
    brand?: string;
    category?: string;
    color?: string;
  }) =>
    [
      'studio',
      'products',
      filters.search ?? '',
      filters.brand ?? '',
      filters.category ?? '',
      filters.color ?? '',
    ] as const,
};
