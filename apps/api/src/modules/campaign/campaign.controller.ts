import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { CreateCampaignSchema, type CreateCampaignInput } from './campaign.dto';
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

  /** Promote one campaign to ACTIVE (and close any other active one). */
  @Post(':id/activate')
  @Roles('ADMIN')
  setActive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.campaigns.setActive(user.orgId, id);
  }
}
