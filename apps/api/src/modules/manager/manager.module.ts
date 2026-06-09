import { Module } from '@nestjs/common';

import { CampaignModule } from '../campaign/campaign.module';

import { ComplianceScorer } from './compliance-scorer.service';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';

// The store-manager workspace module. PrismaService and StorageService are both
// @Global, so nothing to import. One controller owns the `manager` prefix; the
// service resolves the (store, campaign) context every surface is scoped to.
// ComplianceScorer is the floor-map image-compare scorer (Gemini + a stub
// fallback), injected so it stays swappable for tests/evals. CampaignModule is
// imported for CampaignQuestionService (the report's extra-question answers).
@Module({
  imports: [CampaignModule],
  controllers: [ManagerController],
  providers: [ManagerService, ComplianceScorer],
  exports: [ManagerService],
})
export class ManagerModule {}
