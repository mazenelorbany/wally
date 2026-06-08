import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  BulletinScopeSchema,
  type BulletinScopeInput,
  CreateBulletinSchema,
  type CreateBulletinInput,
  UpdateBulletinSchema,
  type UpdateBulletinInput,
} from './bulletin.dto';
import { BulletinService } from './bulletin.service';

// In-memory upload straight to StorageService; 20 MB cap (bulletins can be PDFs).
const ATTACHMENT_UPLOAD = { limits: { fileSize: 20 * 1024 * 1024, files: 1 } };

interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

// Admin-facing bulletin routes (project feed + the bulletin's own id).
@Controller()
@UseGuards(SessionGuard)
export class BulletinController {
  constructor(private readonly bulletins: BulletinService) {}

  @Get('projects/:projectId/bulletins')
  list(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.bulletins.list(user.orgId, projectId);
  }

  @Post('projects/:projectId/bulletins')
  @UseGuards(NoViewerGuard)
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD))
  create(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateBulletinSchema)) dto: CreateBulletinInput,
    @UploadedFile() file: UploadedAttachment | undefined,
  ) {
    return this.bulletins.create(user, projectId, dto, file);
  }

  @Patch('bulletins/:id')
  @UseGuards(NoViewerGuard)
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD))
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBulletinSchema)) dto: UpdateBulletinInput,
    @UploadedFile() file: UploadedAttachment | undefined,
  ) {
    return this.bulletins.update(user, id, dto, file);
  }

  @Delete('bulletins/:id')
  @UseGuards(NoViewerGuard)
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.bulletins.remove(user, id);
  }

  @Get('bulletins/:id/acks')
  acks(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.bulletins.acks(user.orgId, id);
  }
}

// Manager-facing routes (their store's project bulletins + acknowledge).
@Controller('manager')
@UseGuards(SessionGuard)
export class BulletinManagerController {
  constructor(private readonly bulletins: BulletinService) {}

  @Get('bulletins')
  mine(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(BulletinScopeSchema)) q: BulletinScopeInput,
  ) {
    return this.bulletins.mine(user, q.storeId);
  }

  @Post('bulletins/:id/ack')
  @UseGuards(NoViewerGuard)
  acknowledge(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(BulletinScopeSchema)) q: BulletinScopeInput,
  ) {
    return this.bulletins.acknowledge(user, id, q.storeId);
  }

  @Delete('bulletins/:id/ack')
  @UseGuards(NoViewerGuard)
  unacknowledge(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(BulletinScopeSchema)) q: BulletinScopeInput,
  ) {
    return this.bulletins.unacknowledge(user, id, q.storeId);
  }
}
