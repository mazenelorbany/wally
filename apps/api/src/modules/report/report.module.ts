import { Module } from '@nestjs/common';

import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportSummaryService } from './report-summary.service';
import { ReviewThreadController } from './review-thread.controller';
import { ReviewThreadService } from './review-thread.service';
import { StoreReportController } from './store-report.controller';
import { StoreReportService } from './store-report.service';

// PrismaService (@Global) is the only injected dependency. The report renders
// verdict TEXT, never image bytes, so StorageService isn't needed here — and the
// store/fixture rollup it relies on comes from the pure scoring functions
// (imported directly), not the ScoringService provider. Kept import-free so the
// module boots regardless of ScoringModule's wiring state. StoreReportService is
// the submittable-report envelope (score + flags + submit), exported for the
// manager surface to compose.
@Module({
  controllers: [ReportController, StoreReportController, ReviewThreadController],
  providers: [
    ReportService,
    StoreReportService,
    ReportSummaryService,
    ReviewThreadService,
  ],
  exports: [ReportService, StoreReportService],
})
export class ReportModule {}
