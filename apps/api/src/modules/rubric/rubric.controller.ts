import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';
import { MAX_IMAGE_BYTES } from '../storage/image-upload.util';

import {
  ActivateRubricSchema,
  type ActivateRubricInput,
  PublishRubricSchema,
  type PublishRubricInput,
} from './rubric.dto';
import { RubricService } from './rubric.service';

// In-memory upload — the buffer goes straight to StorageService.put(). Same cap
// as every other image upload in the app.
const IMAGE_UPLOAD = { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } };

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

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

  /**
   * Upload a reference/standard image for a fixture's rubric (multipart, field
   * `file`). Returns the storage key + a signed preview URL; the editor then
   * hands `referenceKey` to publish. ADMIN.
   */
  @Post('reference-image')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD))
  uploadReferenceImage(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() _body: unknown,
  ) {
    return this.rubrics.uploadReferenceImage(user.orgId, campaignId, file);
  }

  /**
   * Activate a specific version for one fixture (= roll back to / promote it) —
   * flips the live grading pointer without publishing anything new. ADMIN.
   */
  @Post(':fixtureKey/activate')
  @Roles('ADMIN')
  activate(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('fixtureKey') fixtureKey: string,
    @Body(new ZodValidationPipe(ActivateRubricSchema)) dto: ActivateRubricInput,
  ) {
    return this.rubrics.activate(
      user.orgId,
      campaignId,
      fixtureKey,
      dto.version,
    );
  }
}
