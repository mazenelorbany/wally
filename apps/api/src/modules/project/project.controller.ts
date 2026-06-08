import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ProjectDto, SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  CreateProjectSchema,
  UpdateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from './project.dto';
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

  /**
   * Every project in the caller's org (RETAIL first, then by name). Archived
   * projects are hidden unless `?includeArchived=true` opts them back in.
   */
  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ProjectDto[]> {
    return this.projects.list(user, includeArchived === 'true');
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

  /** Rename a project / change its kind (slug is immutable). ADMIN. */
  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) dto: UpdateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.update(user.orgId, id, dto);
  }

  /** Soft-delete: hide the project from the working list, keep its history. ADMIN. */
  @Post(':id/archive')
  @Roles('ADMIN')
  archive(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<ProjectDto> {
    return this.projects.archive(user.orgId, id);
  }

  /** Restore an archived project back into the working list. ADMIN. */
  @Post(':id/unarchive')
  @Roles('ADMIN')
  unarchive(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<ProjectDto> {
    return this.projects.unarchive(user.orgId, id);
  }

  /**
   * Hard-delete a project. ADMIN; 409 if it still owns stores, campaigns, or
   * bulletins (archive it instead to keep that history).
   */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  remove(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.projects.remove(user.orgId, id);
  }
}
