import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { Env } from '../common/config/env';

/**
 * Thin wrapper over PrismaClient. Connects on module init, disconnects on
 * destroy, and logs both so a stuck boot is obvious.
 *
 * Prisma 7 takes its runtime connection through a driver adapter rather than
 * the legacy `datasources.db.url` option. PrismaPg wraps node-postgres (`pg`)
 * and accepts the same DATABASE_URL the CLI reads from schema.prisma.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: Env.DATABASE_URL }),
      log:
        Env.NODE_ENV === 'development'
          ? [
              { level: 'warn', emit: 'event' },
              { level: 'error', emit: 'event' },
            ]
          : [{ level: 'error', emit: 'event' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
