import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  CampaignQuestionWithAnswer,
  FixtureCompliance,
  FixtureComplianceDetail,
  ManagerFixture,
  ManagerHome,
  ManagerPreferences,
  ManagerReportListItem,
  ProductDto,
  SalesLog,
  SessionUser,
  StoreReportDto,
  StoreReportDocument,
  TaskDto,
} from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import {
  AnswerQuestionSchema,
  type AnswerQuestionInput,
} from '../campaign/campaign-question.dto';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  LogSaleSchema,
  OverrideCaptureSchema,
  SalesQuerySchema,
  StoreScopeSchema,
  TickChecklistSchema,
  UpdatePreferencesSchema,
  type LogSaleInput,
  type OverrideCaptureInput,
  type SalesQueryInput,
  type StoreScopeInput,
  type TickChecklistInput,
  type UpdatePreferencesInput,
} from './manager.dto';
import { ManagerService } from './manager.service';

// In-memory upload — the buffer goes straight to StorageService.put(), never to
// a temp file. 15MB cap mirrors the service-side check (and the submission flow)
// so multer rejects oversized files before fully buffering them.
const PHOTO_UPLOAD = { limits: { fileSize: 15 * 1024 * 1024, files: 1 } };

interface UploadedPhotoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

// =============================================================================
// ManagerController — the signed-in store manager's own store workspace.
//
// Every route resolves a (store, campaign) via ManagerService: a STORE_MANAGER
// gets their own store (the ?storeId query is ignored), while ADMIN/REVIEWER
// may pass ?storeId to view any store in their org (the demo store switcher).
// =============================================================================
@Controller('manager')
@UseGuards(SessionGuard)
export class ManagerController {
  constructor(private readonly manager: ManagerService) {}

