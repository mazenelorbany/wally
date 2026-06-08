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
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  CreateProductSchema,
  ProductFilterSchema,
  UpdateProductSchema,
  type CreateProductInput,
  type ProductFilterInput,
  type UpdateProductInput,
} from './product.dto';
import { ProductService } from './product.service';

// GET    /products             -> the org's catalog (filtered; archived hidden).
// POST   /products             -> add a product (ADMIN; 409 on duplicate sku).
// PATCH  /products/:id          -> edit a product (ADMIN; 409 on a sku collision).
// POST   /products/:id/archive  -> soft-delete: leave the working catalog (ADMIN).
// POST   /products/:id/unarchive-> restore an archived product (ADMIN).
// DELETE /products/:id          -> hard-delete (ADMIN; 409 if merchandised/sold).
@Controller('products')
@UseGuards(SessionGuard)
export class ProductController {
  constructor(private readonly products: ProductService) {}

  /**
   * The org's merchandising catalog for the product picker, with optional
   * ?search=&brand=&category=&color=&includeArchived= filters. Returns
   * ProductDto[] (capped).
   */
  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(ProductFilterSchema)) filters: ProductFilterInput,
  ) {
    return this.products.list(user.orgId, filters);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateProductSchema)) dto: CreateProductInput,
  ) {
    return this.products.create(user.orgId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProductSchema)) dto: UpdateProductInput,
  ) {
    return this.products.update(user.orgId, id, dto);
  }

  /** Soft-delete: hide from the working catalog, keep merchandise/sales. ADMIN. */
  @Post(':id/archive')
  @Roles('ADMIN')
  archive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.products.archive(user.orgId, id);
  }

  /** Restore an archived product back into the working catalog. ADMIN. */
  @Post(':id/unarchive')
  @Roles('ADMIN')
  unarchive(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.products.unarchive(user.orgId, id);
  }

  /** Hard-delete a product. ADMIN; 409 if merchandised or it has logged sales. */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.products.remove(user.orgId, id);
  }
}
