import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser, TaskDto } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  CreateTaskSchema,
  type CreateTaskInput,
  InviteUserSchema,
  type InviteUserInput,
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
}
