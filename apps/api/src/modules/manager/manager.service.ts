import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus, CaptureVerdict, TaskStatus } from '@prisma/client';
import type {
  FixtureCapture,
  FixtureCaptureAttempt,
  Task,
} from '@prisma/client';
import type {
  CaptureAttempt,
  CaptureVerdict as CaptureVerdictDto,
  ComplianceState,
  Department,
  FixtureCompliance,
  FixtureComplianceDetail,
  FixtureKind,
  ManagerFixture,
  ManagerHome,
  ManagerPreferences,
  ProductDto,
  SalesFixtureGroup,
  SalesLine,
  SalesLog,
  SessionUser,
  TaskDto,
  TaskKind,
  TaskStatus as TaskStatusDto,
} from '@wally/types';
import sharp from 'sharp';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

import { ComplianceScorer } from './compliance-scorer.service';

// =============================================================================
// ManagerService — the signed-in store manager's own store workspace.
// =============================================================================
//
// Every manager surface resolves a (store, campaign) pair first:
//   - STORE_MANAGER: their own `user.storeId` (the ?storeId query is ignored);
//   - ADMIN / REVIEWER: the ?storeId query if given (validated in-org), else the
//     org's first store — this powers the demo "view as store" switcher.
// The resolved store is always re-checked against the caller's org, so a stray
// id can't reach another tenant (404, never a leak).
//
// The active campaign is the org's ACTIVE campaign, falling back to its most
// recent — matching how the capture flow resolves "the campaign right now".
//
// Two parallel fixture systems exist in the schema:
//   - the CHECKLIST uses StoreFixture (string fixtureKey) + Photo.fixtureKey,
//     same as the capture flow — so checklist progress reads those;
//   - the GUIDE / MONEY surfaces use Placement (Fixture id) + GuideFixture +
//     Merchandise — so fixtures/products/sales read those.
// =============================================================================

// Photo upload limits for the compliance loop — mirror the submission flow so a
// manager's phone photo is accepted the same way on both surfaces.
const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** The minimal actor projection the capture reads select for stamps. */
type ActorRef = { name: string | null; email: string } | null;

/** An attempt row enriched with the manager who took it (for the history list). */
type AttemptWithActor = FixtureCaptureAttempt & { capturedBy?: ActorRef };

/**
 * A FixtureCapture (the CURRENT pointer) joined with its reviewer actors and the
 * full reshoot history — the read shape the presenters consume.
 */
type CaptureWithHistory = FixtureCapture & {
  requestedBy?: ActorRef;
  reviewedBy?: ActorRef;
  attempts?: AttemptWithActor[];
};

