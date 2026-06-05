import { Module } from '@nestjs/common';

import { ManagerModule } from '../manager/manager.module';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// Admin task-assignment module. Imports ManagerModule only to reuse the shared
// toTaskDto presenter (PrismaService is @Global, so nothing else to import).
@Module({
  imports: [ManagerModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
