import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  AddMerchandiseSchema,
  type AddMerchandiseInput,
  ReorderPlanogramSchema,
  type ReorderPlanogramInput,
  SaveNotesSchema,
  type SaveNotesInput,
} from './guide-fixture.dto';
import { GuideFixtureService } from './guide-fixture.service';

// The instruction sheet read by fixture, routed under campaigns so the URL reads
// naturally: GET /campaigns/:campaignId/fixtures/:fixtureId/detail. Separate
// controller from GuideFixtureController so it doesn't collide with the
// CampaignController's own `campaigns` routes.
@Controller('campaigns')
@UseGuards(SessionGuard)
export class GuideFixtureDetailController {
  constructor(private readonly guideFixtures: GuideFixtureService) {}

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
}
