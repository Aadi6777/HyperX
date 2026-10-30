/**
 * HyperX Phase 5 & 7: Zero-RAM Chunk Engine & Resumable Transfer Protocol
 * Streams files chunk-by-chunk with real backpressure, bitmask (range) recovery, and optional
 * client-side AES-256-GCM encryption.
 *
 * WIRE FORMAT (RTCDataChannel, ordered + reliable)
 *   - Control messages are JSON *strings* (OFFER / REQUEST / STOP / DONE / ACK ...).
 *   - Chunks are ONE binary message:  [u32 BE headerLen][header JSON utf-8][payload bytes]
 *     Keeping header + payload in a single message makes every chunk self-describing, so there is
 *     no "pending header" state to get out of sync when several files stream at once.
 *
 * WHY 64 KB: an SCTP message must fit in the peer's `maxMessageSize`, which is 256 KB in Chrome
 * and Safari. The old 512 KB chunks made Chromium tear the whole channel down on the first send,
 * which is why nothing ever arrived. 64 KB (+ ~150 B header + 16 B GCM tag) is safely below it
 * in every browser.
 */

import { encryptChunk } from './cryptoService';

export const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
export const HIGH_WATERMARK = 4 * 1024 * 1024; // pause sending above 4 MB queued
export const LOW_WATERMARK = 1024 * 1024; // resume when the queue drains below 1 MB
const PREFETCH = 8; // chunks read+encrypted ahead of the send cursor

export interface ChunkHeader {
  type: 'CHUNK';
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  isEncrypted: boolean;
  iv?: number[];
}

export interface StreamControl {
  paused: boolean;
  cancelled: boolean;
}

/* ------------------------------------------------------------------ framing */

export function encodeFrame(header: ChunkHeader, payload: ArrayBuffer): ArrayBuffer {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.length + payload.byteLength);
  new DataView(out.buffer).setUint32(0, headerBytes.length);
  out.set(headerBytes, 4);
  out.set(new Uint8Array(payload), 4 + headerBytes.length);
  return out.buffer;
}

export function decodeFrame(frame: ArrayBuffer): { header: ChunkHeader; payload: ArrayBuffer } {
  if (frame.byteLength < 4) throw new Error('Frame too short');
  const headerLen = new DataView(frame).getUint32(0);
  if (headerLen === 0 || 4 + headerLen > frame.byteLength) throw new Error('Corrupt frame header length');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(frame, 4, headerLen))) as ChunkHeader;
  return { header, payload: frame.slice(4 + headerLen) };
}

/* ------------------------------------------------- chunk bitmap <-> ranges */

/** Compact "which chunks do I already have" description: half-open [start, end) runs. */
export function bitmapToRanges(bitmap: Uint8Array): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < bitmap.length; i++) {
    if (bitmap[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      ranges.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, bitmap.length]);
  return ranges;
}

export function rangesToBitmap(ranges: Array<[number, number]> | undefined, total: number): Uint8Array {
  const bitmap = new Uint8Array(total);
  for (const [s, e] of ranges ?? []) {
    for (let i = Math.max(0, s); i < Math.min(total, e); i++) bitmap[i] = 1;
  }
  return bitmap;
}

/** Collapse a (possibly huge) chunk bitmap into <= `buckets` cells (0..1) for the heat-map UI. */
export function buildHeat(bitmap: Uint8Array, buckets = 120): number[] {
  const total = bitmap.length;
  const n = Math.max(1, Math.min(buckets, total));
  const heat = new Array<number>(n).fill(0);
  for (let b = 0; b < n; b++) {
    const from = Math.floor((b * total) / n);
    const to = Math.max(from + 1, Math.floor(((b + 1) * total) / n));
    let done = 0;
    for (let i = from; i < to && i < total; i++) done += bitmap[i];
    heat[b] = done / (to - from);
  }
  return heat;
}

/* ------------------------------------------------------------ backpressure */

/**
 * Resolve once the channel's send queue has drained. Unlike the previous version this also
 * rejects if the channel dies while we wait (otherwise the sender hangs forever), and polls as a
 * safety net in case a browser never fires `bufferedamountlow`.
 */
