import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  AddFixtureProductSchema,
  CreateFixtureSchema,
  type AddFixtureProductInput,
  type CreateFixtureInput,
} from './fixture.dto';
import { FixtureService } from './fixture.service';

// GET    /fixtures            -> the org's fixture library (Fixture[]).
// POST   /fixtures            -> add a fixture to the library (ADMIN only).
// GET    /fixtures/:id/usage  -> where a fixture is used (stores + guides).
// POST   /fixtures/:id/archive-> soft-delete: hide it, keep placements (ADMIN).
// DELETE /fixtures/:id        -> hard-delete it everywhere (ADMIN).
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

  @Get(':id/usage')
  usage(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.fixtures.usage(user.orgId, id);
  }

  @Post(':id/archive')
  @Roles('ADMIN')
  @HttpCode(204)
  archive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.fixtures.archive(user.orgId, id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.fixtures.remove(user.orgId, id);
  }

  // ----- default products (the fixture's reusable starter set) -------------

  @Get(':id/products')
  listProducts(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.fixtures.listProducts(user.orgId, id);
  }

  @Post(':id/products')
  @Roles('ADMIN')
  @HttpCode(204)
  addProduct(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddFixtureProductSchema))
    dto: AddFixtureProductInput,
  ) {
    return this.fixtures.addProduct(user.orgId, id, dto.productId);
  }

  @Delete(':id/products/:fixtureProductId')
  @Roles('ADMIN')
  @HttpCode(204)
  removeProduct(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('fixtureProductId') fixtureProductId: string,
  ) {
    return this.fixtures.removeProduct(user.orgId, id, fixtureProductId);
  }
}
