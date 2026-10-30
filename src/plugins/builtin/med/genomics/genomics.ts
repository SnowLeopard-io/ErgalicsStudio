// ==========================================================================
// med-genomics — pure genomics statistics kernel (no DOM, unit-testable)
//
// CSV intake with tolerant header resolution (delimiter sniffing, comment
// skipping, normalized column matching), GWAS statistics (genomic inflation
// lambda, Bonferroni threshold, Manhattan/QQ shaping), volcano classification,
// LD matrix / long-table parsing, a classic weighted Kolmogorov-Smirnov GSEA
// with a seeded permutation null, and circos rearrangement shaping. Everything
// is a pure function over typed arrays so the hot paths stay fast on 20k+
// variant tables and the math stays directly testable.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

// ---- generic CSV helpers --------------------------------------------------

export type Delimiter = ',' | '\t' | ';';

/** Keep non-empty, non-comment lines; unwrap a `#CHROM` header marker. */
export function dataLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 35 /* '#' */) {
      if (/^#chr/i.test(line)) out.push(line.slice(1));
      continue;
    }
    out.push(line);
  }
  return out;
}

function countChar(s: string, ch: string): number {
  let c = 0;
  for (let i = 0; i < s.length; i += 1) if (s[i] === ch) c += 1;
  return c;
}

function detectFromLine(line: string | undefined): Delimiter {
  if (!line) return ',';
  const opts: Array<[Delimiter, number]> = [
    [',', countChar(line, ',')],
    ['\t', countChar(line, '\t')],
    [';', countChar(line, ';')],
  ];
  opts.sort((a, b) => b[1] - a[1]);
  const best = opts[0]!;
  return best[1] > 0 ? best[0] : ',';
}

/** Sniff the field delimiter from the first non-comment line. */
export function detectDelimiter(text: string): Delimiter {
  return detectFromLine(dataLines(text)[0]);
}

/** Lowercase and strip every non-alphanumeric character (`adj.P.Val` -> `adjpval`). */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isNumericCell(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return Number.isFinite(Number(t));
}

/** A row is a header when its second field is not a number. */
function isHeaderRow(cells: string[]): boolean {
  return cells.length >= 2 && !isNumericCell(cells[1] ?? '');
}