export function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= HIGH_WATERMARK) return Promise.resolve();

  return new Promise((resolve, reject) => {
    channel.bufferedAmountLowThreshold = LOW_WATERMARK;
    let poll: ReturnType<typeof setInterval>;

    const cleanup = () => {
      clearInterval(poll);
      channel.removeEventListener('bufferedamountlow', onLow);
      channel.removeEventListener('close', onDead);
      channel.removeEventListener('error', onDead);
    };
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onDead = () => {
      cleanup();
      reject(new Error('Data channel closed during transfer'));
    };

    channel.addEventListener('bufferedamountlow', onLow);
    channel.addEventListener('close', onDead);
    channel.addEventListener('error', onDead);
    poll = setInterval(() => {
      if (channel.readyState !== 'open') onDead();
      else if (channel.bufferedAmount <= LOW_WATERMARK) onLow();
    }, 250);
  });
}

/* ---------------------------------------------------------------- sending */

/**
 * Stream a file to ONE peer's data channel, one chunk at a time:
 *   slice -> (encrypt) -> wait for the send queue to drain -> send a single framed message.
 * Only one chunk is ever held in JS memory. Chunks flagged in `skip` (already held by the
 * receiver, from its REQUEST bitmask) are not re-sent, which is what makes resume work.
 */
export async function streamFileToPeer(params: {
  file: File;
  fileId: string;
  channel: RTCDataChannel;
  chunkSize: number;
  totalChunks: number;
  encryptionKey?: CryptoKey | null;
  skip?: Uint8Array;
  control: StreamControl;
  onProgress: (p: { chunkIndex: number; chunksSent: number; speedMBps: number }) => void;
}): Promise<'SENT' | 'CANCELLED'> {
  const { file, fileId, channel, chunkSize, totalChunks, encryptionKey, skip, control, onProgress } = params;

  let chunksSent = 0;
  let bytesSent = 0;
  const startTime = performance.now();

  // Read + encrypt run PIPELINED, PREFETCH chunks ahead of the one being sent. Doing them
  // one-at-a-time made throughput latency-bound (each await is a cross-process round trip, tens of
  // ms when the machine is busy), so the link sat idle most of the time. Memory stays bounded:
  // at most PREFETCH * chunkSize bytes (512 KB) are ever prepared in advance.
  const prepared = new Map<number, Promise<{ payload: ArrayBuffer; iv?: number[] }>>();
  const prepare = (idx: number) => {
    if (idx >= totalChunks || (skip && skip[idx]) || prepared.has(idx)) return;
    const task = (async () => {
      // 1. Zero-RAM slicing: read just this chunk from disk
      const start = idx * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      let payload = await file.slice(start, end).arrayBuffer();
      // 2. Optional AES-256-GCM (fresh IV per chunk, auth tag appended by WebCrypto)
      let iv: number[] | undefined;
      if (encryptionKey) {
        const enc = await encryptChunk(payload, encryptionKey);
        payload = enc.data;
        iv = enc.iv;
      }
      return { payload, iv };
    })();
    task.catch(() => undefined); // surfaced when awaited below; avoids "unhandled rejection" noise
    prepared.set(idx, task);
  };

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (control.cancelled) return 'CANCELLED';

    while (control.paused && !control.cancelled) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (control.cancelled) return 'CANCELLED';

    if (channel.readyState !== 'open') {
      throw new Error('Data channel closed during transfer');
    }

    if (skip && skip[chunkIndex]) {
      chunksSent++;
      continue;
    }

    for (let k = 0; k < PREFETCH; k++) prepare(chunkIndex + k);
    const { payload, iv } = await prepared.get(chunkIndex)!;
    prepared.delete(chunkIndex);

    // 3. Real backpressure: never queue more than HIGH_WATERMARK in the browser
    await waitForBufferDrain(channel);
    if (control.cancelled) return 'CANCELLED';

    // 4. One atomic, self-describing message
    channel.send(
      encodeFrame(
        { type: 'CHUNK', fileId, chunkIndex, totalChunks, isEncrypted: !!encryptionKey, iv },
        payload
      )
    );

    chunksSent++;
    bytesSent += Math.min(chunkSize, file.size - chunkIndex * chunkSize);
    const elapsed = (performance.now() - startTime) / 1000;
    onProgress({
      chunkIndex,
      chunksSent,
      speedMBps: elapsed > 0 ? bytesSent / (1024 * 1024) / elapsed : 0,
    });
  }

  return 'SENT';
}
