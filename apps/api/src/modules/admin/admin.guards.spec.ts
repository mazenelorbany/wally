import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@wally/types';

import { AdminService } from './admin.service';

// Unit tests for the two tenant/lifecycle guards added in this batch:
//  1) inviteUser refuses to touch a user owned by another org (409), and never
//     mints a magic link for it.
//  2) updateUser refuses a demote/disable that would remove the org's last
//     active admin (409).
// Prisma + AuthService are mocked; we assert only the guard branches.

type PrismaMock = {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  session: { deleteMany: ReturnType<typeof vi.fn> };
};

function makeService() {
  const prisma: PrismaMock = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    session: { deleteMany: vi.fn() },
  };
  const auth = { issueMagicLink: vi.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AdminService(prisma as any, auth as any);
  return { service, prisma, auth };
}

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const actor: SessionUser = {
  id: 'admin-1',
  email: 'admin@org-a.test',
  name: 'Admin One',
  role: Role.ADMIN,
  orgId: ORG_A,
};

describe('AdminService.inviteUser — cross-tenant guard', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it('409s when the email belongs to another org and never issues a link', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ orgId: ORG_B });

    await expect(
      ctx.service.inviteUser(ORG_A, {
        email: 'victim@org-b.test',
        role: 'REVIEWER',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(ctx.prisma.user.upsert).not.toHaveBeenCalled();
    expect(ctx.auth.issueMagicLink).not.toHaveBeenCalled();
  });

  it('allows an in-org (re-)invite and normalizes the email', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ orgId: ORG_A });
    ctx.prisma.user.upsert.mockResolvedValue({
      id: 'u1',
      email: 'teammate@org-a.test',
      name: null,
      role: Role.REVIEWER,
      storeId: null,
      disabledAt: null,
      store: null,
    });

    await ctx.service.inviteUser(ORG_A, {
      email: '  Teammate@Org-A.test ',
      role: 'REVIEWER',
    });

    // Email normalized (trim + lowercase) for both the lookup and the upsert.
    expect(ctx.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'teammate@org-a.test' },
      select: { orgId: true },
    });
    expect(ctx.prisma.user.upsert).toHaveBeenCalledOnce();
    expect(ctx.auth.issueMagicLink).toHaveBeenCalledOnce();
  });

  it('allows a brand-new email (no existing user)', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue(null);
    ctx.prisma.user.upsert.mockResolvedValue({
      id: 'u2',
      email: 'new@org-a.test',
      name: null,
      role: Role.ADMIN,
      storeId: null,
      disabledAt: null,
      store: null,
    });

    await expect(
      ctx.service.inviteUser(ORG_A, { email: 'new@org-a.test', role: 'ADMIN' }),
    ).resolves.toMatchObject({ email: 'new@org-a.test' });
    expect(ctx.auth.issueMagicLink).toHaveBeenCalledOnce();
  });
});

describe('AdminService.updateUser — last-admin guard', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  const targetAdmin = { id: 'admin-2', role: Role.ADMIN, disabledAt: null };

  it('refuses demoting the last active admin (count 0)', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue(targetAdmin);
    ctx.prisma.user.count.mockResolvedValue(0);

    await expect(
      ctx.service.updateUser(actor, targetAdmin.id, { role: 'REVIEWER' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses disabling the last active admin (count 0)', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue(targetAdmin);
    ctx.prisma.user.count.mockResolvedValue(0);

    await expect(
      ctx.service.updateUser(actor, targetAdmin.id, { disabled: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows demoting an admin when another active admin remains', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue(targetAdmin);
    ctx.prisma.user.count.mockResolvedValue(1);
    ctx.prisma.user.update.mockResolvedValue({
      id: targetAdmin.id,
      email: 'admin2@org-a.test',
      name: null,
      role: Role.REVIEWER,
      storeId: null,
      disabledAt: null,
      store: null,
    });

    await expect(
      ctx.service.updateUser(actor, targetAdmin.id, { role: 'REVIEWER' }),
    ).resolves.toMatchObject({ role: Role.REVIEWER });
    expect(ctx.prisma.user.update).toHaveBeenCalledOnce();
  });

  it('does not run the last-admin guard for non-admin or non-stripping changes', async () => {
    // Target is a reviewer being given a store — guard must not fire.
    ctx.prisma.user.findFirst.mockResolvedValue({
      id: 'rev-1',
      role: Role.REVIEWER,
      disabledAt: null,
    });
    ctx.prisma.user.update.mockResolvedValue({
      id: 'rev-1',
      email: 'rev@org-a.test',
      name: null,
      role: Role.REVIEWER,
      storeId: 'store-1',
      disabledAt: null,
      store: { name: 'Store One' },
    });

    await ctx.service.updateUser(actor, 'rev-1', { storeId: 'store-1' });
    expect(ctx.prisma.user.count).not.toHaveBeenCalled();
    expect(ctx.prisma.user.update).toHaveBeenCalledOnce();
  });

  it('still blocks self role/access changes (pre-existing guard)', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue({
      id: actor.id,
      role: Role.ADMIN,
      disabledAt: null,
    });

    await expect(
      ctx.service.updateUser(actor, actor.id, { role: 'REVIEWER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.prisma.user.count).not.toHaveBeenCalled();
  });
});
