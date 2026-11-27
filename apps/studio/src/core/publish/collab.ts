// ==========================================================================
// Ergalics Studio — collaborative research notebook CRDT (pure TS)
//
// Text is modelled as a Replicated Growable Array (RGA): every character is an
// atom with a globally unique id and a reference to the atom it was inserted
// after. Concurrent inserts at the same position are ordered deterministically
// by (logical clock, site), and deletes leave tombstones, so replicas converge
// without a central server. `BroadcastChannel` provides same-origin real-time
// sync between tabs/windows; the same snapshot format can be relayed by any
// transport later.
//
// The implementation is intentionally dependency-free (no Yjs needed) and is
// exhaustively testable in a plain node environment.
// ==========================================================================

export interface CrdtAtom {
  /** `${counter}@${site}` — stable, globally unique. */
  id: string;
  /** Id of the atom this one was inserted after (null = document start). */
  after: string | null;
  /** One Unicode code point (surrogate pairs are stored as a single atom). */
  value: string;
  deleted: boolean;
}

export interface CrdtState {
  site: string;
  counter: number;
  atoms: CrdtAtom[];
}

export interface TextDiffOp {
  type: 'equal' | 'add' | 'del';
  text: string;
}

function makeSite(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().slice(0, 8);
    }
  } catch {
    /* ignore */
  }
  return Math.random().toString(36).slice(2, 10);
}

function parseId(id: string): { counter: number; site: string } {
  const at = id.indexOf('@');
  return {
    counter: at < 0 ? 0 : Number(id.slice(0, at)) || 0,
    site: at < 0 ? id : id.slice(at + 1),
  };
}

/** Deterministic sibling order: newer clocks first, then site descending. */
function compareAtoms(a: CrdtAtom, b: CrdtAtom): number {
  const pa = parseId(a.id);
  const pb = parseId(b.id);
  if (pa.counter !== pb.counter) return pb.counter - pa.counter;
  if (pa.site === pb.site) return 0;
  return pa.site < pb.site ? 1 : -1;
}

/**
 * A convergent text CRDT. Two replicas that exchange `snapshot()` objects in
 * any order, any number of times, end up with the same text.
 */
export class TextCrdt {
  readonly site: string;
  private counter: number;
  private readonly atoms = new Map<string, CrdtAtom>();

  constructor(site?: string, state?: Pick<CrdtState, 'atoms' | 'counter'>) {
    this.site = site ?? makeSite();
    this.counter = state?.counter ?? 0;
    if (state) {
      for (const atom of state.atoms) {
        this.atoms.set(atom.id, { ...atom });
        this.counter = Math.max(this.counter, parseId(atom.id).counter + 1);
      }
    }
  }

  /** Merge another replica's full snapshot (idempotent, commutative). */
  apply(state: Pick<CrdtState, 'atoms' | 'counter'>): void {
    for (const atom of state.atoms) {
      const existing = this.atoms.get(atom.id);
      if (!existing) {
        this.atoms.set(atom.id, { ...atom });
      } else if (atom.deleted && !existing.deleted) {
        existing.deleted = true;
      }
      this.counter = Math.max(this.counter, parseId(atom.id).counter + 1);
    }
    this.counter = Math.max(this.counter, state.counter);
  }

  private nextId(): string {
    const id = `${this.counter}@${this.site}`;
    this.counter += 1;
    return id;
  }

  private childrenMap(): Map<string | null, CrdtAtom[]> {
    const known = this.atoms;
    const children = new Map<string | null, CrdtAtom[]>();
    for (const atom of known.values()) {
      const parent = atom.after && known.has(atom.after) ? atom.after : null;
      const list = children.get(parent);
      if (list) list.push(atom);
      else children.set(parent, [atom]);
    }
    for (const list of children.values()) list.sort(compareAtoms);
    return children;
  }

