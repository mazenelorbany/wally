import { describe, expect, it } from 'vitest';
import type { Submission } from '@wally/sdk';
import type { QueuedUpload } from '../lib/idb';

import { buildSlots, isComplete, slotProgress } from './slots';

function photo(over: Partial<Submission['photos'][number]> = {}) {
  return {
    id: 'p1',
    fixtureKey: 'front_window',
    status: 'SCORED',
    ...over,
  } as Submission['photos'][number];
}

function queued(over: Partial<QueuedUpload> = {}): QueuedUpload {
  return {
    id: 'q1',
    submissionId: 's1',
    fixtureKey: 'front_window',
    blob: new Blob(['x']),
    filename: 'f.jpg',
    createdAt: 1,
    status: 'pending',
    attempts: 0,
    ...over,
  };
}

const base = {
  submission: undefined as Submission | undefined,
  fixtureKeys: ['front_window', 'end_cap', 'shelf_talker'],
  queued: [] as QueuedUpload[],
  skipped: new Set<string>(),
  previews: {} as Record<string, string>,
};

describe('buildSlots', () => {
  it('renders empty checklist keys as todo', () => {
    const slots = buildSlots(base);
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.state === 'todo')).toBe(true);
  });

  it('reflects a pending local capture as queued (freshest truth)', () => {
    const slots = buildSlots({ ...base, queued: [queued()] });
    expect(slots.find((s) => s.fixtureKey === 'front_window')?.state).toBe('queued');
  });

  it('shows uploading and error states from the queue', () => {
    const up = buildSlots({ ...base, queued: [queued({ status: 'uploading' })] });
    expect(up[0]?.state).toBe('uploading');
    const err = buildSlots({ ...base, queued: [queued({ status: 'error' })] });
    expect(err[0]?.state).toBe('error');
  });

  it('marks a scored server photo as scored', () => {
    const submission = {
      id: 's1',
      storeId: 'st1',
      campaignId: 'c1',
      storeName: 'Store',
      campaignKey: 'MSP2-2026',
      photos: [photo({ score: { overall: 'good' } as never })],
    } as Submission;
    const slots = buildSlots({ ...base, submission });
    expect(slots.find((s) => s.fixtureKey === 'front_window')?.state).toBe('scored');
  });

  it('honours a client-side skip', () => {
    const slots = buildSlots({ ...base, skipped: new Set(['end_cap']) });
    expect(slots.find((s) => s.fixtureKey === 'end_cap')?.state).toBe('skipped');
  });

  it('treats a done-but-not-yet-refetched upload as uploaded', () => {
    const slots = buildSlots({
      ...base,
      queued: [queued({ status: 'done', serverPhotoId: 'p9' })],
    });
    expect(slots[0]?.state).toBe('uploaded');
  });
});

describe('progress', () => {
  it('counts uploaded/scored/skipped as complete', () => {
    const slots = buildSlots({
      ...base,
      queued: [queued({ status: 'done' })],
      skipped: new Set(['end_cap']),
    });
    const { done, total } = slotProgress(slots);
    expect(total).toBe(3);
    expect(done).toBe(2);
    expect(slots.filter(isComplete)).toHaveLength(2);
  });
});
