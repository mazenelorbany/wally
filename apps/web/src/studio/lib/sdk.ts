// =============================================================================
// Studio SDK accessor.
//
// The CREATE GUIDE web surface talks to the same `@wally/sdk` client as the rest
// of the app (cookie-session auth, org-scoped). Builder C adds the guide-author
// namespaces — `fixtures`, `floorplan`, `placements`, `guideFixtures`,
// `products` — to `createClient(...)`. We describe that contract here and read it
// off the shared `api` instance, so the studio compiles and type-checks against
// the agreed shape even while the SDK build is landing in parallel. When the SDK
// types ship, this interface is structurally identical, so nothing changes.
// =============================================================================

import type {
  CreateProductBody,
  Fixture,
  FloorPlan,
  GuideFixtureDetail,
  ProductDto,
  UpdateProductBody,
} from '@wally/sdk';

import { api } from '../../lib/api';

/** Geometry patch sent when a fixture box is moved or resized on the canvas. */
export interface PlacementMove {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Catalog filters for the product browser. All optional, all server-side. */
export interface ProductFilters {
  search?: string;
  brand?: string;
  category?: string;
  color?: string;
  /** Include archived (soft-deleted) products in the result. Default: hidden. */
  includeArchived?: boolean;
}

/** The guide-author surface of the Wally API (added to createClient by builder C). */
export interface StudioApi {
  fixtures: {
    /** The fixture library, scoped to a project (its own + shared) when given. */
    list(projectId?: string): Promise<Fixture[]>;
  };
  floorplan: {
    /** A store's floor plan for one campaign: placed fixtures laid out. */
    get(campaignId: string, storeId: string): Promise<FloorPlan>;
  };
  placements: {
    /** Persist a moved/resized fixture box. */
    move(id: string, geometry: PlacementMove): Promise<void>;
  };
  guideFixtures: {
    /** One fixture's instruction sheet within a guide. */
    detail(campaignId: string, fixtureId: string): Promise<GuideFixtureDetail>;
    /** Save the VM notes for a guide-fixture. */
    saveNotes(id: string, notes: string): Promise<void>;
    /** Place a product on the sheet (by GuideFixture id). */
    addMerchandise(
      guideFixtureId: string,
      productId: string,
      row?: string,
    ): Promise<void>;
    /** Remove a placed product from the sheet. */
    removeMerchandise(
      guideFixtureId: string,
      merchandiseId: string,
    ): Promise<void>;
    /** Persist the full planogram layout (drag-and-drop). Returns the refreshed sheet. */
    reorderPlanogram(
      guideFixtureId: string,
      body: { shelves: { row: string; merchandiseIds: string[] }[] },
    ): Promise<GuideFixtureDetail>;
    /** Upload a "what good looks like" reference image (optional caption). */
    addExampleImage(
      guideFixtureId: string,
      file: Blob | File,
      caption?: string,
    ): Promise<GuideFixtureDetail>;
    /** Edit an example image's caption (empty string clears it). */
    updateExampleImageCaption(
      guideFixtureId: string,
      imageId: string,
      caption: string,
    ): Promise<GuideFixtureDetail>;
    /** Mark an example image best-in-class (unsets its siblings). */
    setExampleImageBestInClass(
      guideFixtureId: string,
      imageId: string,
    ): Promise<GuideFixtureDetail>;
    /** Remove an example image. */
    removeExampleImage(
      guideFixtureId: string,
      imageId: string,
    ): Promise<GuideFixtureDetail>;
  };
  products: {
    /** The merchandising catalog, optionally filtered. */
    list(filters?: ProductFilters): Promise<ProductDto[]>;
    /** Add a product to the catalog. ADMIN; 409 on a duplicate sku. */
    create(body: CreateProductBody): Promise<ProductDto>;
    /** Edit a product (sku editable, still unique-checked). ADMIN; 409 on collision. */
    update(id: string, body: UpdateProductBody): Promise<ProductDto>;
    /** Soft-delete: leave the working catalog, keep merchandise + sales. ADMIN. */
    archive(id: string): Promise<ProductDto>;
    /** Restore an archived product back into the working catalog. ADMIN. */
    unarchive(id: string): Promise<ProductDto>;
    /** Hard-delete. ADMIN; 409 if the product is merchandised or has sales. */
    remove(id: string): Promise<void>;
  };
}

/**
 * The shared client, widened with the studio namespaces. One client per app —
 * never construct a second. See `apps/web/src/lib/api.ts`.
 */
export const studio = api as unknown as typeof api & StudioApi;
