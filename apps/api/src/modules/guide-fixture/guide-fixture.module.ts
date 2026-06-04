import { Module } from '@nestjs/common';

import { ProductModule } from '../product/product.module';

import {
  GuideFixtureController,
  GuideFixtureDetailController,
} from './guide-fixture.controller';
import { GuideFixtureService } from './guide-fixture.service';

// PrismaService and StorageService are both @Global, so no explicit imports are
// needed for them. The two controllers split the surface: the detail read
// (campaigns/:campaignId/fixtures/:fixtureId/detail) and the by-id mutations
// (guide-fixtures/:id ...). ProductModule is imported only so the shared
// catalog mapper lives in one place; PrismaService is what does the work here.
@Module({
  imports: [ProductModule],
  controllers: [GuideFixtureDetailController, GuideFixtureController],
  providers: [GuideFixtureService],
  exports: [GuideFixtureService],
})
export class GuideFixtureModule {}
