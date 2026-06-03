import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service';

// Global so any module (submission upload, scoring worker, report export) can
// inject StorageService without re-importing StorageModule everywhere.
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