function findColumn(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

// ---- chromosomes ----------------------------------------------------------

/** Strip quotes and the `chr` prefix; canonicalize `MT` -> `M`, digits. */
export function normalizeChr(raw: string): string {
  let s = raw.trim().replace(/^["']|["']$/g, '');
  s = s.replace(/^chr/i, '');
  if (!s) return '?';
  if (/^\d+$/.test(s)) return String(Number(s));
  const up = s.toUpperCase();
  return up === 'MT' ? 'M' : up;
}

/** Sort key: 1..22, then X (23), Y (24), M (25), anything else last. */
export function chrRank(chr: string): number {
  const s = normalizeChr(chr);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= 22) return n;
    return 99;
  }
  if (s === 'X') return 23;
  if (s === 'Y') return 24;
  if (s === 'M') return 25;
  return 99;
}

export function compareChr(a: string, b: string): number {
  const ra = chrRank(a);
  const rb = chrRank(b);
  if (ra !== rb) return ra - rb;
  return normalizeChr(a).localeCompare(normalizeChr(b));
}

// ---- GWAS -----------------------------------------------------------------

export const GENOMEWIDE_P = 5e-8;
export const SUGGESTIVE_P = 1e-5;
/** Median of the chi-square distribution with 1 df (genomic-inflation anchor). */
export const CHI2_ONE_DF_MEDIAN = 0.45493642311957283;

const CHR_COLS = ['chr', 'chrom', 'chromosome', 'rname', 'seqnames', 'contig'];
const POS_COLS = ['pos', 'position', 'bp', 'coordinate', 'start', 'locus'];
const P_COLS = ['p', 'pvalue', 'pval', 'pv'];
const LABEL_COLS = ['label', 'gene', 'snp', 'rsid', 'marker', 'variant', 'id', 'name'];
const BETA_COLS = ['beta', 'effect', 'coef', 'coefficient', 'estimate'];
const OR_COLS = ['or', 'oddsratio', 'hazardratio', 'hr'];

export interface GwasData {
  n: number;
  /** Chromosome names sorted by `compareChr`. */
  chrNames: string[];
  /** Per-site chromosome slot into `chrNames`. */
  chrIdx: Uint8Array;
  pos: Float64Array;
  p: Float64Array;
  /** Effect column: betas as-is, odds ratios stored as ln(OR). NaN when absent. */
  effect: Float64Array | null;
  effectKind: 'beta' | 'or' | null;
  labels: string[] | null;
}

export function parseGwasCsv(text: string): GwasData | null {
  const lines = dataLines(text);
  if (lines.length < 2) return null;
  const delim = detectFromLine(lines[0]);
  const first = lines[0]!.split(delim);
  const hasHeader = isHeaderRow(first);
  const headers = hasHeader ? first.map(normName) : [];
  const start = hasHeader ? 1 : 0;
  const iChr = hasHeader ? findColumn(headers, CHR_COLS) : 0;
  const iPos = hasHeader ? findColumn(headers, POS_COLS) : 1;
  const iP = hasHeader ? findColumn(headers, P_COLS) : 2;
  if (iChr < 0 || iPos < 0 || iP < 0) return null;
  const iBeta = hasHeader ? findColumn(headers, BETA_COLS) : -1;
  const iOr = iBeta >= 0 ? -1 : hasHeader ? findColumn(headers, OR_COLS) : -1;
  const iLabel = hasHeader ? findColumn(headers, LABEL_COLS) : -1;
  const iEff = iBeta >= 0 ? iBeta : iOr;

  const chrTmp: string[] = [];
  const posTmp: number[] = [];
  const pTmp: number[] = [];
  const effTmp: number[] = [];
  const labelTmp: string[] = [];
  const reqMax = Math.max(iChr, iPos, iP);
  for (let li = start; li < lines.length; li += 1) {
    const cells = lines[li]!.split(delim);
    if (cells.length <= reqMax) continue;
    const pos = Number(cells[iPos]!.trim());
    const p = Number(cells[iP]!.trim());
    if (!Number.isFinite(pos) || pos < 0) continue;
    if (!(p > 0) || p > 1) continue; // p must live in (0, 1]
    const chr = normalizeChr(cells[iChr]!);
    if (chr === '?') continue;
    chrTmp.push(chr);
    posTmp.push(pos);
    pTmp.push(p);
    if (iEff >= 0) {
      const raw = cells[iEff] !== undefined ? Number(cells[iEff].trim()) : NaN;
      const v = Number.isFinite(raw) ? (iOr >= 0 && raw > 0 ? Math.log(raw) : raw) : NaN;
      effTmp.push(v);
    }
    labelTmp.push(iLabel >= 0 && cells[iLabel] !== undefined ? cells[iLabel].trim() : '');
  }
  const n = pTmp.length;
  if (n === 0) return null;

  const uniq = Array.from(new Set(chrTmp));
  uniq.sort(compareChr);
  const slot = new Map<string, number>();
  uniq.forEach((c, i) => slot.set(c, i));
  const chrIdx = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) chrIdx[i] = slot.get(chrTmp[i]!) ?? 0;

  return {
    n,
    chrNames: uniq,
    chrIdx,
    pos: Float64Array.from(posTmp),
    p: Float64Array.from(pTmp),
    effect: iEff >= 0 && effTmp.length === n ? Float64Array.from(effTmp) : null,
    effectKind: iBeta >= 0 ? 'beta' : iOr >= 0 ? 'or' : null,
    labels: iLabel >= 0 ? labelTmp : null,
  };
}

/** Inverse standard-normal CDF (Acklam's rational approximation). */
export function probit(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!
    ) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (
      (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
    ) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!
  ) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

/**
 * Chi-square(1 df) value whose upper tail equals `p`, via |z| = probit(1−p/2).
 * The symmetric branch (−probit(p/2) for tiny p) avoids 1−p/2 rounding to 1.
 */
export function pToChi2(p: number): number {
  const q = Math.min(Math.max(p, Number.MIN_VALUE), 1) / 2;
  const z = q > 0.025 ? probit(1 - q) : -probit(q);
  return z * z;
}

/** Genomic inflation factor λ = median(χ²₁) / 0.4549364 over a p-value sample. */
export function genomicInflationFromP(p: ArrayLike<number>): number {
  const n = p.length;
  if (n === 0) return NaN;
  const chi = new Float64Array(n);
  for (let i = 0; i < n; i += 1) chi[i] = pToChi2(p[i]!);
  chi.sort();
  const mid = n >> 1;
  const median = n % 2 === 1 ? chi[mid]! : (chi[mid - 1]! + chi[mid]!) / 2;
  return median / CHI2_ONE_DF_MEDIAN;
}

