import { Injectable, NotFoundException } from '@nestjs/common';
import type { Placement } from '@prisma/client';
import type { FixtureKind, FloorPlan, PlacedFixture } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type { UpdatePlacementInput } from './floorplan.dto';

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
      include: { fixture: { select: { name: true, kind: true } } },
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
      },
      include: { fixture: { select: { name: true, kind: true } } },
    });

    return this.toPlacedFixture(updated);
  }

  // ----- presenters ---------------------------------------------------------

  /** Map a Placement (+ its fixture) to the shared PlacedFixture contract. */
  private toPlacedFixture(
    p: Placement & { fixture: { name: string; kind: string } },
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
    };
  }
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
