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
  FixtureDefaultProduct,
  FixtureKind,
  FixtureUsage,
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

/** Add a fixture to the library; refreshes the grid on success. */
export function useCreateFixture(): UseMutationResult<
  Fixture,
  unknown,
  { name: string; kind?: FixtureKind }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => studio.fixtures.create(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqk.fixtures }),
  });
}

/** Where a fixture is used (stores + guides) — drives the delete dialog. */
export function useFixtureUsage(
  id: string | undefined,
): UseQueryResult<FixtureUsage> {
  return useQuery({
    queryKey: sqk.fixtureUsage(id ?? 'none'),
    queryFn: () => studio.fixtures.usage(id!),
    enabled: Boolean(id),
  });
}

/** Soft-delete (archive): hides the fixture, keeps its placements. */
export function useArchiveFixture(): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => studio.fixtures.archive(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqk.fixtures }),
  });
}

/** Hard-delete: removes the fixture everywhere (placements, guide entries). */
export function useDeleteFixture(): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => studio.fixtures.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqk.fixtures }),
  });
}

/** A fixture's default product set (its reusable starter list). */
export function useFixtureProducts(
  fixtureId: string | undefined,
): UseQueryResult<FixtureDefaultProduct[]> {
  return useQuery({
    queryKey: sqk.fixtureProducts(fixtureId ?? 'none'),
    queryFn: () => studio.fixtures.products.list(fixtureId!),
    enabled: Boolean(fixtureId),
  });
}

/** Add / remove a product in a fixture's default set; refreshes the set. */
export function useAddFixtureProduct(
  fixtureId: string,
): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId) => studio.fixtures.products.add(fixtureId, productId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.fixtureProducts(fixtureId) }),
  });
}

export function useRemoveFixtureProduct(
  fixtureId: string,
): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fixtureProductId) =>
      studio.fixtures.products.remove(fixtureId, fixtureProductId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.fixtureProducts(fixtureId) }),
  });
}

/** Pre-populate a guide-fixture's sheet from the fixture's default products. */
export function usePrepopulate(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<GuideFixtureDetail, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => studio.guideFixtures.prepopulate(campaignId!, fixtureId!),
    onSuccess: (detail) => {
      if (campaignId && fixtureId) {
        qc.setQueryData(sqk.guideFixture(campaignId, fixtureId), detail);
      }
    },
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

/** Add / remove a product on a fixture's planogram; refreshes the sheet. */
export function useAddMerchandise(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<
  void,
  unknown,
  { guideFixtureId: string; productId: string; row?: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ guideFixtureId, productId, row }) =>
      studio.guideFixtures.addMerchandise(guideFixtureId, productId, row),
    onSuccess: () => {
      if (campaignId && fixtureId) {
        void qc.invalidateQueries({
          queryKey: sqk.guideFixture(campaignId, fixtureId),
        });
      }
    },
  });
}

export function useRemoveMerchandise(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<
  void,
  unknown,
  { guideFixtureId: string; merchandiseId: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ guideFixtureId, merchandiseId }) =>
      studio.guideFixtures.removeMerchandise(guideFixtureId, merchandiseId),
    onSuccess: () => {
      if (campaignId && fixtureId) {
        void qc.invalidateQueries({
          queryKey: sqk.guideFixture(campaignId, fixtureId),
        });
      }
    },
  });
}

/**
 * Persist a full drag-and-drop planogram layout. Optimistically regroups the
 * cached sheet, then reconciles to the server's canonical detail on success
 * (mirrors usePrepopulate's self-healing-cache pattern).
 */
export function useReorderPlanogram(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<
  GuideFixtureDetail,
  unknown,
  { guideFixtureId: string; body: { shelves: { row: string; merchandiseIds: string[] }[] } },
  { previous?: GuideFixtureDetail }
> {
  const qc = useQueryClient();
  const key =
    campaignId && fixtureId
      ? sqk.guideFixture(campaignId, fixtureId)
      : (['studio', 'guide-fixture', 'none'] as const);
  return useMutation({
    mutationFn: ({ guideFixtureId, body }) =>
      studio.guideFixtures.reorderPlanogram(guideFixtureId, body),
    onMutate: async ({ body }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<GuideFixtureDetail>(key);
      if (previous) {
        const byId = new Map(
          previous.merchandise.flatMap((r) =>
            r.products.map((p) => [p.merchandiseId, p] as const),
          ),
        );
        const merchandise = body.shelves
          .map((s) => ({
            row: s.row,
            products: s.merchandiseIds
              .map((id) => byId.get(id))
              .filter(Boolean) as GuideFixtureDetail['merchandise'][number]['products'],
          }))
          .filter((r) => r.products.length > 0);
        qc.setQueryData<GuideFixtureDetail>(key, { ...previous, merchandise });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (detail) => {
      qc.setQueryData(key, detail);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}
