import { Module } from '@nestjs/common';

import { ReportController } from './report.controller';
import { ReportService } from './report.service';

// PrismaService (@Global) is the only injected dependency. The report renders
// verdict TEXT, never image bytes, so StorageService isn't needed here — and the
// store/fixture rollup it relies on comes from the pure scoring functions
// (imported directly), not the ScoringService provider. Kept import-free so the
// module boots regardless of ScoringModule's wiring state.
@Module({
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
