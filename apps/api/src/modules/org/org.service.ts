import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { UpdateOrgInput } from './org.dto';

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own org, with a light usage rollup. */
  async getCurrent(orgId: string) {
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      include: {
        _count: {
          select: { users: true, stores: true, campaigns: true },
        },
      },
    });
    if (!org) throw new NotFoundException('org not found');
    return org;
  }

  /** Patch name / slug on the caller's own org. */
  async updateCurrent(orgId: string, input: UpdateOrgInput) {
    // Nothing to change — return the current state rather than issuing an
    // empty UPDATE (Prisma would no-op but the round trip is wasteful).
    if (Object.keys(input).length === 0) return this.getCurrent(orgId);

    try {
      await this.prisma.org.update({
        where: { id: orgId },
        data: input,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new NotFoundException('slug already taken');
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException('org not found');
      }
      throw err;
    }
    return this.getCurrent(orgId);
  }
}
