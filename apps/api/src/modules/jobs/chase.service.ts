import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignStatus, CaptureVerdict } from '@prisma/client';
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';

import { PrismaService } from '../../prisma/prisma.service';

import { withSchedulerLock } from './scheduler-lock';

// =============================================================================
// ChaseService — the "where are your photos?" nudge.
// =============================================================================
//
// Once a day it finds stores that are BEHIND on the live floor-plan capture loop
// for an ACTIVE campaign — a store with applicable Placements that aren't yet
// satisfied — and emits one chase per (store, campaign) (logged, and emailed when
// SMTP is configured).
//
// MIGRATED to the live FixtureCapture+Placement pipeline (from the legacy
// Submission/Photo pipeline). A store doing all its work on the floor plan used to
// be invisible to the legacy Submission read and get wrongly chased (or never
// chased); "behind" is now computed from the SAME source the manager floor map
// writes to:
//   EXPECTED  = the store's applicable Placements for an ACTIVE campaign.
//   SATISFIED = a FixtureCapture for that fixture with a photo (storageKey), no
//               outstanding needsPhoto request, and an EFFECTIVE verdict
//               (`overrideVerdict ?? verdict`) of PASS.
//   BEHIND    = ≥1 applicable placement that is NOT satisfied.
// A store whose every applicable placement is PASS is DONE and is never chased.
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
    // A behind store is only chased once the active campaign is at least this
    // many hours old — so a campaign that just went live isn't chased instantly.
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

/** One store that is behind on an active campaign — the unit of a chase. */
interface BehindStore {
  storeName: string;
  storeBrand: string;
  campaignKey: string;
  /** Applicable placements that aren't satisfied yet. */
  outstanding: number;
  /** Total applicable placements (the denominator for the chase line). */
  expected: number;
  /** ADMIN/REVIEWER recipients in the org who opted into chase emails. */
  recipients: string[];
}

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

  /** The actual sweep. Reads behind stores from the capture pipeline, emits one
   *  chase per behind store, returns the count for logging/testing. */
  private async chase(): Promise<number> {
    const cutoff = new Date(Date.now() - this.cfg.afterHours * 60 * 60_000);
    const behind = await this.findBehindStores(cutoff);

    if (behind.length === 0) {
      this.logger.log('chase sweep: no stores behind');
      return 0;
    }

    for (const store of behind) {
      const line =
        `chase: store "${store.storeName}" (${store.storeBrand}) is behind on ` +
        `campaign ${store.campaignKey} — ${store.outstanding} of ` +
        `${store.expected} applicable fixture(s) not yet passing`;
      this.logger.warn(line);

      if (store.recipients.length > 0) {
        await this.email(
          store.recipients,
          store.storeName,
          store.campaignKey,
          line,
        );
      }
    }

    this.logger.log(`chase sweep complete: ${behind.length} store(s) behind`);
    return behind.length;
  }

  /**
   * Find stores that are BEHIND on an ACTIVE campaign via the capture pipeline.
   *
   * Walks each ACTIVE campaign (created before `cutoff` — a just-launched
   * campaign isn't chased yet), and within it each ACTIVE store (closedAt null),
   * computing whether every applicable Placement is SATISFIED by a FixtureCapture
   * (photo present, no outstanding needsPhoto, effective verdict PASS). A store
   * with ≥1 unsatisfied applicable placement is behind. A store with no
   * applicable placements is not behind (nothing to chase).
   */
  private async findBehindStores(cutoff: Date): Promise<BehindStore[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.ACTIVE, createdAt: { lt: cutoff } },
      select: {
        id: true,
        key: true,
        orgId: true,
        org: {
          select: {
            // Recipients = the org's ADMIN/REVIEWER owners who haven't opted out
            // of chase emails (chaseEmails toggled off in Settings suppresses it).
            // Disabled users are excluded too — they shouldn't get nudges.
            users: {
              where: {
                role: { in: ['ADMIN', 'REVIEWER'] },
                chaseEmails: true,
                disabledAt: null,
              },
              select: { email: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const behind: BehindStore[] = [];

    for (const campaign of campaigns) {
      const recipients = campaign.org.users
        .map((u) => u.email)
        .filter(Boolean);

      // The campaign's applicable placements, grouped by store. (A campaign's
      // placements all live in its org; the store filter below keeps closed
      // stores out.) Only ACTIVE stores are chased — a closed store is retired.
      const placements = await this.prisma.placement.findMany({
        where: {
          campaignId: campaign.id,
          applicable: true,
          store: { closedAt: null },
        },
        select: {
          fixtureId: true,
          storeId: true,
          store: { select: { name: true, brand: true } },
        },
      });
      if (placements.length === 0) continue;

      // The captures for this campaign across all its stores, keyed by
      // (storeId, fixtureId) — the unique floor-plan join key.
      const captures = await this.prisma.fixtureCapture.findMany({
        where: { campaignId: campaign.id },
        select: {
          storeId: true,
          fixtureId: true,
          storageKey: true,
          needsPhoto: true,
          verdict: true,
          overrideVerdict: true,
        },
      });
      const captureByKey = new Map(
        captures.map((c) => [`${c.storeId}:${c.fixtureId}`, c]),
      );

      // Roll the placements up per store: count outstanding (unsatisfied) ones.
      const byStore = new Map<
        string,
        { name: string; brand: string; expected: number; outstanding: number }
      >();
      for (const p of placements) {
        const agg =
          byStore.get(p.storeId) ??
          {
            name: p.store.name,
            brand: p.store.brand,
            expected: 0,
            outstanding: 0,
          };
        agg.expected += 1;
        const capture = captureByKey.get(`${p.storeId}:${p.fixtureId}`);
        if (!isSatisfied(capture)) agg.outstanding += 1;
        byStore.set(p.storeId, agg);
      }

      for (const agg of byStore.values()) {
        if (agg.outstanding === 0) continue; // store is done — never chased
        behind.push({
          storeName: agg.name,
          storeBrand: agg.brand,
          campaignKey: campaign.key,
          outstanding: agg.outstanding,
          expected: agg.expected,
          recipients,
        });
      }
    }

    return behind;
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

/** A FixtureCapture narrowed to the satisfaction predicate's inputs. */
interface SatisfactionCapture {
  storageKey: string | null;
  needsPhoto: boolean;
  verdict: CaptureVerdict | null;
  overrideVerdict: CaptureVerdict | null;
}

/**
 * Is an applicable placement SATISFIED (so it needn't be chased)? Yes only when
 * its capture has a photo, no outstanding re-shoot request, and an EFFECTIVE
 * verdict (override beats AI) of PASS. No capture row, a needs-photo flag, a
 * missing photo, or any non-PASS verdict all leave the placement outstanding.
 */
function isSatisfied(capture: SatisfactionCapture | undefined): boolean {
  if (!capture) return false;
  if (capture.needsPhoto) return false;
  if (!capture.storageKey) return false;
  const effective = capture.overrideVerdict ?? capture.verdict;
  return effective === CaptureVerdict.PASS;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
