import { Module } from '@nestjs/common';

import {
  FloorplanController,
  PlacementController,
} from './floorplan.controller';
import { FloorplanService } from './floorplan.service';

// The floor-plan module. PrismaService is @Global, so nothing to import. Two
// controllers split the surface: the read (campaigns/:id/stores/:id/floorplan)
// and placement edits (placements/:id).
@Module({
  controllers: [FloorplanController, PlacementController],
  providers: [FloorplanService],
  exports: [FloorplanService],
})
export class FloorplanModule {}