export function genomicInflation(g: GwasData): number {
  return genomicInflationFromP(g.p);
}

/** Bonferroni family-wise threshold α/n. */
export function bonferroniThreshold(n: number, alpha = 0.05): number {
  if (n <= 0) return NaN;
  return alpha / n;
}

export interface GwasSummary {
  n: number;
  lambda: number;
  minP: number;
  maxNegLog10: number;
  genomeWideHits: number;
  suggestiveHits: number;
  bonferroni: number;
  bonferroniHits: number;
}

export function gwasSummary(g: GwasData): GwasSummary {
  let minP = 1;
  let gw = 0;
  let sg = 0;
  for (let i = 0; i < g.n; i += 1) {
    const p = g.p[i]!;
    if (p < minP) minP = p;
    if (p <= GENOMEWIDE_P) gw += 1;
    else if (p <= SUGGESTIVE_P) sg += 1;
  }
  const bonf = bonferroniThreshold(g.n);
  let bonfHits = 0;
  for (let i = 0; i < g.n; i += 1) if (g.p[i]! <= bonf) bonfHits += 1;
  return {
    n: g.n,
    lambda: genomicInflation(g),
    minP,
    maxNegLog10: -Math.log10(Math.max(minP, Number.MIN_VALUE)),
    genomeWideHits: gw,
    suggestiveHits: sg,
    bonferroni: bonf,
    bonferroniHits: bonfHits,
  };
}

/** Indices of the `count` smallest p-values, ascending. */
export function topHitIndices(g: GwasData, count: number): number[] {
  const idx = Array.from({ length: g.n }, (_, i) => i);
  idx.sort((a, b) => g.p[a]! - g.p[b]!);
  return idx.slice(0, Math.max(0, count));
}

export interface QqData {
  n: number;
  /** −log10 of the expected uniform quantiles (i + 0.5)/n. */
  expected: Float64Array;
  /** −log10 of the sorted observed p-values. */
  observed: Float64Array;
  /** −log10 of the confidence band upper p (lower edge on the plot). */
  bandLo: Float64Array;
  /** −log10 of the confidence band lower p (upper edge on the plot). */
  bandHi: Float64Array;
  lambda: number;
}

/** QQ plot points with a pointwise 95% binomial confidence band. */
export function qqPlotData(g: GwasData): QqData | null {
  if (g.n < 2) return null;
  const sorted = Float64Array.from(g.p);
  sorted.sort();
  const n = g.n;
  const expected = new Float64Array(n);
  const observed = new Float64Array(n);
  const bandLo = new Float64Array(n);
  const bandHi = new Float64Array(n);
  const floor = 1 / (2 * n);
  for (let i = 0; i < n; i += 1) {
    const q = (i + 0.5) / n;
    expected[i] = -Math.log10(q);
    observed[i] = -Math.log10(Math.max(sorted[i]!, 1e-300));
    const se = 1.96 * Math.sqrt((q * (1 - q)) / n);
    const lo = Math.max(q - se, floor);
    const hi = Math.min(q + se, 1 - floor);
    bandLo[i] = -Math.log10(hi);
    bandHi[i] = -Math.log10(lo);
  }
  return { n, expected, observed, bandLo, bandHi, lambda: genomicInflation(g) };
}

// ---- Volcano --------------------------------------------------------------

const GENE_COLS = ['gene', 'genename', 'symbol', 'id', 'feature', 'probe', 'name', 'label'];
const LFC_COLS = ['log2fc', 'logfc', 'lfc', 'log2foldchange', 'log2foldchanges', 'logratio', 'log2ratio'];
const Q_COLS = ['padj', 'adjpval', 'adjpvalue', 'adjustedpvalue', 'fdr', 'qvalue', 'qval', 'q', 'pvalue', 'pval', 'p', 'pv'];

export interface VolcanoData {
  n: number;
  gene: string[];
  log2fc: Float64Array;
  padj: Float64Array;
}

