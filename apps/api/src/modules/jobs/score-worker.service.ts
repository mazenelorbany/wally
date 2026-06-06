import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JobStatus, PhotoStatus, Prisma } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';

// =============================================================================
// ScoreWorker — the durable-queue consumer.
// =============================================================================
//
// Wally is TRIMMED: no Redis, no BullMQ. The ScoreJob table IS the queue. Every
// few seconds this worker claims AT MOST ONE due job with Postgres'
// SELECT ... FOR UPDATE SKIP LOCKED inside a transaction, which is safe across
// replicas: two API instances ticking at once never grab the same row.
//
// Lifecycle of one tick:
//   claim   — atomically pick one PENDING job whose runAfter <= now(), mark it
//             RUNNING + stamp lockedAt. SKIP LOCKED steps over rows another
//             replica is mid-claim on, so there's no contention stall.
//   run     — hand the photo to ScoringService.scorePhoto.
//   settle  — DONE on success; on failure bump attempts and either reschedule
//             with capped exponential backoff (attempts < MAX) or give up:
//             FAILED job + FAILED photo (so the UI shows the dead photo).
//
// We process one job per tick on purpose. The cost centre is the vision API
// call; serialising keeps memory flat and the per-request rate predictable.
// SECURITY: never logs image bytes — only ids, attempts, and error messages.
// =============================================================================

const WorkerEnv = z.object({
  // Max attempts before a job is parked as FAILED (initial try + retries).
  WALLY_SCORE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // Base backoff; the nth retry waits BASE * 2^(n-1), capped at MAX.
  WALLY_SCORE_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(15_000),
  WALLY_SCORE_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(300_000),
});

// How long a job may sit RUNNING (lockedAt) before a later tick considers it
// dead and reclaims it. A real score (one vision call) is seconds; a job still
// RUNNING this long means the worker that claimed it crashed or was killed
// mid-score, so the row is requeued to PENDING rather than spinning forever.
// Generously above the worst-case score latency so we never reclaim a job
// that's genuinely still in flight on another replica.
const LOCK_LAPSE_MS = 5 * 60_000; // 5 minutes

/** Row shape returned by the claim query. */
interface ClaimedJob {
  id: string;
  photoId: string;
  attempts: number;
}

@Injectable()
export class ScoreWorkerService {
  private readonly logger = new Logger(ScoreWorkerService.name);
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;

