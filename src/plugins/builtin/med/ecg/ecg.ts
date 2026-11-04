// ==========================================================================
// med-ecg — ECG analysis kernel (pure TS, no DOM)
//
// Text-table / WFDB ingestion, Pan-Tompkins style QRS detection, P-QRS-T
// beat annotation, time- and frequency-domain HRV, and a rule-based rhythm
// screening. Everything here is deterministic and unit-testable; the module
// deliberately avoids any clinical claim — the thresholds are teaching-grade
// heuristics (see the plugin manifest research notes).
// ==========================================================================

import { welch } from '@/core/signal/fft';

// ---------------------------------------------------------------------------
// Table parsing (CSV / whitespace-separated text)
// ---------------------------------------------------------------------------

export interface EcgTable {
  /** Lead (column) names without the time column. */
  leadNames: string[];
  /** One Float64Array of samples (mV) per lead. */
  leads: Float64Array[];
  /** Sampling frequency in Hz (from the time column, or the default). */
  fs: number;
  /** True when an explicit time column was present. */
  hasTime: boolean;
}

// Accepts `time`, `time_s`, `time(s)`, `timestamp`, `t-sec`, … — the unit may
// arrive as an underscore/hyphen/dot suffix or in parentheses.
const TIME_TOKEN = /^(time|t|ts|sec|secs|seconds|timestamp)([_\-.].*)?(\(.*\))?$/i;

/** Strip a unit suffix such as `time(s)` / `RR(ms)` down to its base name. */
function stripUnit(token: string): string {
  const paren = token.indexOf('(');
  return paren >= 0 ? token.slice(0, paren) : token;
}

function isNumberToken(tok: string): boolean {
  if (!tok) return false;
  const v = Number(tok);
  return Number.isFinite(v);
}

/** Median of a numeric array (copies before sorting). */
export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return NaN;
  const arr: number[] = [];
  for (let i = 0; i < n; i += 1) arr.push(values[i]!);
  arr.sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 === 1 ? arr[mid]! : (arr[mid - 1]! + arr[mid]!) / 2;
}

function splitLine(line: string, comma: boolean): string[] {
  const parts = comma ? line.split(',') : line.split(/\s+/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Parse a delimited ECG table. Accepts:
 *  - CSV with a header row whose first column is a time axis
 *    (`time(s),II` / `t,V2,…) followed by numeric samples in mV;
 *  - CSV without a header (first column detected as time when strictly
 *    increasing with a near-constant step inside a plausible 1–5000 Hz band);
 *  - whitespace-separated `.txt` in the same shapes (single column = one lead
 *    sampled at `defaultFs`).
 * `#` comment lines may carry a sampling-rate hint (`# fs: 500`).
 * Returns `null` when no numeric samples can be read.
 */
export function parseEcgTable(text: string, defaultFs = 500): EcgTable | null {
  const rawLines = text.split(/\r?\n/);
  let fsHint = NaN;
  const lines: string[] = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('%')) {
      const m = /fs\s*[:=]\s*([\d.]+)/i.exec(line);
      if (m) fsHint = Number(m[1]);
      continue;
    }
    lines.push(line);
  }
  if (lines.length === 0) return null;

  const comma = lines[0]!.includes(',');
  const first = splitLine(lines[0]!, comma);
  if (first.length === 0) return null;

  // Header detection: first row has at least one non-numeric token.
  const headerless = first.every((tok) => isNumberToken(tok));
  let names: string[] | null = null;
  let start = 0;
  if (!headerless) {
    names = first.map((tok, i) => {
      const base = stripUnit(tok) || `col${i + 1}`;
      return TIME_TOKEN.test(base) ? base : base;
    });
    start = 1;
  }

  // Gather data rows with the most common column count.
  const rows: string[][] = [];
  const counts = new Map<number, number>();
  for (let i = start; i < lines.length; i += 1) {
    const cells = splitLine(lines[i]!, comma);
    if (cells.length === 0) continue;
    if (!cells.every((c) => isNumberToken(c))) continue;
    rows.push(cells);
    counts.set(cells.length, (counts.get(cells.length) ?? 0) + 1);
  }
  if (rows.length === 0) return null;
  let width = 0;
  let best = -1;
  for (const [w, c] of counts) {
    if (c > best || (c === best && w > width)) {
      best = c;
      width = w;
    }
  }
  const data = rows.filter((r) => r.length === width);
  if (data.length === 0) return null;

  // Column roles: explicit time column, or infer from a monotone first column.
  let timeCol = -1;
  if (names) {
    timeCol = names.findIndex((n) => TIME_TOKEN.test(n));
  } else if (width >= 2) {
    const col = data.map((r) => Number(r[0]));
    if (isTimeLike(col)) timeCol = 0;
  }

  let fs = Number.isFinite(fsHint) && fsHint > 0 ? fsHint : defaultFs;
  if (timeCol >= 0 && data.length >= 3) {
    const times = data.map((r) => Number(r[timeCol]));
    const dts: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
      const d = times[i]! - times[i - 1]!;
      if (d > 0) dts.push(d);
    }
    if (dts.length >= 2) {
      const step = median(dts);
      const est = 1 / step;
      // Snap to 1 mHz so decimal grids (0.002 s -> 500 Hz, 1/360 s -> 360 Hz)
      // don't surface float noise like 499.99999999999955 Hz downstream.
      if (Number.isFinite(est) && est >= 1 && est <= 5000) fs = Math.round(est * 1000) / 1000;
    }
  }

  const leadIdx: number[] = [];
  for (let c = 0; c < width; c += 1) if (c !== timeCol) leadIdx.push(c);
  if (leadIdx.length === 0) return null;

  const leadNames = leadIdx.map((c, k) => {
    if (names && names[c]) {
      const n = names[c]!;
      return TIME_TOKEN.test(n) ? `lead${k + 1}` : n;
    }
    return `lead${k + 1}`;
  });

  const leads = leadIdx.map((c) => {
    const out = new Float64Array(data.length);
    for (let i = 0; i < data.length; i += 1) out[i] = Number(data[i]![c]);
    return out;
  });

  return { leadNames, leads, fs, hasTime: timeCol >= 0 };
}

