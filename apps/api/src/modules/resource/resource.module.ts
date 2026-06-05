import { Module } from '@nestjs/common';

import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';

// PrismaService + StorageService are @Global, and NoViewerGuard comes from the
// @Global AuthModule — so nothing to import here.
@Module({
  controllers: [ResourceController],
  providers: [ResourceService],
})
export class ResourceModule {}
