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

    // Scan and remove all chunks for this file
    const chunkStore = tx.objectStore(STORE_CHUNKS);
    const req = chunkStore.openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        if (cursor.value.fileId === fileId) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}
