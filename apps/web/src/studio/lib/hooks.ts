// =============================================================================
// react-query data hooks for the CREATE GUIDE studio.
//
// View components consume these, never the SDK directly — so caching,
// invalidation, optimistic moves, and loading states stay uniform across the
// studio (mirrors apps/web/src/lib/hooks.ts for the compliance app).
// =============================================================================

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  Fixture,
  FloorPlan,
  GuideFixtureDetail,
  PlacedFixture,
  ProductDto,
} from '@wally/types';

import { sqk } from './queryKeys';
import { studio, type PlacementMove, type ProductFilters } from './sdk';

/** The org's reusable fixture library. */
export function useFixtures(): UseQueryResult<Fixture[]> {
  return useQuery({
    queryKey: sqk.fixtures,
    queryFn: () => studio.fixtures.list(),
  });
}

/** A store's floor plan for one campaign. Disabled until both ids are known. */
export function useFloorPlan(
  campaignId: string | undefined,
  storeId: string | undefined,
): UseQueryResult<FloorPlan> {
  return useQuery({
    queryKey:
      campaignId && storeId
        ? sqk.floorplan(campaignId, storeId)
        : ['studio', 'floorplan', 'none'],
    queryFn: () => studio.floorplan.get(campaignId as string, storeId as string),
    enabled: Boolean(campaignId && storeId),
  });
}

/** One fixture's instruction sheet. Disabled until a fixture is selected. */
export function useGuideFixture(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseQueryResult<GuideFixtureDetail> {
  return useQuery({
    queryKey:
      campaignId && fixtureId
        ? sqk.guideFixture(campaignId, fixtureId)
        : ['studio', 'guide-fixture', 'none'],
    queryFn: () =>
      studio.guideFixtures.detail(campaignId as string, fixtureId as string),
    enabled: Boolean(campaignId && fixtureId),
  });
}

/** The merchandising catalog, optionally filtered (server-side). */
export function useProducts(
  filters: ProductFilters,
): UseQueryResult<ProductDto[]> {
  return useQuery({
    queryKey: sqk.products(filters),
    queryFn: () => studio.products.list(filters),
    // Filters change as the user types; keep the previous page on screen so the
    // grid doesn't flash empty between keystrokes.
    placeholderData: (prev) => prev,
  });
}

/**
 * Move/resize a placed fixture. Optimistically patches the cached floor plan so
 * the box stays exactly where the user dropped it, then reconciles on settle.
 */
export function usePlacementMove(
  campaignId: string | undefined,
  storeId: string | undefined,
): UseMutationResult<
  void,
  unknown,
  { id: string; geometry: PlacementMove },
  { previous?: FloorPlan }
> {
  const qc = useQueryClient();
  const key =
    campaignId && storeId
      ? sqk.floorplan(campaignId, storeId)
      : (['studio', 'floorplan', 'none'] as const);

  return useMutation({
    mutationFn: ({ id, geometry }) => studio.placements.move(id, geometry),
    onMutate: async ({ id, geometry }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<FloorPlan>(key);
      if (previous) {
        qc.setQueryData<FloorPlan>(key, {
          ...previous,
          placements: previous.placements.map((p: PlacedFixture) =>
            p.id === id ? { ...p, ...geometry } : p,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Save VM notes for a guide-fixture (fired on textarea blur). Invalidates the
 * fixture detail so any other open view re-reads the saved text.
 */
export function useSaveNotes(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<void, unknown, { id: string; notes: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }) => studio.guideFixtures.saveNotes(id, notes),
    onSuccess: () => {
      if (campaignId && fixtureId) {
        void qc.invalidateQueries({
          queryKey: sqk.guideFixture(campaignId, fixtureId),
        });
      }
    },
  });
}
