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
import type { FloorPlan, PlacedFixture, SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  CopyLayoutSchema,
  CreatePlacementSchema,
  UpdatePlacementSchema,
  type CopyLayoutInput,
  type CreatePlacementInput,
  type UpdatePlacementInput,
} from './floorplan.dto';
import { FloorplanService } from './floorplan.service';

// The floor plan for one store × campaign. Lives under `campaigns/...` so the
// route reads naturally; a separate controller (below) owns the `placements`
// prefix for edits, mirroring how the submission module splits its surface.
@Controller('campaigns')
@UseGuards(SessionGuard)
export class FloorplanController {
  constructor(private readonly floorplan: FloorplanService) {}

  @Get(':campaignId/stores/:storeId/floorplan')
  get(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('storeId') storeId: string,
  ) {
    return this.floorplan.get(user.orgId, campaignId, storeId);
  }

  /** Money map: the floor plan recoloured by per-fixture revenue. */
  @Get(':campaignId/stores/:storeId/money-map')
  moneyMap(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('storeId') storeId: string,
  ) {
    return this.floorplan.moneyMap(user.orgId, campaignId, storeId);
  }

  /**
   * Add a fixture to a store's floor plan (the layout builder). Idempotent on
   * (store, campaign, fixture) — re-posting returns the existing placement.
   * Mutating, so VIEWER sessions are rejected (NoViewerGuard).
   */
  @Post(':campaignId/stores/:storeId/placements')
  @UseGuards(NoViewerGuard)
  createPlacement(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(CreatePlacementSchema)) dto: CreatePlacementInput,
  ): Promise<PlacedFixture> {
    return this.floorplan.createPlacement(user.orgId, campaignId, storeId, dto);
  }

  /**
   * Copy another store's whole floor-plan layout onto this one (the target).
   * Idempotent on (store, campaign, fixture) — re-copying overwrites the
   * target's matching placements instead of duplicating. ADMIN only.
   */
  @Post(':campaignId/stores/:storeId/copy-layout')
  @Roles('ADMIN')
  copyLayout(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(CopyLayoutSchema)) dto: CopyLayoutInput,
  ): Promise<FloorPlan> {
    return this.floorplan.copyLayout(
      user.orgId,
      campaignId,
      dto.fromStoreId,
      storeId,
    );
  }

  /**
   * Publish the guide to its stores: stamp `publishedAt` and fan out a
   * "floor plan is ready" task to every store in the campaign's project. ADMIN.
   */
  @Post(':campaignId/publish')
  @Roles('ADMIN')
  publish(
    @CurrentUser() user: SessionUser,
    @Param('campaignId') campaignId: string,
  ): Promise<{ publishedAt: string; notified: number }> {
    return this.floorplan.publish(user.orgId, campaignId);
  }
}

// Placement edits (drag / resize / rotate on the canvas). All mutating, so the
// whole controller blocks the read-only VIEWER role (NoViewerGuard).
@Controller('placements')
@UseGuards(SessionGuard, NoViewerGuard)
export class PlacementController {
  constructor(private readonly floorplan: FloorplanService) {}

  @Patch(':id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePlacementSchema)) dto: UpdatePlacementInput,
  ) {
    return this.floorplan.updatePlacement(user.orgId, id, dto);
  }

  /** Remove a fixture from a store's floor plan (org-scoped). */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.floorplan.deletePlacement(user.orgId, id);
  }
}
