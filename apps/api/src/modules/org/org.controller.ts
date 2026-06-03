import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';

import { UpdateOrgSchema, type UpdateOrgInput } from './org.dto';
import { OrgService } from './org.service';
import { ZodValidationPipe } from './zod-validation.pipe';

@Controller('org')
@UseGuards(SessionGuard)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  /** The current tenant — derived from the session, never from the path. */
  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.org.getCurrent(user.orgId);
  }

  @Patch()
  @Roles('ADMIN')
  update(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(UpdateOrgSchema)) dto: UpdateOrgInput,
  ) {
    return this.org.updateCurrent(user.orgId, dto);
  }
}
