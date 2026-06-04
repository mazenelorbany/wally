import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  UpdatePlacementSchema,
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
}

// Placement edits (drag / resize / rotate on the canvas).
@Controller('placements')
@UseGuards(SessionGuard)
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
}
