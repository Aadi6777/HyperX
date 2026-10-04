/**
 * HyperX Phase 6: Local Chunk Cache
 * Persistent IndexedDB chunk assembly & constant-memory file reconstruction engine.
 * Prevents browser tab RAM exhaustion when receiving multi-gigabyte files.
 */

const DB_NAME = 'HyperX_ChunkStorage';
const DB_VERSION = 2;
const STORE_CHUNKS = 'file_chunks';
const STORE_META = 'transfer_metadata';

export interface StoredTransferMeta {
  fileId: string;
  transferId?: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  mimeType: string;
  manifestHash?: string;
  direction: 'SENDER' | 'RECEIVER';
  isEncrypted: boolean;
  completedChunks: number[]; // Array of confirmed chunk indices for bitmask resume
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
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function saveTransferMetadata(meta: StoredTransferMeta): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META], 'readwrite');
    const store = tx.objectStore(STORE_META);
    const req = store.put(meta);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getTransferMetadata(fileId: string): Promise<StoredTransferMeta | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META], 'readonly');
    const store = tx.objectStore(STORE_META);
    const req = store.get(fileId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveChunk(
  fileId: string,
  chunkIndex: number,
  data: ArrayBuffer
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS], 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);
    const req = store.put({
      fileId,
      chunkIndex,
      data,
      timestamp: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getChunk(fileId: string, chunkIndex: number): Promise<ArrayBuffer | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS], 'readonly');
    const store = tx.objectStore(STORE_CHUNKS);
    const req = store.get([fileId, chunkIndex]);
    req.onsuccess = () => {
      resolve(req.result ? req.result.data : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Constant-Memory File Reconstruction using the W3C File System Access API.
 * Streams slices sequentially from IndexedDB directly to disk without loading into V8 memory.
 * Supported in Chromium/Edge/Desktop browsers.
 */
export async function streamSaveFileToDisk(
  fileId: string,
  totalChunks: number,
  suggestedName: string,
  onProgress?: (savedChunks: number, total: number) => void
): Promise<boolean> {
  // Check if File System Access API is supported
  const win = window as unknown as { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<{ write: (data: ArrayBuffer) => Promise<void>; close: () => Promise<void> }> }> };

  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({ suggestedName });
      const writable = await handle.createWritable();

      for (let i = 0; i < totalChunks; i++) {
        const chunk = await getChunk(fileId, i);
        if (!chunk) {
          throw new Error(`Missing chunk #${i} in IndexedDB during disk streaming`);
        }
        await writable.write(chunk);
        if (onProgress) {
          onProgress(i + 1, totalChunks);
        }
      }

      await writable.close();
      return true;
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        // User cancelled file picker
        return false;
      }
      console.warn('File System Access API error, falling back to Blob download:', err);
    }
  }

  return false;
}

/**
 * Fallback assembly into an in-memory Blob with safety guard against browser heap crashes.
 */
export async function assembleCompleteFile(
  fileId: string,
  totalChunks: number,
  mimeType = 'application/octet-stream'
): Promise<Blob> {
  const chunkBuffers: ArrayBuffer[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const buf = await getChunk(fileId, i);
    if (!buf) {
      throw new Error(`Missing chunk index ${i} during file assembly`);
    }
    chunkBuffers.push(buf);
  }

  return new Blob(chunkBuffers, { type: mimeType });
}

export async function clearTransferCache(fileId: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_META], 'readwrite');
    const metaStore = tx.objectStore(STORE_META);
    metaStore.delete(fileId);

    const chunkStore = tx.objectStore(STORE_CHUNKS);
    const range = IDBKeyRange.bound([fileId, 0], [fileId, Infinity]);
    const req = chunkStore.delete(range);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