/** A first column is a time axis when it strictly increases with a steady step. */
function isTimeLike(col: number[]): boolean {
  if (col.length < 4) return false;
  const first = col[0]!;
  if (!Number.isFinite(first) || first < -1e-6) return false;
  const dts: number[] = [];
  for (let i = 1; i < col.length; i += 1) {
    const d = col[i]! - col[i - 1]!;
    if (d <= 0) return false;
    dts.push(d);
  }
  const step = median(dts);
  if (!(step > 0)) return false;
  let varSum = 0;
  for (const d of dts) varSum += (d - step) * (d - step);
  const cv = Math.sqrt(varSum / dts.length) / step;
  if (cv > 0.05) return false;
  const est = 1 / step;
  return est >= 1 && est <= 5000;
}

// ---------------------------------------------------------------------------
// WFDB (.hea header + 16-bit LE .dat signal) parsing
// ---------------------------------------------------------------------------

export interface WfdbHeader {
  name: string;
  nsig: number;
  fs: number;
  /** Sample count per signal; 0 when the header omits it. */
  nsamp: number;
  datFile: string;
  formats: string[];
  gains: number[];
  baselines: number[];
  units: string[];
  sigNames: string[];
}

const GAIN_TOKEN = /^([\d.]+)(?:\(([-\d.]+)\))?(?:\/(\S+))?$/;

/**
 * Parse a WFDB `.hea` header (tolerant reader). Line 1 carries record name,
 * signal count, sampling frequency (optionally `fs+adcres/baseline` or a
 * trailing sample count); one line per signal carries the `.dat` file, the
 * format (before `:`) and either an inline `gain(baseline)/units` or the
 * traditional `gain baseline` column pair.
 */
