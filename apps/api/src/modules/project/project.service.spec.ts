import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProjectService } from './project.service';

// =============================================================================
// ProjectService CRUD contract — the safety-critical rule for the top-level
// container:
//   DELETE of a project that still OWNS anything (stores, campaigns, or
//   bulletins) is refused with a 409 that steers to Archive — a hard delete
//   would cascade away that whole working tree (floor plans, captures, sales…).
//   Only an EMPTY project (no stores, campaigns, or bulletins) hard-deletes.
// Prisma is mocked at the method boundary (mirrors review.contract.spec.ts /
// product.service.spec.ts).
// =============================================================================

const ORG = 'org_1';
const PROJECT_ID = 'proj_1';

function makePrisma() {
  return {
    project: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    campaign: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    store: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    bulletin: { count: vi.fn(async () => 0) },
    placement: { count: vi.fn(async () => 0) },
    fixtureCapture: { count: vi.fn(async () => 0) },
  };
}

describe('ProjectService CRUD contract', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ProjectService;

  beforeEach(() => {
    prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ProjectService(prisma as any);
  });

  it('DELETE refuses (409) a project that still owns stores', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: PROJECT_ID });
    prisma.store.count.mockResolvedValueOnce(3); // venues still attached
    await expect(service.remove(ORG, PROJECT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('DELETE refuses (409) a project that still owns campaigns', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: PROJECT_ID });
    prisma.campaign.count.mockResolvedValueOnce(1); // a guide period exists
    await expect(service.remove(ORG, PROJECT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('DELETE refuses (409) a project that still owns bulletins', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: PROJECT_ID });
    prisma.bulletin.count.mockResolvedValueOnce(2); // memos exist
    await expect(service.remove(ORG, PROJECT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('DELETE hard-deletes an empty project (no stores, campaigns, or bulletins)', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: PROJECT_ID });
    // all counts default to 0
    prisma.project.delete.mockResolvedValueOnce({ id: PROJECT_ID });
    await service.remove(ORG, PROJECT_ID);
    expect(prisma.project.delete).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
    });
  });

  it('DELETE 404s when the project is not in the caller org', async () => {
    prisma.project.findFirst.mockResolvedValueOnce(null);
    await expect(service.remove(ORG, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('UPDATE 404s when the project is not in the caller org', async () => {
    prisma.project.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.update(ORG, 'nope', { name: 'Renamed' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('UPDATE writes only the fields the caller sent (slug never touched)', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: PROJECT_ID });
    prisma.project.update.mockResolvedValueOnce({
      id: PROJECT_ID,
      name: 'Renamed',
      slug: 'original-slug',
      kind: 'TRADESHOW',
      archivedAt: null,
    });
    const dto = await service.update(ORG, PROJECT_ID, {
      name: 'Renamed',
      kind: 'TRADESHOW',
    });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { name: 'Renamed', kind: 'TRADESHOW' },
    });
    // The update payload carries no `slug` key — the stable key is preserved.
    const arg = prisma.project.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data).not.toHaveProperty('slug');
    expect(dto).toMatchObject({ name: 'Renamed', kind: 'TRADESHOW', slug: 'original-slug' });
  });

  it('ARCHIVE 404s when nothing was updated (wrong org / already archived)', async () => {
    prisma.project.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.archive(ORG, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('UNARCHIVE 404s when nothing was updated (wrong org / not archived)', async () => {
    prisma.project.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.unarchive(ORG, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});
