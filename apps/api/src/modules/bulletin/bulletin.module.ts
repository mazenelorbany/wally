import { Module } from '@nestjs/common';

import {
  BulletinController,
  BulletinManagerController,
} from './bulletin.controller';
import { BulletinService } from './bulletin.service';

// PrismaService + StorageService are @Global, and NoViewerGuard comes from the
// @Global AuthModule — so nothing to import here.
@Module({
  controllers: [BulletinController, BulletinManagerController],
  providers: [BulletinService],
})
export class BulletinModule {}
