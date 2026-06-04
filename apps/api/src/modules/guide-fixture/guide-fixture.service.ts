import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ExampleImage,
  GuideFixture,
  Merchandise,
  Product,
} from '@prisma/client';
import type {
  FixtureKind,
  GuideFixtureDetail,
  GuideFixtureExampleImage,
  MerchandiseRow,
} from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { toProductDto } from '../product/product.service';

// =============================================================================
// GuideFixtureService — a fixture's instruction sheet within a guide.
// =============================================================================
//
// The right rail of the CREATE GUIDE screen: VM notes, "what good looks like"
// reference images, and the merchandise planogram (products grouped into rows).
//
// The detail endpoint is render-on-read: if no GuideFixture exists yet for
// (campaign, fixture) we create an empty one so the screen always has something
// to bind to (the VM team fills it in from there). Everything is org-scoped —
// a fixture/campaign from another tenant 404s rather than leaking.
//
// SECURITY: example images are returned as signed, time-limited URLs
// (StorageService.signedGetUrl), never as raw storage keys.
// =============================================================================

// Rows with no explicit label group under this heading, kept last in row order.
const UNROWED_LABEL = 'Unsorted';

// The relations the detail sheet eagerly loads, in display order. Declared via
// Prisma.validator so the payload type below is inferred from the same source.
const GUIDE_FIXTURE_INCLUDE = Prisma.validator<Prisma.GuideFixtureInclude>()({
  exampleImages: { orderBy: [{ bestInClass: 'desc' }, { createdAt: 'asc' }] },
  merchandise: {
    include: { product: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  },
});

type GuideFixtureWithRelations = Prisma.GuideFixtureGetPayload<{
  include: typeof GUIDE_FIXTURE_INCLUDE;
}>;

@Injectable()
export class GuideFixtureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ----- detail ------------------------------------------------------------

  /**
   * The instruction sheet for (campaign, fixture) in the caller's org. Creates
   * an empty GuideFixture on first read so the screen always renders. Includes
   * the Fixture (name/kind), example images (→ signed URLs), and merchandise
   * grouped into rows in stable order.
   */
  async detail(
    orgId: string,
    campaignId: string,
    fixtureId: string,
  ): Promise<GuideFixtureDetail> {
    // Authorise the campaign + fixture against the org before touching the join
    // — never auto-create a GuideFixture for a tenant that doesn't own both.
    const [campaign, fixture] = await Promise.all([
      this.prisma.campaign.findFirst({
        where: { id: campaignId, orgId },
        select: { id: true },
      }),
      this.prisma.fixture.findFirst({
        where: { id: fixtureId, orgId },
        select: { id: true, name: true, kind: true },
      }),
    ]);
    if (!campaign) throw new NotFoundException('campaign not found');
    if (!fixture) throw new NotFoundException('fixture not found');

    const guideFixture = await this.ensureGuideFixture(orgId, campaignId, fixtureId);

    return {
      fixtureId: fixture.id,
      fixtureName: fixture.name,
      kind: fixture.kind as FixtureKind,
      notes: guideFixture.notes,
      exampleImages: guideFixture.exampleImages.map((img) =>
        this.toExampleImage(img),
      ),
      merchandise: groupMerchandise(guideFixture.merchandise),
    };
  }

  /**
   * Find — or render-on-read create — the GuideFixture for (campaign, fixture),
   * with its example images and merchandise (incl. product) eagerly loaded in
   * display order.
   */
  private async ensureGuideFixture(
    orgId: string,
    campaignId: string,
    fixtureId: string,
  ): Promise<GuideFixtureWithRelations> {
    const existing = await this.prisma.guideFixture.findUnique({
      where: { campaignId_fixtureId: { campaignId, fixtureId } },
      include: GUIDE_FIXTURE_INCLUDE,
    });
    if (existing) return existing;

    // First open of this sheet: create an empty one. upsert (not create) so a
    // concurrent first-open can't 409 on the unique (campaignId,fixtureId).
    return this.prisma.guideFixture.upsert({
      where: { campaignId_fixtureId: { campaignId, fixtureId } },
      create: { orgId, campaignId, fixtureId },
      update: {},
      include: GUIDE_FIXTURE_INCLUDE,
    });
  }

  // ----- notes -------------------------------------------------------------

  /** Save the VM notes on a guide-fixture (org-scoped). */
  async saveNotes(orgId: string, id: string, notes: string): Promise<GuideFixture> {
    await this.getOwned(orgId, id);
    return this.prisma.guideFixture.update({
      where: { id },
      data: { notes },
    });
  }

  // ----- merchandise (optional) --------------------------------------------

  /**
   * Place a product on the sheet. Both the guide-fixture and the product must
   * belong to the caller's org (cross-tenant either way 404s).
   */
  async addMerchandise(
    orgId: string,
    guideFixtureId: string,
    productId: string,
    row?: string,
  ): Promise<Merchandise> {
    await this.getOwned(orgId, guideFixtureId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, orgId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('product not found');

    // Append to the end of the sheet.
    const last = await this.prisma.merchandise.findFirst({
      where: { guideFixtureId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    return this.prisma.merchandise.create({
      data: {
        orgId,
        guideFixtureId,
        productId,
        row: row ?? null,
        order,
      },
    });
  }

  /** Remove a product from the sheet (org-scoped via the parent guide-fixture). */
  async removeMerchandise(
    orgId: string,
    guideFixtureId: string,
    merchandiseId: string,
  ): Promise<{ ok: true }> {
    await this.getOwned(orgId, guideFixtureId);
    const { count } = await this.prisma.merchandise.deleteMany({
      where: { id: merchandiseId, guideFixtureId, orgId },
    });
    if (count === 0) throw new NotFoundException('merchandise not found');
    return { ok: true };
  }

  // ----- helpers -----------------------------------------------------------

  /** Load a guide-fixture scoped to the org (404 if it belongs elsewhere). */
  private async getOwned(orgId: string, id: string): Promise<GuideFixture> {
    const gf = await this.prisma.guideFixture.findFirst({
      where: { id, orgId },
    });
    if (!gf) throw new NotFoundException('guide fixture not found');
    return gf;
  }

  /** Map an ExampleImage row to the contract shape with a signed URL. */
  private toExampleImage(img: ExampleImage): GuideFixtureExampleImage {
    return {
      id: img.id,
      url: this.storage.signedGetUrl(img.storageKey),
      ...(img.caption != null ? { caption: img.caption } : {}),
      bestInClass: img.bestInClass,
    };
  }
}

/**
 * Group merchandise into MerchandiseRow[] by the `row` label, preserving the
 * order in which each row first appears (merchandise comes in pre-sorted by
 * `order`). Unlabelled rows collapse under a single "Unsorted" heading, kept
 * last so the named rows read first.
 */
function groupMerchandise(
  items: (Merchandise & { product: Product })[],
): MerchandiseRow[] {
  const rows = new Map<string, MerchandiseRow>();

  for (const item of items) {
    const label = item.row?.trim() || UNROWED_LABEL;
    let bucket = rows.get(label);
    if (!bucket) {
      bucket = { row: label, products: [] };
      rows.set(label, bucket);
    }
    bucket.products.push(toProductDto(item.product));
  }

  // Float the catch-all "Unsorted" row to the bottom; keep first-seen order for
  // the rest (insertion order on a Map is stable).
  return [...rows.values()].sort((a, b) => {
    if (a.row === UNROWED_LABEL) return 1;
    if (b.row === UNROWED_LABEL) return -1;
    return 0;
  });
}
