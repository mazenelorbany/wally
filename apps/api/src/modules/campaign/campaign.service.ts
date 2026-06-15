import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Campaign,
  CampaignStatus,
  Prisma,
  SnapshotSource,
  StoreReportStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionService } from '../submission/submission.service';

import type { CreateCampaignInput, UpdateCampaignInput } from './campaign.dto';

@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionService,
  ) {}

  /**
   * Every (non-archived) campaign in the caller's org, newest first, with a
   * store-coverage count so the list view can show "12 stores" without an N+1.
   * We count the distinct stores that have a submission against the campaign —
   * that's the useful number for a reviewer planning a sweep. Archived
   * campaigns are hidden (they remain reachable via direct id for analytics).
   */
  async list(orgId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { orgId, archivedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        _count: {
          select: { submissions: true, guideFixtures: true, storeReports: true },
        },
      },
    });
    const ids = campaigns.map((c) => c.id);

    // Two cheap group-bys give the "Tasks" cards their content/progress numbers
    // without an N+1: active questions per task, and submitted reports per task.
    const [questionGroups, submittedGroups] = ids.length
      ? await Promise.all([
          this.prisma.campaignQuestion.groupBy({
            by: ['campaignId'],
            where: { campaignId: { in: ids }, archivedAt: null },
            _count: true,
          }),
          this.prisma.storeReport.groupBy({
            by: ['campaignId'],
            where: { campaignId: { in: ids }, status: StoreReportStatus.SUBMITTED },
            _count: true,
          }),
        ])
      : [[], []];
    const questionsBy = new Map(questionGroups.map((g) => [g.campaignId, g._count]));
    const submittedBy = new Map(submittedGroups.map((g) => [g.campaignId, g._count]));

    return campaigns.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      status: c.status,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      createdAt: c.createdAt,
      activatedAt: c.activatedAt,
      closedAt: c.closedAt,
      archivedAt: c.archivedAt,
      // Stores participating in the campaign. Floor-map campaigns track stores
      // via legacy Submission rows; report/task campaigns via StoreReport
      // assignments — counting only submissions left task campaigns reading
      // "0 stores" in the reviewer console even after stores submitted.
      storeCount: Math.max(c._count.submissions, c._count.storeReports),
      // Task-hub fields: what the task contains + how far along it is.
      fixtureCount: c._count.guideFixtures,
      questionCount: questionsBy.get(c.id) ?? 0,
      storesSent: c._count.storeReports,
      storesSubmitted: submittedBy.get(c.id) ?? 0,
    }));
  }

  /** A single campaign, scoped to the caller's org (404 across tenants). */
  async get(orgId: string, campaignId: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
    });
    if (!campaign) throw new NotFoundException('campaign not found');
    return campaign;
  }

  /** Create a DRAFT campaign. key is unique per org (DB @@unique[orgId,key]). */
  async create(orgId: string, input: CreateCampaignInput) {
    try {
      return await this.prisma.campaign.create({
        data: {
          orgId,
          key: input.key,
          name: input.name,
          status: CampaignStatus.DRAFT,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `a campaign with key "${input.key}" already exists`,
        );
      }
      throw err;
    }
  }

  /**
   * Edit a campaign's mutable fields (name / window). `key` is immutable (see
   * UpdateCampaignSchema). Dates are tri-state: omit = unchanged, null = clear,
   * a value = set. We re-validate the order against the *resulting* window so a
   * partial edit can't leave endsAt < startsAt.
   */
  async update(orgId: string, campaignId: string, input: UpdateCampaignInput) {
    const current = await this.get(orgId, campaignId);

    const startsAt =
      input.startsAt === undefined ? current.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
    if (startsAt && endsAt && endsAt < startsAt) {
      throw new ConflictException('endsAt must be on or after startsAt');
    }

    const data: Prisma.CampaignUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.startsAt !== undefined) data.startsAt = input.startsAt;
    if (input.endsAt !== undefined) data.endsAt = input.endsAt;

    return this.prisma.campaign.update({ where: { id: campaignId }, data });
  }

  // ===========================================================================
  // Lifecycle state machine
  // ---------------------------------------------------------------------------
  //   DRAFT  --activate-->  ACTIVE  --close-->  CLOSED  --reopen-->  ACTIVE
  //   any (DRAFT|ACTIVE|CLOSED) --archive--> archived (soft, status untouched)
  //
  // One-active-PER-PROJECT is enforced here in code, not in the DB: Postgres
  // can express it as a partial unique index `(orgId, projectId) WHERE
  // status='ACTIVE'`, but Prisma's schema language has no `@@unique ... WHERE`,
  // so we'd have to hand-write a raw migration the introspection can't round-
  // trip. Reads (manager.resolveCampaign) are project-scoped, so the invariant
  // that matters is "at most one ACTIVE per (orgId, projectId)" — activate and
  // reopen below close only the *same project's* other ACTIVE campaign(s),
  // leaving other projects' live campaigns alone.
  // ===========================================================================

  /** Promote a campaign to ACTIVE (DRAFT or CLOSED → ACTIVE). */
  async setActive(orgId: string, campaignId: string): Promise<Campaign> {
    const campaign = await this.get(orgId, campaignId);
    if (campaign.status === CampaignStatus.ACTIVE) return campaign; // idempotent
    return this.transitionToActive(orgId, campaign);
  }

  /**
   * Reopen a CLOSED campaign back to ACTIVE (applies the same project-scoped
   * close-others rule as activate). Rejects anything that isn't CLOSED.
   */
  async reopen(orgId: string, campaignId: string): Promise<Campaign> {
    const campaign = await this.get(orgId, campaignId);
    if (campaign.status !== CampaignStatus.CLOSED) {
      throw new ConflictException(
        `cannot reopen a ${campaign.status} campaign — only CLOSED campaigns can be reopened`,
      );
    }
    return this.transitionToActive(orgId, campaign);
  }

  /**
   * Shared ACTIVE transition for activate + reopen. Closes the *same project's*
   * other ACTIVE campaigns (handling null projectId explicitly so a project-less
   * campaign only closes other project-less ones), captures a final snapshot for
   * each campaign being auto-closed so its trend doesn't freeze a day early, then
   * stamps the new campaign ACTIVE. Done in a transaction so there's never a
   * window with two ACTIVE campaigns in the same project.
   */
  private async transitionToActive(
    orgId: string,
    campaign: Campaign,
  ): Promise<Campaign> {
    const now = new Date();

    // Same-project predicate: null projectId only collides with other null
    // projectId campaigns; a non-null projectId only with the same project.
    const sameProject: Prisma.CampaignWhereInput =
      campaign.projectId === null
        ? { projectId: null }
        : { projectId: campaign.projectId };

    // Snapshot every campaign we're about to auto-close *before* the status
    // flip, so the last trend point reflects the campaign's final state.
    const closing = await this.prisma.campaign.findMany({
      where: {
        orgId,
        status: CampaignStatus.ACTIVE,
        id: { not: campaign.id },
        ...sameProject,
      },
      select: { id: true },
    });
    await this.snapshotEach(orgId, closing.map((c) => c.id));

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.campaign.updateMany({
        where: {
          orgId,
          status: CampaignStatus.ACTIVE,
          id: { not: campaign.id },
          ...sameProject,
        },
        data: { status: CampaignStatus.CLOSED, closedAt: now },
      });
      return tx.campaign.update({
        where: { id: campaign.id },
        data: { status: CampaignStatus.ACTIVE, activatedAt: now },
      });
    });

    return updated;
  }

  /**
   * Close an ACTIVE campaign (ACTIVE → CLOSED). Captures a final snapshot first
   * so the trend records the campaign's last-day result. DRAFT/CLOSED are
   * rejected (a DRAFT was never live; a CLOSED is already closed).
   */
  async close(orgId: string, campaignId: string): Promise<Campaign> {
    const campaign = await this.get(orgId, campaignId);
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new ConflictException(
        `cannot close a ${campaign.status} campaign — only ACTIVE campaigns can be closed`,
      );
    }
    await this.snapshotEach(orgId, [campaign.id]);
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.CLOSED, closedAt: new Date() },
    });
  }

  /**
   * Archive a campaign (soft, from any status). Hides it from the list while
   * keeping its rows for historical analytics. Idempotent on already-archived.
   */
  async archive(orgId: string, campaignId: string): Promise<Campaign> {
    const campaign = await this.get(orgId, campaignId);
    if (campaign.archivedAt) return campaign;
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { archivedAt: new Date() },
    });
  }

  /**
   * Hard-delete a campaign — only when it has no dependent history
   * (submissions / sales / captures). Otherwise 409 and steer to archive, since
   * deleting would cascade away real compliance and sales data. Use archive for
   * a campaign that's been run; delete is for a mistakenly-created empty one.
   */
  async remove(orgId: string, campaignId: string): Promise<void> {
    const campaign = await this.get(orgId, campaignId); // 404 across tenants
    const [submissions, captures, sales] = await Promise.all([
      this.prisma.submission.count({ where: { campaignId } }),
      this.prisma.fixtureCapture.count({ where: { campaignId } }),
      this.prisma.salesEntry.count({ where: { campaignId } }),
    ]);
    if (submissions > 0 || captures > 0 || sales > 0) {
      throw new ConflictException(
        'campaign has compliance or sales history — archive it instead of deleting',
      );
    }
    await this.prisma.campaign.delete({ where: { id: campaign.id } });
  }

  /**
   * Capture a final ComplianceSnapshot for each campaign id, best-effort.
   * captureSnapshot is idempotent per (campaignId, dateKey), so re-running the
   * same day overwrites rather than duplicates. A snapshot failure must never
   * block a lifecycle transition, so we swallow per-campaign errors.
   */
  private async snapshotEach(orgId: string, campaignIds: string[]) {
    for (const id of campaignIds) {
      try {
        // The final-day point is canonical — write it as CRON so a later manual
        // capture can't clobber it.
        await this.submissions.captureSnapshot(orgId, id, SnapshotSource.CRON);
      } catch {
        // best-effort: a snapshot failure must not block the transition.
      }
    }
  }
}
