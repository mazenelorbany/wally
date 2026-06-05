import { Module } from '@nestjs/common';

import {
  CampaignQueueController,
  PhotoBlobController,
  PhotoController,
  StoreScoreController,
  SubmissionController,
} from './submission.controller';
import { SubmissionService } from './submission.service';

// PrismaService and StorageService are both @Global, so no explicit imports are
// needed here. The four controllers split the surface: capture (submissions),
// queue (campaigns/:id/queue), per-store score (stores/:id/store-score), and the
// public signed-photo blob (photos/blob/:token).
@Module({
  controllers: [
    SubmissionController,
    CampaignQueueController,
    StoreScoreController,
    PhotoBlobController,
    PhotoController,
  ],
  providers: [SubmissionService],
  exports: [SubmissionService],
})
export class SubmissionModule {}
