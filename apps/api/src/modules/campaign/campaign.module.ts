import { Module } from '@nestjs/common';

import { SubmissionModule } from '../submission/submission.module';

import { CampaignController } from './campaign.controller';
import { CampaignQuestionService } from './campaign-question.service';
import { CampaignService } from './campaign.service';

@Module({
  imports: [SubmissionModule],
  controllers: [CampaignController],
  providers: [CampaignService, CampaignQuestionService],
  exports: [CampaignService, CampaignQuestionService],
})
export class CampaignModule {}