export function parseHeaHeader(text: string): WfdbHeader | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith(';'));
  if (lines.length === 0) return null;

  const head = lines[0]!.split(/\s+/);
  if (head.length < 3) return null;
  const name = head[0]!;
  const nsig = Number.parseInt(head[1]!, 10);
  if (!Number.isFinite(nsig) || nsig <= 0) return null;

  const fsToken = head[2] ?? '';
  const fsNum = Number.parseFloat(fsToken);
  if (!Number.isFinite(fsNum) || fsNum <= 0) return null;
  let nsamp = 0;
  for (let i = 3; i < head.length; i += 1) {
    if (/^\d+$/.test(head[i]!)) nsamp = Number.parseInt(head[i]!, 10);
  }

  const formats: string[] = [];
  const gains: number[] = [];
  const baselines: number[] = [];
  const units: string[] = [];
  const sigNames: string[] = [];
  let datFile = '';
  for (let s = 1; s <= nsig && s < lines.length; s += 1) {
    const tok = lines[s]!.split(/\s+/);
    if (tok.length < 2) return null;
    if (!datFile) datFile = tok[0]!;
    formats.push((tok[1] ?? '').split(':')[0] ?? '');
    let gain = 200;
    let baseline = 0;
    let unit = 'mV';
    let nameIdx = -1;
    for (let i = 2; i < tok.length; i += 1) {
      const raw = tok[i]!;
      const m = GAIN_TOKEN.exec(raw);
      if (!m || !/^\d/.test(raw)) continue;
      if (raw.includes('(') || raw.includes('/')) {
        // Inline `gain(baseline)/units` form.
        gain = Number.parseFloat(m[1]!);
        if (m[2] !== undefined) baseline = Number.parseFloat(m[2]);
        if (m[3] !== undefined) unit = m[3];
        nameIdx = i + 1;
        break;
      }
      const next = tok[i + 1];
      if (next !== undefined && /^[+-]?\d/.test(next)) {
        // Traditional `gain baseline` column pair.
        gain = Number.parseFloat(raw);
        baseline = Number.parseFloat(next);
        nameIdx = i + 2;
        break;
      }
      gain = Number.parseFloat(raw);
      nameIdx = i + 1;
      break;
    }
    if (!Number.isFinite(gain) || gain === 0) gain = 200;
    if (!Number.isFinite(baseline)) baseline = 0;
    gains.push(gain);
    baselines.push(baseline);
    units.push(unit);
    // Skip the optional numeric metadata columns (adcres, adczero, initval,
    // checksum, blocksize); the signal description is the trailing text.
    const rest = nameIdx >= 0 ? tok.slice(nameIdx) : [];
    let d = 0;
    while (d < rest.length && isNumberToken(rest[d]!)) d += 1;
    const desc = rest.slice(d);
    sigNames.push(desc.length > 0 ? desc.join(' ') : `sig${s}`);
  }

  return {
    name,
    nsig,
    fs: fsNum,
    nsamp,
    datFile,
    formats,
    gains,
    baselines,
    units,
    sigNames,
  };
}

/**
 * Decode an interleaved 16-bit little-endian WFDB `.dat` buffer into per-signal
 * millivolt arrays: `mV = (raw − baseline) / gain`. Returns `null` when the
 * buffer is not an exact multiple of the record frame size or any declared
 * format is not 16-bit (`fmt16` / `fmt1`).
 */
export function decodeWfdbDat16(
  buffer: ArrayBuffer,
  nsig: number,
  nsamp: number,
  gains: number[],
  baselines: number[],
): Float64Array[] | null {
  if (nsig <= 0) return null;
  const bytes = buffer.byteLength;
  if (bytes === 0 || bytes % 2 !== 0) return null;
  const frames = bytes / 2 / nsig;
  if (!Number.isInteger(frames) || frames <= 0) return null;
  const count = nsamp > 0 ? Math.min(nsamp, frames) : frames;
  const view = new DataView(buffer);
  const out: Float64Array[] = [];
  for (let s = 0; s < nsig; s += 1) {
    const gain = gains[s] && gains[s] !== 0 ? gains[s]! : 200;
    const base = baselines[s] ?? 0;
    const col = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      const raw = view.getInt16((i * nsig + s) * 2, true);
      col[i] = (raw - base) / gain;
    }
    out.push(col);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pan-Tompkins style QRS detection
// ---------------------------------------------------------------------------

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ biquad low-pass at `fc` (bilinear pre-warped, Q = 0.7071). */
function lowpass(fc: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = s / (2 * Math.SQRT2);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - c) / 2) / a0,
    b1: (1 - c) / a0,
    b2: ((1 - c) / 2) / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** RBJ biquad high-pass at `fc`. */
