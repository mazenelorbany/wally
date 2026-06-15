import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';
import { MAX_IMAGE_BYTES } from '../storage/image-upload.util';

import {
  AddChecklistSchema,
  type AddChecklistInput,
  AddExampleImageSchema,
  type AddExampleImageInput,
  AddMerchandiseSchema,
  type AddMerchandiseInput,
  ReorderChecklistSchema,
  type ReorderChecklistInput,
  ReorderPlanogramSchema,
  type ReorderPlanogramInput,
  SaveInstructionsSchema,
  type SaveInstructionsInput,
  SaveNotesSchema,
  type SaveNotesInput,
  UpdateChecklistSchema,
  type UpdateChecklistInput,
  UpdateExampleImageSchema,
  type UpdateExampleImageInput,
} from './guide-fixture.dto';
import { GuideFixtureService } from './guide-fixture.service';

// In-memory upload — the buffer goes straight to StorageService.put(). 15MB cap
// mirrors every other image upload in the app.
const IMAGE_UPLOAD = { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } };

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

// The instruction sheet read by fixture, routed under campaigns so the URL reads
// naturally: GET /campaigns/:campaignId/fixtures/:fixtureId/detail. Separate
// controller from GuideFixtureController so it doesn't collide with the
// CampaignController's own `campaigns` routes.
@Controller('campaigns')
@UseGuards(SessionGuard)
export class GuideFixtureDetailController {
  constructor(private readonly guideFixtures: GuideFixtureService) {}

  /** The task's photo-request fixtures (the "Build" view list). */
  @Get(':campaignId/fixtures')
  listForCampaign(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
  ) {
    return this.guideFixtures.listForCampaign(user.orgId, campaignId);
  }

  /** The full instruction sheet for one fixture in a guide (render-on-read). */
  @Get(':campaignId/fixtures/:fixtureId/detail')
  detail(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('fixtureId') fixtureId: string,
  ) {
    return this.guideFixtures.detail(user.orgId, campaignId, fixtureId);
  }

  /** Pre-populate the sheet from the fixture's default product set. */
  @Post(':campaignId/fixtures/:fixtureId/prepopulate')
  @UseGuards(NoViewerGuard)
  prepopulate(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('fixtureId') fixtureId: string,
  ) {
    return this.guideFixtures.prepopulateFromDefaults(
      user.orgId,
      campaignId,
      fixtureId,
    );
  }

  /** Add a library fixture to the task as a photo request (places it on every store). */
  @Post(':campaignId/fixtures/:fixtureId/request')
  @UseGuards(NoViewerGuard)
  addRequest(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('fixtureId') fixtureId: string,
  ) {
    return this.guideFixtures.addFixtureToCampaign(user.orgId, campaignId, fixtureId);
  }

  /** Remove a photo request (refused once a store has photographed it). */
  @Delete(':campaignId/fixtures/:fixtureId/request')
  @UseGuards(NoViewerGuard)
  removeRequest(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('fixtureId') fixtureId: string,
  ) {
    return this.guideFixtures.removeFixtureFromCampaign(
      user.orgId,
      campaignId,
      fixtureId,
    );
  }
}

// Mutations addressed by the GuideFixture's own id. All mutating, so the whole
// controller blocks the read-only VIEWER role (NoViewerGuard).
@Controller('guide-fixtures')
@UseGuards(SessionGuard, NoViewerGuard)
export class GuideFixtureController {
  constructor(private readonly guideFixtures: GuideFixtureService) {}

  /** Save the VM notes on a guide-fixture. */
  @Patch(':id')
  saveNotes(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SaveNotesSchema)) dto: SaveNotesInput,
  ) {
    return this.guideFixtures.saveNotes(user.orgId, id, dto.notes);
  }

  /** Replace the ordered instructions list. */
  @Put(':id/instructions')
  saveInstructions(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SaveInstructionsSchema)) dto: SaveInstructionsInput,
  ) {
    return this.guideFixtures.saveInstructions(user.orgId, id, dto.steps);
  }

  /** Add a checklist item to the fixture. */
  @Post(':id/checklist')
  addChecklistItem(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddChecklistSchema)) dto: AddChecklistInput,
  ) {
    return this.guideFixtures.addChecklistItem(
      user.orgId,
      id,
      dto.label,
      dto.required ?? false,
    );
  }

  /** Edit a checklist item. */
  @Patch(':id/checklist/:itemId')
  updateChecklistItem(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(UpdateChecklistSchema)) dto: UpdateChecklistInput,
  ) {
    return this.guideFixtures.updateChecklistItem(user.orgId, id, itemId, dto);
  }

  /** Remove a checklist item (soft-archived if it already has ticks). */
  @Delete(':id/checklist/:itemId')
  removeChecklistItem(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.guideFixtures.removeChecklistItem(user.orgId, id, itemId);
  }

  /** Reorder the checklist items. */
  @Post(':id/checklist/reorder')
  reorderChecklist(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReorderChecklistSchema)) dto: ReorderChecklistInput,
  ) {
    return this.guideFixtures.reorderChecklist(user.orgId, id, dto.ids);
  }

  /** Place a product on the sheet's planogram. */
  @Post(':id/merchandise')
  addMerchandise(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddMerchandiseSchema)) dto: AddMerchandiseInput,
  ) {
    return this.guideFixtures.addMerchandise(user.orgId, id, dto.productId, dto.row);
  }

  /** Remove a placed product from the sheet. */
  @Delete(':id/merchandise/:merchandiseId')
  removeMerchandise(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('merchandiseId') merchandiseId: string,
  ) {
    return this.guideFixtures.removeMerchandise(user.orgId, id, merchandiseId);
  }

  /** Reorder/relabel the whole planogram in one shot (drag-and-drop persistence). */
  @Patch(':id/planogram')
  reorderPlanogram(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReorderPlanogramSchema)) dto: ReorderPlanogramInput,
  ) {
    return this.guideFixtures.reorderPlanogram(user.orgId, id, dto.shelves);
  }

  // ----- example images ("what good looks like") ---------------------------

  /**
   * Upload a reference image for the sheet (multipart, field `file`; optional
   * text field `caption`). Returns the refreshed sheet.
   */
  @Post(':id/example-images')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD))
  addExampleImage(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body(new ZodValidationPipe(AddExampleImageSchema)) dto: AddExampleImageInput,
  ) {
    return this.guideFixtures.addExampleImage(user.orgId, id, file, dto.caption);
  }

  /** Edit an example image's caption. */
  @Patch(':id/example-images/:imageId')
  updateExampleImage(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body(new ZodValidationPipe(UpdateExampleImageSchema))
    dto: UpdateExampleImageInput,
  ) {
    return this.guideFixtures.updateExampleImageCaption(
      user.orgId,
      id,
      imageId,
      dto.caption,
    );
  }

  /** Mark an example image best-in-class (unsets its siblings). */
  @Post(':id/example-images/:imageId/best-in-class')
  setExampleImageBestInClass(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.guideFixtures.setExampleImageBestInClass(
      user.orgId,
      id,
      imageId,
    );
  }

  /** Remove an example image (and clean up its bytes). */
  @Delete(':id/example-images/:imageId')
  removeExampleImage(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.guideFixtures.removeExampleImage(user.orgId, id, imageId);
  }
}
