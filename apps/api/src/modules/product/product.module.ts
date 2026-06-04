import { Module } from '@nestjs/common';

import { ProductController } from './product.controller';
import { ProductService } from './product.service';

// PrismaService is @Global, so no explicit import here. ProductService is
// exported so the guide-fixture module can reuse the catalog mapping if needed.
@Module({
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
