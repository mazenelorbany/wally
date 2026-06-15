import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ExampleImage,
  GuideFixture,
  Merchandise,
  Product,
} from '@prisma/client';
import type {
  CampaignFixtureSummary,
  Department,
  FixtureKind,
  GuideChecklistItem,
  GuideFixtureDetail,
  GuideFixtureExampleImage,
  GuideInstructionStep,
  MerchandiseRow,
} from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';
import { PlanogramSyncService } from '../fixture/planogram-sync.service';
import { StorageService } from '../storage/storage.service';
import {
  assertReadableImage,
  imageExtFor,
  type UploadedImageFile,
} from '../storage/image-upload.util';
import { toProductDto } from '../product/product.service';

import { seedChecklistFromTemplates } from './checklist-seed';

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
  checklistItems: {
    where: { archivedAt: null },
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
    private readonly planogramSync: PlanogramSyncService,
  ) {}

  // ----- detail ------------------------------------------------------------

  /**
   * The instruction sheet for (campaign, fixture) in the caller's org. Creates
   * an empty GuideFixture on first read so the screen always renders. Includes
   * the Fixture (name/kind), example images (→ signed URLs), and merchandise
   * grouped into rows in stable order.
   */
  /**
   * The task's photo-request fixtures for the "Build" view: every distinct
   * fixture placed on at least one store's floor plan for this campaign, with a
   * summary of how filled-in its guide content is (reference / instructions /
   * checklist / products). Sheets that haven't been opened yet report zero
   * counts and a null guideFixtureId — the editor renders-on-open.
   */
  async listForCampaign(
    orgId: string,
    campaignId: string,
  ): Promise<CampaignFixtureSummary[]> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    // The photo requests = distinct applicable fixtures across the campaign's
    // store floor plans. Count the stores that place each one.
    const placements = await this.prisma.placement.findMany({
      where: { campaignId, orgId, applicable: true },
      select: {
        fixtureId: true,
        storeId: true,
        fixture: {
          select: {
            name: true,
            kind: true,
            department: true,
            referenceKey: true,
          },
        },
      },
    });

    type Agg = {
      fixtureId: string;
      name: string;
      kind: string;
      department: string | null;
      hasLibraryRef: boolean;
      stores: Set<string>;
    };
    const byFixture = new Map<string, Agg>();
    for (const p of placements) {
      let a = byFixture.get(p.fixtureId);
      if (!a) {
        a = {
          fixtureId: p.fixtureId,
          name: p.fixture.name,
          kind: p.fixture.kind,
          department: p.fixture.department,
          hasLibraryRef: Boolean(p.fixture.referenceKey),
          stores: new Set<string>(),
        };
        byFixture.set(p.fixtureId, a);
      }
      a.stores.add(p.storeId);
    }

    const fixtureIds = [...byFixture.keys()];
    if (fixtureIds.length === 0) return [];

    // The content sheets that already exist for these fixtures, with counts.
    const sheets = await this.prisma.guideFixture.findMany({
      where: { campaignId, fixtureId: { in: fixtureIds } },
      select: {
        id: true,
        fixtureId: true,
        instructions: true,
        _count: {
          select: { checklistItems: true, exampleImages: true, merchandise: true },
        },
      },
    });
    const sheetBy = new Map(sheets.map((s) => [s.fixtureId, s]));

    return [...byFixture.values()]
      .map((a) => {
        const sheet = sheetBy.get(a.fixtureId);
        const exampleImages = sheet?._count.exampleImages ?? 0;
        return {
          fixtureId: a.fixtureId,
          guideFixtureId: sheet?.id ?? null,
          name: a.name,
          kind: a.kind as FixtureKind,
          department: (a.department as Department | null) ?? null,
          storeCount: a.stores.size,
          hasReference: exampleImages > 0 || a.hasLibraryRef,
          instructionCount: asInstructions(sheet?.instructions).length,
          checklistCount: sheet?._count.checklistItems ?? 0,
          productCount: sheet?._count.merchandise ?? 0,
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /**
   * Add a library fixture to the campaign as a photo request: place it on every
   * active store the campaign can reach (its project's stores; a project-less
   * task reaches the whole org), appended after each store's existing
   * placements. Stores that already place it are skipped, so re-adding is safe.
   * Org-scoped.
   */
  async addFixtureToCampaign(
    orgId: string,
    campaignId: string,
    fixtureId: string,
  ): Promise<void> {
    const [campaign, fixture] = await Promise.all([
      this.prisma.campaign.findFirst({
        where: { id: campaignId, orgId },
        select: { id: true, projectId: true },
      }),
      this.prisma.fixture.findFirst({
        where: { id: fixtureId, orgId },
        select: { id: true, name: true },
      }),
    ]);
    if (!campaign) throw new NotFoundException('campaign not found');
    if (!fixture) throw new NotFoundException('fixture not found');

    const stores = await this.prisma.store.findMany({
      where: {
        orgId,
        closedAt: null,
        ...(campaign.projectId ? { projectId: campaign.projectId } : {}),
      },
      select: { id: true },
    });
    if (stores.length === 0) {
      throw new BadRequestException('no active stores to request this photo from');
    }

    // Append after each store's existing placements (one groupBy, not N max-queries).
    const maxOrders = await this.prisma.placement.groupBy({
      by: ['storeId'],
      where: { campaignId, orgId },
      _max: { order: true },
    });
    const nextOrderBy = new Map(
      maxOrders.map((m) => [m.storeId, (m._max.order ?? -1) + 1]),
    );

    await this.prisma.placement.createMany({
      data: stores.map((s) => ({
        orgId,
        storeId: s.id,
        campaignId,
        fixtureId,
        label: fixture.name,
        applicable: true,
        order: nextOrderBy.get(s.id) ?? 0,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Remove a photo request: delete the fixture's placements across all of the
   * campaign's stores. Refused once any store has photographed it — removing the
   * step would orphan submitted work mid-flight.
   */
  async removeFixtureFromCampaign(
    orgId: string,
    campaignId: string,
    fixtureId: string,
  ): Promise<void> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    const captured = await this.prisma.fixtureCapture.count({
      where: { campaignId, fixtureId, storageKey: { not: null } },
    });
    if (captured > 0) {
      throw new BadRequestException(
        'stores have already submitted photos for this fixture — reopen their reports instead of removing the step',
      );
    }

    await this.prisma.placement.deleteMany({
      where: { orgId, campaignId, fixtureId },
    });
  }

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
      guideFixtureId: guideFixture.id,
      fixtureName: fixture.name,
      kind: fixture.kind as FixtureKind,
      notes: guideFixture.notes,
      instructions: asInstructions(guideFixture.instructions),
      exampleImages: guideFixture.exampleImages.map((img) =>
        this.toExampleImage(img),
      ),
      merchandise: groupMerchandise(guideFixture.merchandise),
      checklist: guideFixture.checklistItems.map((c) => ({
        id: c.id,
        label: c.label,
        required: c.required,
      })),
    };
  }

  /**
   * Pre-populate this sheet from the fixture's default product set (the
   * "use the starter set" choice instead of starting blank). Products already
   * on the sheet are skipped, so running it twice is safe. Returns the
   * refreshed sheet. Org-scoped; a foreign campaign/fixture 404s.
   */
  async prepopulateFromDefaults(
    orgId: string,
    campaignId: string,
    fixtureId: string,
  ): Promise<GuideFixtureDetail> {
    const [campaign, fixture] = await Promise.all([
      this.prisma.campaign.findFirst({
        where: { id: campaignId, orgId },
        select: { id: true },
      }),
      this.prisma.fixture.findFirst({
        where: { id: fixtureId, orgId },
        select: { id: true },
      }),
    ]);
    if (!campaign) throw new NotFoundException('campaign not found');
    if (!fixture) throw new NotFoundException('fixture not found');

    const guideFixture = await this.ensureGuideFixture(
      orgId,
      campaignId,
      fixtureId,
    );

    const defaults = await this.prisma.fixtureProduct.findMany({
      where: { fixtureId, orgId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { productId: true, row: true },
    });

    const already = new Set(guideFixture.merchandise.map((m) => m.productId));
    let order = guideFixture.merchandise.reduce(
      (max, m) => Math.max(max, m.order),
      -1,
    );
    const toCreate = defaults
      .filter((d) => !already.has(d.productId))
      .map((d) => ({
        orgId,
        guideFixtureId: guideFixture.id,
        productId: d.productId,
        row: d.row,
        order: ++order,
      }));

    if (toCreate.length > 0) {
      await this.prisma.merchandise.createMany({ data: toCreate });
    }

    return this.detail(orgId, campaignId, fixtureId);
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
    if (existing) {
      // Sheets created before the library's default checklist was authored
      // (or via paths that skip inheritance) pick the standard up here.
      const seeded = await seedChecklistFromTemplates(
        this.prisma,
        orgId,
        campaignId,
        fixtureId,
      );
      if (seeded === 0) return existing;
      return this.prisma.guideFixture.findUniqueOrThrow({
        where: { id: existing.id },
        include: GUIDE_FIXTURE_INCLUDE,
      });
    }

    // First open of this sheet: inherit the fixture's library DEFAULTS (notes +
    // ordered instructions + checklist), so a fixture's standard is authored once
    // and flows into every task. upsert (not create) so a concurrent first-open
    // can't 409 on the unique (campaignId,fixtureId).
    const fixture = await this.prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: {
        defaultNotes: true,
        defaultInstructions: true,
      },
    });

    const created = await this.prisma.guideFixture.upsert({
      where: { campaignId_fixtureId: { campaignId, fixtureId } },
      create: {
        orgId,
        campaignId,
        fixtureId,
        notes: fixture?.defaultNotes ?? '',
        ...(fixture?.defaultInstructions != null
          ? {
              instructions:
                fixture.defaultInstructions as Prisma.InputJsonValue,
            }
          : {}),
      },
      update: {},
      include: GUIDE_FIXTURE_INCLUDE,
    });

    // Inherit the library checklist (no-op if a concurrent first-open already
    // seeded it — the helper never duplicates).
    await seedChecklistFromTemplates(this.prisma, orgId, campaignId, fixtureId);

    // A fresh sheet inherits the fixture's default planogram too, so the
    // library default set and every sheet stay mirrors from the first open.
    if (created.merchandise.length === 0) {
      await this.planogramSync.pushDefaultsToGuides(orgId, fixtureId);
    }

    return this.prisma.guideFixture.findUniqueOrThrow({
      where: { id: created.id },
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

  // ----- instructions (ordered structured steps) ---------------------------

  /** Replace the ordered instructions list (each step gets a stable id). */
  async saveInstructions(
    orgId: string,
    id: string,
    steps: { text: string }[],
  ): Promise<GuideInstructionStep[]> {
    await this.getOwned(orgId, id);
    const instructions: GuideInstructionStep[] = steps
      .map((s) => s.text.trim())
      .filter((t) => t.length > 0)
      .map((text) => ({ id: randomUUID(), text }));
    await this.prisma.guideFixture.update({
      where: { id },
      data: { instructions: instructions as unknown as Prisma.InputJsonValue },
    });
    return instructions;
  }

  // ----- checklist items (manager ticks them while filling the report) ------

  private async checklist(guideFixtureId: string): Promise<GuideChecklistItem[]> {
    const items = await this.prisma.guideFixtureChecklistItem.findMany({
      where: { guideFixtureId, archivedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return items.map((c) => ({ id: c.id, label: c.label, required: c.required }));
  }

  async addChecklistItem(
    orgId: string,
    guideFixtureId: string,
    label: string,
    required: boolean,
  ): Promise<GuideChecklistItem[]> {
    await this.getOwned(orgId, guideFixtureId);
    const max = await this.prisma.guideFixtureChecklistItem.aggregate({
      where: { guideFixtureId, archivedAt: null },
      _max: { order: true },
    });
    await this.prisma.guideFixtureChecklistItem.create({
      data: {
        orgId,
        guideFixtureId,
        label,
        required,
        order: (max._max.order ?? -1) + 1,
      },
    });
    return this.checklist(guideFixtureId);
  }

  async updateChecklistItem(
    orgId: string,
    guideFixtureId: string,
    itemId: string,
    patch: { label?: string; required?: boolean },
  ): Promise<GuideChecklistItem[]> {
    await this.getOwned(orgId, guideFixtureId);
    const item = await this.prisma.guideFixtureChecklistItem.findFirst({
      where: { id: itemId, guideFixtureId, orgId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('checklist item not found');
    await this.prisma.guideFixtureChecklistItem.update({
      where: { id: itemId },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.required !== undefined ? { required: patch.required } : {}),
      },
    });
    return this.checklist(guideFixtureId);
  }

  async removeChecklistItem(
    orgId: string,
    guideFixtureId: string,
    itemId: string,
  ): Promise<GuideChecklistItem[]> {
    await this.getOwned(orgId, guideFixtureId);
    const item = await this.prisma.guideFixtureChecklistItem.findFirst({
      where: { id: itemId, guideFixtureId, orgId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('checklist item not found');
    const ticks = await this.prisma.storeChecklistTick.count({
      where: { itemId },
    });
    if (ticks > 0) {
      await this.prisma.guideFixtureChecklistItem.update({
        where: { id: itemId },
        data: { archivedAt: new Date() },
      });
    } else {
      await this.prisma.guideFixtureChecklistItem.delete({ where: { id: itemId } });
    }
    return this.checklist(guideFixtureId);
  }

  async reorderChecklist(
    orgId: string,
    guideFixtureId: string,
    ids: string[],
  ): Promise<GuideChecklistItem[]> {
    await this.getOwned(orgId, guideFixtureId);
    const live = await this.prisma.guideFixtureChecklistItem.findMany({
      where: { guideFixtureId, orgId, archivedAt: null },
      select: { id: true },
    });
    const liveIds = new Set(live.map((i) => i.id));
    const ordered = ids.filter((id) => liveIds.has(id));
    await this.prisma.$transaction(
      ordered.map((id, i) =>
        this.prisma.guideFixtureChecklistItem.update({
          where: { id },
          data: { order: i },
        }),
      ),
    );
    return this.checklist(guideFixtureId);
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

    const created = await this.prisma.merchandise.create({
      data: {
        orgId,
        guideFixtureId,
        productId,
        row: row ?? null,
        order,
      },
    });
    // A sheet edit is a planogram edit: write it back to the fixture's default
    // set and mirror to every other sheet using this fixture.
    await this.planogramSync.pullGuideIntoDefaults(orgId, guideFixtureId);
    return created;
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
    await this.planogramSync.pullGuideIntoDefaults(orgId, guideFixtureId);
    return { ok: true };
  }

  /**
   * Persist a full planogram layout: shelves top→bottom, each a left→right list
   * of merchandise ids. Rewrites (row, order) for every facing in one
   * transaction; order = shelfIdx*1000 + colIdx, so the existing read
   * (orderBy order asc → groupMerchandise) reproduces shelf order AND intra-shelf
   * order with no extra column. The payload must cover EXACTLY the sheet's
   * current facings (no aliens, no orphans) so a stale client can't half-rewrite.
   */
  async reorderPlanogram(
    orgId: string,
    guideFixtureId: string,
    shelves: { row: string; merchandiseIds: string[] }[],
  ): Promise<GuideFixtureDetail> {
    await this.getOwned(orgId, guideFixtureId);
    const existing = await this.prisma.merchandise.findMany({
      where: { guideFixtureId, orgId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((m) => m.id));
    const sent = shelves.flatMap((s) => s.merchandiseIds);
    for (const id of sent) {
      if (!existingIds.has(id)) throw new BadRequestException('unknown merchandise');
    }
    if (sent.length !== existingIds.size) {
      throw new BadRequestException('layout must cover all merchandise on the sheet');
    }
    await this.prisma.$transaction(
      shelves.flatMap((shelf, shelfIdx) =>
        shelf.merchandiseIds.map((mid, colIdx) =>
          this.prisma.merchandise.update({
            where: { id: mid },
            data: { row: shelf.row.trim(), order: shelfIdx * 1000 + colIdx },
          }),
        ),
      ),
    );
    await this.planogramSync.pullGuideIntoDefaults(orgId, guideFixtureId);
    return this.detailByGuideFixtureId(orgId, guideFixtureId);
  }

  /** Re-read + map a sheet by GuideFixture id (for mutations that hold only the gf id). */
  private async detailByGuideFixtureId(
    orgId: string,
    guideFixtureId: string,
  ): Promise<GuideFixtureDetail> {
    const gf = await this.prisma.guideFixture.findFirst({
      where: { id: guideFixtureId, orgId },
      include: GUIDE_FIXTURE_INCLUDE,
    });
    if (!gf) throw new NotFoundException('guide fixture not found');
    const fixture = await this.prisma.fixture.findFirst({
      where: { id: gf.fixtureId, orgId },
      select: { id: true, name: true, kind: true },
    });
    if (!fixture) throw new NotFoundException('fixture not found');
    return {
      fixtureId: fixture.id,
      guideFixtureId: gf.id,
      fixtureName: fixture.name,
      kind: fixture.kind as FixtureKind,
      notes: gf.notes,
      instructions: asInstructions(gf.instructions),
      exampleImages: gf.exampleImages.map((img) => this.toExampleImage(img)),
      merchandise: groupMerchandise(gf.merchandise),
      checklist: gf.checklistItems.map((c) => ({
        id: c.id,
        label: c.label,
        required: c.required,
      })),
    };
  }

  // ----- example images ("what good looks like") ---------------------------

  /**
   * Upload a "what good looks like" reference image for the sheet (org-scoped via
   * the parent guide-fixture). Validates the bytes, stores them, and records the
   * ExampleImage. The first image added becomes best-in-class automatically — so
   * a freshly-authored fixture immediately has a reference the AI compares
   * against, instead of "judging the notes alone". Returns the refreshed sheet.
   */
  async addExampleImage(
    orgId: string,
    guideFixtureId: string,
    file: UploadedImageFile | undefined,
    caption?: string,
  ): Promise<GuideFixtureDetail> {
    await this.getOwned(orgId, guideFixtureId);
    await assertReadableImage(file);
    const f = file as UploadedImageFile;

    const storageKey = await this.storage.put(f.buffer, {
      ext: imageExtFor(f.mimetype),
      prefix: `example-images/${orgId}/${guideFixtureId}`,
    });

    // First reference on the sheet is best-in-class by default.
    const existing = await this.prisma.exampleImage.count({
      where: { guideFixtureId, orgId },
    });
    const trimmed = caption?.trim();

    await this.prisma.exampleImage.create({
      data: {
        orgId,
        guideFixtureId,
        storageKey,
        caption: trimmed ? trimmed : null,
        bestInClass: existing === 0,
      },
    });

    return this.detailByGuideFixtureId(orgId, guideFixtureId);
  }

  /** Edit an example image's caption (org-scoped). Empty string clears it. */
  async updateExampleImageCaption(
    orgId: string,
    guideFixtureId: string,
    imageId: string,
    caption: string,
  ): Promise<GuideFixtureDetail> {
    await this.getOwned(orgId, guideFixtureId);
    const trimmed = caption.trim();
    const { count } = await this.prisma.exampleImage.updateMany({
      where: { id: imageId, guideFixtureId, orgId },
      data: { caption: trimmed ? trimmed : null },
    });
    if (count === 0) throw new NotFoundException('example image not found');
    return this.detailByGuideFixtureId(orgId, guideFixtureId);
  }

  /**
   * Mark one example image best-in-class and clear the flag on its siblings, so
   * at most one image leads the "what good looks like" grid. Done in a
   * transaction. Org-scoped.
   */
  async setExampleImageBestInClass(
    orgId: string,
    guideFixtureId: string,
    imageId: string,
  ): Promise<GuideFixtureDetail> {
    await this.getOwned(orgId, guideFixtureId);
    const target = await this.prisma.exampleImage.findFirst({
      where: { id: imageId, guideFixtureId, orgId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('example image not found');

    await this.prisma.$transaction([
      this.prisma.exampleImage.updateMany({
        where: { guideFixtureId, orgId, bestInClass: true, id: { not: imageId } },
        data: { bestInClass: false },
      }),
      this.prisma.exampleImage.update({
        where: { id: imageId },
        data: { bestInClass: true },
      }),
    ]);

    return this.detailByGuideFixtureId(orgId, guideFixtureId);
  }

  /**
   * Remove an example image (and best-effort delete its bytes). If the removed
   * image was best-in-class, promote the next remaining image so the grid keeps
   * a leader. Org-scoped. Returns the refreshed sheet.
   */
  async removeExampleImage(
    orgId: string,
    guideFixtureId: string,
    imageId: string,
  ): Promise<GuideFixtureDetail> {
    await this.getOwned(orgId, guideFixtureId);
    const target = await this.prisma.exampleImage.findFirst({
      where: { id: imageId, guideFixtureId, orgId },
      select: { id: true, storageKey: true, bestInClass: true },
    });
    if (!target) throw new NotFoundException('example image not found');

    await this.prisma.exampleImage.delete({ where: { id: target.id } });

    // Storage cleanup is best-effort — a missing key is not an error.
    await this.storage.remove(target.storageKey);

    // Keep a best-in-class leader: if we just removed it, promote the next one.
    if (target.bestInClass) {
      const next = await this.prisma.exampleImage.findFirst({
        where: { guideFixtureId, orgId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) {
        await this.prisma.exampleImage.update({
          where: { id: next.id },
          data: { bestInClass: true },
        });
      }
    }

    return this.detailByGuideFixtureId(orgId, guideFixtureId);
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
/** Coerce the persisted JSON instructions into a clean GuideInstructionStep[]. */
function asInstructions(value: unknown): GuideInstructionStep[] {
  if (!Array.isArray(value)) return [];
  const out: GuideInstructionStep[] = [];
  for (const it of value) {
    if (!it || typeof it !== 'object') continue;
    const row = it as Record<string, unknown>;
    if (typeof row.text !== 'string' || !row.text.trim()) continue;
    out.push({
      id: typeof row.id === 'string' ? row.id : randomUUID(),
      text: row.text,
    });
  }
  return out;
}

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
    bucket.products.push({ ...toProductDto(item.product), merchandiseId: item.id });
  }

  // Float the catch-all "Unsorted" row to the bottom; keep first-seen order for
  // the rest (insertion order on a Map is stable).
  return [...rows.values()].sort((a, b) => {
    if (a.row === UNROWED_LABEL) return 1;
    if (b.row === UNROWED_LABEL) return -1;
    return 0;
  });
}
