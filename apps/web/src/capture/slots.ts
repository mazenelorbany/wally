// =============================================================================
// Slot model for the capture checklist.
//
// A "slot" is one fixture the store manager must photograph. Its state is the
// merge of two sources of truth:
//   • the server Submission (photos already uploaded + scored), and
//   • the local capture queue (captures taken on THIS device, maybe still
//     pending/uploading because we were offline).
// The queue wins for liveness (a just-shot photo shows instantly), the server
// wins once an upload lands. "Skipped" lives only client-side until submit.
// =============================================================================

import type { Submission, SubmissionPhoto } from '@wally/sdk';
import type { QueuedUpload } from '../lib/idb';
import { humanizeKey } from '../lib/format';

export type SlotState =
  | 'todo' // no photo yet
  | 'queued' // captured locally, waiting to upload (offline / in line)
  | 'uploading' // upload in flight
  | 'error' // upload failed after retries
  | 'uploaded' // on the server, not yet scored
  | 'scored' // on the server with a verdict
  | 'skipped'; // manager marked "don't have it"

export interface Slot {
  fixtureKey: string;
  label: string;
  state: SlotState;
  /** Server photo, when present. */
  photo?: SubmissionPhoto;
  /** Local queue item, when present. */
  queued?: QueuedUpload;
  /** Local object URL for instant preview of a just-captured photo. */
  localPreviewUrl?: string;
}

/**
 * Build the ordered slot list for a submission. `fixtureKeys` is the campaign's
 * required checklist (so empty fixtures still show as `todo`); when omitted we
 * derive the keys from whatever photos/queue items exist.
 */
export function buildSlots(args: {
  submission: Submission | undefined;
  fixtureKeys: string[] | undefined;
  queued: QueuedUpload[];
  skipped: Set<string>;
  previews: Record<string, string>;
}): Slot[] {
  const { submission, fixtureKeys, queued, skipped, previews } = args;

  const byKeyServer = new Map<string, SubmissionPhoto>();
  for (const p of submission?.photos ?? []) byKeyServer.set(p.fixtureKey, p);

  const byKeyQueue = new Map<string, QueuedUpload>();
  for (const q of queued) {
    // Keep the most recent queue item per fixture.
    const existing = byKeyQueue.get(q.fixtureKey);
    if (!existing || q.createdAt > existing.createdAt) byKeyQueue.set(q.fixtureKey, q);
  }

  const keys =
    fixtureKeys && fixtureKeys.length
      ? fixtureKeys
      : dedupe([
          ...(submission?.photos ?? []).map((p) => p.fixtureKey),
          ...queued.map((q) => q.fixtureKey),
        ]);

  return keys.map((fixtureKey) => {
    const photo = byKeyServer.get(fixtureKey);
    const q = byKeyQueue.get(fixtureKey);
    const state = resolveState({
      fixtureKey,
      photo,
      queued: q,
      skipped: skipped.has(fixtureKey),
    });
    return {
      fixtureKey,
      label: humanizeKey(fixtureKey),
      state,
      photo,
      queued: q,
      localPreviewUrl: previews[fixtureKey],
    };
  });
}

function resolveState(args: {
  fixtureKey: string;
  photo?: SubmissionPhoto;
  queued?: QueuedUpload;
  skipped: boolean;
}): SlotState {
  const { photo, queued, skipped } = args;

  // An in-flight / pending local capture is the freshest truth.
  if (queued && queued.status !== 'done') {
    if (queued.status === 'uploading') return 'uploading';
    if (queued.status === 'error') return 'error';
    return 'queued';
  }

  if (photo) {
    return photo.score ? 'scored' : 'uploaded';
  }

  // Local upload finished but the server submission hasn't refetched yet.
  if (queued && queued.status === 'done') return 'uploaded';

  if (skipped) return 'skipped';
  return 'todo';
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

export function isComplete(slot: Slot): boolean {
  return (
    slot.state === 'uploaded' ||
    slot.state === 'scored' ||
    slot.state === 'skipped'
  );
}

export function slotProgress(slots: Slot[]): { done: number; total: number } {
  return { done: slots.filter(isComplete).length, total: slots.length };
}
