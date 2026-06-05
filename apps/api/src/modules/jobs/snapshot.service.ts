import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionService } from '../submission/submission.service';

import { withSchedulerLock } from './scheduler-lock';

// =============================================================================
// SnapshotService — the daily compliance time-series.
// =============================================================================
//
// Once a day it captures one ComplianceSnapshot per ACTIVE campaign (the same
// rollup the dashboard shows), so Insights can chart pass-rate / completion
// over time. Idempotent: captureSnapshot upserts on (campaignId, dateKey), so
// re-running the same day overwrites rather than duplicates.
//
// Single-fire across replicas via a Postgres advisory lock (withSchedulerLock),
// exactly like ChaseService — no Redis required.
// =============================================================================

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionService,
  ) {}

  /** Daily at 02:00 — quiet hour, before the 9am chase. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'compliance-snapshot' })
  async run(): Promise<void> {
    const result = await withSchedulerLock(this.prisma, 'snapshot:tick', () =>
      this.capture(),
    );
    if (result === false) {
      this.logger.debug('snapshot skipped — another replica holds the lock');
    }
  }

  /** Capture one snapshot per ACTIVE campaign. Returns how many succeeded. */
  async capture(): Promise<number> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.ACTIVE },
      select: { id: true, orgId: true },
    });
    let n = 0;
    for (const c of campaigns) {
      try {
        await this.submissions.captureSnapshot(c.orgId, c.id);
        n += 1;
      } catch (err) {
        this.logger.warn(
          `snapshot failed for campaign ${c.id}: ${(err as Error).message}`,
        );
      }
    }
    if (n > 0) this.logger.log(`captured ${n} compliance snapshot(s)`);
    return n;
  }
}
