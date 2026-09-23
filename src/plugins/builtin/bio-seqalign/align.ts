// ==========================================================================
// bio-seqalign — deterministic sequence analysis + pairwise alignment (pure)
//
// Real BLOSUM62 (protein) and NCBI NUC.4.4-class (nucleotide) substitution
// matrices, sequence composition statistics (GC, GC1/2/3, CpG), and global
// (Needleman-Wunsch) / local (Smith-Waterman) alignment with an affine gap
// model. Everything is pure and exact integer/fraction scoring so unit tests
// can assert canonical results (e.g. the classic NW traceback below).
// ==========================================================================

export const DNA = new Set('ACGTNRYSWKMBDHV');
export const AA = new Set('ACDEFGHIKLMNPQRSTVWY');

/** Amino-acid order used by the standard BLOSUM62 rows. */
const AA_ORDER = ['A', 'R', 'N', 'D', 'C', 'Q', 'E', 'G', 'H', 'I', 'L', 'K', 'M', 'F', 'P', 'S', 'T', 'W', 'Y', 'V'];

/** Standard BLOSUM62 (square 20×20, each row comma-separated). */
export const BLOSUM62_STR = [
  '4,-1,-2,-2,0,-1,-1,0,-2,-1,-1,-1,-1,-2,-1,1,0,-3,-2,0',
  '-1,5,0,-2,-3,1,0,-2,0,-3,-2,2,-1,-3,-2,-1,-1,-3,-2,-3',
  '-2,0,6,1,-3,0,0,0,1,-3,-3,0,-2,-3,-2,1,0,-4,-2,-3',
  '-2,-2,1,6,-3,0,2,-1,-1,-3,-4,-1,-3,-3,-1,0,-1,-4,-3,-3',
  '0,-3,-3,-3,9,-3,-4,-3,-3,-1,-1,-3,-1,-2,-3,-1,-1,-2,-2,-1',
  '-1,1,0,0,-3,5,2,-2,0,-3,-2,1,0,-3,-1,0,-1,-2,-1,-2',
  '-1,0,0,2,-4,2,5,-2,0,-3,-3,1,-2,-3,-1,0,-1,-3,-2,-2',
  '0,-2,0,-1,-3,-2,-2,6,-2,-4,-4,-2,-3,-3,-2,0,-2,-2,-3,-3',
  '-2,0,1,-1,-3,0,0,-2,8,-3,-3,-1,-2,-1,-2,-1,-2,-2,2,-3',
  '-1,-3,-3,-3,-1,-3,-3,-4,-3,4,2,-3,1,0,-3,-2,-1,-3,-1,3',
  '-1,-2,-3,-4,-1,-2,-3,-4,-3,2,4,-2,2,0,-3,-2,-1,-2,-1,1',
  '-1,2,0,-1,-3,1,1,-2,-1,-3,-2,5,-1,-3,-1,0,-1,-3,-2,-2',
  '-1,-1,-2,-3,-1,0,-2,-3,-2,1,2,-1,5,0,-2,-1,-1,-1,-1,1',
  '-2,-3,-3,-3,-2,-3,-3,-3,-1,0,0,-3,0,6,-4,-2,-2,1,3,-1',
  '-1,-2,-2,-1,-3,-1,-1,-2,-2,-3,-3,-1,-2,-4,7,-1,-1,-4,-3,-2',
  '1,-1,1,0,-1,0,0,0,-1,-2,-2,0,-1,-2,-1,4,1,-3,-2,-2',
  '0,-1,0,-1,-1,-1,-1,-2,-2,-1,-1,-1,-1,-2,-1,1,5,-2,-2,0',
  '-3,-3,-4,-4,-2,-2,-3,-2,-2,-3,-2,-3,-1,1,-4,-3,-2,11,2,-3',
  '-2,-2,-2,-3,-2,-1,-2,-3,2,-1,-1,-2,-1,3,-3,-2,-2,2,7,-1',
  '0,-3,-3,-3,-1,-2,-2,-3,-3,3,1,-2,1,-1,-2,-2,0,-3,-1,4',
].map((r) => r.split(',').map(Number));

