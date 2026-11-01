/**
 * Nexora CRDT: a conflict-free replicated text document (RGA - Replicated Growable Array).
 *
 * Every character is a node with a globally unique id `counter@siteId`, where `counter` is a
 * Lamport clock. An insert names the node it goes AFTER ("origin"); a delete only marks a node as a
 * tombstone (it is never removed, so late-arriving operations can still find their anchor).
 *
 * Why it converges with no server and no locking:
 *  - Operations are commutative once their dependencies exist (an insert needs its origin, a delete
 *    needs its target); anything that arrives early waits in `pending` and is retried.
 *  - Concurrent inserts at the same spot are ordered by id (higher counter first, ties broken by
 *    siteId). Because a node's counter is always greater than its origin's, skipping "greater" ids
 *    is enough to keep every replica's sequence identical.
 *  - Operations are idempotent (duplicates are ignored), so retransmission is always safe.
 */

export type IdStr = string; // `${counter}@${siteId}`

export type CrdtOp =
  | { t: 'i'; id: IdStr; after: IdStr | null; ch: string }
  | { t: 'd'; id: IdStr };

/** Compact wire form of a node: [id, origin, char, deleted(0|1)] - used for full-state sync. */
export type SnapshotNode = [IdStr, IdStr | null, string, 0 | 1];

interface CharNode {
  id: IdStr;
  c: number;
  p: string;
  ch: string;
  after: IdStr | null;
  deleted: boolean;
}

function parseId(id: IdStr): { c: number; p: string } {
  const at = id.indexOf('@');
  return { c: parseInt(id.slice(0, at), 10), p: id.slice(at + 1) };
}

/** true if node (c1,p1) is ordered strictly before (c2,p2) in the "greater = comes first" order */
function isGreater(c1: number, p1: string, c2: number, p2: string): boolean {
  if (c1 !== c2) return c1 > c2;
  return p1 > p2;
}

export class CrdtDoc {
  private nodes: CharNode[] = [];
  private index = new Map<IdStr, CharNode>();
  private pending: CrdtOp[] = [];
  private clock = 0;
  private cachedText: string | null = '';

  constructor(public readonly siteId: string) {}

  /* ------------------------------------------------------------------ reads */

  public text(): string {
    if (this.cachedText === null) {
      let out = '';
      for (const n of this.nodes) if (!n.deleted) out += n.ch;
      this.cachedText = out;
    }
    return this.cachedText;
  }

  public get length(): number {
    return this.text().length;
  }

  /** Total nodes including tombstones, and how many ops are waiting on missing dependencies. */
  public stats() {
    return { visible: this.length, nodes: this.nodes.length, pending: this.pending.length };
  }

  private visible(): CharNode[] {
    return this.nodes.filter((n) => !n.deleted);
  }

  /* ----------------------------------------------------------- local edits */

  private nextId(): IdStr {
    this.clock += 1;
    return `${this.clock}@${this.siteId}`;
  }

  /** Insert `text` at visible position `index`. Returns the operations to broadcast. */
  public localInsert(index: number, text: string): CrdtOp[] {
    const vis = this.visible();
    const at = Math.max(0, Math.min(index, vis.length));
    let after: IdStr | null = at === 0 ? null : vis[at - 1].id;
    const ops: CrdtOp[] = [];
    for (let k = 0; k < text.length; k++) {
      const op: CrdtOp = { t: 'i', id: this.nextId(), after, ch: text[k] };
      this.integrate(op);
      ops.push(op);
      after = op.id;
    }
    this.cachedText = null;
    return ops;
  }

  /** Delete `count` visible characters starting at `index`. Returns the operations to broadcast. */
  public localDelete(index: number, count: number): CrdtOp[] {
    const vis = this.visible();
    const ops: CrdtOp[] = [];
    for (let k = index; k < Math.min(vis.length, index + count); k++) {
      const op: CrdtOp = { t: 'd', id: vis[k].id };
      this.integrate(op);
      ops.push(op);
    }
    this.cachedText = null;
    return ops;
  }

  /* ---------------------------------------------------------- remote edits */

  /** Apply operations received from another replica (any order, duplicates allowed). */
  public applyRemote(ops: CrdtOp[]): void {
    for (const op of ops) {
      if (!this.integrate(op)) this.pending.push(op);
    }
    this.drainPending();
    this.cachedText = null;
  }

  /** Full state for a peer that just connected (or reconnected). */
  public snapshot(): SnapshotNode[] {
    return this.nodes.map((n) => [n.id, n.after, n.ch, n.deleted ? 1 : 0] as SnapshotNode);
  }

  /** Merge a (possibly partial) snapshot. Safe to call repeatedly and with overlapping data. */
  public mergeSnapshot(nodes: SnapshotNode[]): void {
    const ops: CrdtOp[] = [];
    for (const [id, after, ch, del] of nodes) {
      ops.push({ t: 'i', id, after, ch });
      if (del) ops.push({ t: 'd', id });
    }
    this.applyRemote(ops);
  }

  /* -------------------------------------------------------------- internals */

  /** @returns false when a dependency is missing (op must wait), true when applied or a duplicate */
  private integrate(op: CrdtOp): boolean {
    if (op.t === 'd') {
      const node = this.index.get(op.id);
      if (!node) return false;
      node.deleted = true;
      return true;
    }

    if (this.index.has(op.id)) return true; // duplicate delivery

    let pos = 0;
    if (op.after !== null) {
      const origin = this.index.get(op.after);
      if (!origin) return false;
      pos = this.nodes.indexOf(origin) + 1;
    }
    const { c, p } = parseId(op.id);
    // Skip siblings (and their subtrees) that outrank the new node.
    while (pos < this.nodes.length && isGreater(this.nodes[pos].c, this.nodes[pos].p, c, p)) pos++;

    const node: CharNode = { id: op.id, c, p, ch: op.ch, after: op.after, deleted: false };
    this.nodes.splice(pos, 0, node);
    this.index.set(op.id, node);
    if (c > this.clock) this.clock = c; // Lamport rule: our next id must exceed anything we've seen
    return true;
  }

  private drainPending() {
    let progressed = true;
    while (progressed && this.pending.length > 0) {
      progressed = false;
      const still: CrdtOp[] = [];
      for (const op of this.pending) {
        if (this.integrate(op)) progressed = true;
        else still.push(op);
      }
      this.pending = still;
    }
  }
}
