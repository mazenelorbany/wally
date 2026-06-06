import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
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
  ReorderFixturePlanogramSchema,
  UpdateFixtureSchema,
  type AddFixtureProductInput,
  type CreateFixtureInput,
  type ReorderFixturePlanogramInput,
  type UpdateFixtureInput,
} from './fixture.dto';
import { FixtureService } from './fixture.service';

// GET    /fixtures            -> the org's fixture library (Fixture[]).
// POST   /fixtures            -> add a fixture to the library (ADMIN only).
// PATCH  /fixtures/:id        -> rename / re-kind / re-classify (ADMIN; 409 on
//                               a name collision).
// GET    /fixtures/:id/usage  -> where a fixture is used (stores + guides).
// POST   /fixtures/:id/archive-> soft-delete: hide it, keep placements (ADMIN).
// DELETE /fixtures/:id        -> hard-delete it (ADMIN; 409 if in use).
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

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateFixtureSchema)) dto: UpdateFixtureInput,
  ) {
    return this.fixtures.update(user.orgId, id, dto);
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
    return this.fixtures.addProduct(user.orgId, id, dto.productId, dto.row);
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

  /** Reorganise the default set into a planogram (shelves + layout) in one shot. */
  @Patch(':id/planogram')
  @Roles('ADMIN')
  reorderPlanogram(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReorderFixturePlanogramSchema))
    dto: ReorderFixturePlanogramInput,
  ) {
    return this.fixtures.reorderPlanogram(user.orgId, id, dto.shelves);
  }
}
