import { Module } from '@nestjs/common';

import { SubmissionModule } from '../submission/submission.module';

import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({
  imports: [SubmissionModule],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
