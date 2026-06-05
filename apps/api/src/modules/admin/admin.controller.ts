import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { SessionUser, TaskDto } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { CreateTaskSchema, type CreateTaskInput } from './admin.dto';
import { AdminService } from './admin.service';

// =============================================================================
// AdminController — admin-only management actions.
//
// POST /admin/stores/:storeId/tasks assigns a task to a store's manager. The
// SessionGuard authenticates; the service enforces the ADMIN role (403) and the
// in-org store check (404).
// =============================================================================
@Controller('admin')
@UseGuards(SessionGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('stores/:storeId/tasks')
  createTask(
    @CurrentUser() user: SessionUser,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: CreateTaskInput,
  ): Promise<TaskDto> {
    return this.admin.createTask(user, storeId, body);
  }
}