export function parseVolcanoCsv(text: string): VolcanoData | null {
  const lines = dataLines(text);
  if (lines.length < 2) return null;
  const delim = detectFromLine(lines[0]);
  const first = lines[0]!.split(delim);
  const hasHeader = isHeaderRow(first);
  const headers = hasHeader ? first.map(normName) : [];
  const start = hasHeader ? 1 : 0;
  const iGene = hasHeader ? findColumn(headers, GENE_COLS) : 0;
  const iLfc = hasHeader ? findColumn(headers, LFC_COLS) : 1;
  const iQ = hasHeader ? findColumn(headers, Q_COLS) : 2;
  if (iGene < 0 || iLfc < 0 || iQ < 0) return null;
  const reqMax = Math.max(iGene, iLfc, iQ);

  const genes: string[] = [];
  const lfc: number[] = [];
  const q: number[] = [];
  for (let li = start; li < lines.length; li += 1) {
    const cells = lines[li]!.split(delim);
    if (cells.length <= reqMax) continue;
    const gene = cells[iGene]!.trim();
    const fc = Number(cells[iLfc]!.trim());
    const pv = Number(cells[iQ]!.trim());
    if (!gene || !Number.isFinite(fc) || !Number.isFinite(pv) || pv < 0) continue;
    genes.push(gene);
    lfc.push(fc);
    q.push(Math.min(pv, 1) || 1e-300); // padj = 0 would blow up -log10
  }
  const n = q.length;
  if (n === 0) return null;
  return { n, gene: genes, log2fc: Float64Array.from(lfc), padj: Float64Array.from(q) };
}

export interface VolcanoSummary {
  total: number;
  up: number;
  down: number;
  ns: number;
  fcThresh: number;
  qThresh: number;
  minPadj: number;
  maxAbsLog2fc: number;
}

export function volcanoSummary(v: VolcanoData, fcThresh: number, qThresh: number): VolcanoSummary {
  let up = 0;
  let down = 0;
  let minPadj = 1;
  let maxAbs = 0;
  for (let i = 0; i < v.n; i += 1) {
    const fc = v.log2fc[i]!;
    const q = v.padj[i]!;
    if (q < minPadj) minPadj = q;
    const a = Math.abs(fc);
    if (a > maxAbs) maxAbs = a;
    if (q <= qThresh && fc >= fcThresh) up += 1;
    else if (q <= qThresh && fc <= -fcThresh) down += 1;
  }
  return {
    total: v.n,
    up,
    down,
    ns: v.n - up - down,
    fcThresh,
    qThresh,
    minPadj,
    maxAbsLog2fc: maxAbs,
  };
}

/** Top `count` genes by significance (padj asc, then |log2fc| desc). */
export function topVolcanoIndices(v: VolcanoData, count: number): number[] {
  const idx = Array.from({ length: v.n }, (_, i) => i);
  idx.sort((a, b) => {
    const qa = Math.max(v.padj[a]!, 1e-300);
    const qb = Math.max(v.padj[b]!, 1e-300);
    if (qa !== qb) return qa - qb;
    return Math.abs(v.log2fc[b]!) - Math.abs(v.log2fc[a]!);
  });
  return idx.slice(0, Math.max(0, count));
}

// ---- LD (linkage disequilibrium) ------------------------------------------

export interface LdData {
  n: number;
  ids: string[];
  /** Row-major n×n r² matrix with a unit diagonal. */
  r2: Float64Array;
}

function buildLdFromMatrix(rows: string[][], ids: string[], valueStart: number): LdData {
  const n = ids.length;
  const r2 = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    const row = rows[i]!;
    for (let j = 0; j < n; j += 1) {
      const cell = row[j + valueStart];
      const v = cell !== undefined ? Number(cell.trim()) : NaN;
      r2[i * n + j] = Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : i === j ? 1 : 0;
    }
    r2[i * n + i] = 1;
  }
  return { n, ids, r2 };
}

/**
 * Parse an LD table with three accepted layouts:
 *  (a) headerless numeric square matrix,
 *  (b) square matrix with an id header row and/or row-label column,
 *  (c) long table `pos_i, pos_j, r2` (header optional).
 */
