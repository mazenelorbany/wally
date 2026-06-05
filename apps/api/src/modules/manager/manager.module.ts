import { Module } from '@nestjs/common';

import { ComplianceScorer } from './compliance-scorer.service';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';

// The store-manager workspace module. PrismaService and StorageService are both
// @Global, so nothing to import. One controller owns the `manager` prefix; the
// service resolves the (store, campaign) context every surface is scoped to.
// ComplianceScorer is the floor-map image-compare scorer (Gemini + a stub
// fallback), injected so it stays swappable for tests/evals.
@Module({
  controllers: [ManagerController],
  providers: [ManagerService, ComplianceScorer],
  exports: [ManagerService],
})
export class ManagerModule {}
