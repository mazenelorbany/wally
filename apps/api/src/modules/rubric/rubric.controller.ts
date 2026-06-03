import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { PublishRubricSchema, type PublishRubricInput } from './rubric.dto';
import { RubricService } from './rubric.service';

// Rubrics hang off a campaign — they are versioned per (campaign, fixture).
@Controller('campaigns/:campaignId/rubrics')
@UseGuards(SessionGuard)
export class RubricController {
  constructor(private readonly rubrics: RubricService) {}

  /**
   * Every rubric version for the campaign. Optionally narrow to one fixture's
   * latest version (?fixtureKey=storefront) — what the scorer needs to grade.
   */
  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Query('fixtureKey') fixtureKey?: string,
  ) {
    if (fixtureKey) {
      return this.rubrics.latestForFixture(user.orgId, campaignId, fixtureKey);
    }
    return this.rubrics.listForCampaign(user.orgId, campaignId);
  }

  /**
   * Publish a new version of (campaign, fixture). Append-only — never mutates an
   * existing rubric. Admins only: this is the compliance standard everyone is
   * graded against.
   */
  @Post()
  @Roles('ADMIN')
  publish(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(PublishRubricSchema)) dto: PublishRubricInput,
  ) {
    return this.rubrics.publish(user.orgId, campaignId, dto);
  }
}
