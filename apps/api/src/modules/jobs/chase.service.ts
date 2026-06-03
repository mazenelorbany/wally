import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignStatus, SubmissionStatus } from '@prisma/client';
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';

import { PrismaService } from '../../prisma/prisma.service';

import { withSchedulerLock } from './scheduler-lock';

// =============================================================================
// ChaseService — the "where are your photos?" nudge.
// =============================================================================
//
// Once a day it finds submissions for ACTIVE campaigns that are still open
// (PENDING / PARTIAL) and were created more than WALLY_CHASE_AFTER_HOURS ago,
// and emits one chase per store (logged, and emailed when SMTP is configured).
//
// Single-fire across replicas: the @Cron fires on every replica, but the body
// runs under a Postgres advisory lock (withSchedulerLock) so exactly one
// replica actually sends the chases — no Redis required (Wally is TRIMMED).
//
// SECURITY: chase emails carry no photo bytes and no PII beyond the store name
// and a campaign key. Recipient addresses come from the org's ADMIN/REVIEWER
// users (the people who own the sweep), not from store-manager uploads.
// =============================================================================

const ChaseEnv = z
  .object({
    // A submission is "overdue" once this many hours have passed since it was
    // created without being SUBMITTED.
    WALLY_CHASE_AFTER_HOURS: z.coerce.number().int().positive().default(48),
    // Mail — mirrors the auth MailService config so a chase can actually send.
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('wally@thecookwarecompany.com'),
    SESSION_COOKIE_SECURE: z.string().optional(), // unused; kept for parity
  })
  .transform((e) => ({
    afterHours: e.WALLY_CHASE_AFTER_HOURS,
    smtpHost: e.SMTP_HOST,
    smtpPort: e.SMTP_PORT,
    smtpUser: e.SMTP_USER && e.SMTP_USER.length ? e.SMTP_USER : undefined,
    smtpPass:
      e.SMTP_PASSWORD && e.SMTP_PASSWORD.length ? e.SMTP_PASSWORD : undefined,
    mailFrom: e.MAIL_FROM,
  }));

@Injectable()
export class ChaseService implements OnModuleInit {
  private readonly logger = new Logger(ChaseService.name);
  private readonly cfg = ChaseEnv.parse(process.env);
  private transporter!: Transporter;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.transporter = nodemailer.createTransport({
      host: this.cfg.smtpHost,
      port: this.cfg.smtpPort,
      secure: false, // Mailhog (dev) has no TLS; a prod relay upgrades via STARTTLS
      ...(this.cfg.smtpUser && this.cfg.smtpPass
        ? { auth: { user: this.cfg.smtpUser, pass: this.cfg.smtpPass } }
        : {}),
    });
  }

  /**
   * Daily at 09:00 (server tz). The @Cron fires on every replica; the advisory
   * lock makes the body run exactly once.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { name: 'chase-missing-photos' })
  async run(): Promise<void> {
    const result = await withSchedulerLock(this.prisma, 'chase:tick', async () =>
      this.chase(),
    );
    if (result === false) {
      this.logger.debug('chase skipped — another replica holds the lock');
    }
  }

  /** The actual sweep. Pure-ish: reads overdue submissions, emits one chase per
   *  store, returns the count for logging/testing. */
  private async chase(): Promise<number> {
    const cutoff = new Date(Date.now() - this.cfg.afterHours * 60 * 60_000);

    // Overdue = an open submission, on a campaign that's still ACTIVE, created
    // before the cutoff. We only chase live sweeps — a CLOSED campaign is done.
    const overdue = await this.prisma.submission.findMany({
      where: {
        status: { in: [SubmissionStatus.PENDING, SubmissionStatus.PARTIAL] },
        createdAt: { lt: cutoff },
        campaign: { status: CampaignStatus.ACTIVE },
      },
      include: {
        store: { select: { name: true, brand: true } },
        campaign: { select: { key: true, name: true } },
        _count: { select: { photos: true } },
        org: {
          select: {
            name: true,
            users: {
              where: { role: { in: ['ADMIN', 'REVIEWER'] } },
              select: { email: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (overdue.length === 0) {
      this.logger.log('chase sweep: no overdue submissions');
      return 0;
    }

    for (const sub of overdue) {
      const line =
        `chase: store "${sub.store.name}" (${sub.store.brand}) has an open ` +
        `submission for campaign ${sub.campaign.key} — status ${sub.status}, ` +
        `${sub._count.photos} photo(s) uploaded, opened ` +
        `${ageInDays(sub.createdAt)}d ago`;
      this.logger.warn(line);

      const recipients = sub.org.users.map((u) => u.email).filter(Boolean);
      if (recipients.length > 0) {
        await this.email(recipients, sub.store.name, sub.campaign.key, line);
      }
    }

    this.logger.log(`chase sweep complete: ${overdue.length} overdue submission(s)`);
    return overdue.length;
  }

  private async email(
    to: string[],
    storeName: string,
    campaignKey: string,
    body: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.cfg.mailFrom,
        to,
        subject: `Wally chase: ${storeName} still owes photos for ${campaignKey}`,
        text: body,
      });
    } catch (err) {
      // A mail outage must not crash the daily sweep — log and carry on.
      this.logger.warn(
        `chase email failed for ${storeName}/${campaignKey}: ${errMsg(err)}`,
      );
    }
  }
}

function ageInDays(from: Date): number {
  return Math.floor((Date.now() - from.getTime()) / (24 * 60 * 60_000));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
