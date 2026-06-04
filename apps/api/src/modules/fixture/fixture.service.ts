import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Fixture, FixtureKind } from '@wally/types';

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

  /** The org's fixture library, ordered by name, mapped to the shared contract. */
  async list(orgId: string): Promise<Fixture[]> {
    const fixtures = await this.prisma.fixture.findMany({
      where: { orgId },
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
