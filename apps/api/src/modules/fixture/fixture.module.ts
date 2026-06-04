import { Module } from '@nestjs/common';

import { FixtureController } from './fixture.controller';
import { FixtureService } from './fixture.service';

// The fixture library module. PrismaService is @Global, so nothing to import.
// FixtureService is exported so the floorplan / guide-fixture modules can reuse
// the org's fixture vocabulary.
@Module({
  controllers: [FixtureController],
  providers: [FixtureService],
  exports: [FixtureService],
})
export class FixtureModule {}