export function parseLdCsv(text: string): LdData | null {
  const lines = dataLines(text);
  if (lines.length < 2) return null;
  const delim = detectFromLine(lines[0]);
  const rows = lines.map((l) => l.split(delim));
  const w = rows[0]!.length;

  // (a) headerless all-numeric square matrix
  if (w === rows.length && rows.every((r) => r.length === w && r.every(isNumericCell))) {
    const n = w;
    const ids = Array.from({ length: n }, (_, i) => String(i + 1));
    const r2 = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        r2[i * n + j] = Number(rows[i]![j]!);
      }
      r2[i * n + i] = 1;
    }
    return { n, ids, r2 };
  }

  // (b) id header row: header has w cells, data rows are label + n numeric
  const head = rows[0]!;
  if (
    rows.length === w &&
    rows.length >= 3 &&
    head[0] !== undefined &&
    !isNumericCell(head[0]) &&
    head.slice(1).every((c) => !isNumericCell(c)) &&
    rows.slice(1).every((r) => r.length === w && r.slice(1).every(isNumericCell))
  ) {
    const ids = rows.slice(1).map((r) => r[0]!.trim());
    return buildLdFromMatrix(rows.slice(1), ids, 1);
  }

  // (b2) row-label square matrix without a header: label + n values per row
  if (
    w - 1 === rows.length &&
    head[0] !== undefined &&
    !isNumericCell(head[0]) &&
    rows.every((r) => r.length === w && r.slice(1).every(isNumericCell))
  ) {
    const ids = rows.map((r) => r[0]!.trim());
    return buildLdFromMatrix(rows, ids, 1);
  }

  // (c) long table: id/pos pairs with an r² column
  if (w >= 3) {
    const first = rows[0]!;
    const header = !isNumericCell(first[0] ?? '') || !isNumericCell(first[1] ?? '');
    const headers = header ? first.map(normName) : [];
    const iA = header ? findColumn(headers, ['posi', 'idi', 'i', 'a', 'from', 'snp1', 'id1', 'site1', 'variant1']) : 0;
    const iB = header ? findColumn(headers, ['posj', 'idj', 'j', 'b', 'to', 'snp2', 'id2', 'site2', 'variant2']) : 1;
    const iR = header ? findColumn(headers, ['r2', 'rsquare', 'ld', 'dprime']) : 2;
    if (iA < 0 || iB < 0 || iR < 0) return null;
    const start = header ? 1 : 0;
    const idSet = new Set<string>();
    const pairs: Array<[string, string, number]> = [];
    for (let li = start; li < rows.length; li += 1) {
      const r = rows[li]!;
      if (r.length <= Math.max(iA, iB, iR)) continue;
      const a = r[iA]!.trim();
      const b = r[iB]!.trim();
      const v = Number(r[iR]!.trim());
      if (!a || !b || !Number.isFinite(v)) continue;
      idSet.add(a);
      idSet.add(b);
      pairs.push([a, b, Math.min(Math.max(v, 0), 1)]);
    }
    const ids = Array.from(idSet);
    const allNumeric = ids.every((s) => Number.isFinite(Number(s)));
    ids.sort(allNumeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b));
    const n = ids.length;
    if (n < 2 || pairs.length === 0) return null;
    const slot = new Map<string, number>();
    ids.forEach((id, i) => slot.set(id, i));
    const r2 = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) r2[i * n + i] = 1;
    for (const [a, b, v] of pairs) {
      const ia = slot.get(a)!;
      const ib = slot.get(b)!;
      r2[ia * n + ib] = v;
      r2[ib * n + ia] = v;
    }
    return { n, ids, r2 };
  }

  return null;
}

export interface LdSummary {
  n: number;
  maxR2: number;
  meanR2: number;
  maxI: number;
  maxJ: number;
}

/** Off-diagonal r² statistics (upper triangle only). */
export function ldSummary(d: LdData): LdSummary {
  let max = 0;
  let sum = 0;
  let count = 0;
  let mi = 0;
  let mj = 0;
  for (let i = 0; i < d.n; i += 1) {
    for (let j = i + 1; j < d.n; j += 1) {
      const v = d.r2[i * d.n + j]!;
      sum += v;
      count += 1;
      if (v > max) {
        max = v;
        mi = i;
        mj = j;
      }
    }
  }
  return { n: d.n, maxR2: max, meanR2: count > 0 ? sum / count : NaN, maxI: mi, maxJ: mj };
}

export interface LdBlock {
  /** First locus index (inclusive). */
  start: number;
  /** Last locus index + 1 (exclusive). */
  end: number;
  size: number;
  /** Minimum pairwise r² inside the block. */
  minR2: number;
}

/**
 * Largest contiguous window whose every pair of loci keeps r² ≥ threshold.
 * Falls back to the single strongest pair when no such window exists.
 */