/**
 * Nucleotide substitution matrix (common NUC.4.4-style): match +5, mismatch
 * −4, and −1 for an ambiguous base compared against a specific one.
 */
export function nucScore(a: string, b: string): number {
  if (a === b) return 5;
  const amb = 'NRYSWKMBDHV';
  if (amb.includes(a) || amb.includes(b)) return -1;
  return -4;
}

export type MatrixName = 'BLOSUM62' | 'NUC.4.4';

export interface SubMatrix {
  name: MatrixName;
  build: (a: string, b: string) => number;
}

export const MATRICES: SubMatrix[] = [
  {
    name: 'BLOSUM62',
    build: (a, b) => {
      const i = AA_ORDER.indexOf(a.toUpperCase());
      const j = AA_ORDER.indexOf(b.toUpperCase());
      if (i < 0 || j < 0) return -4; // rare amino acid
      return BLOSUM62_STR[i]![j]!;
    },
  },
  { name: 'NUC.4.4', build: nucScore },
];

export function makeMatrix(name: MatrixName): SubMatrix {
  return MATRICES.find((m) => m.name === name) ?? MATRICES[0]!;
}

/** Affine gap model: first gap costs `open`, each extra position `extend`. */
export interface GapModel {
  open: number;
  extend: number;
}

export const BLOSUM_GAPS: GapModel = { open: -11, extend: -1 };
export const NUC_GAPS: GapModel = { open: -10, extend: -0.5 };

export interface BaseStats {
  length: number;
  gcFraction: number;
  gc: number;
  at: number;
  composition: Array<{ base: string; count: number; fraction: number }>;
}

/** Composition & GC statistics for a nucleotide or protein sequence. */
export function baseStats(seq: string): BaseStats {
  const all = [...seq];
  const alphabet = Array.from(new Set(all.map((c) => c.toUpperCase())));
  alphabet.sort();
  const composition = alphabet
    .map((base) => {
      const count = all.filter((c) => c.toUpperCase() === base).length;
      return { base, count, fraction: all.length ? count / all.length : 0 };
    })
    .sort((x, y) => y.count - x.count || x.base.localeCompare(y.base));
  const gc = all.filter((c) => c.toUpperCase() === 'G' || c.toUpperCase() === 'C').length;
  const at = all.filter((c) => c.toUpperCase() === 'A' || c.toUpperCase() === 'T').length;
  return {
    length: all.length,
    gcFraction: all.length ? gc / all.length : 0,
    gc,
    at,
    composition,
  };
}

/** GC1 / GC2 / GC3 for a coding sequence (codon-position-specific GC content). */
export function codonGc(seq: string): { gc1: number; gc2: number; gc3: number } {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  let g1 = 0;
  let g2 = 0;
  let g3 = 0;
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  for (let i = 0; i + 2 < s.length; i += 3) {
    n1 += 1;
    n2 += 1;
    n3 += 1;
    if (s[i] === 'G' || s[i] === 'C') g1 += 1;
    if (s[i + 1] === 'G' || s[i + 1] === 'C') g2 += 1;
    if (s[i + 2] === 'G' || s[i + 2] === 'C') g3 += 1;
  }
  return {
    gc1: n1 ? g1 / n1 : 0,
    gc2: n2 ? g2 / n2 : 0,
    gc3: n3 ? g3 / n3 : 0,
  };
}

/** Sliding-window GC content (window size ≥ 2). */
export function gcWindow(seq: string, window = 20): { pos: number[]; gc: number[] } {
  const s = seq.toUpperCase();
  const pos: number[] = [];
  const gc: number[] = [];
  for (let i = 0; i + window <= s.length; i += 1) {
    const win = s.slice(i, i + window);
    const g = (win.match(/[GC]/g) ?? []).length;
    pos.push(i + window / 2);
    gc.push(g / window);
  }
  if (pos.length === 0) {
    pos.push(s.length / 2);
    gc.push((s.match(/[GC]/g) ?? []).length / Math.max(s.length, 1));
  }
  return { pos, gc };
}

