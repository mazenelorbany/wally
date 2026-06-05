import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
  ProductDto,
  SalesLog,
  SessionUser,
  TaskDto,
} from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  LogSaleSchema,
  StoreScopeSchema,
  type LogSaleInput,
  type StoreScopeInput,
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
    @Query(new ZodValidationPipe(StoreScopeSchema)) q: StoreScopeInput,
  ): Promise<SalesLog> {
    return this.manager.sales(user, q.storeId);
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
    return this.manager.logSale(user, productId, body.units, q.storeId);
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
}