export function maxLdBlock(d: LdData, threshold = 0.5): LdBlock | null {
  const n = d.n;
  if (n < 2) return null;
  let best: LdBlock | null = null;
  for (let start = 0; start < n - 1; start += 1) {
    let minIn = 1;
    for (let end = start + 1; end <= n; end += 1) {
      // extend by locus (end-1) and check it against the current window
      const last = end - 1;
      let ok = true;
      let windowMin = minIn;
      for (let k = start; k < last; k += 1) {
        const v = d.r2[k * n + last]!;
        if (v < threshold) {
          ok = false;
          break;
        }
        if (v < windowMin) windowMin = v;
      }
      if (!ok) break;
      minIn = windowMin;
      const size = end - start;
      if (!best || size > best.size) best = { start, end, size, minR2: minIn };
    }
  }
  if (best) return best;
  // Fallback: strongest single pair, reported as a 2-locus interval.
  const s = ldSummary(d);
  const i = Math.min(s.maxI, s.maxJ);
  return {
    start: i,
    end: i + 2,
    size: 2,
    minR2: s.maxR2,
  };
}

// ---- GSEA -----------------------------------------------------------------

const SCORE_COLS = ['score', 'stat', 'statistic', 't', 'value', 'z', 'nes', 'metric', 'log2fc', 'logfc', 'lfc', 'coefficient', 'estimate'];

export interface RankedList {
  n: number;
  gene: string[];
  /** Sorted descending (stable) — the preranked gene order. */
  score: Float64Array;
}

export function parseRankedCsv(text: string): RankedList | null {
  const lines = dataLines(text);
  if (lines.length < 2) return null;
  const delim = detectFromLine(lines[0]);
  const first = lines[0]!.split(delim);
  const hasHeader = isHeaderRow(first);
  const headers = hasHeader ? first.map(normName) : [];
  const start = hasHeader ? 1 : 0;
  const iGene = hasHeader ? findColumn(headers, GENE_COLS) : 0;
  const iScore = hasHeader ? findColumn(headers, SCORE_COLS) : 1;
  if (iGene < 0 || iScore < 0) return null;
  const reqMax = Math.max(iGene, iScore);

  const genes: string[] = [];
  const scores: number[] = [];
  for (let li = start; li < lines.length; li += 1) {
    const cells = lines[li]!.split(delim);
    if (cells.length <= reqMax) continue;
    const gene = cells[iGene]!.trim();
    const s = Number(cells[iScore]!.trim());
    if (!gene || !Number.isFinite(s)) continue;
    genes.push(gene);
    scores.push(s);
  }
  const n = scores.length;
  if (n < 2) return null;
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => scores[b]! - scores[a]!); // stable: ties keep file order
  const outGene = new Array<string>(n);
  const outScore = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    outGene[k] = genes[order[k]!]!;
    outScore[k] = scores[order[k]!]!;
  }
  return { n, gene: outGene, score: outScore };
}

function hitMaskOf(ranked: RankedList, geneSet: Iterable<string>): Uint8Array {
  const set = new Set<string>();
  for (const g of geneSet) {
    const k = g.trim().toLowerCase();
    if (k) set.add(k);
  }
  const mask = new Uint8Array(ranked.n);
  for (let i = 0; i < ranked.n; i += 1) {
    if (set.has((ranked.gene[i] ?? '').toLowerCase())) mask[i] = 1;
  }
  return mask;
}

/**
 * Classic weighted running-sum enrichment score: hits step up by
 * |score|/Σ|score| (weight=1) and non-hits step down by 1/(N−Nh);
 * ES is the running sum at its largest-absolute deviation.
 */
function computeEs(
  scores: ArrayLike<number>,
  mask: Uint8Array,
  weight: number,
  keepRunning: boolean,
): { es: number; esIndex: number; running: Float64Array | null } {
  const n = scores.length;
  let nh = 0;
  for (let i = 0; i < n; i += 1) nh += mask[i]!;
  if (nh === 0 || nh === n) return { es: 0, esIndex: -1, running: null };
  let sumHit = 0;
  for (let i = 0; i < n; i += 1) if (mask[i]) sumHit += Math.abs(scores[i]!) ** weight;
  const uniform = !(sumHit > 0);
  const missStep = -1 / (n - nh);
  const running = keepRunning ? new Float64Array(n) : null;
  let run = 0;
  let bestAbs = -1;
  let bestIdx = 0;
  let bestVal = 0;
  for (let i = 0; i < n; i += 1) {
    if (mask[i]) {
      const w = Math.abs(scores[i]!) ** weight;
      run += uniform ? 1 / nh : w / sumHit;
    } else {
      run += missStep;
    }
    if (running) running[i] = run;
    const a = Math.abs(run);
    if (a > bestAbs) {
      bestAbs = a;
      bestIdx = i;
      bestVal = run;
    }
  }
  return { es: bestVal, esIndex: bestIdx, running };
}

