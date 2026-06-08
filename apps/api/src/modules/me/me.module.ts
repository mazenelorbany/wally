import { Module } from '@nestjs/common';

import { MeController } from './me.controller';
import { MeService } from './me.service';

// The signed-in user's own account-preferences surface (admin/reviewer Settings).
// PrismaService is @Global, so nothing to import. Owns the `me` route prefix.
@Module({
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
