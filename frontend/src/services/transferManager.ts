/**
 * HyperX transfer protocol (runs on top of WebRtcEngine's data channels).
 *
 *   sender                                          receiver
 *   ------                                          --------
 *   OFFER {meta}                      ───────────▶  shows "incoming file" card
 *                                     ◀───────────  REQUEST {fileId, have:[ranges]}   (user accepts / resumes)
 *   binary CHUNK frames (backpressured) ─────────▶  decrypt → IndexedDB
 *   DONE                              ───────────▶  verify → COMPLETED
 *                                     ◀───────────  ACK                               (sender shows "delivered")
 *
 * Why a handshake? The old code fired chunks at whichever channels happened to be open at that
 * instant, never told the receiver how many chunks to expect, and marked the sender "COMPLETED"
 * whether or not anybody received anything. Now nothing is sent until a receiver asks for it,
 * late joiners still get the offer, and "delivered" only appears after the receiver's ACK.
 * `have` (the REQUEST bitmask) is what makes pause/resume and reconnect-resume work.
 */

import { WebRtcEngine, ControlMessage } from './webrtcEngine';
import {
  CHUNK_SIZE,
  StreamControl,
  streamFileToPeer,
  decodeFrame,
  ChunkHeader,
  bitmapToRanges,
  rangesToBitmap,
  buildHeat,
} from './chunkEngine';
import { deriveKeyFromSecret, decryptChunk, computeSha256, hasWebCrypto } from './cryptoService';
import {
  saveChunk,
  getChunk,
  saveTransferMetadata,
  clearTransferCache,
  assembleCompleteFile,
  saveToDiskStreaming,
} from './indexedDbCache';

export type TransferStatus =
  | 'OFFERED' // receiver: waiting for the user to accept
  | 'WAITING' // sender: offered, no receiver has asked for it yet
  | 'STREAMING'
  | 'PAUSED'
  | 'VERIFYING' // all bytes moved, waiting for the other side's confirmation / integrity check
  | 'COMPLETED'
  | 'ERROR';

export interface LocalTransfer {
  fileId: string;
  direction: 'SEND' | 'RECEIVE';
  fileName: string;
  fileSize: number;
  mimeType: string;
  totalChunks: number;
  chunkSize: number;
  chunksCompleted: number;
  percentage: number;
  speedMBps: number;
  status: TransferStatus;
  isEncrypted: boolean;
  /** Shortened SHA-256 of the first 1 MB (a cheap fingerprint; AES-GCM authenticates the rest). */
  checksum?: string;
  checksumVerified?: boolean;
  heat: number[];
  senderName?: string;
  senderPeerId?: string;
  deliveredTo: string[];
  note?: string;
  createdAt: number;
}

export interface TransferManagerOptions {
  onChange: (transfers: LocalTransfer[]) => void;
  getPassphrase: () => string;
  isAutoAccept: () => boolean;
  onDelivered?: (transfer: LocalTransfer) => void;
}

interface OfferMeta {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  totalChunks: number;
  chunkSize: number;
  encrypted: boolean;
  checksum?: string;
  senderName: string;
}

interface TransferRecord {
  t: LocalTransfer;
  // --- sender side
  file?: File;
  key?: CryptoKey | null;
  streams: Map<string, StreamControl>;
  paused: boolean;
  sentAll: boolean;
  sentMap?: Uint8Array;
  sampleHash?: string; // full hex
  // --- receiver side
  received?: Uint8Array;
  keyForReceive?: CryptoKey;
  pending: Set<Promise<void>>; // chunk writes currently in flight
  claimed: Set<number>; // indices being processed right now (dedupes overlapping resume frames)
  bytesSinceStart: number;
  startedAt: number;
  requestRetries: number;
}

const SAMPLE_BYTES = 1024 * 1024;
const MAX_CHUNKS = 16_000_000;
const EMIT_INTERVAL_MS = 120;

