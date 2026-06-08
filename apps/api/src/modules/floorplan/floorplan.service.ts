import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TaskKind, TaskStatus, type Placement } from '@prisma/client';
import type {
  Department,
  FixtureKind,
  FloorPlan,
  MoneyFixture,
  MoneyMap,
  PlacedFixture,
} from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type {
  CreatePlacementInput,
  UpdatePlacementInput,
} from './floorplan.dto';

// =============================================================================
// FloorplanService — a store's floor plan for one campaign's guide.
//
// A Placement positions a library Fixture on a store's plan (its x/y/w/h on the
// canvas, rotation, and per-store applicability — "we don't have this here").
// This service reads the whole plan for the store-store-builder UI and applies
// drag/resize edits. Everything is org-scoped: the store + campaign must belong
// to the caller's org, and a placement edit re-checks the placement's orgId.
// =============================================================================

@Injectable()
export class FloorplanService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The floor plan for one store × campaign: every Placement laid out, with the
   * fixture's name folded into the label fallback and its kind carried through.
   * 404 if the store or campaign isn't in the caller's org (no cross-tenant leak).
   */
  async get(
    orgId: string,
    campaignId: string,
    storeId: string,
  ): Promise<FloorPlan> {
    const [store, campaign] = await Promise.all([
      this.prisma.store.findFirst({
        where: { id: storeId, orgId },
        select: { id: true, name: true },
      }),
      this.prisma.campaign.findFirst({
        where: { id: campaignId, orgId },
        select: { id: true, key: true },
      }),
    ]);
    if (!store) throw new NotFoundException('store not found');
    if (!campaign) throw new NotFoundException('campaign not found');

    const placements = await this.prisma.placement.findMany({
      where: { storeId, campaignId, orgId },
      orderBy: { order: 'asc' },
      include: { fixture: { select: { name: true, kind: true, department: true } } },
    });

    return {
      storeId: store.id,
      storeName: store.name,
      campaignId: campaign.id,
      campaignKey: campaign.key,
      placements: placements.map((p) => this.toPlacedFixture(p)),
    };
  }

  /**
   * The money map: the same floor plan, each fixture carrying its period revenue
   * + units + share of the store total. Sales are illustrative until a POS feed
   * lands (flagged so the UI can say so). 404 on cross-tenant store/campaign.
   */
  async moneyMap(
    orgId: string,
    campaignId: string,
    storeId: string,
  ): Promise<MoneyMap> {
    const [store, campaign] = await Promise.all([
      this.prisma.store.findFirst({
        where: { id: storeId, orgId },
        select: { id: true, name: true },
      }),
      this.prisma.campaign.findFirst({
        where: { id: campaignId, orgId },
        select: { id: true, key: true },
      }),
    ]);
    if (!store) throw new NotFoundException('store not found');
    if (!campaign) throw new NotFoundException('campaign not found');

    const placements = await this.prisma.placement.findMany({
      where: { storeId, campaignId, orgId },
      orderBy: { order: 'asc' },
      include: { fixture: { select: { name: true, kind: true, department: true } } },
    });

    // Prefer REAL logged sales when the store has any. SalesEntry rows roll up
    // by their denormalised fixtureId; a fixture with no logged sales reads 0.
    // With zero entries we fall back to the seeded illustrative figures on the
    // placements themselves (flagged so the UI can say "sample data").
    const salesByFixture = await this.prisma.salesEntry.groupBy({
      by: ['fixtureId'],
      where: { storeId, campaignId },
      _sum: { units: true, revenue: true },
    });
    const hasRealSales = salesByFixture.length > 0;
    const realByFixture = new Map<string, { units: number; revenue: number }>();
    for (const row of salesByFixture) {
      if (!row.fixtureId) continue; // entries with no fixture don't map to a tile
      realByFixture.set(row.fixtureId, {
        units: row._sum.units ?? 0,
        revenue: row._sum.revenue ?? 0,
      });
    }

    // The revenue/units a given placement contributes — real sums when present,
    // else its illustrative seed.
    const valuesFor = (p: (typeof placements)[number]) => {
      if (hasRealSales) {
        const real = realByFixture.get(p.fixtureId);
        return { revenue: real?.revenue ?? 0, units: real?.units ?? 0 };
      }
      return { revenue: p.revenue ?? 0, units: p.units ?? 0 };
    };

    const totalRevenue = placements.reduce((a, p) => a + valuesFor(p).revenue, 0);
    const totalUnits = placements.reduce((a, p) => a + valuesFor(p).units, 0);
    const maxRevenue = placements.reduce(
      (m, p) => Math.max(m, valuesFor(p).revenue),
      0,
    );

    const fixtures: MoneyFixture[] = placements.map((p) => {
      const { revenue, units } = valuesFor(p);
      return {
        id: p.id,
        fixtureId: p.fixtureId,
        label: p.label || p.fixture.name,
        kind: toFixtureKind(p.fixture.kind),
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        rotation: p.rotation,
        revenue,
        units,
        sharePct:
          totalRevenue > 0
            ? Math.round((revenue / totalRevenue) * 1000) / 10
            : 0,
        department: toDepartment(p.fixture.department),
      };
    });

    return {
      storeId: store.id,
      storeName: store.name,
      campaignId: campaign.id,
      campaignKey: campaign.key,
      totalRevenue,
      totalUnits,
      maxRevenue,
      illustrative: !hasRealSales,
      fixtures,
    };
  }

  /**
   * Move / resize / rotate one placement. Org-scoped: the placement is loaded by
   * id and its orgId is verified against the caller before any write, so a valid
   * session can't nudge another org's floor plan. Returns the updated fixture.
   */
  async updatePlacement(
    orgId: string,
    placementId: string,
    input: UpdatePlacementInput,
  ): Promise<PlacedFixture> {
    const existing = await this.prisma.placement.findFirst({
      where: { id: placementId, orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('placement not found');

    const updated = await this.prisma.placement.update({
      where: { id: existing.id },
      // Only the fields the client sent — `data` is built from the validated
      // (partial) DTO, so an absent field is left untouched rather than nulled.
      data: {
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.w !== undefined ? { w: input.w } : {}),
        ...(input.h !== undefined ? { h: input.h } : {}),
        ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.applicable !== undefined
          ? { applicable: input.applicable }
          : {}),
      },
      include: { fixture: { select: { name: true, kind: true, department: true } } },
    });

    return this.toPlacedFixture(updated);
  }

  /**
   * Add a fixture to a store's floor plan (the layout builder). Org-scoped: the
   * campaign, store, and fixture must all belong to the caller's org. Geometry
   * + label default (centre of canvas, the fixture's library name); `order`
   * lands after the store's current placements for the campaign.
   *
   * Idempotent on the unique (storeId, campaignId, fixtureId): if the fixture is
   * already placed, the existing row is returned rather than raising a duplicate.
   */
  async createPlacement(
    orgId: string,
    campaignId: string,
    storeId: string,
    input: CreatePlacementInput,
  ): Promise<PlacedFixture> {
    const [store, campaign, fixture] = await Promise.all([
      this.prisma.store.findFirst({
        where: { id: storeId, orgId },
        select: { id: true },
      }),
      this.prisma.campaign.findFirst({
        where: { id: campaignId, orgId },
        select: { id: true },
      }),
      this.prisma.fixture.findFirst({
        where: { id: input.fixtureId, orgId },
        select: { id: true, name: true, kind: true, department: true },
      }),
    ]);
    if (!store) throw new NotFoundException('store not found');
    if (!campaign) throw new NotFoundException('campaign not found');
    if (!fixture) throw new NotFoundException('fixture not found');

    // Already placed? Return it (idempotent) instead of hitting the unique key.
    const existing = await this.prisma.placement.findUnique({
      where: {
        storeId_campaignId_fixtureId: {
          storeId,
          campaignId,
          fixtureId: input.fixtureId,
        },
      },
      include: { fixture: { select: { name: true, kind: true, department: true } } },
    });
    if (existing) return this.toPlacedFixture(existing);

    // New placement lands after the store's current ones for this campaign.
    const max = await this.prisma.placement.aggregate({
      where: { storeId, campaignId, orgId },
      _max: { order: true },
    });
    const order = (max._max.order ?? -1) + 1;

    const created = await this.prisma.placement.create({
      data: {
        orgId,
        storeId,
        campaignId,
        fixtureId: input.fixtureId,
        label: input.label ?? fixture.name,
        x: input.x ?? 440,
        y: input.y ?? 280,
        w: input.w ?? 120,
        h: input.h ?? 80,
        rotation: input.rotation ?? 0,
        applicable: true,
        order,
      },
      include: { fixture: { select: { name: true, kind: true, department: true } } },
    });

    return this.toPlacedFixture(created);
  }

  /**
   * Remove a placement from a floor plan. Org-scoped: the placement is loaded by
   * id and its orgId verified before the delete, so a valid session can't remove
   * another org's fixture. 404 if it isn't the caller's.
   */
  async deletePlacement(orgId: string, placementId: string): Promise<void> {
    const existing = await this.prisma.placement.findFirst({
      where: { id: placementId, orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('placement not found');

    await this.prisma.placement.delete({ where: { id: existing.id } });
  }

  /**
   * Copy a store's whole floor-plan layout onto another store for the same
   * campaign — so a venue's true layout can be reused instead of rebuilt
   * fixture-by-fixture. Org-scoped: campaign + both stores must belong to the
   * caller's org. Idempotent on the unique (storeId, campaignId, fixtureId):
   * a fixture already placed on the target is updated to match the source's
   * geometry / label / order / applicability rather than erroring. Returns the
   * refreshed target floor plan.
   */
  async copyLayout(
    orgId: string,
    campaignId: string,
    fromStoreId: string,
    toStoreId: string,
  ): Promise<FloorPlan> {
    if (fromStoreId === toStoreId) {
      throw new BadRequestException(
        'source and target stores must be different',
      );
    }

    const [campaign, fromStore, toStore] = await Promise.all([
      this.prisma.campaign.findFirst({
        where: { id: campaignId, orgId },
        select: { id: true },
      }),
      this.prisma.store.findFirst({
        where: { id: fromStoreId, orgId },
        select: { id: true },
      }),
      this.prisma.store.findFirst({
        where: { id: toStoreId, orgId },
        select: { id: true },
      }),
    ]);
    if (!campaign) throw new NotFoundException('campaign not found');
    if (!fromStore) throw new NotFoundException('source store not found');
    if (!toStore) throw new NotFoundException('target store not found');

    const source = await this.prisma.placement.findMany({
      where: { storeId: fromStoreId, campaignId, orgId },
      orderBy: { order: 'asc' },
    });

    // Upsert each source placement onto the target, keyed on the existing
    // (storeId, campaignId, fixtureId) unique — so re-copying is a no-op-safe
    // overwrite, never a duplicate-key error. One transaction so the target
    // never half-updates.
    await this.prisma.$transaction(
      source.map((p) =>
        this.prisma.placement.upsert({
          where: {
            storeId_campaignId_fixtureId: {
              storeId: toStoreId,
              campaignId,
              fixtureId: p.fixtureId,
            },
          },
          create: {
            orgId,
            storeId: toStoreId,
            campaignId,
            fixtureId: p.fixtureId,
            label: p.label,
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            rotation: p.rotation,
            applicable: p.applicable,
            order: p.order,
          },
          update: {
            label: p.label,
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            rotation: p.rotation,
            applicable: p.applicable,
            order: p.order,
          },
        }),
      ),
    );

    return this.get(orgId, campaignId, toStoreId);
  }

  /**
   * Publish the guide to its stores: stamp the campaign `publishedAt` and fan a
   * GENERAL "the floor plan is ready" task out to every store in the campaign's
   * project (so each store manager is notified). Org-scoped; 404 cross-tenant.
   *
   * Tasks are created with `skipDuplicates` off (each publish is a fresh notice)
   * but we de-dupe the open notice per store so re-publishing doesn't pile up
   * identical OPEN tasks — an existing OPEN publish task for the store is left
   * as-is and counted as "already notified". Returns the count notified.
   */
  async publish(
    orgId: string,
    campaignId: string,
  ): Promise<{ publishedAt: string; notified: number }> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true, key: true, name: true, projectId: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');

    // The stores to notify: every ACTIVE store in the campaign's project (or,
    // for a project-less campaign, every active project-less store in the org).
    // Closed stores are retired and shouldn't receive a fanned-out task.
    const stores = await this.prisma.store.findMany({
      where: {
        orgId,
        projectId: campaign.projectId,
        closedAt: null,
      },
      select: { id: true },
    });

    const now = new Date();
    const title = `Floor plan published — ${campaign.name}`;
    const body =
      'The floor plan and fixture guide for this campaign are ready. ' +
      'Open your floor plan to review the layout and upload your fixture photos.';

    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id: campaign.id },
        data: { publishedAt: now },
      });

      if (stores.length > 0) {
        // De-dupe: skip stores that already have an OPEN publish task for this
        // campaign so re-publishing doesn't stack identical notices.
        const existing = await tx.task.findMany({
          where: {
            orgId,
            campaignId: campaign.id,
            kind: TaskKind.GENERAL,
            status: TaskStatus.OPEN,
            title,
            storeId: { in: stores.map((s) => s.id) },
          },
          select: { storeId: true },
        });
        const alreadyNotified = new Set(existing.map((t) => t.storeId));
        const fresh = stores.filter((s) => !alreadyNotified.has(s.id));

        if (fresh.length > 0) {
          await tx.task.createMany({
            data: fresh.map((s) => ({
              orgId,
              storeId: s.id,
              campaignId: campaign.id,
              kind: TaskKind.GENERAL,
              status: TaskStatus.OPEN,
              title,
              body,
            })),
          });
        }
      }
    });

    return { publishedAt: now.toISOString(), notified: stores.length };
  }

  // ----- presenters ---------------------------------------------------------

  /** Map a Placement (+ its fixture) to the shared PlacedFixture contract. */
  private toPlacedFixture(
    p: Placement & {
      fixture: { name: string; kind: string; department: string | null };
    },
  ): PlacedFixture {
    return {
      id: p.id,
      fixtureId: p.fixtureId,
      // The placement carries its own label; fall back to the fixture's library
      // name so the canvas never renders a blank tile.
      label: p.label || p.fixture.name,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      rotation: p.rotation,
      applicable: p.applicable,
      kind: toFixtureKind(p.fixture.kind),
      department: toDepartment(p.fixture.department),
    };
  }
}

// The DB stores `department` as a free String; narrow it to the Department union
// the UI groups on. Unknown / null → null (un-classified) rather than a bad value.
const DEPARTMENTS: readonly Department[] = ['The Custom Chef', 'The Cook Shop'];

function toDepartment(value: string | null): Department | null {
  return value && (DEPARTMENTS as readonly string[]).includes(value)
    ? (value as Department)
    : null;
}

// The DB stores fixture `kind` as a plain String; the shared contract narrows it
// to the FixtureKind union the web app switches on. Anything unexpected falls
// back to "bay" rather than emitting an off-union value.
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
