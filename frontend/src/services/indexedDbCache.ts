/**
 * HyperX Phase 6: Local Chunk Cache
 * Persistent IndexedDB chunk assembly & file reconstruction engine.
 * Prevents browser tab RAM exhaustion when receiving multi-gigabyte files.
 */

const DB_NAME = 'HyperX_ChunkStorage';
const DB_VERSION = 1;
const STORE_CHUNKS = 'file_chunks';
const STORE_META = 'transfer_metadata';

export interface StoredTransferMeta {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  mimeType: string;
  checksum?: string;
  receivedChunks: number;
  isComplete: boolean;
  createdAt: number;
}

let dbInstance: IDBDatabase | null = null;

export async function getDb(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        // Compound key: [fileId, chunkIndex]
        db.createObjectStore(STORE_CHUNKS, { keyPath: ['fileId', 'chunkIndex'] });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'fileId' });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      // If another tab upgrades/deletes the DB, drop our handle so the next call reopens it.
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/** Key range covering every chunk of one file: [fileId, 0] .. [fileId, +inf). */
function fileRange(fileId: string): IDBKeyRange {
  return IDBKeyRange.bound([fileId, 0], [fileId, Number.MAX_SAFE_INTEGER]);
}

export async function saveTransferMetadata(meta: StoredTransferMeta): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META], 'readwrite');
    tx.objectStore(STORE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Persist one chunk. Resolves only once the transaction has COMMITTED (not merely when the
 * request was queued), so a "stored" chunk is really durable. Rejects on quota errors etc.
 */
export async function saveChunk(
  fileId: string,
  chunkIndex: number,
  data: ArrayBuffer
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS], 'readwrite');
    tx.objectStore(STORE_CHUNKS).put({ fileId, chunkIndex, data, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted (storage quota full?)'));
  });
}

export async function getChunk(fileId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS], 'readonly');
    const req = tx.objectStore(STORE_CHUNKS).get([fileId, chunkIndex]);
    req.onsuccess = () => {
      resolve(req.result ? req.result.data : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Rebuild the file as a Blob. Chunks are folded into intermediate Blobs of ~32 MB so that raw
 * ArrayBuffers can be garbage-collected as we go (browsers back large Blobs by disk), instead of
 * holding every chunk in JS memory at once.
 */
export async function assembleCompleteFile(
  fileId: string,
  totalChunks: number,
  mimeType = 'application/octet-stream'
): Promise<Blob> {
  const BATCH_BYTES = 32 * 1024 * 1024;
  const parts: Blob[] = [];
  let batch: ArrayBuffer[] = [];
  let batchBytes = 0;

  for (let i = 0; i < totalChunks; i++) {
    const buf = await getChunk(fileId, i);
    if (!buf) {
      throw new Error(`Missing chunk index ${i} during file assembly`);
    }
    batch.push(buf);
    batchBytes += buf.byteLength;
    if (batchBytes >= BATCH_BYTES) {
      parts.push(new Blob(batch));
      batch = [];
      batchBytes = 0;
    }
  }
  if (batch.length > 0) parts.push(new Blob(batch));

  return new Blob(parts, { type: mimeType });
}

/**
 * True zero-RAM save: stream chunks from IndexedDB straight into a file on disk via the
 * File System Access API (Chromium). Returns false when unsupported so the caller can fall back
 * to the Blob download. Must be called from a user gesture (the picker requires one).
 */
export async function saveToDiskStreaming(
  fileId: string,
  totalChunks: number,
  suggestedName: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker !== 'function') return false;

  let handle;
  try {
    handle = await picker.call(window, { suggestedName });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return true; // user cancelled
    return false;
  }
  const writable = await handle.createWritable();
  try {
    for (let i = 0; i < totalChunks; i++) {
      const buf = await getChunk(fileId, i);
      if (!buf) throw new Error(`Missing chunk index ${i} during file assembly`);
      await writable.write(buf);
    }
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
  return true;
}

export async function clearTransferCache(fileId: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_META], 'readwrite');
    tx.objectStore(STORE_META).delete(fileId);
    tx.objectStore(STORE_CHUNKS).delete(fileRange(fileId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Transfers aren't resumable across page reloads (their state lives in memory), so chunks left
 * behind by closed tabs are dead weight against the origin's storage quota. Drop anything whose
 * metadata record is older than maxAgeMs.
 */
export async function purgeStaleTransfers(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const db = await getDb();
  const metas: StoredTransferMeta[] = await new Promise((resolve, reject) => {
    const req = db.transaction([STORE_META], 'readonly').objectStore(STORE_META).getAll();
    req.onsuccess = () => resolve(req.result as StoredTransferMeta[]);
    req.onerror = () => reject(req.error);
  });
  const cutoff = Date.now() - maxAgeMs;
  for (const m of metas) {
    if (m.createdAt < cutoff) await clearTransferCache(m.fileId);
  }
}