export interface GseaCoreResult {
  es: number;
  esIndex: number;
  runningEs: Float64Array;
  hits: number[];
  setSize: number;
}

export function gseaCore(ranked: RankedList, geneSet: Iterable<string>, weight = 1): GseaCoreResult | null {
  const mask = hitMaskOf(ranked, geneSet);
  const r = computeEs(ranked.score, mask, weight, true);
  if (!r.running || r.esIndex < 0) return null;
  const hits: number[] = [];
  for (let i = 0; i < ranked.n; i += 1) if (mask[i]) hits.push(i);
  if (hits.length === 0) return null;
  return { es: r.es, esIndex: r.esIndex, runningEs: r.running, hits, setSize: hits.length };
}

export const GSEA_DEFAULT_SEED = 20261029;
export const GSEA_DEFAULT_PERMUTATIONS = 200;

export interface GseaResult {
  n: number;
  setSize: number;
  es: number;
  esIndex: number;
  runningEs: Float64Array;
  hits: number[];
  /** (1 + #{null ES ≥ ES}) / (k + 1) for ES > 0 (same-direction tail). */
  nominalP: number;
  nes: number;
  /** FDR-style q from the pooled null NES of this run. */
  qValue: number;
  permutations: number;
  nullEs: Float64Array;
  nullNes: Float64Array;
  geneSet: string[];
}

/**
 * Preranked GSEA with a fixed-seed Fisher-Yates permutation null. The same
 * (ranked list, gene set, seed, permutation count) always yields identical
 * ES / nominal p / NES / q.
 */
export function runGsea(
  ranked: RankedList,
  geneSet: Iterable<string>,
  opts?: { permutations?: number; seed?: number; weight?: number },
): GseaResult | null {
  const perms = Math.max(1, Math.floor(opts?.permutations ?? GSEA_DEFAULT_PERMUTATIONS));
  const seed = opts?.seed ?? GSEA_DEFAULT_SEED;
  const weight = opts?.weight ?? 1;
  const setList = Array.from(geneSet, (g) => g.trim()).filter(Boolean);
  if (setList.length === 0) return null;
  const core = gseaCore(ranked, setList, weight);
  if (!core) return null;
  const mask = hitMaskOf(ranked, setList);

  const rng = mulberry32(seed);
  // Permute gene-set membership (fixed set size, random positions) while the
  // ranked statistic stays fixed. Shuffling the scores instead leaves the
  // running sum invariant for contiguous hits and collapses the null.
  const permMask = Uint8Array.from(mask);
  const nullEs = new Float64Array(perms);
  for (let k = 0; k < perms; k += 1) {
    for (let i = permMask.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = permMask[i]!;
      permMask[i] = permMask[j]!;
      permMask[j] = t;
    }
    nullEs[k] = computeEs(ranked.score, permMask, weight, false).es;
  }

  // NES normalizes by the mean null ES of the same sign; nominal p and q use
  // the same-direction tail (Subramanian et al. 2005).
  let sumPos = 0;
  let nPos = 0;
  let sumNeg = 0;
  let nNeg = 0;
  for (let k = 0; k < perms; k += 1) {
    const v = nullEs[k]!;
    if (v >= 0) {
      sumPos += v;
      nPos += 1;
    } else {
      sumNeg += -v;
      nNeg += 1;
    }
  }
  const meanPos = nPos > 0 ? sumPos / nPos : 0;
  const meanNegAbs = nNeg > 0 ? sumNeg / nNeg : 0;
  const norm = core.es >= 0 ? meanPos : meanNegAbs;
  const nes = norm > 0 ? core.es / norm : 0;
  const nullNes = new Float64Array(perms);
  let pCount = 0;
  let qCount = 0;
  for (let k = 0; k < perms; k += 1) {
    const v = nullEs[k]!;
    const nn = v >= 0 ? (meanPos > 0 ? v / meanPos : 0) : meanNegAbs > 0 ? v / meanNegAbs : 0;
    nullNes[k] = nn;
    if (core.es >= 0 ? v >= core.es : v <= core.es) pCount += 1;
    if (core.es >= 0 ? nn >= nes : nn <= nes) qCount += 1;
  }
  return {
    n: ranked.n,
    setSize: core.setSize,
    es: core.es,
    esIndex: core.esIndex,
    runningEs: core.runningEs,
    hits: core.hits,
    nominalP: (1 + pCount) / (perms + 1),
    nes,
    qValue: (1 + qCount) / (perms + 1),
    permutations: perms,
    nullEs,
    nullNes,
    geneSet: setList,
  };
}