function highpass(fc: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = s / (2 * Math.SQRT2);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + c) / 2) / a0,
    b1: (-(1 + c)) / a0,
    b2: ((1 + c) / 2) / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyBiquad(x: Float64Array, f: Biquad): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i += 1) {
    const x0 = x[i]!;
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** Zero-phase (forward + reversed) IIR pass with reflected edge padding. */
function filtfilt(x: Float64Array, f: Biquad, fs: number): Float64Array {
  const n = x.length;
  if (n < 8) return x.slice();
  const pad = Math.min(Math.floor(n / 3), Math.max(8, Math.round(fs * 0.5)));
  const padded = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i += 1) {
    const head = x[pad - i] ?? x[0]!;
    const tail = x[n - 1 - i] ?? x[n - 1]!;
    padded[i] = head;
    padded[n + pad + i] = tail;
  }
  for (let i = 0; i < n; i += 1) padded[pad + i] = x[i]!;
  const fwd = applyBiquad(padded, f);
  const rev = new Float64Array(fwd.length);
  for (let i = 0; i < fwd.length; i += 1) rev[i] = fwd[fwd.length - 1 - i]!;
  const bwd = applyBiquad(rev, f);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = bwd[bwd.length - 1 - (pad + i)]!;
  return out;
}

/**
 * 5–15 Hz QRS emphasis band (zero-phase): cascaded high-pass at 5 Hz and
 * low-pass at 15 Hz (both clamped for low sampling rates), which is the
 * pass-band Pan-Tompkins derives from its cascade differencers.
 */
export function bandpassQrs(x: Float64Array, fs: number): Float64Array {
  const hi = Math.min(15, fs * 0.4);
  const lo = Math.min(5, hi * 0.4);
  if (!(hi > lo * 1.2)) return x.slice();
  let y = filtfilt(x, highpass(lo, fs), fs);
  y = filtfilt(y, lowpass(hi, fs), fs);
  return y;
}

function quantileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))));
  return sorted[pos]!;
}

/**
 * Pan-Tompkins pipeline: 5–15 Hz band-pass → 5-point derivative → squaring →
 * 150 ms moving-window integration → two-level adaptive threshold with a
 * 250 ms refractory period, long-gap search-back, and ±100 ms `argmax|x|`
 * refinement back on the band-passed trace.
 *
 * `sensitivity` scales the decision threshold (>1 admits weaker beats).
 * Returns sample indices of the R peaks (ascending, ≥250 ms apart).
 */
