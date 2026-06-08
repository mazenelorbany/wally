import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  CreateCampaignSchema,
  UpdateCampaignSchema,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from './campaign.dto';
import { CampaignService } from './campaign.service';

@Controller('campaigns')
@UseGuards(SessionGuard)
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.campaigns.list(user.orgId);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateCampaignSchema)) dto: CreateCampaignInput,
  ) {
    return this.campaigns.create(user.orgId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.campaigns.get(user.orgId, id);
  }

  /** Edit a campaign's mutable fields (name / window). key is immutable. */
  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCampaignSchema)) dto: UpdateCampaignInput,
  ) {
    return this.campaigns.update(user.orgId, id, dto);
  }

  /** Promote one campaign to ACTIVE (and close the same project's active one). */
  @Post(':id/activate')
  @Roles('ADMIN')
  setActive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.campaigns.setActive(user.orgId, id);
  }

  /** Close an ACTIVE campaign (ACTIVE → CLOSED). 409 if not ACTIVE. */
  @Post(':id/close')
  @Roles('ADMIN')
  close(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.campaigns.close(user.orgId, id);
  }

  /** Reopen a CLOSED campaign (CLOSED → ACTIVE). 409 if not CLOSED. */
  @Post(':id/reopen')
  @Roles('ADMIN')
  reopen(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.campaigns.reopen(user.orgId, id);
  }

  /** Soft-archive a campaign (from any status); hides it from the list. */
  @Post(':id/archive')
  @Roles('ADMIN')
  archive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.campaigns.archive(user.orgId, id);
  }

  /** Hard-delete a campaign — only when it has no history (else 409). */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.campaigns.remove(user.orgId, id);
  }
}
