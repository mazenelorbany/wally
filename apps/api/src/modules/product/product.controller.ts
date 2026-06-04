import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { ProductFilterSchema, type ProductFilterInput } from './product.dto';
import { ProductService } from './product.service';

@Controller('products')
@UseGuards(SessionGuard)
export class ProductController {
  constructor(private readonly products: ProductService) {}

  /**
   * The org's merchandising catalog for the product picker, with optional
   * ?search=&brand=&category=&color= filters. Returns ProductDto[] (capped).
   */
  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(ProductFilterSchema)) filters: ProductFilterInput,
  ) {
    return this.products.list(user.orgId, filters);
  }
}
