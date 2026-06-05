import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
  CreateResourceSchema,
  type CreateResourceInput,
  UpdateResourceSchema,
  type UpdateResourceInput,
} from './resource.dto';
import { ResourceService } from './resource.service';

// In-memory upload straight to StorageService; 25 MB cap (PDFs, decks, images).
const ATTACHMENT_UPLOAD = { limits: { fileSize: 25 * 1024 * 1024, files: 1 } };

interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

// The org's training & reference library. GET is open to any signed-in role
// (managers read it); mutations are author-only (NoViewerGuard + service check).
@Controller('resources')
@UseGuards(SessionGuard)
export class ResourceController {
  constructor(private readonly resources: ResourceService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.resources.list(user.orgId);
  }

  @Post()
  @UseGuards(NoViewerGuard)
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD))
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateResourceSchema)) dto: CreateResourceInput,
    @UploadedFile() file: UploadedAttachment | undefined,
  ) {
    return this.resources.create(user, dto, file);
  }

  @Patch(':id')
  @UseGuards(NoViewerGuard)
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateResourceSchema)) dto: UpdateResourceInput,
  ) {
    return this.resources.update(user, id, dto);
  }

  @Delete(':id')
  @UseGuards(NoViewerGuard)
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.resources.remove(user, id);
  }
}