export interface AlignResult {
  score: number;
  seqA: string;
  seqB: string;
  alignedA: string;
  alignedB: string;
  identity: number; // fraction of aligned non-gap positions with identical residue
  positive: number; // fraction of aligned positions with score > 0 (similar)
  length: number; // aligned length (excluding terminal gaps only for global? we report full span)
  gaps: number;
  mode: 'global' | 'local';
}

/**
 * Needleman-Wunsch global alignment with affine gaps. Uses three DP matrices
 * (M matching, X gap-in-A, Y gap-in-B) — the standard O(n·m) formulation.
 */
export function alignGlobal(a: string, b: string, matrix: SubMatrix, gap: GapModel): AlignResult {
  return runAlign(a, b, matrix, gap, false);
}

/** Smith-Waterman local alignment (best local segment). */
export function alignLocal(a: string, b: string, matrix: SubMatrix, gap: GapModel): AlignResult {
  return runAlign(a, b, matrix, gap, true);
}

function runAlign(a: string, b: string, matrix: SubMatrix, gap: GapModel, local: boolean): AlignResult {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    return {
      score: 0, seqA: a, seqB: b, alignedA: '', alignedB: '',
      identity: 0, positive: 0, length: 0, gaps: 0, mode: local ? 'local' : 'global',
    };
  }
  const NEG = -Infinity;
  const d = gap.open;
  const e = gap.extend;
  // Three affine DP matrices (Durbin et al.):
  //   M  x_i matched to y_j
  //   Ix x_i aligned to a gap (y_j skipped)  → consumes x_i
  //   Iy y_j aligned to a gap (x_i skipped)  → consumes y_j
  const M = make2(n + 1, m + 1, NEG);
  const Ix = make2(n + 1, m + 1, NEG);
  const Iy = make2(n + 1, m + 1, NEG);
  // predecessors (which table led into each cell): 1=M,2=Ix,3=Iy
  const pM = make2(n + 1, m + 1, 0);
  const pIx = make2(n + 1, m + 1, 0);
  const pIy = make2(n + 1, m + 1, 0);

  M[0]![0] = 0;
  if (!local) {
    for (let j = 1; j <= m; j += 1) Iy[0]![j] = d + (j - 1) * e;
    for (let i = 1; i <= n; i += 1) Ix[i]![0] = d + (i - 1) * e;
  }

  let best = 0;
  let bi = 0;
  let bj = 0;

  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (i === 0 && j === 0) continue;
      // Ix: consume x_i against a gap
      if (i > 0) {
        const aM = M[i - 1]![j]! + d;
        const aX = Ix[i - 1]![j]! + e;
        const m1 = aM > aX ? aM : aX;
        Ix[i]![j] = local && m1 < 0 ? 0 : m1;
        pIx[i]![j] = aM >= aX ? 1 : 2;
      }
      // Iy: consume y_j against a gap
      if (j > 0) {
        const aM = M[i]![j - 1]! + d;
        const aY = Iy[i]![j - 1]! + e;
        const m2 = aM > aY ? aM : aY;
        Iy[i]![j] = local && m2 < 0 ? 0 : m2;
        pIy[i]![j] = aM >= aY ? 1 : 3;
      }
      // M: x_i ↔ y_j
      if (i > 0 && j > 0) {
        const sc = matrix.build(a[i - 1]!, b[j - 1]!);
        const cand = Math.max(M[i - 1]![j - 1]!, Ix[i - 1]![j - 1]!, Iy[i - 1]![j - 1]!);
        pM[i]![j] = cand === M[i - 1]![j - 1]! ? 1 : cand === Ix[i - 1]![j - 1]! ? 2 : 3;
        const mv = cand + sc;
        M[i]![j] = local && mv < 0 ? 0 : mv;
      }
      if (local) {
        const lc = Math.max(M[i]![j]!, Ix[i]![j]!, Iy[i]![j]!);
        if (lc > best) {
          best = lc;
          bi = i;
          bj = j;
        }
      }
    }
  }

  if (local) {
    if (best <= 0) {
      return {
        score: 0, seqA: a, seqB: b, alignedA: '', alignedB: '',
        identity: 0, positive: 0, length: 0, gaps: 0, mode: 'local',
      };
    }
    const r = traceback(a, b, bi, bj, M, Ix, Iy, pM, pIx, pIy, true);
    r.score = best;
    return r;
  }

  const fin = Math.max(M[n]![m]!, Ix[n]![m]!, Iy[n]![m]!);
  const cur = fin === M[n]![m]! ? 1 : fin === Iy[n]![m]! ? 3 : 2;
  const res = traceback(a, b, n, m, M, Ix, Iy, pM, pIx, pIy, false);
  res.score = cur === 1 ? M[n]![m]! : cur === 2 ? Ix[n]![m]! : Iy[n]![m]!;
  return res;
}

