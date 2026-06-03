import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';

import { renderReport } from './report.render';
import { ReportService } from './report.service';

@Controller('stores')
@UseGuards(SessionGuard)
export class ReportController {
  constructor(private readonly report: ReportService) {}

  /**
   * Stream a compliance PDF for a store × campaign. Reviewers and admins only —
   * the report aggregates verdicts across the store's fixtures.
   *
   * GET /api/stores/:id/report.pdf?campaignId=...
   */
  @Get(':id/report.pdf')
  @Roles('REVIEWER', 'ADMIN')
  async pdf(
    @CurrentUser() user: SessionUser,
    @Param('id') storeId: string,
    @Query('campaignId') campaignId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!campaignId) {
      throw new BadRequestException('campaignId query param is required');
    }

    // Build the payload first so a 404 (store/campaign not found) is a clean
    // JSON error BEFORE we commit to streaming PDF bytes / headers.
    const data = await this.report.build(user.orgId, storeId, campaignId);

    const filename = `wally-${data.campaign.key}-${slug(data.store.name)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');

    const doc = renderReport(data);
    doc.pipe(res);
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}
