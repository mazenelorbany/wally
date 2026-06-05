import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Fixture,
  FixtureDefaultProduct,
  FixtureKind,
  FixtureUsage,
} from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type { CreateFixtureInput } from './fixture.dto';

// =============================================================================
// FixtureService — the org's fixture library (the reusable catalog of fixture
// types a store can carry: bays, tables, stands, windows, daises, trolleys).
//
// This is the shared vocabulary the CREATE GUIDE pillar builds on: a Placement
// positions one of these on a store's floor plan, and a GuideFixture turns one
// into an instruction sheet. Everything here is org-scoped.
// =============================================================================

@Injectable()
export class FixtureService {
  constructor(private readonly prisma: PrismaService) {}

  /** The org's fixture library, ordered by name, mapped to the shared contract.
   *  Archived fixtures are hidden — they stay in the DB so existing placements
   *  keep working, but they no longer appear in the library. */
  async list(orgId: string): Promise<Fixture[]> {
    const fixtures = await this.prisma.fixture.findMany({
      where: { orgId, archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, kind: true },
    });
    return fixtures.map((f) => ({
      id: f.id,
      name: f.name,
      kind: toFixtureKind(f.kind),
    }));
  }

  /**
   * Add a fixture to the org's library. The (orgId, name) pair is unique, so a
   * duplicate name surfaces as a 409 rather than a raw Prisma error.
   */
  async create(orgId: string, input: CreateFixtureInput): Promise<Fixture> {
    try {
      const created = await this.prisma.fixture.create({
        data: { orgId, name: input.name, kind: input.kind },
        select: { id: true, name: true, kind: true },
      });
      return {
        id: created.id,
        name: created.name,
        kind: toFixtureKind(created.kind),
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `a fixture named "${input.name}" already exists`,
        );
      }
      throw err;
    }
  }

  /**
   * Where a fixture is in use, so the delete dialog can warn before acting:
   * the distinct stores that have it placed on a floor plan, plus how many
   * guides reference it. Org-scoped; 404 if the fixture isn't this org's.
   */
  async usage(orgId: string, id: string): Promise<FixtureUsage> {
    const fixture = await this.prisma.fixture.findFirst({
      where: { id, orgId },
      select: { id: true },
    });
    if (!fixture) throw new NotFoundException('fixture not found');

    const [placements, guideCount] = await Promise.all([
      this.prisma.placement.findMany({
        where: { fixtureId: id, orgId },
        select: { store: { select: { id: true, name: true } } },
        distinct: ['storeId'],
        orderBy: { store: { name: 'asc' } },
      }),
      this.prisma.guideFixture.count({ where: { fixtureId: id, orgId } }),
    ]);

    const stores = placements.map((p) => ({
      id: p.store.id,
      name: p.store.name,
    }));
    return { stores, storeCount: stores.length, guideCount };
  }

  /**
   * Soft-delete: hide the fixture from the library but keep its placements and
   * guide entries intact (reversible). Org-scoped; 404 if not found.
   */
  async archive(orgId: string, id: string): Promise<void> {
    const res = await this.prisma.fixture.updateMany({
      where: { id, orgId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('fixture not found');
  }

  /**
   * Hard-delete: remove the fixture and everything that hangs off it
   * (placements, guide fixtures + their merchandise/example images, captures —
   * all `onDelete: Cascade`). Org-scoped; 404 if not found.
   */
  async remove(orgId: string, id: string): Promise<void> {
    const res = await this.prisma.fixture.deleteMany({ where: { id, orgId } });
    if (res.count === 0) throw new NotFoundException('fixture not found');
  }

  // ----- default products (the reusable starter set) -----------------------

  /** The fixture's default product set, in planogram order. */
  async listProducts(
    orgId: string,
    fixtureId: string,
  ): Promise<FixtureDefaultProduct[]> {
    await this.ensureOwned(orgId, fixtureId);
    const rows = await this.prisma.fixtureProduct.findMany({
      where: { fixtureId, orgId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { product: true },
    });
    return rows.map((r) => ({
      fixtureProductId: r.id,
      id: r.product.id,
      sku: r.product.sku,
      name: r.product.name,
      brand: r.product.brand ?? undefined,
      category: r.product.category ?? undefined,
      color: r.product.color ?? undefined,
      imageUrl: r.product.imageUrl ?? undefined,
      row: r.row,
    }));
  }

  /** Add a product to the fixture's default set (idempotent on re-add). */
  async addProduct(
    orgId: string,
    fixtureId: string,
    productId: string,
  ): Promise<void> {
    await this.ensureOwned(orgId, fixtureId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, orgId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('product not found');

    const last = await this.prisma.fixtureProduct.findFirst({
      where: { fixtureId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    try {
      await this.prisma.fixtureProduct.create({
        data: { orgId, fixtureId, productId, order },
      });
    } catch (err) {
      // Already in the set — adding twice is a no-op, not an error.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  /** Remove a product from the fixture's default set. */
  async removeProduct(
    orgId: string,
    fixtureId: string,
    fixtureProductId: string,
  ): Promise<void> {
    const res = await this.prisma.fixtureProduct.deleteMany({
      where: { id: fixtureProductId, fixtureId, orgId },
    });
    if (res.count === 0) {
      throw new NotFoundException('default product not found');
    }
  }

  /** Guard: the fixture must belong to the caller's org (else 404). */
  private async ensureOwned(orgId: string, fixtureId: string): Promise<void> {
    const f = await this.prisma.fixture.findFirst({
      where: { id: fixtureId, orgId },
      select: { id: true },
    });
    if (!f) throw new NotFoundException('fixture not found');
  }
}

// The DB stores `kind` as a plain String (default "bay"); the shared contract
// narrows it to the FixtureKind union. Anything unexpected falls back to "bay"
// rather than emitting a value outside the union the web app switches on.
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