  private visibleAtoms(): CrdtAtom[] {
    const children = this.childrenMap();
    const out: CrdtAtom[] = [];
    const stack: Array<{ parent: string | null; index: number }> = [{ parent: null, index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const list = children.get(frame.parent) ?? [];
      if (frame.index >= list.length) {
        stack.pop();
        continue;
      }
      const atom = list[frame.index]!;
      frame.index += 1;
      if (!atom.deleted) out.push(atom);
      stack.push({ parent: atom.id, index: 0 });
    }
    return out;
  }

  get length(): number {
    return this.visibleAtoms().length;
  }

  getText(): string {
    return this.visibleAtoms().map((a) => a.value).join('');
  }

  /** Insert text at a visible character offset. */
  insert(index: number, text: string): void {
    if (!text) return;
    const visible = this.visibleAtoms();
    const at = Math.max(0, Math.min(visible.length, Math.floor(index)));
    let after = at === 0 ? null : visible[at - 1]!.id;
    for (const ch of Array.from(text)) {
      const id = this.nextId();
      this.atoms.set(id, { id, after, value: ch, deleted: false });
      after = id;
    }
  }

  /** Delete `count` visible characters starting at `index`. */
  delete(index: number, count = 1): void {
    if (count <= 0) return;
    const visible = this.visibleAtoms();
    const start = Math.max(0, Math.min(visible.length, Math.floor(index)));
    const end = Math.min(visible.length, start + Math.floor(count));
    for (let i = start; i < end; i += 1) {
      const atom = this.atoms.get(visible[i]!.id);
      if (atom) atom.deleted = true;
    }
  }

  /** Replace the whole text using a minimal diff (keeps remote edits stable). */
  replaceAll(next: string): void {
    const prev = this.getText();
    if (prev === next) return;
    // Diff over code-point arrays so offsets align with atom indices
    // (insert() stores one atom per code point, not per UTF-16 code unit).
    const prevCp = Array.from(prev);
    const nextCp = Array.from(next);
    let start = 0;
    while (start < prevCp.length && start < nextCp.length && prevCp[start] === nextCp[start]) start += 1;
    let endPrev = prevCp.length;
    let endNext = nextCp.length;
    while (endPrev > start && endNext > start && prevCp[endPrev - 1] === nextCp[endNext - 1]) {
      endPrev -= 1;
      endNext -= 1;
    }
    this.delete(start, endPrev - start);
    this.insert(start, nextCp.slice(start, endNext).join(''));
  }

  snapshot(): CrdtState {
    return {
      site: this.site,
      counter: this.counter,
      atoms: [...this.atoms.values()].map((a) => ({ ...a })),
    };
  }

  clone(): TextCrdt {
    return new TextCrdt(this.site, this.snapshot());
  }
}

/** Merge two snapshots into a new one. */
export function mergeCrdtStates(
  a: Pick<CrdtState, 'atoms' | 'counter'>,
  b: Pick<CrdtState, 'atoms' | 'counter'>,
): Pick<CrdtState, 'atoms' | 'counter'> {
  const merged = new Map<string, CrdtAtom>();
  for (const atom of a.atoms) merged.set(atom.id, { ...atom });
  for (const atom of b.atoms) {
    const existing = merged.get(atom.id);
    if (!existing) merged.set(atom.id, { ...atom });
    else if (atom.deleted) existing.deleted = true;
  }
  return {
    atoms: [...merged.values()],
    counter: Math.max(a.counter, b.counter),
  };
}

/** Create a text CRDT from a snapshot. */
export function crdtFromState(state: CrdtState, site?: string): TextCrdt {
  return new TextCrdt(site ?? state.site, state);
}

/** Render text from a snapshot without constructing a replica. */
export function crdtText(state: Pick<CrdtState, 'atoms'>): string {
  return new TextCrdt('readonly', { atoms: state.atoms, counter: 0 }).getText();
}

// --------------------------------------------------------------------------
// Change history / diff
// --------------------------------------------------------------------------

/**
 * Line-level LCS diff. Suitable for notebook history panels; quadratic in the
 * number of changed lines but the notebook sizes here are small.
 */
export function diffText(previous: string, next: string): TextDiffOp[] {
  const a = previous.split('\n');
  const b = next.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const ops: TextDiffOp[] = [];
  const push = (type: TextDiffOp['type'], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += `\n${text}`;
    else ops.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]!);
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      push('del', a[i]!);
      i += 1;
    } else {
      push('add', b[j]!);
      j += 1;
    }
  }
  while (i < n) push('del', a[i++]!);
  while (j < m) push('add', b[j++]!);
  return ops;
}

