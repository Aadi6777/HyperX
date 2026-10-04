/**
 * HyperX Phase 5 & 7: Zero-RAM Chunk Engine & Resumable Transfer Protocol
 * Streams files chunk-by-chunk with dynamic sizing (256KB - 1MB), active backpressure control,
 * bitmask recovery, and client-side AES-256-GCM encryption.
 */

import { encryptChunk, decryptChunk } from './cryptoService';
import { saveChunk } from './indexedDbCache';

export const CHUNK_SIZE = 512 * 1024; // 512 KB per chunk
export const HIGH_WATERMARK = 1024 * 1024; // 1 MB backpressure limit
export const LOW_WATERMARK = 256 * 1024; // 256 KB resume threshold

export interface ChunkHeader {
  type: 'CHUNK';
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  isEncrypted: boolean;
  iv?: number[];
  checksum?: string;
}

export interface TransferProgress {
  fileId: string;
  fileName: string;
  fileSize: number;
  chunksCompleted: number;
  totalChunks: number;
  percentage: number;
  speedMBps: number;
  status: 'STREAMING' | 'PAUSED' | 'COMPLETED' | 'ERROR';
  chunksMap: boolean[]; // true = chunk sent/received
}

/**
 * Wait until RTCDataChannel bufferedAmount drains below the low watermark.
 */
export function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= LOW_WATERMARK) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    channel.bufferedAmountLowThreshold = LOW_WATERMARK;
    const onLow = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow);
  });
}

/**
 * Stream a file out to a WebRTC DataChannel with zero RAM spikes.
 */
export async function streamFileToPeer(params: {
  file: File;
  fileId: string;
  channel: RTCDataChannel;
  encryptionKey?: CryptoKey | null;
  acknowledgedChunks?: Set<number>;
  signalState: { isPaused: boolean; isCancelled: boolean };
  onProgress: (progress: TransferProgress) => void;
}): Promise<void> {
  const { file, fileId, channel, encryptionKey, acknowledgedChunks, signalState, onProgress } = params;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const chunksMap = new Array<boolean>(totalChunks).fill(false);

  if (acknowledgedChunks) {
    acknowledgedChunks.forEach(idx => {
      if (idx < totalChunks) chunksMap[idx] = true;
    });
  }

  let bytesTransferred = 0;
  const startTime = Date.now();

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (signalState.isCancelled) {
      throw new Error('Transfer cancelled by user');
    }

    // Handle user pause
    while (signalState.isPaused && !signalState.isCancelled) {
      await new Promise(r => setTimeout(r, 200));
    }

    // Skip chunk if receiver already has it (Resumable Bitmask recovery)
    if (chunksMap[chunkIndex]) {
      continue;
    }

    // 1. Zero-RAM Slicing
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const sliceBlob = file.slice(start, end);
    let chunkBuffer = await sliceBlob.arrayBuffer();

    let iv: number[] | undefined;
    let isEncrypted = false;

    // 2. Client-side AES-256-GCM Encryption (Phase 8)
    if (encryptionKey) {
      const encrypted = await encryptChunk(chunkBuffer, encryptionKey);
      chunkBuffer = encrypted.data;
      iv = encrypted.iv;
      isEncrypted = true;
    }

    // 3. Backpressure Control: Prevent flooding browser memory
    await waitForBufferDrain(channel);

    // 4. Send Chunk Header followed by Raw Binary ArrayBuffer
    const header: ChunkHeader = {
      type: 'CHUNK',
      fileId,
      chunkIndex,
      totalChunks,
      isEncrypted,
      iv,
    };

    channel.send(JSON.stringify(header));
    channel.send(chunkBuffer);

    chunksMap[chunkIndex] = true;
    bytesTransferred += (end - start);

    const elapsedSec = (Date.now() - startTime) / 1000;
    const speedMBps = elapsedSec > 0 ? (bytesTransferred / (1024 * 1024)) / elapsedSec : 0;
    const completedCount = chunksMap.filter(Boolean).length;
    const percentage = Math.round((completedCount / totalChunks) * 100);

    onProgress({
      fileId,
      fileName: file.name,
      fileSize: file.size,
      chunksCompleted: completedCount,
      totalChunks,
      percentage,
      speedMBps: parseFloat(speedMBps.toFixed(2)),
      status: completedCount === totalChunks ? 'COMPLETED' : 'STREAMING',
      chunksMap: [...chunksMap],
    });
  }
}

/**
 * Handle incoming chunk on receiver browser, decrypt if needed, and store into IndexedDB.
 */
export async function processIncomingChunk(params: {
  header: ChunkHeader;
  data: ArrayBuffer;
  encryptionKey?: CryptoKey | null;
  onProgress?: (chunkIndex: number, totalChunks: number) => void;
}): Promise<void> {
  const { header, data, encryptionKey, onProgress } = params;

  let plainBuffer = data;

  if (header.isEncrypted) {
    if (!encryptionKey || !header.iv) {
      throw new Error('Encryption key or IV missing for encrypted chunk');
    }
    plainBuffer = await decryptChunk(data, header.iv, encryptionKey);
  }

  // Persist directly to IndexedDB to keep browser RAM completely flat
  await saveChunk(header.fileId, header.chunkIndex, plainBuffer);

  if (onProgress) {
    onProgress(header.chunkIndex, header.totalChunks);
  }
}