  // In-process guard so a slow tick (a long vision call) never overlaps the
  // next @Interval fire on the SAME replica. Cross-replica safety comes from
  // SKIP LOCKED at the row level, not from this flag.
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
  ) {
    const cfg = WorkerEnv.parse(process.env);
    this.maxAttempts = cfg.WALLY_SCORE_MAX_ATTEMPTS;
    this.backoffBaseMs = cfg.WALLY_SCORE_BACKOFF_BASE_MS;
    this.backoffMaxMs = cfg.WALLY_SCORE_BACKOFF_MAX_MS;
  }

  @Interval('score-worker', 4_000)
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // Reaper: requeue any job stuck RUNNING past the lock-lapse window (its
      // worker crashed mid-score). Cheap bulk UPDATE; runs before each claim so
      // a reclaimed job is immediately eligible to be picked up this same tick.
      await this.reapStale();
      const job = await this.claim();
      if (!job) return; // nothing due — idle tick
      await this.process(job);
    } catch (err) {
      // A failure in claim()/process() bookkeeping itself (e.g. DB blip). Log
      // and let the next tick retry; the job stays RUNNING and will be picked
      // up again once its lock window lapses on a later sweep.
      this.logger.error(`score-worker tick failed: ${errMsg(err)}`);
    } finally {
      this.busy = false;
    }
  }

  // ----- reaper ------------------------------------------------------------

  /**
   * Reclaim jobs stuck RUNNING longer than the lock-lapse window — the worker
   * that claimed them crashed or was killed mid-score, so `lockedAt` (written at
   * claim, never read until now) is stale. Requeue them to PENDING with
   * runAfter=now so the next claim() re-picks them, instead of leaving the photo
   * spinning in SCORING forever. attempts is left as-is so the retry budget
   * (and eventual FAILED parking) still applies to a job that keeps crashing.
   *
   * Bulk + idempotent: a RUNNING job a live worker is still mid-score on has a
   * recent lockedAt and is excluded by the cutoff.
   */
  private async reapStale(): Promise<void> {
    const cutoff = new Date(Date.now() - LOCK_LAPSE_MS);
    const { count } = await this.prisma.scoreJob.updateMany({
      where: { status: JobStatus.RUNNING, lockedAt: { lt: cutoff } },
      data: {
        status: JobStatus.PENDING,
        lockedAt: null,
        runAfter: new Date(),
      },
    });
    if (count > 0) {
      this.logger.warn(
        `reaped ${count} stale RUNNING job(s) (locked > ${Math.round(
          LOCK_LAPSE_MS / 60_000,
        )}m) back to PENDING`,
      );
    }
  }

  // ----- claim -------------------------------------------------------------

  /**
   * Atomically claim one due job. The SELECT ... FOR UPDATE SKIP LOCKED locks
   * exactly one eligible row for the duration of the transaction; the UPDATE
   * flips it to RUNNING so a concurrent claimer (whose SKIP LOCKED already
   * stepped over this row) won't see it as PENDING on its next tick.
   */
  private async claim(): Promise<ClaimedJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id
        FROM "ScoreJob"
        WHERE status = 'PENDING' AND "runAfter" <= now()
        ORDER BY "runAfter" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const id = rows[0]?.id;
      if (!id) return null;

      const job = await tx.scoreJob.update({
        where: { id },
        data: { status: JobStatus.RUNNING, lockedAt: new Date() },
        select: { id: true, photoId: true, attempts: true },
      });
      return job;
    });
  }

  // ----- process -----------------------------------------------------------

  private async process(job: ClaimedJob): Promise<void> {
    try {
      await this.scoring.scorePhoto(job.photoId);
      await this.prisma.scoreJob.update({
        where: { id: job.id },
        data: { status: JobStatus.DONE, lastError: null, lockedAt: null },
      });
      this.logger.debug(`job ${job.id} done (photo ${job.photoId})`);
    } catch (err) {
      await this.fail(job, err);
    }
  }

  /**
   * Settle a failed attempt. If the retry budget remains, reschedule with
   * capped exponential backoff and return the job to PENDING. Otherwise park it
   * FAILED and mark the photo FAILED so the reviewer sees a dead tile instead
   * of an eternally-spinning one.
   */
  private async fail(job: ClaimedJob, err: unknown): Promise<void> {
    const attempts = job.attempts + 1;
    const message = errMsg(err).slice(0, 1000);

    if (attempts < this.maxAttempts) {
      const delay = this.backoffFor(attempts);
      const runAfter = new Date(Date.now() + delay);
      await this.prisma.scoreJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.PENDING,
          attempts,
          lastError: message,
          lockedAt: null,
          runAfter,
        },
      });
      this.logger.warn(
        `job ${job.id} failed (attempt ${attempts}/${this.maxAttempts}), ` +
          `retrying in ${Math.round(delay / 1000)}s: ${message}`,
      );
      return;
    }

    // Out of retries — park both the job and the photo.
    await this.prisma.$transaction([
      this.prisma.scoreJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          attempts,
          lastError: message,
          lockedAt: null,
        },
      }),
      this.prisma.photo.update({
        where: { id: job.photoId },
        data: { status: PhotoStatus.FAILED },
      }),
    ]);
    this.logger.error(
      `job ${job.id} FAILED permanently after ${attempts} attempts ` +
        `(photo ${job.photoId}): ${message}`,
    );
  }

  /** Capped exponential backoff: BASE * 2^(attempt-1), clamped to MAX. */
  private backoffFor(attempt: number): number {
    const raw = this.backoffBaseMs * 2 ** (attempt - 1);
    return Math.min(raw, this.backoffMaxMs);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
