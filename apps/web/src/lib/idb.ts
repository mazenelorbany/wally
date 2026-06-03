// =============================================================================
// Tiny IndexedDB wrapper for the offline capture queue.
//
// Store managers shoot photos in the field where signal is poor. Each captured
// photo is written to IndexedDB *first* (durable across reloads / app kills),
// then uploaded. The Blob itself lives in IDB so a half-finished submission
// survives a closed tab. No external dep — a ~40-line promise wrapper is enough
// and keeps the PWA bundle small (no idb-keyval).
// =============================================================================

const DB_NAME = 'wally-capture';
const DB_VERSION = 1;
const STORE = 'queue';

/** A pending (or in-flight) photo upload, persisted across sessions. */
export interface QueuedUpload {
  /** Local uuid — the queue item id (not the server photo id). */
  id: string;
  submissionId: string;
  fixtureKey: string;
  /** The raw image bytes. Never logged, never serialised to JSON. */
  blob: Blob;
  /** Original filename / a synthesised one for camera captures. */
  filename: string;
  createdAt: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  attempts: number;
  /** Last error message, for the field UI. */
  error?: string;
  /** Server photo id once the upload lands. */
  serverPhotoId?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('submissionId', 'submissionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? req.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function putUpload(item: QueuedUpload): Promise<void> {
  await tx('readwrite', (s) => s.put(item));
}

export async function getUpload(id: string): Promise<QueuedUpload | undefined> {
  return tx('readonly', (s) => s.get(id) as IDBRequest<QueuedUpload | undefined>);
}

export async function getAllUploads(): Promise<QueuedUpload[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<QueuedUpload[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteUpload(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** Browser-native uuid, with a fallback for older webviews. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
