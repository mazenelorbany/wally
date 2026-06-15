import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ReviewThreadDto, SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  CreateThreadSchema,
  type CreateThreadInput,
  ListThreadsSchema,
  type ListThreadsInput,
  ReplySchema,
  type ReplyInput,
} from './review-thread.dto';
import { ReviewThreadService } from './review-thread.service';

/**
 * Review conversations on a store's report. Opening and resolving are
 * moderator moves (ADMIN/REVIEWER); replying is open to the store's manager
 * too (service-enforced); listing is org-scoped with managers locked to their
 * own store.
 */
@Controller('report-threads')
@UseGuards(SessionGuard)
export class ReviewThreadController {
  constructor(private readonly threads: ReviewThreadService) {}

  /** Threads for one store × campaign (manager: own store; storeId optional). */
  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(ListThreadsSchema)) q: ListThreadsInput,
  ): Promise<ReviewThreadDto[]> {
    return this.threads.list(user, q.campaignId, q.storeId);
  }

  /** Open a thread on a fixture step or question answer (first comment rides along). */
  @Post()
  @Roles('REVIEWER', 'ADMIN')
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateThreadSchema)) dto: CreateThreadInput,
  ): Promise<ReviewThreadDto> {
    return this.threads.create(user, dto);
  }

  /** Reply (admin/reviewer anywhere; the store's manager on their own threads). */
  @Post(':id/comments')
  reply(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReplySchema)) dto: ReplyInput,
  ): Promise<ReviewThreadDto> {
    return this.threads.reply(user, id, dto);
  }

  /** Mark the conversation handled. */
  @Post(':id/resolve')
  @Roles('REVIEWER', 'ADMIN')
  resolve(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<ReviewThreadDto> {
    return this.threads.setResolved(user, id, true);
  }

  /** Reopen a resolved conversation. */
  @Post(':id/reopen')
  @Roles('REVIEWER', 'ADMIN')
  reopen(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<ReviewThreadDto> {
    return this.threads.setResolved(user, id, false);
  }
}