  @Get('home')
  home(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<ManagerHome> {
    return this.manager.home(user, q.storeId);
  }

  /** The manager's venue stores (their own + sibling concessions) — the switcher. */
  @Get('stores')
  venueStores(
    @CurrentUser() user: SessionUser,
  ): Promise<{ id: string; name: string }[]> {
    return this.manager.venueStores(user);
  }

  @Get('tasks')
  tasks(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<TaskDto[]> {
    return this.manager.tasks(user, q.storeId);
  }

  @Post('tasks/seen')
  @UseGuards(NoViewerGuard)
  @HttpCode(204)
  markTasksSeen(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<void> {
    return this.manager.markTasksSeen(user, q.storeId);
  }

  @Post('tasks/:id/complete')
  @UseGuards(NoViewerGuard)
  @HttpCode(204)
  completeTask(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<void> {
    return this.manager.completeTask(user, id, q.storeId);
  }

  /** Reopen a completed task (DONE → OPEN) — recover a mis-tapped completion. */
  @Post('tasks/:id/reopen')
  @UseGuards(NoViewerGuard)
  @HttpCode(204)
  reopenTask(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<void> {
    return this.manager.reopenTask(user, id, q.storeId);
  }

  // ----- preferences --------------------------------------------------------

  /** The signed-in user's notification preferences. */
  @Get('preferences')
  getPreferences(
    @CurrentUser() user: SessionUser,
  ): Promise<ManagerPreferences> {
    return this.manager.getPreferences(user);
  }

  /** Patch the signed-in user's notification preferences. */
  @Patch('preferences')
  @UseGuards(NoViewerGuard)
  updatePreferences(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(UpdatePreferencesSchema))
    body: UpdatePreferencesInput,
  ): Promise<ManagerPreferences> {
    return this.manager.updatePreferences(user, body);
  }

  @Get('fixtures')
  fixtures(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<ManagerFixture[]> {
    return this.manager.fixtures(user, q.storeId);
  }

  @Get('products')
  products(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<ProductDto[]> {
    return this.manager.products(user, q.storeId);
  }

  @Get('sales')
  sales(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(SalesQuerySchema)) q: SalesQueryInput,
  ): Promise<SalesLog> {
    return this.manager.sales(user, q.storeId, q.date);
  }

  @Put('sales/:productId')
  @UseGuards(NoViewerGuard)
  @HttpCode(204)
  logSale(
    @CurrentUser() user: SessionUser,
    @Param('productId') productId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
    @Body(new ZodValidationPipe(LogSaleSchema)) body: LogSaleInput,
  ): Promise<void> {
    return this.manager.logSale(user, productId, body.units, q.storeId, body.date);
  }

  // ----- compliance loop ----------------------------------------------------

  /** The store's floor-map compliance sheet for the active campaign. */
  @Get('compliance')
  compliance(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<FixtureCompliance[]> {
    return this.manager.compliance(user, q.storeId, q.campaignId);
  }

  /** One fixture's compliance sheet: reference, notes, my photo, AI verdict. */
  @Get('fixtures/:fixtureId/compliance')
  fixtureCompliance(
    @CurrentUser() user: SessionUser,
    @Param('fixtureId') fixtureId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<FixtureComplianceDetail> {
    return this.manager.fixtureCompliance(user, fixtureId, q.storeId, q.campaignId);
  }

  /**
   * Upload the manager's photo for a fixture (multipart/form-data, field `file`)
   * and score it synchronously against the guide reference + notes. Returns the
   * post-score compliance sheet.
   */
  @Post('fixtures/:fixtureId/photo')
  @UseGuards(NoViewerGuard)
  @UseInterceptors(FileInterceptor('file', PHOTO_UPLOAD))
  uploadFixturePhoto(
    @CurrentUser() user: SessionUser,
    @Param('fixtureId') fixtureId: string,
    @UploadedFile() file: UploadedPhotoFile | undefined,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<FixtureComplianceDetail> {
    return this.manager.uploadFixturePhoto(
      user,
      fixtureId,
      {
        buffer: file?.buffer as Buffer,
        mimetype: file?.mimetype ?? '',
        size: file?.size ?? 0,
      },
      q.storeId,
      q.campaignId,
    );
  }

  /**
   * Remove one photo from a fixture's gallery (soft-archive) and re-score the
   * remaining set. Returns the updated compliance sheet.
   */
  @Delete('fixtures/:fixtureId/photos/:photoId')
  @UseGuards(NoViewerGuard)
  deleteFixturePhoto(
    @CurrentUser() user: SessionUser,
    @Param('fixtureId') fixtureId: string,
    @Param('photoId') photoId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<FixtureComplianceDetail> {
    return this.manager.deleteFixturePhoto(user, fixtureId, photoId, q.storeId, q.campaignId);
  }

  /**
   * REVIEWER/ADMIN: re-request a photo for a fixture ("redo this") — raises
   * needsPhoto and stamps the requester. Returns the updated compliance sheet.
   */
  @Post('fixtures/:fixtureId/request-photo')
  @Roles('REVIEWER', 'ADMIN')
  requestCapturePhoto(
    @CurrentUser() user: SessionUser,
    @Param('fixtureId') fixtureId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<FixtureComplianceDetail> {
    return this.manager.requestCapturePhoto(user, fixtureId, q.storeId, q.campaignId);
  }

  /**
   * REVIEWER/ADMIN: override a fixture-capture's AI verdict with a human
   * decision (the EFFECTIVE verdict compliance/money-map/UI show). Optional note.
   */
  @Post('fixtures/:fixtureId/override')
  @Roles('REVIEWER', 'ADMIN')
  overrideCapture(
    @CurrentUser() user: SessionUser,
    @Param('fixtureId') fixtureId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
    @Body(new ZodValidationPipe(OverrideCaptureSchema)) body: OverrideCaptureInput,
  ): Promise<FixtureComplianceDetail> {
    return this.manager.overrideCapture(user, fixtureId, body, q.storeId, q.campaignId);
  }

  // ----- report extra questions (text / yes-no / note) ----------------------

  /** The campaign's extra report questions paired with this store's answers. */
  @Get('questions')
  listQuestions(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<CampaignQuestionWithAnswer[]> {
    return this.manager.listQuestions(user, q.storeId, q.campaignId);
  }

  /** Upsert this store's answer to one report question. */
  @Put('questions/:questionId/answer')
  @UseGuards(NoViewerGuard)
  answerQuestion(
    @CurrentUser() user: SessionUser,
    @Param('questionId') questionId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
    @Body(new ZodValidationPipe(AnswerQuestionSchema)) body: AnswerQuestionInput,
  ): Promise<CampaignQuestionWithAnswer[]> {
    return this.manager.answerQuestion(user, questionId, body, q.storeId, q.campaignId);
  }

  // ----- the submittable report ---------------------------------------------

  /** This store's report envelope (status, total score, flags, progress). */
  @Get('report')
  getReport(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<StoreReportDto> {
    return this.manager.getReport(user, q.storeId, q.campaignId);
  }

  /** Submit this store's report (blocks on unanswered required questions). */
  @Post('report/submit')
  @UseGuards(NoViewerGuard)
  submitReport(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<StoreReportDto> {
    return this.manager.submitReport(user, q.storeId, q.campaignId);
  }

  /** The full report document for this store (read-only submitted view). */
  @Get('report/document')
  getReportDocument(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<StoreReportDocument> {
    return this.manager.getReportDocument(user, q.storeId, q.campaignId);
  }

  /** This store's reports across campaigns (current + past) for the Tasks list. */
  @Get('reports')
  listReports(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<ManagerReportListItem[]> {
    return this.manager.listReports(user, q.storeId);
  }

  /** Tick/untick one checklist item on a fixture (part of filling the report). */
  @Put('fixtures/:fixtureId/checklist/:itemId')
  @UseGuards(NoViewerGuard)
  tickChecklist(
    @CurrentUser() user: SessionUser,
    @Param('fixtureId') fixtureId: string,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
    @Body(new ZodValidationPipe(TickChecklistSchema)) body: TickChecklistInput,
  ): Promise<FixtureComplianceDetail> {
    return this.manager.tickChecklist(
      user,
      fixtureId,
      itemId,
      body.checked,
      q.storeId,
      q.campaignId,
    );
  }
}