// --------------------------------------------------------------------------
// Collaborative notebook model
// --------------------------------------------------------------------------

export type CollabCellType = 'md' | 'code';

export interface CollabComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
  resolved?: boolean;
}

export interface CollabCell {
  id: string;
  type: CollabCellType;
  crdt: CrdtState;
  comments: CollabComment[];
}

export interface CollabNote {
  id: string;
  title: string;
  cells: CollabCell[];
  updatedAt: number;
  /** Append-only checkpoints for the history/diff panel. */
  history?: Array<{ id: string; at: number; cells: Array<{ id: string; text: string }> }>;
}

export function createCollabCell(type: CollabCellType = 'md', text = ''): CollabCell {
  const crdt = new TextCrdt();
  crdt.insert(0, text);
  return { id: crypto.randomUUID(), type, crdt: crdt.snapshot(), comments: [] };
}

export function createCollabNote(title = 'Research notebook'): CollabNote {
  return {
    id: crypto.randomUUID(),
    title,
    cells: [
      createCollabCell('md', `# ${title}\n\nStart writing here.`),
      createCollabCell('md', '## Observations\n\n- '),
    ],
    updatedAt: Date.now(),
    history: [],
  };
}

/** Snapshot the visible text of every cell (history checkpoints). */
export function noteCheckpoint(note: CollabNote): { id: string; at: number; cells: Array<{ id: string; text: string }> } {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    cells: note.cells.map((cell) => ({ id: cell.id, text: crdtText(cell.crdt) })),
  };
}

/** Merge a remote notebook snapshot into a local one (cell-level LWW + CRDT). */
export function mergeCollabNotes(local: CollabNote, remote: CollabNote): CollabNote {
  const byId = new Map(local.cells.map((c) => [c.id, c]));
  for (const remoteCell of remote.cells) {
    const existing = byId.get(remoteCell.id);
    if (!existing) {
      byId.set(remoteCell.id, remoteCell);
      continue;
    }
    const merged = mergeCrdtStates(existing.crdt, remoteCell.crdt);
    byId.set(remoteCell.id, {
      ...existing,
      type: remoteCell.type,
      crdt: { site: existing.crdt.site, ...merged },
      comments: mergeComments(existing.comments, remoteCell.comments),
    });
  }
  // Order: local order first, then remote-only cells appended.
  const order = new Map(local.cells.map((c, i) => [c.id, i]));
  const cells = [...byId.values()].sort((a, b) => {
    const ai = order.get(a.id);
    const bi = order.get(b.id);
    if (ai === undefined && bi === undefined) return a.id.localeCompare(b.id);
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
  return {
    ...local,
    title: remote.updatedAt > local.updatedAt ? remote.title : local.title,
    cells,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    history: local.history,
  };
}

function mergeComments(a: CollabComment[], b: CollabComment[]): CollabComment[] {
  const byId = new Map(a.map((c) => [c.id, c]));
  for (const comment of b) if (!byId.has(comment.id)) byId.set(comment.id, comment);
  return [...byId.values()];
}

/** Export a notebook to a single Markdown document. */
export function notebookToMarkdown(note: CollabNote): string {
  return note.cells
    .map((cell) => {
      const text = crdtText(cell.crdt);
      return cell.type === 'code' ? `\`\`\`\n${text}\n\`\`\`` : text;
    })
    .join('\n\n');
}

// --------------------------------------------------------------------------
// Same-origin real-time transport
// --------------------------------------------------------------------------

export type CollabMessage =
  | { type: 'request'; from: string }
  | { type: 'state'; from: string; note: CollabNote };

export interface CollabChannel {
  room: string;
  send: (message: CollabMessage) => void;
  close: () => void;
}

/**
 * Join a same-origin collaboration room. Returns null when BroadcastChannel is
 * unavailable (SSR, older browsers); the page then works offline.
 */
export function createCollabChannel(
  room: string,
  onMessage: (message: CollabMessage) => void,
): CollabChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(`ergalics-collab:${room}`);
  channel.onmessage = (event: MessageEvent<CollabMessage>) => {
    if (event.data && typeof event.data === 'object') onMessage(event.data);
  };
  return {
    room,
    send: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
}