// ---- Circos rearrangements ------------------------------------------------

const A_COLS = ['chra', 'chr1', 'chrom1', 'fromchr', 'sourcechr', 'chr'];
const PA_COLS = ['posa', 'pos1', 'start1', 'start', 'positiona', 'frompos', 'pos'];
const B_COLS = ['chrb', 'chr2', 'chrom2', 'tochr', 'targetchr'];
const PB_COLS = ['posb', 'pos2', 'end2', 'end', 'positionb', 'topos'];
const TYPE_COLS = ['type', 'event', 'kind', 'rearrangement', 'class'];

export interface CircosEvent {
  chrA: string;
  posA: number;
  chrB: string;
  posB: number;
  type: string;
}

export interface CircosData {
  n: number;
  events: CircosEvent[];
  /** Distinct type names in file order. */
  types: string[];
  /** Per-chromosome maximum observed position (arc length proxy). */
  lengths: Record<string, number>;
}

export function parseRearrangements(text: string): CircosData | null {
  const lines = dataLines(text);
  if (lines.length < 2) return null;
  const delim = detectFromLine(lines[0]);
  const first = lines[0]!.split(delim);
  const hasHeader = isHeaderRow(first);
  const headers = hasHeader ? first.map(normName) : [];
  const start = hasHeader ? 1 : 0;
  const iChrA = hasHeader ? findColumn(headers, A_COLS) : 0;
  const iPosA = hasHeader ? findColumn(headers, PA_COLS) : 1;
  const iChrB = hasHeader ? findColumn(headers, B_COLS) : 2;
  const iPosB = hasHeader ? findColumn(headers, PB_COLS) : 3;
  const iType = hasHeader ? findColumn(headers, TYPE_COLS) : 4;
  if (iChrA < 0 || iPosA < 0 || iChrB < 0 || iPosB < 0) return null;
  const reqMax = Math.max(iChrA, iPosA, iChrB, iPosB);

  const events: CircosEvent[] = [];
  const types: string[] = [];
  for (let li = start; li < lines.length; li += 1) {
    const cells = lines[li]!.split(delim);
    if (cells.length <= reqMax) continue;
    const chrA = normalizeChr(cells[iChrA]!);
    const posA = Number(cells[iPosA]!.trim());
    const chrB = normalizeChr(cells[iChrB]!);
    const posB = Number(cells[iPosB]!.trim());
    if (chrA === '?' || chrB === '?') continue;
    if (!Number.isFinite(posA) || !Number.isFinite(posB) || posA <= 0 || posB <= 0) continue;
    let type = iType >= 0 && cells[iType] !== undefined ? cells[iType].trim() : '';
    if (!type) type = 'rearrangement';
    if (!types.includes(type)) types.push(type);
    events.push({ chrA, posA, chrB, posB, type });
  }
  if (events.length === 0) return null;
  return { n: events.length, events, types, lengths: inferChromosomeLengths(events) };
}

/** Per-chromosome arc length = largest anchor position seen on that chromosome. */
export function inferChromosomeLengths(events: CircosEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.posA > (out[e.chrA] ?? 0)) out[e.chrA] = e.posA;
    if (e.posB > (out[e.chrB] ?? 0)) out[e.chrB] = e.posB;
  }
  return out;
}

export interface CircosSummary {
  total: number;
  crossChromosome: number;
  byType: Record<string, number>;
  chromosomes: number;
}

export function circosSummary(d: CircosData): CircosSummary {
  let cross = 0;
  const byType: Record<string, number> = {};
  for (const e of d.events) {
    if (e.chrA !== e.chrB) cross += 1;
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  return { total: d.n, crossChromosome: cross, byType, chromosomes: Object.keys(d.lengths).length };
}
