import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { ReportSendResult, SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { StoreReportService } from './store-report.service';

const SendReportSchema = z
  .object({
    storeIds: z.array(z.string().min(1)).min(1),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict();
type SendReportInput = z.infer<typeof SendReportSchema>;

// Admin/reviewer reports list + send for a campaign.
@Controller('campaigns')
@UseGuards(SessionGuard)
export class StoreReportController {
  constructor(private readonly reports: StoreReportService) {}

  /** GET /api/campaigns/:id/reports — the studio reports worklist. */
  @Get(':id/reports')
  @Roles('REVIEWER', 'ADMIN')
  list(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.reports.listForCampaign(user.orgId, id);
  }

  /** POST /api/campaigns/:id/reports/send — assign the report to stores. */
  @Post(':id/reports/send')
  @Roles('ADMIN')
  send(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendReportSchema)) body: SendReportInput,
  ): Promise<ReportSendResult> {
    return this.reports.sendToStores(
      user.orgId,
      id,
      body.storeIds,
      user.id,
      body.dueAt ? new Date(body.dueAt) : null,
    );
  }
}
