import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { Env } from './common/config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { StorageModule } from './modules/storage/storage.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { OrgModule } from './modules/org/org.module';
import { StoreModule } from './modules/store/store.module';
import { CampaignModule } from './modules/campaign/campaign.module';
import { RubricModule } from './modules/rubric/rubric.module';
import { SubmissionModule } from './modules/submission/submission.module';
import { ReviewModule } from './modules/review/review.module';
import { ReportModule } from './modules/report/report.module';
import { FixtureModule } from './modules/fixture/fixture.module';
import { FloorplanModule } from './modules/floorplan/floorplan.module';
import { GuideFixtureModule } from './modules/guide-fixture/guide-fixture.module';
import { ProductModule } from './modules/product/product.module';

@Module({
  imports: [
    // Loads apps/api/.env into process.env. `Env` (zod) is the validated read
    // surface — ConfigModule here is for any code that injects ConfigService.
    ConfigModule.forRoot({ isGlobal: true, cache: true }),

    // Structured logging. pino-pretty only in dev; JSON lines in prod. Never
    // log image bytes — redact auth + cookie headers defensively.
    LoggerModule.forRoot({
      pinoHttp: {
        level: Env.LOG_LEVEL,
        autoLogging: true,
        transport:
          Env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
        formatters: { level: (label: string) => ({ level: label }) },
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),

    // Drives the durable-queue worker tick + any scheduler-lock cron. No Redis
    // / BullMQ in Wally — the ScoreJob table IS the queue (claimed SKIP LOCKED).
    ScheduleModule.forRoot(),

    // Basic per-IP rate limiting. ~120 req/min is generous for an internal
    // reviewer tool; auth + magic-link routes can tighten with @Throttle.
    ThrottlerModule.forRoot([{ name: 'global', ttl: 60_000, limit: 120 }]),

    PrismaModule,

    // The 12 contract modules. Other builders own each module body; this file
    // only wires them in. Order: identity/tenancy first, then domain.
    AuthModule,
    OrgModule,
    StoreModule,
    CampaignModule,
    RubricModule,
    SubmissionModule,
    StorageModule,
    ScoringModule,
    JobsModule,
    ReviewModule,
    ReportModule,
    FixtureModule,
    FloorplanModule,
    GuideFixtureModule,
    ProductModule,
  ],
  providers: [
    // Apply the rate limiter to every controller route by default.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
