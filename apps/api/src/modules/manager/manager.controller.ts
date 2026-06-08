import {
  Body,
  Controller,
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
  FixtureCompliance,
  FixtureComplianceDetail,
  ManagerFixture,
  ManagerHome,
  ManagerPreferences,
  ProductDto,
  SalesLog,
  SessionUser,
  TaskDto,
} from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  LogSaleSchema,
  OverrideCaptureSchema,
  SalesQuerySchema,
  StoreScopeSchema,
  UpdatePreferencesSchema,
  type LogSaleInput,
  type OverrideCaptureInput,
  type SalesQueryInput,
  type StoreScopeInput,
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
    return this.manager.compliance(user, q.storeId);
  }

  /** One fixture's compliance sheet: reference, notes, my photo, AI verdict. */
  @Get('fixtures/:fixtureId/compliance')
  fixtureCompliance(
    @CurrentUser() user: SessionUser,
    @Param('fixtureId') fixtureId: string,
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<FixtureComplianceDetail> {
    return this.manager.fixtureCompliance(user, fixtureId, q.storeId);
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
    );
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
    return this.manager.requestCapturePhoto(user, fixtureId, q.storeId);
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
    return this.manager.overrideCapture(user, fixtureId, body, q.storeId);
  }
}
