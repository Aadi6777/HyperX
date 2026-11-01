/**
 * Nexora room features that ride on the peer-to-peer data channels (no server involved):
 *   - NotesSync:     live collaborative notes backed by the CRDT in crdtDoc.ts
 *   - ClipboardSync: push text/links to everyone in the room
 *
 * Wire messages (JSON strings on the data channel; each stays far below the 256 KB SCTP limit):
 *   NOTE_OPS   { ops: CrdtOp[] }                       incremental edits
 *   NOTE_STATE { nodes: SnapshotNode[] }               full state, sent to a peer when its link opens
 *   CLIP       { id, text, from, at }                  one clipboard item
 */

import { WebRtcEngine, ControlMessage } from './webrtcEngine';
import { CrdtDoc, CrdtOp, SnapshotNode } from './crdtDoc';

const OPS_PER_MESSAGE = 1000; // ~65 KB of JSON
const NODES_PER_MESSAGE = 1500; // ~100 KB of JSON
export const MAX_NOTE_LENGTH = 100_000;
export const MAX_CLIP_LENGTH = 40_000;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/* ================================================================== Notes */

export class NotesSync {
  public readonly doc: CrdtDoc;
  private unsubscribe: () => void;
  private listeners = new Set<(remote: boolean) => void>();

  constructor(private readonly engine: WebRtcEngine) {
    this.doc = new CrdtDoc(engine.peerId);
    this.unsubscribe = engine.subscribe({
      onControl: (_peerId, msg) => this.handle(msg),
      // Whenever a link opens (first connect OR reconnect) hand the peer our full state. Both sides
      // do this, and merging is idempotent, so they converge no matter who connected first or what
      // was typed while the link was down.
      onLinkOpen: (peerId) => this.sendState(peerId),
    });
  }

  public dispose() {
    this.unsubscribe();
    this.listeners.clear();
  }

  /** Subscribe to document changes. `remote` is true when the change came from another peer. */
  public onChange(fn: (remote: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  public text(): string {
    return this.doc.text();
  }

  /**
   * Turn the textarea's new value into CRDT operations. We find the common prefix/suffix between
   * the old and new text; whatever lies between is "what the user just deleted / typed".
   * @returns false if the edit was rejected (document would exceed the size cap).
   */
  public edit(newText: string): boolean {
    const old = this.doc.text();
    if (newText === old) return true;
    if (newText.length > MAX_NOTE_LENGTH && newText.length > old.length) return false;

    let start = 0;
    const minLen = Math.min(old.length, newText.length);
    while (start < minLen && old[start] === newText[start]) start++;
    let oldEnd = old.length;
    let newEnd = newText.length;
    while (oldEnd > start && newEnd > start && old[oldEnd - 1] === newText[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    const ops: CrdtOp[] = [];
    if (oldEnd > start) ops.push(...this.doc.localDelete(start, oldEnd - start));
    if (newEnd > start) ops.push(...this.doc.localInsert(start, newText.slice(start, newEnd)));

    for (const batch of chunk(ops, OPS_PER_MESSAGE)) {
      this.engine.broadcastControl({ t: 'NOTE_OPS', ops: batch });
    }
    this.emit(false);
    return true;
  }

  private handle(msg: ControlMessage) {
    if (msg.t === 'NOTE_OPS' && Array.isArray(msg.ops)) {
      this.doc.applyRemote(msg.ops as CrdtOp[]);
      this.emit(true);
    } else if (msg.t === 'NOTE_STATE' && Array.isArray(msg.nodes)) {
      this.doc.mergeSnapshot(msg.nodes as SnapshotNode[]);
      this.emit(true);
    }
  }

  private sendState(peerId: string) {
    const nodes = this.doc.snapshot();
    if (nodes.length === 0) return;
    for (const batch of chunk(nodes, NODES_PER_MESSAGE)) {
      this.engine.sendControl(peerId, { t: 'NOTE_STATE', nodes: batch });
    }
  }

  private emit(remote: boolean) {
    this.listeners.forEach((fn) => fn(remote));
  }
}

/* ============================================================== Clipboard */

export interface ClipItem {
  id: string;
  from: string;
  text: string;
  at: number;
  mine: boolean;
  /** For items we sent: how many peers it was delivered to. */
  deliveredTo?: number;
}

export class ClipboardSync {
  private items: ClipItem[] = [];
  private unsubscribe: () => void;
  private listeners = new Set<(items: ClipItem[]) => void>();

  constructor(private readonly engine: WebRtcEngine) {
    this.unsubscribe = engine.subscribe({
      onControl: (_peerId, msg) => {
        if (msg.t !== 'CLIP') return;
        const text = typeof msg.text === 'string' ? msg.text.slice(0, MAX_CLIP_LENGTH) : '';
        const id = typeof msg.id === 'string' ? msg.id : '';
        if (!text || !id || this.items.some((i) => i.id === id)) return;
        this.add({
          id,
          text,
          from: typeof msg.from === 'string' ? msg.from.slice(0, 40) : 'Peer',
          at: typeof msg.at === 'number' ? msg.at : Date.now(),
          mine: false,
        });
      },
    });
  }

  public dispose() {
    this.unsubscribe();
    this.listeners.clear();
  }

  public onChange(fn: (items: ClipItem[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.items);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Send text to every linked peer. Returns how many peers received it (0 = nobody was linked). */
  public send(text: string): number {
    const clean = text.slice(0, MAX_CLIP_LENGTH);
    if (!clean.trim()) return 0;
    const id = 'c_' + Math.random().toString(36).slice(2, 11);
    const at = Date.now();
    const delivered = this.engine.broadcastControl({ t: 'CLIP', id, text: clean, from: this.engine.peerName, at });
    this.add({ id, text: clean, from: 'You', at, mine: true, deliveredTo: delivered });
    return delivered;
  }

  public clear() {
    this.items = [];
    this.listeners.forEach((fn) => fn(this.items));
  }

  private add(item: ClipItem) {
    this.items = [item, ...this.items].slice(0, 50);
    this.listeners.forEach((fn) => fn(this.items));
  }
}

/** Copy to the system clipboard, with a fallback for non-secure (http) pages. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
