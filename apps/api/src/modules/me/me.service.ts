import { Injectable, NotFoundException } from '@nestjs/common';
import type { MePreferences, SessionUser } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type { UpdateMePreferencesInput } from './me.dto';

// =============================================================================
// MeService — the signed-in user's own account preferences.
//
// Home for self-service prefs that aren't role-specific. Today: chaseEmails, the
// admin/reviewer opt-out for the daily "store still owes photos" chase email
// (ChaseService filters its recipient query by this flag). Always scoped to the
// caller's own row — there is no cross-user surface here.
// =============================================================================
@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in user's preferences. */
  async getPreferences(user: SessionUser): Promise<MePreferences> {
    const row = await this.prisma.user.findFirst({
      where: { id: user.id, orgId: user.orgId },
      select: { chaseEmails: true },
    });
    if (!row) throw new NotFoundException('user not found');
    return { chaseEmails: row.chaseEmails };
  }

  /** Patch the signed-in user's preferences. */
  async updatePreferences(
    user: SessionUser,
    input: UpdateMePreferencesInput,
  ): Promise<MePreferences> {
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(input.chaseEmails !== undefined
          ? { chaseEmails: input.chaseEmails }
          : {}),
      },
      select: { chaseEmails: true },
    });
    return { chaseEmails: row.chaseEmails };
  }
}
