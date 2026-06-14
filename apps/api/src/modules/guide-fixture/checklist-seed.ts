import type { PrismaClient } from '@prisma/client';

/**
 * Copy a fixture's library default checklist (FixtureChecklistTemplate) into
 * the (campaign, fixture) guide sheet when the sheet has never had any items.
 * Sheets created before the defaults were authored — or via paths that skip
 * inheritance (e.g. planogram sync's render-on-read create) — pick the
 * standard up on the next read instead of staying blank forever.
 *
 * A sheet whose items were all deliberately removed (archived) is left alone:
 * the guard counts archived items too, so re-reads never resurrect a checklist
 * a reviewer chose to clear. Returns the number of items seeded (0 = no-op).
 */
export async function seedChecklistFromTemplates(
  prisma: PrismaClient,
  orgId: string,
  campaignId: string,
  fixtureId: string,
): Promise<number> {
  const sheet = await prisma.guideFixture.findUnique({
    where: { campaignId_fixtureId: { campaignId, fixtureId } },
    select: {
      id: true,
      orgId: true,
      _count: { select: { checklistItems: true } },
    },
  });
  if (!sheet || sheet.orgId !== orgId || sheet._count.checklistItems > 0) {
    return 0;
  }

  const templates = await prisma.fixtureChecklistTemplate.findMany({
    where: { fixtureId, orgId, archivedAt: null },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { label: true, required: true, order: true },
  });
  if (templates.length === 0) return 0;

  await prisma.guideFixtureChecklistItem.createMany({
    data: templates.map((t) => ({
      orgId,
      guideFixtureId: sheet.id,
      label: t.label,
      required: t.required,
      order: t.order,
    })),
  });
  return templates.length;
}
