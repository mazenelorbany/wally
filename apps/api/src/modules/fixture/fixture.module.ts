import { Module } from '@nestjs/common';

import { FixtureController } from './fixture.controller';
import { FixtureService } from './fixture.service';
import { PlanogramSyncService } from './planogram-sync.service';

// The fixture library module. PrismaService is @Global, so nothing to import.
// FixtureService is exported so the floorplan / guide-fixture modules can reuse
// the org's fixture vocabulary. PlanogramSyncService keeps the library default
// sets and guide-sheet merchandise mirrored, so it's exported for the
// guide-fixture module too.
@Module({
  controllers: [FixtureController],
  providers: [FixtureService, PlanogramSyncService],
  exports: [FixtureService, PlanogramSyncService],
})
export class FixtureModule {}
