import type { Prisma, Rubric } from '@prisma/client';

// =============================================================================
// Active-version resolution — the single rule for "which rubric version grades
// this fixture right now".
// =============================================================================
//
// A rubric is versioned per (campaignId, fixtureKey). Publishing flags the new
// row `active=true` and clears the flag on its siblings, so the live grading
// standard is an explicit pointer (admins can roll back by re-activating an
// earlier version) instead of "whatever has the highest version".
//
// FALLBACK: legacy/seeded rows predate `active` and are all false. So when no
// version is flagged active we fall back to the HIGHEST version — preserving the
// old "latest wins" behaviour with no data migration. Once any publish/activate
// runs for the pair, the active pointer takes over.
//
// Past Verdicts are NOT affected: each Verdict FKs the exact Rubric row it was
// graded against, so flipping the active pointer never rewrites history.
// =============================================================================

/** A Prisma-like surface with the one model method this helper needs. */
interface RubricFinder {
  rubric: {
    findFirst(args: {
      where: Prisma.RubricWhereInput;
      orderBy?: Prisma.RubricOrderByWithRelationInput;
    }): Promise<Rubric | null>;
  };
}

/**
 * Resolve the live rubric row for (campaignId, fixtureKey): the version flagged
 * `active`, else the highest version. Returns null when the fixture has no
 * rubric at all. `orgId` is optional so the scorer (which has already resolved
 * the campaign) can omit it while the org-scoped API paths pass it.
 */
export async function resolveActiveRubric(
  prisma: RubricFinder,
  where: { campaignId: string; fixtureKey: string; orgId?: string },
): Promise<Rubric | null> {
  const base: Prisma.RubricWhereInput = {
    campaignId: where.campaignId,
    fixtureKey: where.fixtureKey,
    ...(where.orgId ? { orgId: where.orgId } : {}),
  };

  const active = await prisma.rubric.findFirst({
    where: { ...base, active: true },
    // Defensive: if more than one row is somehow active (a bad write), the
    // newest active one wins so we never grade against a stale pointer.
    orderBy: { version: 'desc' },
  });
  if (active) return active;

  // No active pointer (legacy/seeded data) → highest version, as before.
  return prisma.rubric.findFirst({
    where: base,
    orderBy: { version: 'desc' },
  });
}
