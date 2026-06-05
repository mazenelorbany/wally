import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import type { ProjectDto, ProjectKind, SessionUser } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type { CreateProjectInput } from './project.dto';

// =============================================================================
// ProjectService — the admin's top-level containers.
//
// A Project groups venues (Stores) and the guide (Campaign) they're set up
// against: a Myer RETAIL programme, an Ambiente TRADESHOW, … Each project's
// "active campaign" is its ACTIVE Campaign, else its most-recent one — the
// standard the venues are built to and checked against.
//
// Everything is org-scoped: a project is only ever read/created within the
// caller's org, and all roll-up counts are constrained to that project's own
// stores + its active campaign so one project's progress never bleeds into
// another's.
// =============================================================================

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every project in the caller's org as a ProjectDto: its active campaign, its
   * venue count, and setup progress (applicable placements vs captured photos)
   * across the project's stores for that campaign. RETAIL first, then by name.
   */
  async list(user: SessionUser): Promise<ProjectDto[]> {
    const projects = await this.prisma.project.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ name: 'asc' }],
    });

    const dtos = await Promise.all(
      projects.map((p) => this.toProjectDto(p)),
    );

    // RETAIL before TRADESHOW, then alphabetical (the findMany already sorted by
    // name, so a stable sort on kind keeps name order within each band).
    dtos.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
    return dtos;
  }

  /** One project as a ProjectDto, scoped to the caller's org (404 otherwise). */
  async get(user: SessionUser, id: string): Promise<ProjectDto> {
    const project = await this.prisma.project.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!project) throw new NotFoundException('project not found');
    return this.toProjectDto(project);
  }

  /** The project's venues (stores) — the real venue list, regardless of submissions. */
  async venues(
    user: SessionUser,
    id: string,
  ): Promise<{ storeId: string; storeName: string }[]> {
    const project = await this.prisma.project.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('project not found');
    const stores = await this.prisma.store.findMany({
      where: { projectId: id, orgId: user.orgId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return stores.map((s) => ({ storeId: s.id, storeName: s.name }));
  }

  /**
   * Create a project (ADMIN only). The slug is the kebab-case of the name, made
   * unique per org by appending -2, -3, … on collision. Returns its ProjectDto.
   */
  async create(user: SessionUser, input: CreateProjectInput): Promise<ProjectDto> {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('only admins can create projects');
    }

    const base = kebabCase(input.name) || 'project';
    const slug = await this.uniqueSlug(user.orgId, base);

    const project = await this.prisma.project.create({
      data: {
        orgId: user.orgId,
        name: input.name,
        slug,
        kind: input.kind,
      },
    });
    return this.toProjectDto(project);
  }

  // ----- helpers ------------------------------------------------------------

  /**
   * Find a slug not already used in the org. Tries `base`, then `base-2`,
   * `base-3`, … Done in a small loop (projects per org are few); the DB
   * @@unique(orgId, slug) is the final guard against a race.
   */
  private async uniqueSlug(orgId: string, base: string): Promise<string> {
    const taken = await this.prisma.project.findMany({
      where: { orgId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
      select: { slug: true },
    });
    const used = new Set(taken.map((t) => t.slug));
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  /**
   * The project's "active" campaign: its ACTIVE campaign, else its most-recent.
   * Scoped to the project (campaign.projectId === project.id) — null if the
   * project has no campaign yet.
   */
  private async activeCampaign(projectId: string) {
    const active = await this.prisma.campaign.findFirst({
      where: { projectId, status: CampaignStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true, name: true },
    });
    if (active) return active;
    return this.prisma.campaign.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true, name: true },
    });
  }

  /** Map a Project row to the shared ProjectDto, resolving its roll-up counts. */
  private async toProjectDto(project: {
    id: string;
    name: string;
    slug: string;
    kind: string;
  }): Promise<ProjectDto> {
    const campaign = await this.activeCampaign(project.id);

    // Venues = the project's stores. Computed even with no campaign.
    const venueCount = await this.prisma.store.count({
      where: { projectId: project.id },
    });

    // Setup progress only has meaning against a campaign (the guide). With no
    // campaign yet, totals are zero rather than counting the wrong thing.
    let fixturesTotal = 0;
    let fixturesCaptured = 0;
    if (campaign) {
      const storeIds = (
        await this.prisma.store.findMany({
          where: { projectId: project.id },
          select: { id: true },
        })
      ).map((s) => s.id);

      if (storeIds.length > 0) {
        [fixturesTotal, fixturesCaptured] = await Promise.all([
          // Applicable placements across the project's stores for the campaign.
          this.prisma.placement.count({
            where: {
              storeId: { in: storeIds },
              campaignId: campaign.id,
              applicable: true,
            },
          }),
          // Captures that have reached submitted or scored (a photo is stored).
          this.prisma.fixtureCapture.count({
            where: {
              storeId: { in: storeIds },
              campaignId: campaign.id,
              storageKey: { not: null },
            },
          }),
        ]);
      }
    }

    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      kind: toProjectKind(project.kind),
      campaignId: campaign?.id ?? null,
      campaignKey: campaign?.key ?? null,
      campaignName: campaign?.name ?? null,
      venueCount,
      fixturesTotal,
      fixturesCaptured,
    };
  }
}

// ----- presenters / utils ----------------------------------------------------

const PROJECT_KINDS: readonly ProjectKind[] = ['RETAIL', 'TRADESHOW'];

function toProjectKind(kind: string): ProjectKind {
  return (PROJECT_KINDS as readonly string[]).includes(kind)
    ? (kind as ProjectKind)
    : 'RETAIL';
}

/** RETAIL sorts before TRADESHOW; anything else after both. */
function kindRank(kind: ProjectKind): number {
  return kind === 'RETAIL' ? 0 : kind === 'TRADESHOW' ? 1 : 2;
}

/** kebab-case a name for use as a slug: lower, alnum runs joined by hyphens. */
function kebabCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