export function detectRPeaks(signal: Float64Array, fs: number, sensitivity = 1): number[] {
  const n = signal.length;
  if (n < Math.round(fs) || !(fs > 0)) return [];
  const bp = bandpassQrs(signal, fs);

  // 5-point derivative (shape only; squaring removes the sign).
  const diff = new Float64Array(n);
  const dt = 1 / fs;
  for (let i = 0; i < n; i += 1) {
    const im2 = Math.max(0, i - 2);
    const im1 = Math.max(0, i - 1);
    const ip1 = Math.min(n - 1, i + 1);
    const ip2 = Math.min(n - 1, i + 2);
    diff[i] = (bp[im2]! + bp[im1]! - bp[ip1]! - bp[ip2]!) / (8 * dt);
  }
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i += 1) sq[i] = diff[i]! * diff[i]!;

  // Centered 150 ms moving-window integration via prefix sums.
  const w = Math.max(1, Math.round(0.15 * fs));
  const half = w >> 1;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i]! + sq[i]!;
  const integ = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + w - half);
    integ[i] = (prefix[hi]! - prefix[lo]!) / Math.max(1, hi - lo);
  }

  // Threshold seeds: noise floor (median) vs beat level (98th percentile).
  const sorted = Float64Array.from(integ);
  sorted.sort();
  const med = quantileSorted(sorted, 0.5);
  const p98 = quantileSorted(sorted, 0.98);
  if (!(p98 > med * 1.05)) return [];

  const refractory = Math.max(1, Math.round(0.25 * fs));
  const sens = Math.max(0.1, sensitivity);
  const k = 0.25 / sens;
  let spk = p98;
  let npk = med;
  const thr = () => npk + k * (spk - npk);

  const peaks: number[] = [];
  let lastR = -1;
  let rrSum = 0;
  let accepted = 0;
  let pending: Array<{ i: number; v: number }> = [];

  const refine = (approx: number): number => {
    const win = Math.round(0.1 * fs);
    const lo = Math.max(0, approx - win);
    const hi = Math.min(n - 1, approx + win);
    let best = lo;
    let bestV = -1;
    for (let i = lo; i <= hi; i += 1) {
      const v = Math.abs(bp[i]!);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    return best;
  };

  const accept = (idx: number, v: number): void => {
    const r = refine(idx);
    if (lastR >= 0 && r - lastR < refractory) return;
    if (lastR >= 0) rrSum += r - lastR;
    peaks.push(r);
    lastR = r;
    accepted += 1;
    spk = 0.125 * v + 0.875 * spk;
    pending = [];
  };

  const searchGap = (): number => {
    if (accepted >= 3) return Math.max(refractory, Math.round(1.6 * (rrSum / (accepted - 1))));
    return Math.round(1.6 * fs);
  };

  for (let i = 1; i < n - 1; i += 1) {
    const v = integ[i]!;
    const isMax = v >= integ[i - 1]! && v > integ[i + 1]!;
    if (!isMax) continue;

    // Search-back: after an unexpectedly long gap, re-test rejected maxima.
    if (lastR >= 0 && i - lastR >= searchGap() && pending.length > 0) {
      let bi = 0;
      for (let p = 1; p < pending.length; p += 1) {
        if (pending[p]!.v > pending[bi]!.v) bi = p;
      }
      const cand = pending[bi]!;
      const backThr = npk + 0.5 * (spk - npk);
      if (cand.v > backThr) accept(cand.i, cand.v);
      pending = pending.filter((p) => p.i > (lastR >= 0 ? lastR : 0) && p.i !== cand.i);
      if (lastR >= 0 && i - lastR < refractory) continue;
    }

    if (lastR >= 0 && i - lastR < refractory) {
      // Inside the refractory period: update learning rates only.
      if (v > spk) spk = 0.125 * v + 0.875 * spk;
      else npk = 0.125 * v + 0.875 * npk;
      continue;
    }

    if (v > thr()) {
      accept(i, v);
    } else {
      npk = 0.125 * v + 0.875 * npk;
      pending.push({ i, v });
    }
  }

  // Enforce the refractory distance on the final list.
  const out: number[] = [];
  for (const p of peaks) {
    if (out.length === 0 || p - out[out.length - 1]! >= refractory) out.push(p);
    else if (Math.abs(bp[p]!) > Math.abs(bp[out[out.length - 1]!]!)) out[out.length - 1] = p;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Beat annotation (P / QRS / T)
// ---------------------------------------------------------------------------

export interface BeatAnnotation {
  /** Sample index of the R peak. */
  rIndex: number;
  /** R-peak time in seconds. */
  timeS: number;
  /** Sample index of QRS onset / offset. */
  qrsOn: number;
  qrsOff: number;
  /** QRS duration in milliseconds. */
  qrsMs: number;
  /** Sample index of the detected P wave (-1 when absent). */
  pIndex: number;
  /** Sample index of the detected T wave (-1 when absent). */
  tIndex: number;
  /** Interval to the previous R peak in ms (0 for the first beat). */
  rrPrevMs: number;
  /** Interval to the next R peak in ms (0 for the last beat). */
  rrNextMs: number;
  /** Local heart rate in bpm (previous RR, falling back to the next one). */
  hrBpm: number;
  label: 'N' | 'PVC';
}

function localBaseline(signal: Float64Array, r: number, fs: number): number {
  const lo = Math.max(0, r - Math.round(0.12 * fs));
  const hi = Math.max(lo + 1, r - Math.round(0.04 * fs));
  const win = signal.subarray(lo, Math.min(signal.length, hi));
  if (win.length === 0) return 0;
  return median(win);
}

/** Linear detrend using the outer 15% medians of `win`. */
function detrended(win: Float64Array): { values: Float64Array } {
  const n = win.length;
  const edge = Math.max(1, Math.floor(n * 0.15));
  let a = 0;
  for (let i = 0; i < edge; i += 1) a += win[i]!;
  a /= edge;
  let b = 0;
  for (let i = n - edge; i < n; i += 1) b += win[i]!;
  b /= edge;
  const values = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = n > 1 ? i / (n - 1) : 0;
    values[i] = win[i]! - (a + (b - a) * t);
  }
  return { values };
}

function peakIndexIn(
  signal: Float64Array,
  lo: number,
  hi: number,
  mode: 'positive' | 'extreme',
): { index: number; value: number } {
  const start = Math.max(0, lo);
  const end = Math.min(signal.length - 1, hi);
  if (end <= start) return { index: -1, value: 0 };
  const win = signal.subarray(start, end + 1);
  const { values } = detrended(win);
  let bi = 0;
  let bv = values[0]!;
  for (let i = 1; i < values.length; i += 1) {
    const v = values[i]!;
    if (mode === 'positive' ? v > bv : Math.abs(v) > Math.abs(bv)) {
      bv = v;
      bi = i;
    }
  }
  return { index: start + bi, value: bv };
}

/**
 * Annotate every detected R peak with QRS onset/offset (isoelectric
 * walk-out from the local baseline), P and T wave positions, RR intervals,
 * beat rate and a rule-based `N`/`PVC` label.
 */
export function annotateBeats(signal: Float64Array, fs: number, rPeaks: number[]): BeatAnnotation[] {
  const n = signal.length;
  const out: BeatAnnotation[] = [];
  if (rPeaks.length === 0) return out;

  const rrAll: number[] = [];
  for (let i = 1; i < rPeaks.length; i += 1) rrAll.push(((rPeaks[i]! - rPeaks[i - 1]!) / fs) * 1000);
  const medianRr = rrAll.length > 0 ? median(rrAll) : 0;

  for (let b = 0; b < rPeaks.length; b += 1) {
    const r = rPeaks[b]!;
    if (r < 0 || r >= n) continue;
    const base = localBaseline(signal, r, fs);
    const amp = Math.abs(signal[r]! - base);

    // QRS boundaries: walk out until the trace returns within 8% of the
    // R-wave amplitude of the isoelectric line (3 consecutive samples).
    const thrQ = Math.max(0.02, 0.08 * amp);
    let on = r;
    const backCap = Math.max(2, Math.round(0.12 * fs));
    let run = 0;
    for (let i = r; i >= Math.max(0, r - backCap); i -= 1) {
      if (Math.abs(signal[i]! - base) <= thrQ) {
        run += 1;
        if (run >= 3) {
          on = i + 2;
          break;
        }
      } else run = 0;
    }
    let off = r;
    run = 0;
    const fwdCap = Math.max(2, Math.round(0.2 * fs));
    const nextR = b + 1 < rPeaks.length ? rPeaks[b + 1]! : n;
    for (let i = r; i <= Math.min(n - 1, r + fwdCap, nextR - 1); i += 1) {
      if (Math.abs(signal[i]! - base) <= thrQ) {
        run += 1;
        if (run >= 3) {
          off = i - 2;
          break;
        }
      } else run = 0;
    }
    if (off < on) off = on;
    const qrsMs = ((off - on) / fs) * 1000;

    // P wave: largest positive deflection in the 200 ms before QRS onset.
    const pEnd = on - Math.round(0.04 * fs);
    const pStart = on - Math.round(0.2 * fs);
    let pIndex = -1;
    if (pEnd > pStart + 2) {
      const p = peakIndexIn(signal, pStart, pEnd, 'positive');
      if (p.index >= 0 && p.value > 0.12 * amp) pIndex = p.index;
    }

    // T wave: largest (possibly inverted) deflection after QRS offset.
    const tStart = off + Math.round(0.04 * fs);
    const tEnd = Math.min(n - 1, off + Math.round(0.4 * fs), nextR - Math.round(0.04 * fs));
    let tIndex = -1;
    if (tEnd > tStart + 2) {
      const tw = peakIndexIn(signal, tStart, tEnd, 'extreme');
      if (tw.index >= 0 && Math.abs(tw.value) > 0.05 * amp) tIndex = tw.index;
    }

    const rrPrevMs = b > 0 ? ((r - rPeaks[b - 1]!) / fs) * 1000 : 0;
    const rrNextMs = b + 1 < rPeaks.length ? ((rPeaks[b + 1]! - r) / fs) * 1000 : 0;
    const rrLocal = rrPrevMs > 0 ? rrPrevMs : rrNextMs;
    const hrBpm = rrLocal > 0 ? 60000 / rrLocal : 0;

    out.push({
      rIndex: r,
      timeS: r / fs,
      qrsOn: on,
      qrsOff: off,
      qrsMs,
      pIndex,
      tIndex,
      rrPrevMs,
      rrNextMs,
      hrBpm,
      label: 'N',
    });
  }

  for (const beat of out) {
    if (isPvcRule(beat.qrsMs, beat.rrPrevMs, beat.rrNextMs, medianRr)) beat.label = 'PVC';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule-based rhythm screening
// ---------------------------------------------------------------------------

/**
 * Premature-ventricular-complex rule: a wide QRS (>120 ms) that arrives
 * early (previous RR < 0.9 × median) and is followed by a compensatory
 * pause (next RR > 1.15 × median). All RR inputs are milliseconds; a
 * non-positive interval makes the rule abstain.
 */
export function isPvcRule(qrsMs: number, rrPrevMs: number, rrNextMs: number, medianRrMs: number): boolean {
  if (!(medianRrMs > 0) || !(rrPrevMs > 0) || !(rrNextMs > 0)) return false;
  return qrsMs > 120 && rrPrevMs < 0.9 * medianRrMs && rrNextMs > 1.15 * medianRrMs;
}

export interface RhythmInput {
  meanHrBpm: number;
  meanRrMs: number;
  rmssdMs: number;
  /** Fraction of beats with a detectable P wave (0–1). */
  pWaveRate: number;
  pvcCount: number;
  nBeats: number;
}

export interface RhythmSummary {
  /** English conclusion, e.g. `sinus rhythm`, `suspected AFib`. */
  conclusion: string;
  conclusionZh: string;
  severity: 'ok' | 'warn';
  brady: boolean;
  tachy: boolean;
  afibSuspect: boolean;
}

/**
 * Teaching-grade rhythm screening from beat statistics:
 *  - suspected AFib: irregular RR (RMSSD/mean > 0.1) with P waves mostly
 *    absent (< 50% of beats);
 *  - sinus bradycardia < 60 bpm, sinus tachycardia > 100 bpm;
 *  - wide-QRS ectopy reported as `sinus rhythm with PVCs`.
 * Not a clinical diagnosis.
 */
export function classifyRhythm(inp: RhythmInput): RhythmSummary {
  const irregular = inp.meanRrMs > 0 && inp.rmssdMs / inp.meanRrMs > 0.1;
  const afibSuspect = irregular && inp.pWaveRate < 0.5 && inp.nBeats >= 4;
  const brady = inp.meanHrBpm > 0 && inp.meanHrBpm < 60;
  const tachy = inp.meanHrBpm > 100;
  if (afibSuspect) {
    return {
      conclusion: 'suspected AFib',
      conclusionZh: '疑似心房颤动',
      severity: 'warn',
      brady,
      tachy,
      afibSuspect: true,
    };
  }
  if (inp.pvcCount > 0) {
    return {
      conclusion: 'sinus rhythm with PVCs',
      conclusionZh: '窦性心律伴室性早搏',
      severity: 'warn',
      brady,
      tachy,
      afibSuspect: false,
    };
  }
  if (brady) {
    return {
      conclusion: 'sinus bradycardia',
      conclusionZh: '窦性心动过缓',
      severity: 'warn',
      brady: true,
      tachy,
      afibSuspect: false,
    };
  }
  if (tachy) {
    return {
      conclusion: 'sinus tachycardia',
      conclusionZh: '窦性心动过速',
      severity: 'warn',
      brady,
      tachy: true,
      afibSuspect: false,
    };
  }
  return {
    conclusion: 'sinus rhythm',
    conclusionZh: '窦性心律',
    severity: 'ok',
    brady,
    tachy,
    afibSuspect: false,
  };
}

// ---------------------------------------------------------------------------
// Heart-rate variability
// ---------------------------------------------------------------------------

export interface HrvStats {
  nIntervals: number;
  meanRrMs: number;
  /** Sample standard deviation of NN intervals (n − 1). */
  sdnnMs: number;
  /** Root mean square of successive differences (n − 1). */
  rmssdMs: number;
  /** Fraction of successive differences > 50 ms. */
  pnn50: number;
  minRrMs: number;
  maxRrMs: number;
  meanHrBpm: number;
}

/** Time-domain HRV statistics from an RR interval series (ms). */
export function hrvTimeStats(rrMs: number[]): HrvStats {
  const rr = rrMs.filter((v) => Number.isFinite(v) && v > 0);
  const n = rr.length;
  if (n === 0) {
    return {
      nIntervals: 0,
      meanRrMs: 0,
      sdnnMs: 0,
      rmssdMs: 0,
      pnn50: 0,
      minRrMs: 0,
      maxRrMs: 0,
      meanHrBpm: 0,
    };
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of rr) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sd = 0;
  for (const v of rr) sd += (v - mean) * (v - mean);
  const sdnn = n > 1 ? Math.sqrt(sd / (n - 1)) : 0;
  let sq = 0;
  let over = 0;
  for (let i = 1; i < n; i += 1) {
    const d = rr[i]! - rr[i - 1]!;
    sq += d * d;
    if (Math.abs(d) > 50) over += 1;
  }
  const rmssd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  const pnn50 = n > 1 ? over / (n - 1) : 0;
  return {
    nIntervals: n,
    meanRrMs: mean,
    sdnnMs: sdnn,
    rmssdMs: rmssd,
    pnn50,
    minRrMs: min,
    maxRrMs: max,
    meanHrBpm: mean > 0 ? 60000 / mean : 0,
  };
}

export interface HrvSpectrum {
  freqs: Float64Array;
  /** One-sided PSD of the interpolated tachogram (ms²/Hz). */
  psd: Float64Array;
  /** Interpolation rate of the RR tachogram (Hz). */
  interpHz: number;
  /** LF band power 0.04–0.15 Hz (ms²). */
  lfMs2: number;
  /** HF band power 0.15–0.4 Hz (ms²). */
  hfMs2: number;
  /** LF / HF ratio (NaN when HF power is zero). */
  lfhf: number;
  /** Total power below 0.4 Hz (ms²). */
  totalMs2: number;
}

function bandPower(freqs: Float64Array, psd: Float64Array, lo: number, hi: number, df: number): number {
  let acc = 0;
  for (let k = 0; k < freqs.length; k += 1) {
    const f = freqs[k]!;
    if (f >= lo && f < hi) acc += psd[k]! * df;
  }
  return acc;
}

/**
 * Frequency-domain HRV: the RR series is converted to a tachogram at the
 * beat times, linearly resampled at `interpHz` (default 4 Hz), mean-removed
 * and passed through Welch's averaged periodogram (hann, 50% overlap).
 * LF (0.04–0.15 Hz), HF (0.15–0.4 Hz), their ratio and the total power
 * below 0.4 Hz are integrated from the PSD. Returns `null` for series too
 * short to estimate a spectrum.
 */
export function hrvFrequency(rrMs: number[], interpHz = 4): HrvSpectrum | null {
  const rr = rrMs.filter((v) => Number.isFinite(v) && v > 0);
  if (rr.length < 3 || !(interpHz > 0)) return null;

  // Beat times of interval ends (classic tachogram anchoring).
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < rr.length; i += 1) {
    t += rr[i]! / 1000;
    times.push(t);
  }
  const t0 = times[0]!;
  const tEnd = times[times.length - 1]!;
  const dt = 1 / interpHz;
  const n = Math.floor((tEnd - t0) / dt) + 1;
  if (n < 8) return null;

  const x = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    const tq = t0 + i * dt;
    while (j + 1 < times.length - 1 && times[j + 1]! < tq) j += 1;
    const ta = times[j]!;
    const tb = times[j + 1] ?? ta;
    const ya = rr[j]!;
    const yb = rr[j + 1] ?? ya;
    const a = tb > ta ? Math.min(1, Math.max(0, (tq - ta) / (tb - ta))) : 0;
    x[i] = ya + (yb - ya) * a;
  }

  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += x[i]!;
  mean /= n;
  for (let i = 0; i < n; i += 1) x[i] = x[i]! - mean;

  const segLen = Math.min(256, n);
  let res: { freqs: Float64Array; psd: Float64Array; nfft: number };
  try {
    res = welch(x, interpHz, segLen, 'hann');
  } catch {
    return null;
  }
  const df = res.nfft > 1 ? interpHz / res.nfft : interpHz;
  const lf = bandPower(res.freqs, res.psd, 0.04, 0.15, df);
  const hf = bandPower(res.freqs, res.psd, 0.15, 0.4, df);
  const total = bandPower(res.freqs, res.psd, 0, 0.4, df);
  return {
    freqs: res.freqs,
    psd: res.psd,
    interpHz,
    lfMs2: lf,
    hfMs2: hf,
    lfhf: hf > 0 ? lf / hf : NaN,
    totalMs2: total,
  };
}
