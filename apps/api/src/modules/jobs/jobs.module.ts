import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ScoringModule } from '../scoring/scoring.module';
import { StorageModule } from '../storage/storage.module';
import { SubmissionModule } from '../submission/submission.module';

import { ChaseService } from './chase.service';
import { ScoreWorkerService } from './score-worker.service';
import { SnapshotService } from './snapshot.service';

// =============================================================================
// JobsModule — Wally's background workers.
// =============================================================================
//
// Two schedulers, both driven by @nestjs/schedule (registered globally by
// ScheduleModule.forRoot() in AppModule):
//
//   ScoreWorkerService — @Interval(4s) durable-queue consumer. Claims one due
//     ScoreJob with SELECT ... FOR UPDATE SKIP LOCKED and scores its photo.
//   ChaseService       — @Cron(daily) nudge for stores with missing photos,
//     guarded by a Postgres advisory lock so it fires once across replicas.
//
// Imports the providers the workers depend on: ScoringService (ScoringModule),
// StorageService (StorageModule, also @Global), and PrismaService.
// No controllers — these are headless workers with no HTTP surface.
// =============================================================================

@Module({
  imports: [PrismaModule, ScoringModule, StorageModule, SubmissionModule],
  providers: [ScoreWorkerService, ChaseService, SnapshotService],
  exports: [ScoreWorkerService, ChaseService, SnapshotService],
})
export class JobsModule {}
