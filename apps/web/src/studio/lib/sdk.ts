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
  Fixture,
  FloorPlan,
  GuideFixtureDetail,
  ProductDto,
} from '@wally/types';

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
}

/** The guide-author surface of the Wally API (added to createClient by builder C). */
export interface StudioApi {
  fixtures: {
    /** The org's reusable fixture library. */
    list(): Promise<Fixture[]>;
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
  };
  products: {
    /** The merchandising catalog, optionally filtered. */
    list(filters?: ProductFilters): Promise<ProductDto[]>;
  };
}

/**
 * The shared client, widened with the studio namespaces. One client per app —
 * never construct a second. See `apps/web/src/lib/api.ts`.
 */
export const studio = api as unknown as typeof api & StudioApi;