function traceback(
  a: string,
  b: string,
  i: number,
  j: number,
  M: number[][],
  Ix: number[][],
  Iy: number[][],
  pM: number[][],
  pIx: number[][],
  pIy: number[][],
  local: boolean,
): AlignResult {
  const resA: string[] = [];
  const resB: string[] = [];
  let cur: number;
  if (local) {
    cur = Math.max(M[i]![j]!, Ix[i]![j]!, Iy[i]![j]!);
    cur = cur === M[i]![j]! ? 1 : cur === Iy[i]![j]! ? 3 : 2;
  } else {
    const fin = Math.max(M[i]![j]!, Ix[i]![j]!, Iy[i]![j]!);
    cur = fin === M[i]![j]! ? 1 : fin === Iy[i]![j]! ? 3 : 2;
  }
  while (i > 0 || j > 0) {
    if (local) {
      const val = cur === 1 ? M[i]![j]! : cur === 2 ? Ix[i]![j]! : Iy[i]![j]!;
      if (val <= 0) break;
    }
    if (cur === 1) {
      if (i === 0 || j === 0) break;
      resA.unshift(a[i - 1]!);
      resB.unshift(b[j - 1]!);
      cur = pM[i]![j]!;
      i -= 1;
      j -= 1;
    } else if (cur === 2) {
      if (i === 0) break;
      resA.unshift(a[i - 1]!);
      resB.unshift('-');
      cur = pIx[i]![j]!;
      i -= 1;
    } else {
      if (j === 0) break;
      resA.unshift('-');
      resB.unshift(b[j - 1]!);
      cur = pIy[i]![j]!;
      j -= 1;
    }
    if (local && cur === 0) break;
  }
  const alignedA = resA.join('');
  const alignedB = resB.join('');
  return summarize(alignedA, alignedB, local);
}

function summarize(alignedA: string, alignedB: string, local: boolean): AlignResult {
  let identical = 0;
  let positive = 0;
  let pos = 0;
  let gaps = 0;
  for (let k = 0; k < alignedA.length; k += 1) {
    const aa = alignedA[k]!;
    const bb = alignedB[k]!;
    if (aa === '-' || bb === '-') {
      gaps += 1;
      continue;
    }
    pos += 1;
    if (aa.toUpperCase() === bb.toUpperCase()) identical += 1;
    if (aa === bb) positive += 1;
  }
  return {
    score: 0, // recompute by caller when needed
    seqA: '',
    seqB: '',
    alignedA,
    alignedB,
    identity: pos ? identical / pos : 0,
    positive: pos ? positive / pos : 0,
    length: alignedA.length,
    gaps,
    mode: local ? 'local' : 'global',
  };
}

function make2(rows: number, cols: number, fill: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

/** Canonical DNA helper: reverse complement. */
export function revcomp(seq: string): string {
  const map: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N', a: 't', t: 'a', g: 'c', c: 'g', n: 'n' };
  return [...seq].reverse().map((c) => map[c] ?? 'N').join('');
}

/** A named sequence record. */
export interface SeqEntry {
  id?: string;
  description?: string;
  sequence: string;
}

/** Parse FASTA text into named sequence records (empty id when no header). */
export function parseFasta(text: string): SeqEntry[] {
  const out: SeqEntry[] = [];
  let cur: { id: string; description: string; seq: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) {
      if (cur) out.push({ id: cur.id || undefined, description: cur.description || undefined, sequence: cur.seq.join('') });
      const header = line.slice(1).trim();
      const [id, ...desc] = header.split(/\s+/);
      cur = { id: id ?? '', description: desc.join(' '), seq: [] };
    } else if (cur) {
      cur.seq.push(line.replace(/[\s0-9]/g, ''));
    }
  }
  if (cur) out.push({ id: cur.id || undefined, description: cur.description || undefined, sequence: cur.seq.join('') });
  return out.filter((e) => e.sequence.length > 0);
}

