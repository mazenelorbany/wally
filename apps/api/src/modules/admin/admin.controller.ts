import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AdminTaskDto, SessionUser, TaskDto } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  BulkCreateTaskSchema,
  type BulkCreateTaskInput,
  CreateTaskSchema,
  type CreateTaskInput,
  InviteUserSchema,
  type InviteUserInput,
  UpdateTaskSchema,
  type UpdateTaskInput,
  UpdateUserSchema,
  type UpdateUserInput,
} from './admin.dto';
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
  @Roles('ADMIN')
  createTask(
    @CurrentUser() user: SessionUser,
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: CreateTaskInput,
  ): Promise<TaskDto> {
    return this.admin.createTask(user, storeId, body);
  }

  /** Assign one task to many stores at once (the bulk "assign to all"). */
  @Post('tasks/bulk')
  @Roles('ADMIN')
  bulkCreateTasks(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(BulkCreateTaskSchema)) body: BulkCreateTaskInput,
  ): Promise<{ created: number }> {
    return this.admin.bulkCreateTasks(user, body);
  }

  /** List the org's tasks (optionally one store) for the Studio task view. */
  @Get('tasks')
  @Roles('ADMIN')
  listTasks(
    @CurrentUser() user: SessionUser,
    @Query('storeId') storeId?: string,
  ): Promise<AdminTaskDto[]> {
    return this.admin.listTasks(user.orgId, storeId);
  }

  /** Edit a task: title / body / due date / status. */
  @Patch('tasks/:id')
  @Roles('ADMIN')
  updateTask(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) body: UpdateTaskInput,
  ): Promise<TaskDto> {
    return this.admin.updateTask(user, id, body);
  }

  /** Cancel (delete) a mistaken task. */
  @Delete('tasks/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  deleteTask(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.admin.deleteTask(user.orgId, id);
  }

  // ----- user & role management (ADMIN) ------------------------------------

  @Get('users')
  @Roles('ADMIN')
  listUsers(@CurrentUser() user: SessionUser) {
    return this.admin.listUsers(user.orgId);
  }

  @Post('users/invite')
  @Roles('ADMIN')
  invite(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(InviteUserSchema)) body: InviteUserInput,
  ) {
    return this.admin.inviteUser(user.orgId, body);
  }

  @Patch('users/:id')
  @Roles('ADMIN')
  updateUser(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: UpdateUserInput,
  ) {
    return this.admin.updateUser(user, id, body);
  }

  /** Hard-delete a user. ADMIN; org-scoped; can't delete self or the last admin. */
  @Delete('users/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  deleteUser(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.admin.deleteUser(user, id);
  }
}
