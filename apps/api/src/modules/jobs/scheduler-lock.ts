import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';

// =============================================================================
// Postgres advisory scheduler-lock — leader election WITHOUT Redis.
// =============================================================================
//
// Flow uses a Redis SETNX lock so a @Cron fires once across N replicas. Wally is
// TRIMMED (no Redis), so we lean on Postgres' own session/transaction advisory
// locks — the lock lives in the database every replica already shares.
//
// pg_try_advisory_xact_lock(key) takes a non-blocking, transaction-scoped lock:
//   - returns true  → this replica won the election; run the body.
//   - returns false → another replica holds it this tick; skip.
// The lock auto-releases when the surrounding transaction commits/rolls back,
// so there is nothing to clean up and no stuck-lock failure mode if a replica
// crashes mid-tick.
//
// The lock key is a bigint; we hash the human-readable name into one so callers
// pass "chase:tick" instead of magic numbers.
// =============================================================================

const logger = new Logger('SchedulerLock');

/**
 * Run `fn` under a Postgres advisory lock named `name`, but only if this
 * replica acquires the lock this tick. Returns the body's value on success, or
 * `false` when the lock was busy (another replica is running it).
 *
 * The whole thing runs inside ONE transaction so the lock is held for the
 * duration of `fn` and released automatically on commit/rollback.
 */
export async function withSchedulerLock<T>(
  prisma: PrismaService,
  name: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | false> {
  const key = lockKey(name);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${key}) AS locked`,
    );
    if (!rows[0]?.locked) {
      logger.debug(`lock busy: ${name}`);
      return false as const;
    }
    return fn(tx);
  });
}

/**
 * Deterministically map a lock name to a signed 64-bit key. FNV-1a (64-bit)
 * over the name; we keep it inside the signed-bigint range Postgres expects.
 */
function lockKey(name: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < name.length; i++) {
    hash = (hash ^ BigInt(name.charCodeAt(i))) & mask;
    hash = (hash * prime) & mask;
  }
  // Fold the unsigned 64-bit hash into the signed bigint space.
  return hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash;
}
