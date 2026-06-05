import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { ProjectDto, SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { CreateProjectSchema, type CreateProjectInput } from './project.dto';
import { ProjectService } from './project.service';

// =============================================================================
// ProjectController — the admin's top-level project containers.
//
// All reads are open to any authenticated user (incl. the read-only VIEWER);
// creating a project is ADMIN-only, enforced in the service (a VIEWER or
// REVIEWER gets a 403 there).
// =============================================================================
@Controller('projects')
@UseGuards(SessionGuard)
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  /** Every project in the caller's org (RETAIL first, then by name). */
  @Get()
  list(@CurrentUser() user: SessionUser): Promise<ProjectDto[]> {
    return this.projects.list(user);
  }

  /** One project, scoped to the caller's org (404 across tenants). */
  @Get(':id')
  get(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<ProjectDto> {
    return this.projects.get(user, id);
  }

  /** The project's venues (stores) — the studio's venue list. */
  @Get(':id/venues')
  venues(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<{ storeId: string; storeName: string }[]> {
    return this.projects.venues(user, id);
  }

  /** Create a project (ADMIN only — the service rejects other roles). */
  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateProjectSchema)) dto: CreateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.create(user, dto);
  }
}
