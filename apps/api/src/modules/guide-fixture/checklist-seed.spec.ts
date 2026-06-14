import { describe, it, expect } from 'vitest';

import { seedChecklistFromTemplates } from './checklist-seed';

// =============================================================================
// seedChecklistFromTemplates — library default checklist → guide sheet.
//
// The helper backfills a sheet that has NEVER had checklist items from the
// fixture's library templates, and must no-op for: a missing sheet, a foreign
// org, a sheet that ever had items (even all-archived — a deliberate clear must
// stay cleared), and a fixture with no active templates.
// =============================================================================

const ORG = 'org_1';
const CAMPAIGN = 'camp_1';
const FIXTURE = 'fix_1';

interface Seed {
  sheet: { id: string; orgId: string; itemCount: number } | null;
  templates: { label: string; required: boolean; order: number }[];
}

function makePrisma(seed: Seed) {
  const created: unknown[] = [];
  const prisma = {
    guideFixture: {
      findUnique: async () =>
        seed.sheet
          ? {
              id: seed.sheet.id,
              orgId: seed.sheet.orgId,
              _count: { checklistItems: seed.sheet.itemCount },
            }
          : null,
    },
    fixtureChecklistTemplate: {
      findMany: async () => seed.templates,
    },
    guideFixtureChecklistItem: {
      createMany: async ({ data }: { data: unknown[] }) => {
        created.push(...data);
        return { count: data.length };
      },
    },
  };
  return { prisma: prisma as never, created };
}

describe('seedChecklistFromTemplates', () => {
  const templates = [
    { label: 'Stock pulled forward', required: false, order: 0 },
    { label: 'Ticketing matches the guide', required: true, order: 1 },
  ];

  it('copies active templates into a sheet that never had items', async () => {
    const { prisma, created } = makePrisma({
      sheet: { id: 'gf_1', orgId: ORG, itemCount: 0 },
      templates,
    });
    const seeded = await seedChecklistFromTemplates(prisma, ORG, CAMPAIGN, FIXTURE);
    expect(seeded).toBe(2);
    expect(created).toEqual([
      { orgId: ORG, guideFixtureId: 'gf_1', label: 'Stock pulled forward', required: false, order: 0 },
      { orgId: ORG, guideFixtureId: 'gf_1', label: 'Ticketing matches the guide', required: true, order: 1 },
    ]);
  });

  it('no-ops when the sheet does not exist', async () => {
    const { prisma, created } = makePrisma({ sheet: null, templates });
    expect(await seedChecklistFromTemplates(prisma, ORG, CAMPAIGN, FIXTURE)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('no-ops for a sheet owned by another org', async () => {
    const { prisma, created } = makePrisma({
      sheet: { id: 'gf_1', orgId: 'org_other', itemCount: 0 },
      templates,
    });
    expect(await seedChecklistFromTemplates(prisma, ORG, CAMPAIGN, FIXTURE)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('no-ops when the sheet ever had items (incl. archived-only)', async () => {
    const { prisma, created } = makePrisma({
      sheet: { id: 'gf_1', orgId: ORG, itemCount: 3 },
      templates,
    });
    expect(await seedChecklistFromTemplates(prisma, ORG, CAMPAIGN, FIXTURE)).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('no-ops when the library has no active templates', async () => {
    const { prisma, created } = makePrisma({
      sheet: { id: 'gf_1', orgId: ORG, itemCount: 0 },
      templates: [],
    });
    expect(await seedChecklistFromTemplates(prisma, ORG, CAMPAIGN, FIXTURE)).toBe(0);
    expect(created).toHaveLength(0);
  });
});
