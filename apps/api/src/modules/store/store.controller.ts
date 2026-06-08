import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  CreateStoreSchema,
  type CreateStoreInput,
  UpdateStoreSchema,
  type UpdateStoreInput,
} from './store.dto';
import { StoreService } from './store.service';

@Controller('stores')
@UseGuards(SessionGuard)
export class StoreController {
  constructor(private readonly stores: StoreService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.stores.list(user.orgId);
  }

  /**
   * The org's existing DISTINCT segmentation values, for the directory's
   * combobox datalists. Declared before `:id` so the literal path wins.
   */
  @Get('segments')
  segments(@CurrentUser() user: SessionUser) {
    return this.stores.segments(user.orgId);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateStoreSchema)) dto: CreateStoreInput,
  ) {
    return this.stores.create(user.orgId, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.stores.get(user.orgId, id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateStoreSchema)) dto: UpdateStoreInput,
  ) {
    return this.stores.update(user.orgId, id, dto);
  }

  /** Deactivate (retire) a store — stamps closedAt=now. ADMIN. */
  @Post(':id/deactivate')
  @Roles('ADMIN')
  deactivate(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.stores.deactivate(user.orgId, id);
  }

  /** Reactivate a closed store — clears closedAt. ADMIN. */
  @Post(':id/reactivate')
  @Roles('ADMIN')
  reactivate(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.stores.reactivate(user.orgId, id);
  }

  /** The fixture checklist for a store, optionally filtered to one campaign. */
  @Get(':id/fixtures')
  fixtures(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.stores.fixtures(user.orgId, id, campaignId);
  }
}