/** One or two bare sequences separated by a blank line / `seqA:seqB`. */
export function parseBareSequences(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const labelRe = /^seq[A-Za-z]*\s*[:=]\s*/i;
  // Labeled lines: `sequenceA: ATGC` / `sequenceA=ATGC` → one entry per line.
  if (lines.every((l) => labelRe.test(l))) {
    return lines.map((l) => l.replace(labelRe, '').replace(/[\s0-9]/g, '')).filter((s) => s.length > 0);
  }
  const hasBlank = /\r?\n\s*\r?\n/.test(text);
  const clean = (s: string) => s.replace(/[\s0-9]/g, '');
  if (hasBlank) {
    // Blank-line separated blocks → each block is one sequence.
    const blocks = text
      .split(/\r?\n\s*\r?\n/)
      .map((b) => clean(b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('')))
      .filter((s) => s.length > 0);
    return blocks;
  }
  // No blank-lines → treat each nonempty line as a separate sequence.
  return lines.map(clean).filter((s) => s.length > 0);
}

/**
 * Parse sequence data from JSON text: either `[seqA, seqB]`, `{a,b}` /
 * `{seqA,seqB}`, a FASTA-shaped object, or an array of `{id,sequence}`.
 */
export function parseSequenceJson(text: string): SeqEntry[] | null {
  try {
    const json = JSON.parse(text) as unknown;
    if (typeof json === 'string') return [{ sequence: json.replace(/[\s0-9]/g, '') }];
    if (Array.isArray(json)) {
      const out: SeqEntry[] = [];
      for (const it of json) {
        if (typeof it === 'string') out.push({ sequence: it.replace(/[\s0-9]/g, '') });
        else if (it && typeof it === 'object') {
          const o = it as { id?: string; header?: string; def?: string; sequence?: string; seq?: string };
          const s = (o.sequence ?? o.seq ?? '') as string;
          if (s) out.push({ id: o.id ?? o.header ?? o.def, sequence: s.replace(/[\s0-9]/g, '') });
        }
      }
      return out;
    }
    if (json && typeof json === 'object') {
      const o = json as Record<string, unknown>;
      const seqA = o.sequenceA ?? o.a ?? o.seqA ?? o['sequence a'];
      const seqB = o.sequenceB ?? o.b ?? o.seqB ?? o['sequence b'];
      const a = typeof seqA === 'string' ? seqA.replace(/[\s0-9]/g, '') : '';
      const b = typeof seqB === 'string' ? seqB.replace(/[\s0-9]/g, '') : '';
      const out: SeqEntry[] = [];
      if (a) out.push({ id: 'a', sequence: a });
      if (b) out.push({ id: 'b', sequence: b });
      return out.length ? out : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse two-column CSV/TSV into up to two sequence entries. */
export function parseSequenceTable(text: string): SeqEntry[] {
  const headerRe = /^(id|seq|sequenc[ea])\s*(a|b)?$/i;
  const out: SeqEntry[] = [];
  outer: for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(/[,\t]+/).map((c) => c.trim()).filter(Boolean);
    // Skip a header / index row entirely (all tokens are non-sequence).
    if (cells.every((c) => headerRe.test(c) || !/[ACGUacgu]/.test(c))) continue;
    for (const cell of cells) {
      if (/^[ACGTUNRYSWKMBDHVacgtunryswkmbdhv]+$/.test(cell.replace(/^"?|"?$/g, ''))) {
        out.push({ sequence: cell.replace(/[\s0-9"']/g, '') });
        if (out.length >= 2) break outer;
      }
    }
  }
  return out.filter((e) => e.sequence.length > 0);
}