// =============================================================================
// The capture queue — zustand store over the IndexedDB-backed upload list.
//
// Flow: a store manager picks/shoots a photo → `enqueue()` writes the Blob to
// IDB and to this store → `drain()` uploads pending items one at a time via the
// SDK. Items survive reloads (rehydrated from IDB on boot). `online`/`offline`
// events and a manual `drain()` retry stalled uploads. We never JSON-serialise
// the Blob and never log image bytes.
// =============================================================================

import { create } from 'zustand';

import { api, errorMessage } from './api';
import {
  deleteUpload,
  getAllUploads,
  putUpload,
  uuid,
  type QueuedUpload,
} from './idb';

const MAX_ATTEMPTS = 5;

interface CaptureState {
  /** Keyed by local queue-item id. */
  items: Record<string, QueuedUpload>;
  online: boolean;
  /** True while `drain()` is actively uploading. */
  draining: boolean;
  hydrated: boolean;

  /** Load any persisted uploads from IDB (call once on app boot). */
  hydrate: () => Promise<void>;
  /** Persist a new capture and kick off a drain. Returns the queue-item id. */
  enqueue: (input: {
    submissionId: string;
    fixtureKey: string;
    blob: Blob;
    filename: string;
  }) => Promise<string>;
  /** Upload all pending items, oldest first, sequentially. */
  drain: () => Promise<void>;
  /** Drop a queued item (e.g. the user re-shoots before it uploads). */
  remove: (id: string) => Promise<void>;
  /** Reset a failed item back to pending and retry. */
  retry: (id: string) => Promise<void>;
  setOnline: (online: boolean) => void;
}

function patch(
  set: (fn: (s: CaptureState) => Partial<CaptureState>) => void,
  id: string,
  changes: Partial<QueuedUpload>,
): QueuedUpload | undefined {
  let updated: QueuedUpload | undefined;
  set((s) => {
    const prev = s.items[id];
    if (!prev) return {};
    updated = { ...prev, ...changes };
    return { items: { ...s.items, [id]: updated } };
  });
  return updated;
}

export const useCaptureQueue = create<CaptureState>((set, get) => ({
  items: {},
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  draining: false,
  hydrated: false,

  hydrate: async () => {
    const list = await getAllUploads();
    const items: Record<string, QueuedUpload> = {};
    for (const it of list) {
      // A crash mid-upload leaves an item 'uploading'; treat it as pending.
      items[it.id] = it.status === 'uploading' ? { ...it, status: 'pending' } : it;
    }
    set({ items, hydrated: true });
    void get().drain();
  },

  enqueue: async ({ submissionId, fixtureKey, blob, filename }) => {
    const item: QueuedUpload = {
      id: uuid(),
      submissionId,
      fixtureKey,
      blob,
      filename,
      createdAt: Date.now(),
      status: 'pending',
      attempts: 0,
    };
    await putUpload(item);
    set((s) => ({ items: { ...s.items, [item.id]: item } }));
    void get().drain();
    return item.id;
  },

  drain: async () => {
    if (get().draining || !get().online) return;
    set({ draining: true });
    try {
      // Sequential: field connections are fragile; parallel uploads thrash them.
      for (;;) {
        const next = Object.values(get().items)
          .filter((i) => i.status === 'pending')
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next || !get().online) break;

        const uploading = patch(set, next.id, { status: 'uploading' });
        if (uploading) await putUpload(uploading);

        try {
          const file = new File([next.blob], next.filename, {
            type: next.blob.type || 'image/jpeg',
          });
          const res = await api.submissions.uploadPhoto(
            next.submissionId,
            next.fixtureKey,
            file,
          );
          const done = patch(set, next.id, {
            status: 'done',
            serverPhotoId: res.id,
            error: undefined,
          });
          if (done) await putUpload(done);
        } catch (err) {
          const attempts = next.attempts + 1;
          const failed = patch(set, next.id, {
            status: attempts >= MAX_ATTEMPTS ? 'error' : 'pending',
            attempts,
            error: errorMessage(err),
          });
          if (failed) await putUpload(failed);
          // Stop the loop on failure so we don't hammer a dead connection;
          // a reconnect or manual retry restarts the drain.
          break;
        }
      }
    } finally {
      set({ draining: false });
    }
  },

  remove: async (id) => {
    await deleteUpload(id);
    set((s) => {
      const next = { ...s.items };
      delete next[id];
      return { items: next };
    });
  },

  retry: async (id) => {
    const reset = patch(set, id, { status: 'pending', error: undefined, attempts: 0 });
    if (reset) await putUpload(reset);
    void get().drain();
  },

  setOnline: (online) => {
    set({ online });
    if (online) void get().drain();
  },
}));

/** Wire up online/offline listeners (call once from the app shell). */
export function installConnectivityListeners(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => useCaptureQueue.getState().setOnline(true);
  const onOffline = () => useCaptureQueue.getState().setOnline(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

/** Select the queue items belonging to one submission, oldest first. */
export function selectUploadsForSubmission(
  items: Record<string, QueuedUpload>,
  submissionId: string,
): QueuedUpload[] {
  return Object.values(items)
    .filter((i) => i.submissionId === submissionId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
