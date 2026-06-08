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
  CreateProductBody,
  UpdateProductBody,
} from '@wally/sdk';
import type {
  Department,
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

/**
 * The reusable fixture library. Pass the current project's id to scope it to
 * that project's fixtures plus shared ones — so Myer never shows Ambiente's
 * fixtures (and vice versa). Omit it for the org-wide list.
 */
export function useFixtures(projectId?: string): UseQueryResult<Fixture[]> {
  return useQuery({
    queryKey: sqk.fixturesList(projectId),
    queryFn: () => studio.fixtures.list(projectId),
  });
}

/** Add a fixture to the library; refreshes the grid on success. */
export function useCreateFixture(): UseMutationResult<
  Fixture,
  unknown,
  {
    name: string;
    kind?: FixtureKind;
    department?: Department;
    projectId?: string | null;
  }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => studio.fixtures.create(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sqk.fixtures }),
  });
}

/** Edit a library fixture (name / kind / department / project); refreshes the grid. */
export function useUpdateFixture(): UseMutationResult<
  Fixture,
  unknown,
  {
    id: string;
    name?: string;
    kind?: FixtureKind;
    department?: Department | null;
    projectId?: string | null;
  }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => studio.fixtures.update(id, body),
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

/** Add / remove a product in a fixture's default set; refreshes the set. The
 *  optional `row` files the product onto a planogram shelf. */
export function useAddFixtureProduct(
  fixtureId: string,
): UseMutationResult<void, unknown, { productId: string; row?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, row }) =>
      studio.fixtures.products.add(fixtureId, productId, row),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.fixtureProducts(fixtureId) }),
  });
}

/** Persist the whole default-set planogram (shelves + layout) in one PATCH. */
export function useReorderFixturePlanogram(
  fixtureId: string,
): UseMutationResult<
  FixtureDefaultProduct[],
  unknown,
  { shelves: { row: string; merchandiseIds: string[] }[] }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => studio.fixtures.products.reorder(fixtureId, body),
    onSuccess: (rows) =>
      qc.setQueryData(sqk.fixtureProducts(fixtureId), rows),
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

/** Add a product to the catalog; refreshes every catalog view on success. */
export function useCreateProduct(): UseMutationResult<
  ProductDto,
  unknown,
  CreateProductBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => studio.products.create(body),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.productsAll }),
  });
}

/** Edit a product (sku editable; pricing changes only affect future sales). */
export function useUpdateProduct(): UseMutationResult<
  ProductDto,
  unknown,
  { id: string; body: UpdateProductBody }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => studio.products.update(id, body),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.productsAll }),
  });
}

/** Soft-delete: archive a product out of the working catalog (keeps history). */
export function useArchiveProduct(): UseMutationResult<
  ProductDto,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => studio.products.archive(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.productsAll }),
  });
}

/** Restore an archived product back into the working catalog. */
export function useUnarchiveProduct(): UseMutationResult<
  ProductDto,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => studio.products.unarchive(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.productsAll }),
  });
}

/** Hard-delete a product (guarded server-side: 409 if merchandised or sold). */
export function useDeleteProduct(): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => studio.products.remove(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: sqk.productsAll }),
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
 * Patch a placed fixture's editable fields — `applicable` (n/a toggle), `label`
 * (inline rename), or `order` (checklist reorder). Invalidates the floor plan so
 * the canvas + checklist re-read. Used by the layout editor's detail controls.
 */
export function usePlacementPatch(
  campaignId: string | undefined,
  storeId: string | undefined,
): UseMutationResult<
  void,
  unknown,
  { id: string; label?: string; order?: number; applicable?: boolean }
> {
  const qc = useQueryClient();
  const key =
    campaignId && storeId
      ? sqk.floorplan(campaignId, storeId)
      : (['studio', 'floorplan', 'none'] as const);
  return useMutation({
    mutationFn: ({ id, ...body }) => studio.placements.patch(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Copy another store's whole floor-plan layout onto this one. Invalidates the
 * target store's floor plan so the canvas re-reads the copied placements.
 */
export function useCopyLayout(
  campaignId: string | undefined,
  toStoreId: string | undefined,
): UseMutationResult<FloorPlan, unknown, string> {
  const qc = useQueryClient();
  const key =
    campaignId && toStoreId
      ? sqk.floorplan(campaignId, toStoreId)
      : (['studio', 'floorplan', 'none'] as const);
  return useMutation({
    mutationFn: (fromStoreId) =>
      studio.floorplan.copyLayout(campaignId!, fromStoreId, toStoreId!),
    onSuccess: (plan) => {
      qc.setQueryData(key, plan);
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Publish the guide to its stores (publish & notify). Returns the count notified. */
export function usePublishCampaign(
  campaignId: string | undefined,
): UseMutationResult<
  { publishedAt: string; notified: number },
  unknown,
  void
> {
  return useMutation({
    mutationFn: () => studio.campaigns.publish(campaignId!),
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

// ----- example images ("what good looks like") -----------------------------

/**
 * Shared cache-write for the example-image mutations: every one returns the
 * refreshed sheet, so we seed the detail cache with it and invalidate so any
 * other open view re-reads. Keeps the four mutations from repeating the wiring.
 */
function useGuideFixtureSheetMutation<TVars>(
  campaignId: string | undefined,
  fixtureId: string | undefined,
  mutationFn: (vars: TVars) => Promise<GuideFixtureDetail>,
): UseMutationResult<GuideFixtureDetail, unknown, TVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (detail) => {
      if (campaignId && fixtureId) {
        const key = sqk.guideFixture(campaignId, fixtureId);
        qc.setQueryData(key, detail);
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Upload a reference image (optional caption) to the sheet. */
export function useAddExampleImage(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<
  GuideFixtureDetail,
  unknown,
  { guideFixtureId: string; file: File; caption?: string }
> {
  return useGuideFixtureSheetMutation(campaignId, fixtureId, ({
    guideFixtureId,
    file,
    caption,
  }) => studio.guideFixtures.addExampleImage(guideFixtureId, file, caption));
}

/** Edit an example image's caption. */
export function useUpdateExampleImageCaption(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<
  GuideFixtureDetail,
  unknown,
  { guideFixtureId: string; imageId: string; caption: string }
> {
  return useGuideFixtureSheetMutation(campaignId, fixtureId, ({
    guideFixtureId,
    imageId,
    caption,
  }) =>
    studio.guideFixtures.updateExampleImageCaption(
      guideFixtureId,
      imageId,
      caption,
    ),
  );
}

/** Mark an example image best-in-class. */
export function useSetExampleImageBestInClass(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<
  GuideFixtureDetail,
  unknown,
  { guideFixtureId: string; imageId: string }
> {
  return useGuideFixtureSheetMutation(campaignId, fixtureId, ({
    guideFixtureId,
    imageId,
  }) =>
    studio.guideFixtures.setExampleImageBestInClass(guideFixtureId, imageId),
  );
}

/** Remove an example image. */
export function useRemoveExampleImage(
  campaignId: string | undefined,
  fixtureId: string | undefined,
): UseMutationResult<
  GuideFixtureDetail,
  unknown,
  { guideFixtureId: string; imageId: string }
> {
  return useGuideFixtureSheetMutation(campaignId, fixtureId, ({
    guideFixtureId,
    imageId,
  }) => studio.guideFixtures.removeExampleImage(guideFixtureId, imageId));
}