const newId = () => 'fx_' + Math.random().toString(36).slice(2, 11);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class TransferManager {
  private records = new Map<string, TransferRecord>();
  private declined = new Set<string>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly engine: WebRtcEngine,
    private readonly opts: TransferManagerOptions
  ) {
    engine.setCallbacks({
      onControl: (peerId, msg) => this.handleControl(peerId, msg),
      onFrame: (peerId, frame) => this.handleFrame(peerId, frame),
      onLinkOpen: (peerId) => this.handleLinkOpen(peerId),
      onLinkClosed: (peerId) => this.handleLinkClosed(peerId),
    });
  }

  public dispose() {
    this.disposed = true;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    for (const rec of this.records.values()) {
      rec.streams.forEach((c) => (c.cancelled = true));
    }
    this.engine.setCallbacks({
      onControl: undefined,
      onFrame: undefined,
      onLinkOpen: undefined,
      onLinkClosed: undefined,
    });
  }

  /* ---------------------------------------------------------------- state */

  private snapshot(): LocalTransfer[] {
    return [...this.records.values()]
      .sort((a, b) => b.t.createdAt - a.t.createdAt)
      .map((r) => {
        const bitmap = r.t.direction === 'RECEIVE' ? r.received : r.sentMap;
        return {
          ...r.t,
          deliveredTo: [...r.t.deliveredTo],
          heat: bitmap ? buildHeat(bitmap) : r.t.heat,
        };
      });
  }

  private emitNow() {
    if (this.disposed) return;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.opts.onChange(this.snapshot());
  }

  /** Progress updates arrive per chunk (thousands/sec); batch them into ~8 UI updates/sec. */
  private scheduleEmit() {
    if (this.disposed || this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitNow();
    }, EMIT_INTERVAL_MS);
  }

  private blankHeat(total: number) {
    return new Array<number>(Math.max(1, Math.min(120, total))).fill(0);
  }

  /* ---------------------------------------------------------- public: send */

  /**
   * Offer files to everyone in the room. Nothing is streamed yet - each receiver pulls the file
   * when they accept it.
   */
  public async sendFiles(files: File[], opts: { encrypt: boolean; passphrase: string }) {
    for (const file of files) {
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      if (totalChunks > MAX_CHUNKS) throw new Error(`${file.name} is too large for the chunk index`);

      const key = opts.encrypt ? await deriveKeyFromSecret(opts.passphrase) : null;
      let sampleHash: string | undefined;
      if (hasWebCrypto()) {
        sampleHash = await computeSha256(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
      }

      const t: LocalTransfer = {
        fileId: newId(),
        direction: 'SEND',
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        totalChunks,
        chunkSize: CHUNK_SIZE,
        chunksCompleted: 0,
        percentage: 0,
        speedMBps: 0,
        status: 'WAITING',
        isEncrypted: !!key,
        checksum: sampleHash ? sampleHash.slice(0, 16) + '…' : undefined,
        heat: this.blankHeat(totalChunks),
        deliveredTo: [],
        createdAt: Date.now(),
      };
      const rec: TransferRecord = {
        t,
        file,
        key,
        streams: new Map(),
        paused: false,
        sentAll: false,
        sampleHash,
        pending: new Set(),
        claimed: new Set(),
        bytesSinceStart: 0,
        startedAt: 0,
        requestRetries: 0,
      };
      this.records.set(t.fileId, rec);
      this.engine.broadcastControl({ t: 'OFFER', file: this.offerMeta(rec) });
      this.emitNow();
    }
  }

  private offerMeta(rec: TransferRecord): OfferMeta {
    const { t } = rec;
    return {
      fileId: t.fileId,
      name: t.fileName,
      size: t.fileSize,
      mime: t.mimeType,
      totalChunks: t.totalChunks,
      chunkSize: t.chunkSize,
      encrypted: t.isEncrypted,
      checksum: rec.sampleHash,
      senderName: this.engine.peerName,
    };
  }

  /* ------------------------------------------------------- public: receive */

  /** Accept an offered file (or retry/resume one): asks the sender to stream what we're missing. */
  public async accept(fileId: string) {
    const rec = this.records.get(fileId);
    if (!rec || rec.t.direction !== 'RECEIVE' || !rec.received) return;
    if (!['OFFERED', 'ERROR', 'PAUSED'].includes(rec.t.status)) return;

    if (rec.t.isEncrypted) {
      try {
        rec.keyForReceive = await deriveKeyFromSecret(this.opts.getPassphrase());
      } catch (e) {
        rec.t.status = 'ERROR';
        rec.t.note = errMsg(e);
        this.emitNow();
        return;
      }
    }

    rec.t.status = 'STREAMING';
    rec.t.note = undefined;
    rec.requestRetries = 0;
    rec.bytesSinceStart = 0;
    rec.startedAt = performance.now();

    saveTransferMetadata({
      fileId,
      fileName: rec.t.fileName,
      fileSize: rec.t.fileSize,
      totalChunks: rec.t.totalChunks,
      mimeType: rec.t.mimeType,
      checksum: rec.sampleHash,
      receivedChunks: rec.t.chunksCompleted,
      isComplete: false,
      createdAt: Date.now(),
    }).catch(() => undefined);

    this.sendRequest(rec);
    this.emitNow();
  }

  /** Save a completed received file to disk. Throws a readable error on failure. */
  public async save(fileId: string) {
    const rec = this.records.get(fileId);
    if (!rec || rec.t.direction !== 'RECEIVE' || rec.t.status !== 'COMPLETED') return;
    const { totalChunks, fileName, mimeType } = rec.t;

    // Chromium: stream IndexedDB -> disk with no RAM spike. (Picker must run inside the click.)
    if (await saveToDiskStreaming(fileId, totalChunks, fileName)) return;

    // Everyone else: assemble a Blob (chunks are folded into disk-backed Blobs along the way).
    const blob = await assembleCompleteFile(fileId, totalChunks, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  public togglePause(fileId: string) {
    const rec = this.records.get(fileId);
    if (!rec) return;

    if (rec.t.direction === 'SEND') {
      rec.paused = !rec.paused;
      rec.streams.forEach((c) => (c.paused = rec.paused));
      this.refreshSendStatus(rec);
    } else if (rec.t.status === 'STREAMING') {
      if (rec.t.senderPeerId) this.engine.sendControl(rec.t.senderPeerId, { t: 'STOP', fileId });
      rec.t.status = 'PAUSED';
    } else if (rec.t.status === 'PAUSED') {
      rec.t.status = 'STREAMING';
      rec.requestRetries = 0;
      rec.bytesSinceStart = 0;
      rec.startedAt = performance.now();
      this.sendRequest(rec); // `have` bitmask => only the missing chunks are re-sent
    }
    this.emitNow();
  }

  /** Remove a card: withdraws an outgoing offer, declines/aborts an incoming one, frees cache. */
  public dismiss(fileId: string) {
    const rec = this.records.get(fileId);
    if (!rec) return;

    if (rec.t.direction === 'SEND') {
      rec.streams.forEach((c) => (c.cancelled = true));
      this.engine.broadcastControl({ t: 'WITHDRAW', fileId });
    } else {
      this.declined.add(fileId);
      if (rec.t.senderPeerId && ['STREAMING', 'PAUSED'].includes(rec.t.status)) {
        this.engine.sendControl(rec.t.senderPeerId, { t: 'STOP', fileId });
      }
      clearTransferCache(fileId).catch(() => undefined);
    }
    this.records.delete(fileId);
    this.emitNow();
  }

  /* ------------------------------------------------------- link lifecycle */

  private handleLinkOpen(peerId: string) {
    for (const rec of this.records.values()) {
      if (rec.t.direction === 'SEND') {
        // Late joiners (and reconnecting peers) still get to see everything on offer.
        this.engine.sendControl(peerId, { t: 'OFFER', file: this.offerMeta(rec) });
      } else if (rec.t.senderPeerId === peerId && rec.t.status === 'STREAMING') {
        rec.t.note = undefined;
        this.sendRequest(rec); // resume where we left off
      }
    }
    this.emitNow();
  }

  private handleLinkClosed(peerId: string) {
    for (const rec of this.records.values()) {
      if (rec.t.direction === 'SEND') {
        const ctl = rec.streams.get(peerId);
        if (ctl) {
          ctl.cancelled = true;
          rec.streams.delete(peerId);
          this.refreshSendStatus(rec);
        }
      } else if (rec.t.senderPeerId === peerId && rec.t.status === 'STREAMING') {
        rec.t.note = 'Link to sender lost - will resume automatically when it reconnects.';
      }
    }
    this.emitNow();
  }

  /* ------------------------------------------------------ control messages */

  private handleControl(peerId: string, msg: ControlMessage) {
    const fileId = typeof msg.fileId === 'string' ? msg.fileId : '';
    switch (msg.t) {
      case 'OFFER':
        this.onOffer(peerId, msg.file as OfferMeta);
        break;
      case 'REQUEST':
        this.onRequest(peerId, fileId, msg.have as Array<[number, number]> | undefined);
        break;
      case 'STOP': {
        const rec = this.records.get(fileId);
        const ctl = rec?.streams.get(peerId);
        if (rec && ctl) {
          ctl.cancelled = true;
          rec.streams.delete(peerId);
          this.refreshSendStatus(rec);
          this.emitNow();
        }
        break;
      }
      case 'DONE':
        this.onDone(fileId);
        break;
      case 'ACK':
        this.onAck(peerId, fileId);
        break;
      case 'WITHDRAW':
        this.onWithdraw(fileId);
        break;
      case 'FAIL': {
        const rec = this.records.get(fileId);
        if (rec && rec.t.direction === 'SEND') {
          rec.t.note = `${this.engine.getPeerName(peerId)}: ${String(msg.message ?? 'transfer failed')}`;
          this.emitNow();
        }
        break;
      }
    }
  }

  private onOffer(peerId: string, m: OfferMeta) {
    if (!m || typeof m.fileId !== 'string' || this.declined.has(m.fileId)) return;

    const existing = this.records.get(m.fileId);
    if (existing) {
      if (existing.t.direction === 'RECEIVE') {
        existing.t.senderPeerId = peerId;
        existing.t.senderName = m.senderName;
      }
      return;
    }

    const valid =
      Number.isInteger(m.totalChunks) &&
      m.totalChunks >= 1 &&
      m.totalChunks <= MAX_CHUNKS &&
      Number.isInteger(m.chunkSize) &&
      m.chunkSize >= 1 &&
      m.chunkSize <= 1024 * 1024 &&
      Number.isFinite(m.size) &&
      m.size >= 0 &&
      m.totalChunks === Math.max(1, Math.ceil(m.size / m.chunkSize));
    if (!valid) {
      console.warn('Ignoring malformed file offer', m);
      return;
    }

    const t: LocalTransfer = {
      fileId: m.fileId,
      direction: 'RECEIVE',
      fileName: String(m.name || 'download').replace(/[\\/]/g, '_'),
      fileSize: m.size,
      mimeType: m.mime || 'application/octet-stream',
      totalChunks: m.totalChunks,
      chunkSize: m.chunkSize,
      chunksCompleted: 0,
      percentage: 0,
      speedMBps: 0,
      status: 'OFFERED',
      isEncrypted: !!m.encrypted,
      checksum: m.checksum ? m.checksum.slice(0, 16) + '…' : undefined,
      heat: this.blankHeat(m.totalChunks),
      senderName: m.senderName,
      senderPeerId: peerId,
      deliveredTo: [],
      createdAt: Date.now(),
    };
    this.records.set(m.fileId, {
      t,
      streams: new Map(),
      paused: false,
      sentAll: false,
      sampleHash: m.checksum,
      received: new Uint8Array(m.totalChunks),
      pending: new Set(),
      claimed: new Set(),
      bytesSinceStart: 0,
      startedAt: 0,
      requestRetries: 0,
    });
    this.emitNow();

    if (this.opts.isAutoAccept()) void this.accept(m.fileId);
  }

  /** Sender: a receiver asked for the file (or asked to resume it). */
  private onRequest(peerId: string, fileId: string, have?: Array<[number, number]>) {
    const rec = this.records.get(fileId);
    if (!rec || rec.t.direction !== 'SEND' || !rec.file) return;
    const channel = this.engine.getChannel(peerId);
    if (!channel) return;

    const previous = rec.streams.get(peerId);
    if (previous) previous.cancelled = true; // a new REQUEST supersedes the old stream (resume)

    const ctl: StreamControl = { paused: rec.paused, cancelled: false };
    rec.streams.set(peerId, ctl);
    const skip = rangesToBitmap(have, rec.t.totalChunks);
    rec.sentMap = Uint8Array.from(skip);
    rec.sentAll = false;
    rec.t.note = undefined;
    rec.t.chunksCompleted = skip.reduce((n, v) => n + v, 0);
    this.refreshSendStatus(rec);
    this.emitNow();

    void this.runStream(rec, peerId, ctl, skip);
  }

  private async runStream(rec: TransferRecord, peerId: string, ctl: StreamControl, skip: Uint8Array) {
    const peerName = this.engine.getPeerName(peerId);
    const channel = this.engine.getChannel(peerId);
    if (!channel || !rec.file) return;
    const { totalChunks } = rec.t;

    try {
      const result = await streamFileToPeer({
        file: rec.file,
        fileId: rec.t.fileId,
        channel,
        chunkSize: rec.t.chunkSize,
        totalChunks,
        encryptionKey: rec.key,
        skip,
        control: ctl,
        onProgress: (p) => {
          if (rec.sentMap) rec.sentMap[p.chunkIndex] = 1;
          rec.t.chunksCompleted = p.chunksSent;
          rec.t.percentage = Math.floor((p.chunksSent / totalChunks) * 100);
          rec.t.speedMBps = parseFloat(p.speedMBps.toFixed(2));
          this.scheduleEmit();
        },
      });
      if (result === 'SENT' && !ctl.cancelled) {
        rec.sentAll = true;
        rec.t.chunksCompleted = totalChunks;
        rec.t.percentage = 100;
        this.engine.sendControl(peerId, { t: 'DONE', fileId: rec.t.fileId });
      }
    } catch (e) {
      if (!ctl.cancelled) rec.t.note = `Sending to ${peerName} failed: ${errMsg(e)}`;
    } finally {
      if (rec.streams.get(peerId) === ctl) rec.streams.delete(peerId);
      this.refreshSendStatus(rec);
      this.emitNow();
    }
  }

  private refreshSendStatus(rec: TransferRecord) {
    if (rec.streams.size > 0) rec.t.status = rec.paused ? 'PAUSED' : 'STREAMING';
    else if (rec.t.deliveredTo.length > 0) rec.t.status = 'COMPLETED';
    else if (rec.sentAll) rec.t.status = 'VERIFYING';
    else rec.t.status = rec.paused ? 'PAUSED' : 'WAITING';
  }

  private onAck(peerId: string, fileId: string) {
    const rec = this.records.get(fileId);
    if (!rec || rec.t.direction !== 'SEND') return;
    const name = this.engine.getPeerName(peerId);
    if (!rec.t.deliveredTo.includes(name)) {
      rec.t.deliveredTo.push(name);
      this.refreshSendStatus(rec);
      this.emitNow();
      this.opts.onDelivered?.({ ...rec.t, deliveredTo: [...rec.t.deliveredTo] });
    }
  }

  private onWithdraw(fileId: string) {
    const rec = this.records.get(fileId);
    if (!rec || rec.t.direction !== 'RECEIVE' || rec.t.status === 'COMPLETED') return;
    if (rec.t.status === 'OFFERED') {
      this.records.delete(fileId);
    } else {
      rec.t.status = 'ERROR';
      rec.t.note = 'The sender cancelled this transfer.';
    }
    this.emitNow();
  }

  /** Receiver: the sender says it has sent everything. If anything is missing, ask again. */
  private onDone(fileId: string) {
    const rec = this.records.get(fileId);
    if (!rec || rec.t.direction !== 'RECEIVE') return;
    // Let every chunk write that is still in flight land before deciding anything is missing.
    void Promise.allSettled([...rec.pending]).then(async () => {
      if (rec.t.status !== 'STREAMING') return;
      if (rec.t.chunksCompleted >= rec.t.totalChunks) return; // finalize already ran
      if (rec.requestRetries < 3) {
        rec.requestRetries++;
        this.sendRequest(rec);
      } else {
        await this.failReceive(rec, 'Transfer ended with missing chunks.');
      }
    });
  }

  private sendRequest(rec: TransferRecord) {
    if (!rec.t.senderPeerId || !rec.received) return;
    const ok = this.engine.sendControl(rec.t.senderPeerId, {
      t: 'REQUEST',
      fileId: rec.t.fileId,
      have: bitmapToRanges(rec.received),
    });
    rec.t.note = ok ? undefined : 'Waiting for a direct link to the sender…';
  }

  /* --------------------------------------------------------- chunk intake */

  private handleFrame(peerId: string, frame: ArrayBuffer) {
    let decoded: { header: ChunkHeader; payload: ArrayBuffer };
    try {
      decoded = decodeFrame(frame);
    } catch (e) {
      console.warn('Dropping malformed frame:', e);
      return;
    }
    const { header, payload } = decoded;
    const rec = this.records.get(header.fileId);
    if (!rec || rec.t.direction !== 'RECEIVE' || !rec.received) return;
    if (rec.t.senderPeerId !== peerId) return; // only accept chunks from the peer that offered the file
    if (['OFFERED', 'ERROR', 'COMPLETED'].includes(rec.t.status)) return;
    if (!Number.isInteger(header.chunkIndex) || header.chunkIndex < 0 || header.chunkIndex >= rec.t.totalChunks) return;

    // Chunks are decrypted + written concurrently (serialising them made the receiver latency-bound).
    // Completion is still detected exactly once: only the call that makes the count hit the total
    // finalizes, and `claimed` stops duplicate in-flight frames from being counted twice.
    const task: Promise<void> = this.ingestChunk(rec, header, payload)
      .catch((e) => console.error('Chunk ingest failed:', e))
      .finally(() => rec.pending.delete(task));
    rec.pending.add(task);
  }

  private async ingestChunk(rec: TransferRecord, header: ChunkHeader, payload: ArrayBuffer) {
    if (!rec.received || ['OFFERED', 'ERROR', 'COMPLETED'].includes(rec.t.status)) return;
    const idx = header.chunkIndex;
    if (rec.received[idx] || rec.claimed.has(idx)) return; // duplicate (resume overlap)
    rec.claimed.add(idx);
    try {
      await this.ingestClaimed(rec, header, payload);
    } finally {
      rec.claimed.delete(idx);
    }
  }

  private async ingestClaimed(rec: TransferRecord, header: ChunkHeader, payload: ArrayBuffer) {
    if (!rec.received) return;
    const idx = header.chunkIndex;

    let plain = payload;
    if (header.isEncrypted) {
      if (!rec.keyForReceive || !header.iv) {
        await this.failReceive(rec, 'Encrypted data arrived but no decryption key is available.');
        return;
      }
      try {
        plain = await decryptChunk(payload, header.iv, rec.keyForReceive);
      } catch {
        // Previously this was swallowed and the still-encrypted bytes were saved as if valid,
        // producing a corrupt "completed" file whenever the passphrases differed.
        await this.failReceive(
          rec,
          'Decryption failed - the passphrase does not match the sender’s. Fix it and press Retry.'
        );
        return;
      }
    } else if (rec.t.isEncrypted) {
      await this.failReceive(rec, 'Expected encrypted data but received plaintext.');
      return;
    }
    if (plain.byteLength > rec.t.chunkSize) return;

    try {
      await saveChunk(rec.t.fileId, idx, plain);
    } catch (e) {
      await this.failReceive(rec, `Could not store the chunk (disk quota?): ${errMsg(e)}`);
      return;
    }

    if (rec.t.status === 'ERROR' || rec.t.status === 'COMPLETED') return; // failed while this write was in flight
    rec.received[idx] = 1;
    rec.t.chunksCompleted++;
    rec.bytesSinceStart += plain.byteLength;
    const elapsed = (performance.now() - rec.startedAt) / 1000;
    rec.t.speedMBps = elapsed > 0 ? parseFloat((rec.bytesSinceStart / (1024 * 1024) / elapsed).toFixed(2)) : 0;
    rec.t.percentage = Math.floor((rec.t.chunksCompleted / rec.t.totalChunks) * 100);

    if (rec.t.chunksCompleted >= rec.t.totalChunks) {
      await this.finalizeReceive(rec);
    } else {
      this.scheduleEmit();
    }
  }

  private async finalizeReceive(rec: TransferRecord) {
    rec.t.status = 'VERIFYING';
    this.emitNow();

    // Re-hash the first 1 MB as it now sits in IndexedDB and compare with the sender's fingerprint.
    if (rec.sampleHash && hasWebCrypto()) {
      try {
        const n = Math.min(rec.t.totalChunks, Math.ceil(SAMPLE_BYTES / rec.t.chunkSize));
        const parts: ArrayBuffer[] = [];
        for (let i = 0; i < n; i++) {
          const c = await getChunk(rec.t.fileId, i);
          if (!c) throw new Error(`chunk ${i} missing from cache`);
          parts.push(c);
        }
        const head = await new Blob(parts).slice(0, Math.min(SAMPLE_BYTES, rec.t.fileSize)).arrayBuffer();
        if ((await computeSha256(head)) !== rec.sampleHash) {
          await this.failReceive(rec, 'Integrity check failed: the received data does not match the sender’s checksum.');
          return;
        }
        rec.t.checksumVerified = true;
      } catch (e) {
        console.warn('Checksum verification skipped:', e);
      }
    }

    rec.t.status = 'COMPLETED';
    rec.t.percentage = 100;
    rec.t.note = undefined;
    if (rec.t.senderPeerId) this.engine.sendControl(rec.t.senderPeerId, { t: 'ACK', fileId: rec.t.fileId });
    this.emitNow();
  }

  private async failReceive(rec: TransferRecord, message: string) {
    if (rec.t.status === 'ERROR') return;
    rec.t.status = 'ERROR';
    rec.t.note = message;
    if (rec.t.senderPeerId) {
      this.engine.sendControl(rec.t.senderPeerId, { t: 'STOP', fileId: rec.t.fileId });
      this.engine.sendControl(rec.t.senderPeerId, { t: 'FAIL', fileId: rec.t.fileId, message });
    }
    this.emitNow();
  }
}