@Injectable()
export class ManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scorer: ComplianceScorer,
  ) {}

  // ----- shared resolution --------------------------------------------------

  /**
   * Resolve the target store for a manager surface. STORE_MANAGER → their own
   * store (query ignored); ADMIN/REVIEWER → the requested store (in-org) or the
   * org's first store. The result is always confirmed to belong to the org.
   */
  private async resolveStore(
    user: SessionUser,
    storeId?: string,
  ): Promise<{ id: string; name: string; projectId: string | null }> {
    if (user.role === 'STORE_MANAGER') {
      if (!user.storeId) {
        throw new NotFoundException(
          'No store is linked to this account. Ask head office to re-send your checklist link.',
        );
      }
      const store = await this.prisma.store.findFirst({
        where: { id: user.storeId, orgId: user.orgId },
        select: { id: true, name: true, projectId: true },
      });
      if (!store) throw new NotFoundException('store not found');
      return store;
    }

    // ADMIN / REVIEWER / VIEWER: explicit store (validated in-org) or the org's
    // first. VIEWER reads like a reviewer — it may pass ?storeId, else lands on
    // the first store.
    if (storeId) {
      const store = await this.prisma.store.findFirst({
        where: { id: storeId, orgId: user.orgId },
        select: { id: true, name: true, projectId: true },
      });
      if (!store) throw new NotFoundException('store not found');
      return store;
    }

    // The org's first ACTIVE store (closed stores are retired — never the
    // default landing for the ADMIN/REVIEWER store switcher).
    const first = await this.prisma.store.findFirst({
      where: { orgId: user.orgId, closedAt: null },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, projectId: true },
    });
    if (!first) throw new NotFoundException('no store found for this org');
    return first;
  }

  /**
   * Resolve the active campaign for a store.
   *
   * PROJECT-SCOPED: when the store belongs to a project, the campaign comes from
   * that project — its ACTIVE campaign, else its most-recent. This makes an
   * Ambiente venue resolve the Ambiente guide and a Myer store resolve MSP2-2026
   * even though both live in the same org. A project-less store falls back to
   * the org-level logic (ACTIVE campaign, else the org's most recent) — the
   * original behaviour, kept intact.
   */
  private async resolveCampaign(
    orgId: string,
    projectId: string | null,
  ): Promise<{ id: string; key: string; name: string }> {
    if (projectId) {
      const projectActive = await this.prisma.campaign.findFirst({
        where: { orgId, projectId, status: CampaignStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        select: { id: true, key: true, name: true },
      });
      if (projectActive) return projectActive;

      const projectRecent = await this.prisma.campaign.findFirst({
        where: { orgId, projectId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, key: true, name: true },
      });
      if (projectRecent) return projectRecent;
      // A project with no campaign of its own falls through to the org-level
      // resolution so the workspace still renders.
    }

    const active = await this.prisma.campaign.findFirst({
      where: { orgId, status: CampaignStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true, name: true },
    });
    if (active) return active;

    const recent = await this.prisma.campaign.findFirst({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true, name: true },
    });
    if (!recent) throw new NotFoundException('no campaign found for this org');
    return recent;
  }

  /** Resolve (store, campaign) — most manager surfaces need both. */
  private async resolveContext(user: SessionUser, storeId?: string) {
    const store = await this.resolveStore(user, storeId);
    const campaign = await this.resolveCampaign(user.orgId, store.projectId);
    return { store, campaign };
  }

  // ----- home ---------------------------------------------------------------

  /** The store manager's landing payload: tasks, checklist progress, sales. */
  async home(user: SessionUser, storeId?: string): Promise<ManagerHome> {
    const { store, campaign } = await this.resolveContext(user, storeId);

    const [openTasks, unseenTasks, overdueTasks, checklist, sales, tasks] =
      await Promise.all([
        this.prisma.task.count({
          where: { storeId: store.id, status: TaskStatus.OPEN },
        }),
        // PER-USER unread count: OPEN tasks for this store with no TaskRead row
        // for THIS user. A co-manager opening Tasks no longer clears this badge.
        this.prisma.task.count({
          where: {
            storeId: store.id,
            status: TaskStatus.OPEN,
            reads: { none: { userId: user.id } },
          },
        }),
        // Overdue: OPEN tasks whose dueAt is already in the past.
        this.prisma.task.count({
          where: {
            storeId: store.id,
            status: TaskStatus.OPEN,
            dueAt: { not: null, lt: new Date() },
          },
        }),
        this.checklist(store.id, campaign.id),
        this.salesSummary(store.id, campaign.id),
        this.tasksFor(store.id, user.id),
      ]);

    return {
      storeId: store.id,
      storeName: store.name,
      campaignId: campaign.id,
      campaignKey: campaign.key,
      campaignName: campaign.name,
      department: null,
      openTasks,
      unseenTasks,
      overdueTasks,
      checklist,
      sales,
      tasks,
    };
  }

  /**
   * Checklist progress for the store × campaign. `total` = the store's
   * applicable StoreFixtures (the capture-flow checklist); `done` = the distinct
   * fixtureKeys that already have an uploaded Photo in the store's submission.
   */
  private async checklist(
    storeId: string,
    campaignId: string,
  ): Promise<{ total: number; done: number }> {
    const total = await this.prisma.storeFixture.count({
      where: { storeId, campaignId, applicable: true },
    });

    const submission = await this.prisma.submission.findUnique({
      where: { storeId_campaignId: { storeId, campaignId } },
      select: { id: true },
    });
    if (!submission) return { total, done: 0 };

    const distinct = await this.prisma.photo.findMany({
      where: { submissionId: submission.id },
      distinct: ['fixtureKey'],
      select: { fixtureKey: true },
    });
    return { total, done: distinct.length };
  }

  /**
   * Sales snapshot for the manager home tile. Returns BOTH windows so the tile
   * can show today's revenue/units (matching what the linked Sales Log opens to)
   * as the primary figure and the campaign-to-date running total as a labelled
   * secondary figure — the two surfaces never silently disagree.
   *
   * `today` uses the same `dayUtc()` convention as `sales`/`logSale` so the tile
   * and the day-scoped log share one definition of "today".
   *
   * `loggedProducts` is the DISTINCT count of products with logged units
   * campaign-to-date (a groupBy on productId), so a product logged on N separate
   * days counts once — not N times as a raw row count would.
   */
  private async salesSummary(
    storeId: string,
    campaignId: string,
  ): Promise<{
    today: { totalRevenue: number; totalUnits: number };
    campaignToDate: { totalRevenue: number; totalUnits: number };
    loggedProducts: number;
  }> {
    const today = dayUtc();
    const [todayAgg, campaignAgg, distinctProducts] = await Promise.all([
      this.prisma.salesEntry.aggregate({
        where: { storeId, campaignId, soldOn: today },
        _sum: { revenue: true, units: true },
      }),
      this.prisma.salesEntry.aggregate({
        where: { storeId, campaignId },
        _sum: { revenue: true, units: true },
      }),
      this.prisma.salesEntry.groupBy({
        by: ['productId'],
        where: { storeId, campaignId, units: { gt: 0 } },
      }),
    ]);
    return {
      today: {
        totalRevenue: todayAgg._sum.revenue ?? 0,
        totalUnits: todayAgg._sum.units ?? 0,
      },
      campaignToDate: {
        totalRevenue: campaignAgg._sum.revenue ?? 0,
        totalUnits: campaignAgg._sum.units ?? 0,
      },
      loggedProducts: distinctProducts.length,
    };
  }

  // ----- tasks --------------------------------------------------------------

  /**
   * The store's tasks for the requesting user: OPEN first then DONE. Within OPEN,
   * sort by dueAt ascending (soonest first) with NULL dueAt last, then newest
   * first; DONE is newest first. The per-user `seen` flag comes from TaskRead.
   */
  async tasks(user: SessionUser, storeId?: string): Promise<TaskDto[]> {
    const store = await this.resolveStore(user, storeId);
    return this.tasksFor(store.id, user.id);
  }

  private async tasksFor(storeId: string, userId: string): Promise<TaskDto[]> {
    const tasks = await this.prisma.task.findMany({
      where: { storeId },
      // OPEN before DONE (alphabetical: DONE < OPEN, so desc puts OPEN first).
      // dueAt asc puts the soonest-due first; Prisma sorts NULLs last on asc, so
      // undated tasks fall after dated ones. createdAt desc breaks ties.
      orderBy: [{ status: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        reads: { where: { userId }, select: { id: true } },
        completedBy: { select: { name: true, email: true } },
        assignedTo: { select: { name: true, email: true } },
      },
    });
    return tasks.map(toTaskDto);
  }

  /**
   * Mark one task DONE (verified to belong to the resolved store + org). Stamps
   * the acting user as `completedById` for the audit trail.
   */
  async completeTask(
    user: SessionUser,
    taskId: string,
    storeId?: string,
  ): Promise<void> {
    const store = await this.resolveStore(user, storeId);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, storeId: store.id, orgId: user.orgId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('task not found');

    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.DONE,
        completedAt: new Date(),
        completedById: user.id,
      },
    });
  }

  /**
   * Reopen a DONE task (DONE → OPEN), clearing completedAt/completedById so a
   * mis-tapped completion is recoverable. No-op if it's already OPEN.
   */
  async reopenTask(
    user: SessionUser,
    taskId: string,
    storeId?: string,
  ): Promise<void> {
    const store = await this.resolveStore(user, storeId);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, storeId: store.id, orgId: user.orgId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('task not found');

    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.OPEN,
        completedAt: null,
        completedById: null,
      },
    });
  }

  /**
   * Mark every OPEN task for the store as seen BY THIS USER (clears their badge).
   * Upserts one TaskRead per open task for `user.id`, so the read state is
   * per-user — a co-manager's badge is untouched.
   */
  async markTasksSeen(user: SessionUser, storeId?: string): Promise<void> {
    const store = await this.resolveStore(user, storeId);
    const openTasks = await this.prisma.task.findMany({
      where: {
        storeId: store.id,
        status: TaskStatus.OPEN,
        reads: { none: { userId: user.id } },
      },
      select: { id: true },
    });
    if (openTasks.length === 0) return;
    // createMany + skipDuplicates is atomic and idempotent against the
    // (taskId, userId) unique — concurrent opens never collide.
    await this.prisma.taskRead.createMany({
      data: openTasks.map((t) => ({ taskId: t.id, userId: user.id })),
      skipDuplicates: true,
    });
  }

  // ----- preferences --------------------------------------------------------

  /** The signed-in user's notification preferences. */
  async getPreferences(user: SessionUser): Promise<ManagerPreferences> {
    const row = await this.prisma.user.findFirst({
      where: { id: user.id, orgId: user.orgId },
      select: { notifyOnNewTask: true },
    });
    if (!row) throw new NotFoundException('user not found');
    return { notifyOnNewTask: row.notifyOnNewTask };
  }

  /** Patch the signed-in user's notification preferences. */
  async updatePreferences(
    user: SessionUser,
    input: { notifyOnNewTask?: boolean },
  ): Promise<ManagerPreferences> {
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(input.notifyOnNewTask !== undefined
          ? { notifyOnNewTask: input.notifyOnNewTask }
          : {}),
      },
      select: { notifyOnNewTask: true },
    });
    return { notifyOnNewTask: row.notifyOnNewTask };
  }

  // ----- fixtures -----------------------------------------------------------

  /**
   * The store's read-only fixture list for the active campaign: its Placements
   * (applicable first), each carrying the fixture's label/kind/department and
   * the count of products merchandised on its guide-fixture.
   */
  async fixtures(user: SessionUser, storeId?: string): Promise<ManagerFixture[]> {
    const { store, campaign } = await this.resolveContext(user, storeId);

    const placements = await this.prisma.placement.findMany({
      where: { storeId: store.id, campaignId: campaign.id, orgId: user.orgId },
      orderBy: [{ applicable: 'desc' }, { order: 'asc' }],
      include: {
        fixture: { select: { name: true, kind: true, department: true } },
      },
    });

    // Product counts per fixture come from the campaign's guide-fixtures.
    const counts = await this.merchandiseCountByFixture(
      user.orgId,
      campaign.id,
    );

    return placements.map((p) => ({
      fixtureId: p.fixtureId,
      label: p.label || p.fixture.name,
      kind: toFixtureKind(p.fixture.kind),
      department: toDepartment(p.fixture.department),
      applicable: p.applicable,
      productCount: counts.get(p.fixtureId) ?? 0,
    }));
  }

  /**
   * Map fixtureId → merchandised product count for the campaign's guide.
   * (GuideFixture is unique per (campaign, fixture), so one count per fixture.)
   */
  private async merchandiseCountByFixture(
    orgId: string,
    campaignId: string,
  ): Promise<Map<string, number>> {
    const guideFixtures = await this.prisma.guideFixture.findMany({
      where: { orgId, campaignId },
      select: { fixtureId: true, _count: { select: { merchandise: true } } },
    });
    const map = new Map<string, number>();
    for (const gf of guideFixtures) {
      map.set(gf.fixtureId, gf._count.merchandise);
    }
    return map;
  }

  // ----- products -----------------------------------------------------------

  /**
   * The distinct products merchandised in the active campaign's guide. Mapped to
   * ProductDto with the retail web title preferred over the VM-guide label.
   */
  async products(user: SessionUser, storeId?: string): Promise<ProductDto[]> {
    const { campaign } = await this.resolveContext(user, storeId);

    const merch = await this.prisma.merchandise.findMany({
      where: { orgId: user.orgId, guideFixture: { campaignId: campaign.id } },
      include: { product: true },
    });

    const seen = new Set<string>();
    const products: ProductDto[] = [];
    for (const m of merch) {
      if (seen.has(m.productId)) continue;
      seen.add(m.productId);
      const p = m.product;
      products.push({
        id: p.id,
        sku: p.sku,
        name: p.webTitle ?? p.name,
        ...(p.brand != null ? { brand: p.brand } : {}),
        ...(p.category != null ? { category: p.category } : {}),
        ...(p.color != null ? { color: p.color } : {}),
        ...(p.imageUrl != null ? { imageUrl: p.imageUrl } : {}),
      });
    }

    products.sort((a, b) => (a.brand ?? '').localeCompare(b.brand ?? '') || a.name.localeCompare(b.name));
    return products;
  }

  // ----- sales --------------------------------------------------------------

  /**
   * The sales log for the store × active campaign, grouped by the fixture the
   * products sit on. Each applicable placement's guide-fixture merchandise
   * becomes a group of SalesLines (current units pulled from SalesEntry). Only
   * fixtures with ≥1 merchandised product are included.
   */
  async sales(
    user: SessionUser,
    storeId?: string,
    date?: string,
  ): Promise<SalesLog> {
    const { store, campaign } = await this.resolveContext(user, storeId);
    const soldOn = dayUtc(date);

    const placements = await this.prisma.placement.findMany({
      where: {
        storeId: store.id,
        campaignId: campaign.id,
        orgId: user.orgId,
        applicable: true,
      },
      orderBy: [{ order: 'asc' }],
      include: {
        fixture: { select: { name: true, kind: true, department: true } },
      },
    });

    // The campaign's guide-fixtures, keyed by fixtureId, with their merchandise
    // (+ product) so each placement can find the products on it.
    const guideFixtures = await this.prisma.guideFixture.findMany({
      where: { orgId: user.orgId, campaignId: campaign.id },
      include: {
        merchandise: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          include: { product: true },
        },
      },
    });
    const merchByFixture = new Map<string, (typeof guideFixtures)[number]['merchandise']>();
    for (const gf of guideFixtures) merchByFixture.set(gf.fixtureId, gf.merchandise);

    // Logged units per product for this store × campaign ON THE SELECTED DAY.
    const entries = await this.prisma.salesEntry.findMany({
      where: { storeId: store.id, campaignId: campaign.id, soldOn },
      select: { productId: true, units: true },
    });
    const unitsByProduct = new Map<string, number>();
    for (const e of entries) unitsByProduct.set(e.productId, e.units);

    const groups: SalesFixtureGroup[] = [];
    let totalUnits = 0;
    let totalRevenue = 0;

    for (const p of placements) {
      const merch = merchByFixture.get(p.fixtureId);
      if (!merch || merch.length === 0) continue;

      const lines: SalesLine[] = [];
      const seen = new Set<string>();
      let groupUnits = 0;
      let groupRevenue = 0;

      for (const m of merch) {
        if (seen.has(m.productId)) continue; // one line per product per fixture
        seen.add(m.productId);
        const prod = m.product;
        const unitPrice = prod.salePrice ?? prod.rrp ?? 0;
        const units = unitsByProduct.get(prod.id) ?? 0;
        const revenue = units * unitPrice;
        groupUnits += units;
        groupRevenue += revenue;
        lines.push({
          productId: prod.id,
          sku: prod.sku,
          name: prod.webTitle ?? prod.name,
          webTitle: prod.webTitle,
          imageUrl: prod.imageUrl,
          range: prod.range,
          unitPrice,
          units,
          revenue,
        });
      }

      if (lines.length === 0) continue;

      totalUnits += groupUnits;
      totalRevenue += groupRevenue;
      groups.push({
        fixtureId: p.fixtureId,
        label: p.label || p.fixture.name,
        kind: toFixtureKind(p.fixture.kind),
        department: toDepartment(p.fixture.department),
        units: groupUnits,
        revenue: groupRevenue,
        lines,
      });
    }

    return {
      storeId: store.id,
      storeName: store.name,
      campaignId: campaign.id,
      campaignKey: campaign.key,
      soldOn: toDateStr(soldOn),
      totalUnits,
      totalRevenue,
      groups,
    };
  }

  /**
   * Set the units sold for one product (store × active campaign × day).
   * Idempotent upsert on the unique (storeId, campaignId, productId, soldOn).
   *
   * Price is snapshotted ONCE, when the day's entry is first created
   * (salePrice → rrp → 0); a later edit to that same day keeps the original
   * `unitPrice` and only recomputes `revenue = units × existingUnitPrice`, so a
   * mid-campaign price change never silently rewrites an already-logged day's
   * recorded value. `loggedById` records the acting user on both branches, and
   * the denormalised `fixtureId` keeps the Money Map's by-fixture rollup cheap.
   * The product must belong to the caller's org.
   */
  async logSale(
    user: SessionUser,
    productId: string,
    units: number,
    storeId?: string,
    date?: string,
  ): Promise<void> {
    const { store, campaign } = await this.resolveContext(user, storeId);
    const soldOn = dayUtc(date);

    const product = await this.prisma.product.findFirst({
      where: { id: productId, orgId: user.orgId },
      select: { id: true, salePrice: true, rrp: true },
    });
    if (!product) throw new NotFoundException('product not found');

    // The product's fixture in this campaign (via Merchandise → GuideFixture).
    // Denormalised onto the entry so the Money Map groups by fixture cheaply.
    const merch = await this.prisma.merchandise.findFirst({
      where: {
        orgId: user.orgId,
        productId: product.id,
        guideFixture: { campaignId: campaign.id },
      },
      include: { guideFixture: { select: { fixtureId: true } } },
    });
    const fixtureId = merch?.guideFixture.fixtureId ?? null;

    const dayKey = {
      storeId: store.id,
      campaignId: campaign.id,
      productId: product.id,
      soldOn,
    };

    // Keep the day's existing price snapshot on edit; only snapshot fresh on the
    // first log of the day. Read the current row to decide which.
    const existing = await this.prisma.salesEntry.findUnique({
      where: { storeId_campaignId_productId_soldOn: dayKey },
      select: { unitPrice: true },
    });
    const createPrice = product.salePrice ?? product.rrp ?? 0;
    const unitPrice = existing?.unitPrice ?? createPrice;
    const revenue = units * unitPrice;

    await this.prisma.salesEntry.upsert({
      where: { storeId_campaignId_productId_soldOn: dayKey },
      create: {
        orgId: user.orgId,
        storeId: store.id,
        campaignId: campaign.id,
        productId: product.id,
        fixtureId,
        soldOn,
        units,
        unitPrice,
        revenue,
        loggedById: user.id,
      },
      update: {
        units,
        // unitPrice intentionally NOT updated — keep the day's original snapshot.
        revenue,
        fixtureId,
        loggedById: user.id,
      },
    });
  }

  // ----- compliance loop ----------------------------------------------------
  //
  // The floor-map COMPLIANCE LOOP, distinct from the legacy Submission/Photo
  // pipeline: keyed by Placement (Fixture id) + GuideFixture, scored by an
  // image-compare against the guide's reference image + VM notes. One
  // FixtureCapture row per (store, campaign, fixture) holds the photo + verdict.

  /**
   * The compliance sheet for the resolved store × active campaign: one row per
   * APPLICABLE placement, carrying its state (todo/submitted/scored), the AI
   * verdict (if scored), whether a photo is wanted, and whether the guide has a
   * reference image. Needs-a-photo fixtures float to the top, then placement order.
   */
  async compliance(
    user: SessionUser,
    storeId?: string,
  ): Promise<FixtureCompliance[]> {
    const { store, campaign } = await this.resolveContext(user, storeId);

    const placements = await this.prisma.placement.findMany({
      where: {
        storeId: store.id,
        campaignId: campaign.id,
        orgId: user.orgId,
        applicable: true,
      },
      orderBy: [{ order: 'asc' }],
      include: {
        fixture: { select: { name: true, kind: true, department: true } },
      },
    });

    // Captures for these fixtures, keyed by fixtureId (the unique row per
    // store+campaign+fixture). One query, then a Map lookup per placement.
    const captures = await this.prisma.fixtureCapture.findMany({
      where: { storeId: store.id, campaignId: campaign.id },
    });
    const captureByFixture = new Map(captures.map((c) => [c.fixtureId, c]));

    // Which guide-fixtures have ≥1 example image → hasReference per fixture.
    const guideFixtures = await this.prisma.guideFixture.findMany({
      where: { orgId: user.orgId, campaignId: campaign.id },
      select: { fixtureId: true, _count: { select: { exampleImages: true } } },
    });
    const refByFixture = new Map(
      guideFixtures.map((gf) => [gf.fixtureId, gf._count.exampleImages > 0]),
    );

    const rows: FixtureCompliance[] = placements.map((p) => {
      const capture = captureByFixture.get(p.fixtureId);
      const state = captureState(capture);
      const aiVerdict = capture?.verdict
        ? toCaptureVerdict(capture.verdict)
        : null;
      const overrideVerdict = capture?.overrideVerdict
        ? toCaptureVerdict(capture.overrideVerdict)
        : null;
      return {
        fixtureId: p.fixtureId,
        label: p.label || p.fixture.name,
        kind: toFixtureKind(p.fixture.kind),
        department: toDepartment(p.fixture.department),
        needsPhoto: state === 'todo' || capture?.needsPhoto === true,
        state,
        overall: aiVerdict,
        overrideVerdict,
        // Override beats the AI verdict — this is what the floor map should trust.
        effectiveVerdict: overrideVerdict ?? aiVerdict,
        hasReference: refByFixture.get(p.fixtureId) ?? false,
        // Floor-plan geometry so the visualization can place the fixture …
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        rotation: p.rotation,
        // … and a signed thumbnail of the submitted photo when one exists
        // (same pattern as fixtureCompliance's myPhotoUrl).
        photoUrl: capture?.storageKey
          ? this.storage.signedGetUrl(capture.storageKey)
          : null,
      };
    });

    // Needs-a-photo first (true before false), otherwise preserve placement
    // order (the map is already order-asc, so a stable sort keeps it).
    rows.sort((a, b) => Number(b.needsPhoto) - Number(a.needsPhoto));
    return rows;
  }

  /**
   * One fixture's full compliance sheet: the VM notes, the "what good looks
   * like" reference (best-in-class preferred) as a signed URL, the manager's
   * submitted photo as a signed URL, and the AI verdict. 404 if the fixture
   * isn't placed for this store + campaign.
   */
  async fixtureCompliance(
    user: SessionUser,
    fixtureId: string,
    storeId?: string,
  ): Promise<FixtureComplianceDetail> {
    const { store, campaign } = await this.resolveContext(user, storeId);
    const placement = await this.requirePlacement(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );

    const capture = await this.loadCaptureDetail(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );

    const { notes, reference } = await this.guideFor(
      user.orgId,
      campaign.id,
      fixtureId,
    );

    return this.presentComplianceDetail(placement, capture, notes, reference);
  }

  /**
   * Upload the manager's photo for a fixture and score it synchronously. Stores
   * the bytes via StorageService (mirroring the submission flow), upserts the
   * FixtureCapture, then runs the ComplianceScorer against the guide's reference
   * image + notes and persists the verdict. Returns the post-score detail.
   */
  async uploadFixturePhoto(
    user: SessionUser,
    fixtureId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    storeId?: string,
  ): Promise<FixtureComplianceDetail> {
    const { store, campaign } = await this.resolveContext(user, storeId);
    const placement = await this.requirePlacement(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );

    // Validate the upload exactly as the submission flow does.
    if (!file?.buffer?.length) {
      throw new BadRequestException('no photo file received');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException('photo exceeds 15MB limit');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `unsupported image type "${file.mimetype}" (allowed: jpeg, png, webp)`,
      );
    }
    // A file sharp can't parse isn't a real image — reject loudly (never log bytes).
    try {
      await sharp(file.buffer).metadata();
    } catch {
      throw new BadRequestException('file is not a readable image');
    }

    // Persist the bytes. Same key scheme as the submission flow:
    // captures/<storeId>/<campaignId>/<fixtureId>.
    const storageKey = await this.storage.put(file.buffer, {
      ext: mimeToExt(file.mimetype),
      prefix: `captures/${store.id}/${campaign.id}/${fixtureId}`,
    });

    // Upsert the capture: record the new photo, clear the needs-photo flag.
    await this.prisma.fixtureCapture.upsert({
      where: {
        storeId_campaignId_fixtureId: {
          storeId: store.id,
          campaignId: campaign.id,
          fixtureId,
        },
      },
      create: {
        orgId: user.orgId,
        storeId: store.id,
        campaignId: campaign.id,
        fixtureId,
        storageKey,
        uploadedAt: new Date(),
        needsPhoto: false,
      },
      update: {
        storageKey,
        uploadedAt: new Date(),
        needsPhoto: false,
        // A fresh photo invalidates the previous verdict until re-scored below.
        verdict: null,
        aiNotes: null,
        confidence: null,
        modelId: null,
        scoredAt: null,
      },
    });

    // Resolve the guide notes + reference image for the compare.
    const { notes, reference } = await this.guideFor(
      user.orgId,
      campaign.id,
      fixtureId,
    );

    // SCORE synchronously. The scorer NEVER throws — on any error it returns a
    // deterministic stub verdict so the upload always resolves with a result.
    let referenceBytes: Buffer | undefined;
    if (reference) {
      try {
        referenceBytes = await this.storage.getBytes(reference.storageKey);
      } catch {
        // A missing reference blob just means we judge against the notes alone.
        referenceBytes = undefined;
      }
    }

    const scored = await this.scorer.score({
      referenceBytes,
      referenceMime: referenceBytes ? 'image/jpeg' : undefined,
      photoBytes: file.buffer,
      photoMime: file.mimetype,
      notes,
      fixtureLabel: placement.label || placement.fixture.name,
    });

    const verdict = fromCaptureVerdict(scored.verdict);
    const capture = await this.prisma.fixtureCapture.update({
      where: {
        storeId_campaignId_fixtureId: {
          storeId: store.id,
          campaignId: campaign.id,
          fixtureId,
        },
      },
      data: {
        verdict,
        aiNotes: scored.notes,
        confidence: scored.confidence,
        modelId: scored.modelId,
        scoredAt: new Date(),
      },
    });

    // HISTORY: preserve THIS shot as an immutable attempt so a re-shoot never
    // erases the prior verdict. The FixtureCapture row above is the CURRENT
    // pointer (latest); the attempt rows are the full reshoot history.
    await this.prisma.fixtureCaptureAttempt.create({
      data: {
        orgId: user.orgId,
        captureId: capture.id,
        storageKey,
        verdict,
        aiNotes: scored.notes,
        confidence: scored.confidence,
        modelId: scored.modelId,
        capturedById: user.id,
      },
    });

    const detail = await this.loadCaptureDetail(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );
    return this.presentComplianceDetail(placement, detail, notes, reference);
  }

  /**
   * REVIEWER/ADMIN: re-request a photo for a fixture ("redo this"). Raises
   * needsPhoto and stamps requestedById/At. Idempotent — re-requesting just
   * re-stamps. 404 if the fixture isn't placed for this store + campaign.
   */
  async requestCapturePhoto(
    user: SessionUser,
    fixtureId: string,
    storeId?: string,
  ): Promise<FixtureComplianceDetail> {
    const { store, campaign } = await this.resolveContext(user, storeId);
    const placement = await this.requirePlacement(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );

    // Upsert so a reviewer can request a photo for a fixture that has no capture
    // row yet (the manager has never shot it) — the request is the prompt to shoot.
    await this.prisma.fixtureCapture.upsert({
      where: {
        storeId_campaignId_fixtureId: {
          storeId: store.id,
          campaignId: campaign.id,
          fixtureId,
        },
      },
      create: {
        orgId: user.orgId,
        storeId: store.id,
        campaignId: campaign.id,
        fixtureId,
        needsPhoto: true,
        requestedById: user.id,
        requestedAt: new Date(),
      },
      update: {
        needsPhoto: true,
        requestedById: user.id,
        requestedAt: new Date(),
      },
    });

    const { notes, reference } = await this.guideFor(
      user.orgId,
      campaign.id,
      fixtureId,
    );
    const detail = await this.loadCaptureDetail(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );
    return this.presentComplianceDetail(placement, detail, notes, reference);
  }

  /**
   * REVIEWER/ADMIN: override the AI verdict for a fixture's capture with a human
   * decision. The EFFECTIVE verdict (overrideVerdict ?? verdict) is what
   * compliance / money-map / the UI display. Stamps reviewedById/At + the
   * optional note. 404 if the fixture isn't placed, or has no capture to judge.
   */
  async overrideCapture(
    user: SessionUser,
    fixtureId: string,
    input: { verdict: CaptureVerdictDto; note?: string },
    storeId?: string,
  ): Promise<FixtureComplianceDetail> {
    const { store, campaign } = await this.resolveContext(user, storeId);
    const placement = await this.requirePlacement(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );

    const existing = await this.prisma.fixtureCapture.findUnique({
      where: {
        storeId_campaignId_fixtureId: {
          storeId: store.id,
          campaignId: campaign.id,
          fixtureId,
        },
      },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('no capture to override for this fixture');
    }

    await this.prisma.fixtureCapture.update({
      where: { id: existing.id },
      data: {
        overrideVerdict: fromCaptureVerdict(input.verdict),
        overrideNote: input.note ?? null,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });

    const { notes, reference } = await this.guideFor(
      user.orgId,
      campaign.id,
      fixtureId,
    );
    const detail = await this.loadCaptureDetail(
      user.orgId,
      store.id,
      campaign.id,
      fixtureId,
    );
    return this.presentComplianceDetail(placement, detail, notes, reference);
  }

  /**
   * The CURRENT capture for (store, campaign, fixture) with the reviewer actors
   * and the full attempt history (newest first). Null when no row exists yet.
   */
  private async loadCaptureDetail(
    orgId: string,
    storeId: string,
    campaignId: string,
    fixtureId: string,
  ): Promise<CaptureWithHistory | null> {
    void orgId;
    return this.prisma.fixtureCapture.findUnique({
      where: {
        storeId_campaignId_fixtureId: { storeId, campaignId, fixtureId },
      },
      include: {
        requestedBy: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
        attempts: {
          orderBy: { capturedAt: 'desc' },
          include: {
            capturedBy: { select: { name: true, email: true } },
          },
        },
      },
    });
  }

  /**
   * The placement for (store, campaign, fixture) with its fixture meta, or 404.
   * This is the compliance loop's "is this fixture on this store's floor?" gate.
   */
  private async requirePlacement(
    orgId: string,
    storeId: string,
    campaignId: string,
    fixtureId: string,
  ) {
    const placement = await this.prisma.placement.findFirst({
      where: { orgId, storeId, campaignId, fixtureId },
      include: {
        fixture: { select: { name: true, kind: true, department: true } },
      },
    });
    if (!placement) throw new NotFoundException('fixture not placed for this store');
    return placement;
  }

  /**
   * The guide notes + best reference image for a fixture in a campaign. The
   * reference is the best-in-class ExampleImage, else the first; null if the
   * guide-fixture has no images. Notes default to "" when there's no guide row.
   */
  private async guideFor(
    orgId: string,
    campaignId: string,
    fixtureId: string,
  ): Promise<{
    notes: string;
    reference: { storageKey: string; caption: string | null } | null;
  }> {
    const guideFixture = await this.prisma.guideFixture.findUnique({
      where: { campaignId_fixtureId: { campaignId, fixtureId } },
      include: {
        exampleImages: {
          // Best-in-class first, then oldest — so [0] is the reference to show.
          orderBy: [{ bestInClass: 'desc' }, { createdAt: 'asc' }],
          select: { storageKey: true, caption: true },
        },
      },
    });
    if (!guideFixture || guideFixture.orgId !== orgId) {
      return { notes: '', reference: null };
    }
    const best = guideFixture.exampleImages[0] ?? null;
    return {
      notes: guideFixture.notes ?? '',
      reference: best
        ? { storageKey: best.storageKey, caption: best.caption }
        : null,
    };
  }

  /** Shape a placement + capture + guide into the FixtureComplianceDetail. */
  private presentComplianceDetail(
    placement: {
      fixtureId: string;
      label: string;
      fixture: { name: string; kind: string; department: string | null };
    },
    capture: CaptureWithHistory | null,
    notes: string,
    reference: { storageKey: string; caption: string | null } | null,
  ): FixtureComplianceDetail {
    const aiVerdict = capture?.verdict ? toCaptureVerdict(capture.verdict) : null;
    const overrideVerdict = capture?.overrideVerdict
      ? toCaptureVerdict(capture.overrideVerdict)
      : null;
    return {
      fixtureId: placement.fixtureId,
      label: placement.label || placement.fixture.name,
      kind: toFixtureKind(placement.fixture.kind),
      department: toDepartment(placement.fixture.department),
      notes,
      referenceUrl: reference ? this.storage.signedGetUrl(reference.storageKey) : null,
      referenceCaption: reference?.caption ?? null,
      myPhotoUrl: capture?.storageKey
        ? this.storage.signedGetUrl(capture.storageKey)
        : null,
      state: captureState(capture),
      overall: aiVerdict,
      aiNotes: capture?.aiNotes ?? null,
      confidence: capture?.confidence ?? null,
      scoredAt: capture?.scoredAt ? capture.scoredAt.toISOString() : null,
      needsPhoto: capture?.needsPhoto ?? true,
      // The human override (if any) and the EFFECTIVE verdict the UI/money-map
      // should trust: override beats the AI verdict.
      overrideVerdict,
      overrideNote: capture?.overrideNote ?? null,
      reviewedByName: actorName(capture?.reviewedBy),
      reviewedAt: capture?.reviewedAt ? capture.reviewedAt.toISOString() : null,
      requestedByName: actorName(capture?.requestedBy),
      requestedAt: capture?.requestedAt ? capture.requestedAt.toISOString() : null,
      effectiveVerdict: overrideVerdict ?? aiVerdict,
      attempts: (capture?.attempts ?? []).map((a) =>
        this.presentAttempt(a),
      ),
    };
  }

  /** Shape one history attempt → CaptureAttempt (signed thumb + actor name). */
  private presentAttempt(a: AttemptWithActor): CaptureAttempt {
    return {
      id: a.id,
      photoUrl: a.storageKey ? this.storage.signedGetUrl(a.storageKey) : null,
      verdict: a.verdict ? toCaptureVerdict(a.verdict) : null,
      aiNotes: a.aiNotes ?? null,
      confidence: a.confidence ?? null,
      capturedAt: a.capturedAt.toISOString(),
      capturedByName: actorName(a.capturedBy),
    };
  }
}

// ----- presenters -----------------------------------------------------------

const TASK_KINDS: readonly TaskKind[] = ['UPLOAD_PHOTO', 'LOG_SALES', 'GENERAL'];
const TASK_STATUSES: readonly TaskStatusDto[] = ['OPEN', 'DONE'];

/** Normalise a 'YYYY-MM-DD' (or today) to a UTC midnight Date for the @db.Date
 *  `soldOn` column, so sales are keyed by day regardless of time-of-day/zone. */
function dayUtc(date?: string): Date {
  if (date) return new Date(`${date}T00:00:00.000Z`);
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** A Date → 'YYYY-MM-DD' (UTC). */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A Task row optionally enriched with the requesting user's read receipt and the
 * completed-by / assigned-to actors. `reads` is pre-filtered to the one user, so
 * a non-empty array means "seen by them". A bare Task (e.g. just created) maps to
 * `seen: false` with no actor names — the honest default.
 */
type TaskWithRelations = Task & {
  reads?: { id: string }[];
  completedBy?: { name: string | null; email: string } | null;
  assignedTo?: { name: string | null; email: string } | null;
};

/** Map a Task row to the shared TaskDto, dates → ISO strings, null preserved. */
export function toTaskDto(t: TaskWithRelations): TaskDto {
  return {
    id: t.id,
    kind: (TASK_KINDS as readonly string[]).includes(t.kind)
      ? (t.kind as TaskKind)
      : 'GENERAL',
    status: (TASK_STATUSES as readonly string[]).includes(t.status)
      ? (t.status as TaskStatusDto)
      : 'OPEN',
    title: t.title,
    body: t.body,
    fixtureKey: t.fixtureKey,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    seen: (t.reads?.length ?? 0) > 0,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    completedByName: t.completedBy
      ? (t.completedBy.name ?? t.completedBy.email)
      : null,
    assignedToName: t.assignedTo
      ? (t.assignedTo.name ?? t.assignedTo.email)
      : null,
    createdAt: t.createdAt.toISOString(),
  };
}

// The DB stores `department` as a free String; narrow it to the Department union
// the UI groups on. Unknown / null → null (un-classified).
const DEPARTMENTS: readonly Department[] = ['The Custom Chef', 'The Cook Shop'];

function toDepartment(value: string | null): Department | null {
  return value && (DEPARTMENTS as readonly string[]).includes(value)
    ? (value as Department)
    : null;
}

// The DB stores fixture `kind` as a plain String; narrow to the FixtureKind
// union the web app switches on. Anything unexpected falls back to "bay".
const FIXTURE_KINDS: readonly FixtureKind[] = [
  'bay',
  'table',
  'stand',
  'window',
  'dais',
  'trolley',
];

function toFixtureKind(kind: string): FixtureKind {
  return (FIXTURE_KINDS as readonly string[]).includes(kind)
    ? (kind as FixtureKind)
    : 'bay';
}

// ----- compliance presenters ------------------------------------------------

/**
 * Where a fixture sits in the capture loop, from its FixtureCapture row:
 *   scored    → the photo has been graded (scoredAt set);
 *   submitted → a photo is uploaded but not yet scored (storageKey set);
 *   todo      → no row, or no photo yet.
 */
function captureState(capture: FixtureCapture | null | undefined): ComplianceState {
  if (capture?.scoredAt) return 'scored';
  if (capture?.storageKey) return 'submitted';
  return 'todo';
}

/** Display name for an actor projection (name → email → null). */
function actorName(
  actor: { name: string | null; email: string } | null | undefined,
): string | null {
  if (!actor) return null;
  return actor.name ?? actor.email;
}

// The DB enum (UPPERCASE) and the @wally/types CaptureVerdict union are the same
// three values; these are the boundary maps so a stray value never leaks.
const CAPTURE_VERDICTS: readonly CaptureVerdictDto[] = ['PASS', 'NEEDS_REVIEW', 'FAIL'];

function toCaptureVerdict(verdict: CaptureVerdict): CaptureVerdictDto {
  return (CAPTURE_VERDICTS as readonly string[]).includes(verdict)
    ? (verdict as CaptureVerdictDto)
    : 'NEEDS_REVIEW';
}

function fromCaptureVerdict(verdict: CaptureVerdictDto): CaptureVerdict {
  switch (verdict) {
    case 'PASS':
      return CaptureVerdict.PASS;
    case 'FAIL':
      return CaptureVerdict.FAIL;
    case 'NEEDS_REVIEW':
    default:
      return CaptureVerdict.NEEDS_REVIEW;
  }
}

/** Map an accepted upload mime to the storage extension (mirrors submission). */
function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '.jpg';
  }
}
