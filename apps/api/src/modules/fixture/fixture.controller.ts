import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { CreateFixtureSchema, type CreateFixtureInput } from './fixture.dto';
import { FixtureService } from './fixture.service';

// GET  /fixtures  -> the org's fixture library (Fixture[]), ordered by name.
// POST /fixtures  -> add a fixture to the library (ADMIN only).
@Controller('fixtures')
@UseGuards(SessionGuard)
export class FixtureController {
  constructor(private readonly fixtures: FixtureService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.fixtures.list(user.orgId);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateFixtureSchema)) dto: CreateFixtureInput,
  ) {
    return this.fixtures.create(user.orgId, dto);
  }
}
