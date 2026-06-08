import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignStatus, SnapshotSource } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionService } from '../submission/submission.service';

import { withSchedulerLock } from './scheduler-lock';

// =============================================================================
// SnapshotService — the daily compliance time-series.
// =============================================================================
//
// Once a day it captures one ComplianceSnapshot per ACTIVE campaign (the same
// rollup the dashboard shows), so Insights can chart pass-rate / completion
// over time. It also re-captures campaigns CLOSED within the last day, so a
// campaign that closed yesterday still records its final-day point even if it
// was closed outside the in-app lifecycle path. Idempotent: captureSnapshot
// upserts on (campaignId, dateKey), re-running the same day overwrites rather
// than duplicates.
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

  /**
   * Capture one snapshot per ACTIVE campaign, plus any campaign CLOSED within
   * the last day (so its trend records the final-day result and doesn't freeze
   * the morning before close). Returns how many succeeded.
   */
  async capture(): Promise<number> {
    const closedSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        OR: [
          { status: CampaignStatus.ACTIVE },
          {
            status: CampaignStatus.CLOSED,
            closedAt: { gte: closedSince },
          },
        ],
      },
      select: { id: true, orgId: true },
    });
    let n = 0;
    for (const c of campaigns) {
      try {
        // The cron is the canonical author — CRON points are kept over MANUAL.
        await this.submissions.captureSnapshot(c.orgId, c.id, SnapshotSource.CRON);
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
