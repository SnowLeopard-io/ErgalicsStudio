// ==========================================================================
// med-imaging — pure imaging kernel (no DOM, no Three.js, no host imports)
//
// Teaching-level DICOM Part-10 reader (uncompressed / explicit-VR and
// implicit-VR little-endian only), Hounsfield-unit conversion, window/level
// mapping, volume shaping for the host marching-tets isosurface, simple
// image processing (histogram equalization, Sobel edges), ROI / volume
// statistics, plus a minimal explicit-VR-LE writer used to build the seeded
// phantom example data (and exercised by round-trip tests).
//
// NOT a clinical DICOM implementation: no JPEG/RLE/deflated transfer
// syntaxes, no nested sequence traversal beyond delimiter skipping, and no
// palette / multi-frame handling.
// ==========================================================================

// ---- supported transfer syntaxes ------------------------------------------

const TS_IMPLICIT = '1.2.840.10008.1.2'; // implicit VR little endian
const TS_EXPLICIT = '1.2.840.10008.1.2.1'; // explicit VR little endian

/** VRs whose explicit encoding carries a 32-bit length (2 reserved bytes). */
const LONG_VR = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);
const UNDEFINED_LENGTH = 0xffffffff;

export type DicomParseReason =
  | 'no-dicom-marker'
  | 'unsupported-transfer-syntax'
  | 'unsupported-pixel-format'
  | 'invalid-dimensions'
  | 'no-pixel-data'
  | 'truncated-pixel-data';

export interface DicomElement {
  vr: string;
  offset: number;
  length: number;
}

/** One parsed single-frame DICOM image slice. */
export interface DicomSlice {
  rows: number;
  columns: number;
  samplesPerPixel: number;
  bitsAllocated: number;
  /** 0 = unsigned, 1 = two's-complement signed. */
  pixelRepresentation: number;
  /** RescaleSlope (default 1) and RescaleIntercept (default 0). */
  slope: number;
  intercept: number;
  windowCenter: number | null;
  windowWidth: number | null;
  sliceThickness: number | null;
  pixelSpacing: [number, number] | null;
  instanceNumber: number | null;
  sliceLocation: number | null;
  modality: string | null;
  transferSyntax: string;
  /** Raw pixel bytes (view into the source buffer). */
  pixelData: Uint8Array;
}

export type DicomParseResult =
  | { ok: true; slice: DicomSlice }
  | { ok: false; reason: DicomParseReason; detail?: string };

export type DicomStackParseResult =
  | { ok: true; slices: DicomSlice[] }
  | { ok: false; reason: DicomParseReason; detail?: string };

// ---- low-level byte readers -----------------------------------------------

function u16(b: Uint8Array, p: number): number {
  return b[p]! | (b[p + 1]! << 8);
}

function u32(b: Uint8Array, p: number): number {
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
}

function isVrAlpha(c1: number, c2: number): boolean {
  return c1 >= 65 && c1 <= 90 && c2 >= 65 && c2 <= 90;
}

function asciiOf(b: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i += 1) s += String.fromCharCode(b[offset + i]!);
  return s;
}

function asciiTrim(b: Uint8Array, offset: number, length: number): string {
  return asciiOf(b, offset, length).replace(/[\0 ]+$/, '');
}

/** First numeric item of a DICOM DS / IS string (backslash multi-value). */
function firstNumber(s: string): number | null {
  const token = s.split('\\')[0]!.trim();
  if (!token) return null;
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

// ---- element-stream parsing ------------------------------------------------

/**
 * Sequentially parse DICOM elements from `start`. Stops at a non-VR byte
 * pair (padding / next concatenated Part-10 preamble), at a truncated
 * header, or at the end of `end`. Undefined-length sequences and
 * encapsulated pixel data are skipped up to their (FFFE,E0DD) delimiter —
 * their contents are not traversed (teaching-level scope).
 */
function parseElements(
  bytes: Uint8Array,
  start: number,
  explicitVr: boolean,
  end: number,
): Map<number, DicomElement> {
  const out = new Map<number, DicomElement>();
  let p = start;
  while (p + 8 <= end) {
    const group = u16(bytes, p);
    const elem = u16(bytes, p + 2);
    let vr = 'UN';
    let headerLen = 8;
    let len = 0;
    if (explicitVr) {
      const c1 = bytes[p + 4]!;
      const c2 = bytes[p + 5]!;
      if (!isVrAlpha(c1, c2)) break; // padding / next file marker / corruption
      vr = String.fromCharCode(c1, c2);
      if (LONG_VR.has(vr)) {
        len = u32(bytes, p + 8);
        headerLen = 12;
      } else {
        len = u16(bytes, p + 6);
      }
    } else {
      len = u32(bytes, p + 4);
    }
    if (group === 0xfffe) {
      // Item / item delimiter / sequence delimiter: skip defined payloads.
      p += 8;
      if (len !== UNDEFINED_LENGTH) p += len;
      continue;
    }
    const valueStart = p + headerLen;
    if (len === UNDEFINED_LENGTH) {
      const stop = findSequenceDelimiter(bytes, valueStart, end);
      p = stop < 0 ? end : stop + 8;
      continue;
    }
    if (valueStart + len > end) break; // truncated, or next concatenated file
    out.set(((group << 16) | elem) >>> 0, { vr, offset: valueStart, length: len });
    p = valueStart + len;
  }
  return out;
}

/** Scan even-aligned offsets for the (FFFE,E0DD) sequence delimiter. */
function findSequenceDelimiter(bytes: Uint8Array, start: number, end: number): number {
  for (let p = start & ~1; p + 8 <= end; p += 2) {
    if (bytes[p] === 0xfe && bytes[p + 1] === 0xff && bytes[p + 2] === 0xdd && bytes[p + 3] === 0xe0) {
      return p;
    }
  }
  return -1;
}

function findDicmOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  const n = bytes.length - 3;
  for (let i = 0; i < n; i += 1) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x43 && bytes[i + 3] === 0x4d) {
      offsets.push(i);
      i += 3;
    }
  }
  return offsets;
}

/**
 * Parse one Part-10 dataset that begins at a 'DICM' marker: read the
 * always-explicit file-meta group to pick the transfer syntax, then parse
 * the main dataset accordingly. Returns the element map.
 */
function parsePart10Dataset(
  bytes: Uint8Array,
  dicmOffset: number,
): { ok: true; elements: Map<number, DicomElement>; transferSyntax: string } | { ok: false; reason: DicomParseReason; detail?: string } {
  let p = dicmOffset + 4;
  let ts = '';
  while (p + 8 <= bytes.length) {
    const group = u16(bytes, p);
    if (group !== 0x0002) break;
    const elem = u16(bytes, p + 2);
    const c1 = bytes[p + 4]!;
    const c2 = bytes[p + 5]!;
    if (!isVrAlpha(c1, c2)) return { ok: false, reason: 'no-dicom-marker' };
    const vr = String.fromCharCode(c1, c2);
    let headerLen = 8;
    let len = 0;
    if (LONG_VR.has(vr)) {
      len = u32(bytes, p + 8);
      headerLen = 12;
    } else {
      len = u16(bytes, p + 6);
    }
    const valueStart = p + headerLen;
    if (len === UNDEFINED_LENGTH || valueStart + len > bytes.length) {
      return { ok: false, reason: 'no-dicom-marker' };
    }
    if (elem === 0x0010) ts = asciiTrim(bytes, valueStart, len);
    p = valueStart + len;
  }
  let explicitVr: boolean;
  if (ts) {
    if (ts === TS_IMPLICIT) explicitVr = false;
    else if (ts === TS_EXPLICIT) explicitVr = true;
    else return { ok: false, reason: 'unsupported-transfer-syntax', detail: ts };
  } else {
    // No file meta (raw dataset): sniff the first element header.
    explicitVr = p + 6 <= bytes.length && isVrAlpha(bytes[p + 4]!, bytes[p + 5]!);
  }
  const elements = parseElements(bytes, p, explicitVr, bytes.length);
  return { ok: true, elements, transferSyntax: ts || (explicitVr ? TS_EXPLICIT : TS_IMPLICIT) };
}

function elementAt(elements: Map<number, DicomElement>, group: number, elem: number): DicomElement | undefined {
  return elements.get((((group << 16) | elem) >>> 0));
}

function usValue(bytes: Uint8Array, e: DicomElement | undefined): number | null {
  if (!e || e.length < 2) return null;
  return u16(bytes, e.offset);
}

function strValue(bytes: Uint8Array, e: DicomElement | undefined): string | null {
  if (!e) return null;
  return asciiTrim(bytes, e.offset, e.length);
}

function dsValue(bytes: Uint8Array, e: DicomElement | undefined): number | null {
  const s = strValue(bytes, e);
  return s === null ? null : firstNumber(s);
}

/** Build a DicomSlice from parsed elements, validating the pixel payload. */
function sliceFromElements(
  bytes: Uint8Array,
  elements: Map<number, DicomElement>,
  transferSyntax: string,
): DicomParseResult {
  const rows = usValue(bytes, elementAt(elements, 0x0028, 0x0010));
  const columns = usValue(bytes, elementAt(elements, 0x0028, 0x0011));
  const samples = usValue(bytes, elementAt(elements, 0x0028, 0x0002)) ?? 1;
  const bits = usValue(bytes, elementAt(elements, 0x0028, 0x0100)) ?? 16;
  const pixel = elementAt(elements, 0x7fe0, 0x0010);
  if (!rows || !columns || rows <= 0 || columns <= 0 || samples !== 1) {
    return { ok: false, reason: 'invalid-dimensions', detail: `rows=${rows} columns=${columns} samples=${samples}` };
  }
  if (bits !== 8 && bits !== 16) {
    return { ok: false, reason: 'unsupported-pixel-format', detail: `BitsAllocated=${bits}` };
  }
  if (!pixel) return { ok: false, reason: 'no-pixel-data' };
  const needed = rows * columns * (bits / 8);
  if (pixel.length < needed) return { ok: false, reason: 'truncated-pixel-data' };

  const spacingStr = strValue(bytes, elementAt(elements, 0x0028, 0x0030));
  let pixelSpacing: [number, number] | null = null;
  if (spacingStr) {
    const parts = spacingStr.split('\\').map((t) => Number(t.trim()));
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      pixelSpacing = [parts[0]!, parts[1]!];
    }
  }

  const slice: DicomSlice = {
    rows,
    columns,
    samplesPerPixel: samples,
    bitsAllocated: bits,
    pixelRepresentation: usValue(bytes, elementAt(elements, 0x0028, 0x0103)) ?? 0,
    slope: dsValue(bytes, elementAt(elements, 0x0028, 0x1053)) ?? 1,
    intercept: dsValue(bytes, elementAt(elements, 0x0028, 0x1052)) ?? 0,
    windowCenter: dsValue(bytes, elementAt(elements, 0x0028, 0x1050)),
    windowWidth: dsValue(bytes, elementAt(elements, 0x0028, 0x1051)),
    sliceThickness: dsValue(bytes, elementAt(elements, 0x0018, 0x0050)),
    pixelSpacing,
    instanceNumber: firstNumber(strValue(bytes, elementAt(elements, 0x0020, 0x0013)) ?? ''),
    sliceLocation: dsValue(bytes, elementAt(elements, 0x0020, 0x1041)),
    modality: strValue(bytes, elementAt(elements, 0x0008, 0x0060)),
    transferSyntax,
    pixelData: bytes.subarray(pixel.offset, pixel.offset + pixel.length),
  };
  return { ok: true, slice };
}

/**
 * Parse a single-slice DICOM file (first dataset in the buffer).
 * Teaching-level: uncompressed explicit/implicit VR little endian only.
 */
export function parseDicom(buffer: ArrayBuffer): DicomParseResult {
  const stack = parseDicomStack(buffer);
  if (!stack.ok) return stack;
  return { ok: true, slice: stack.slices[0]! };
}

/**
 * Parse a stack of Part-10 files concatenated back-to-back (the bundled
 * example format), or a plain single-slice file. Every 'DICM' marker starts
 * a new dataset; parsing stops cleanly at the next preamble.
 */
export function parseDicomStack(buffer: ArrayBuffer): DicomStackParseResult {
  const bytes = new Uint8Array(buffer);
  const offsets = findDicmOffsets(bytes);
  if (offsets.length === 0) return { ok: false, reason: 'no-dicom-marker' };
  const slices: DicomSlice[] = [];
  let firstError: { reason: DicomParseReason; detail?: string } | null = null;
  for (const off of offsets) {
    const parsed = parsePart10Dataset(bytes, off);
    if (!parsed.ok) {
      if (!firstError) firstError = { reason: parsed.reason, detail: parsed.detail };
      continue;
    }
    const slice = sliceFromElements(bytes, parsed.elements, parsed.transferSyntax);
    if (!slice.ok) {
      if (!firstError) firstError = { reason: slice.reason, detail: slice.detail };
      continue;
    }
    slices.push(slice.slice);
  }
  if (slices.length === 0) {
    return {
      ok: false,
      reason: firstError?.reason ?? 'no-pixel-data',
      detail: firstError?.detail,
    };
  }
  return { ok: true, slices };
}

// ---- HU conversion ---------------------------------------------------------

/**
 * Convert raw pixel bytes to Hounsfield-like values with
 * `hu = raw * slope + intercept`. Supports 8/16-bit, signed/unsigned.
 * Returns null for pixel formats the teaching parser does not handle.
 */
export function sliceToHu(slice: DicomSlice): Float32Array | null {
  const n = slice.rows * slice.columns;
  if (slice.samplesPerPixel !== 1) return null;
  if (slice.bitsAllocated !== 8 && slice.bitsAllocated !== 16) return null;
  const px = slice.pixelData;
  if (px.length < n * (slice.bitsAllocated / 8)) return null;
  const out = new Float32Array(n);
  const { slope, intercept } = slice;
  if (slice.bitsAllocated === 8) {
    for (let i = 0; i < n; i += 1) {
      const raw = slice.pixelRepresentation ? (px[i]! << 24) >> 24 : px[i]!;
      out[i] = raw * slope + intercept;
    }
  } else {
    const view = new DataView(px.buffer, px.byteOffset, px.byteLength);
    for (let i = 0; i < n; i += 1) {
      const raw = slice.pixelRepresentation
        ? view.getInt16(i * 2, true)
        : view.getUint16(i * 2, true);
      out[i] = raw * slope + intercept;
    }
  }
  return out;
}

// ---- window / level --------------------------------------------------------

/**
 * Linear window/level mapping to a normalized 0..1 grayscale: values below
 * `center - width/2` saturate to 0, above `center + width/2` to 1.
 */
export function windowLevel(v: number, center: number, width: number): number {
  if (!(width > 0)) return v >= center ? 1 : 0;
  const lo = center - width / 2;
  if (v <= lo) return 0;
  const hi = center + width / 2;
  if (v >= hi) return 1;
  return (v - lo) / (hi - lo);
}

/** Displayed HU interval of a window (for readouts). */
export function windowBounds(center: number, width: number): { lo: number; hi: number } {
  const half = (width > 0 ? width : 0) / 2;
  return { lo: center - half, hi: center + half };
}

/** Map a slice to 0..255 grayscale bytes via window/level. */
export function windowLevelSlice(
  hu: Float32Array,
  center: number,
  width: number,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const dst = out ?? new Uint8ClampedArray(hu.length);
  for (let i = 0; i < hu.length; i += 1) dst[i] = Math.round(windowLevel(hu[i]!, center, width) * 255);
  return dst;
}

/** Common CT window presets (center / width in HU). */
export const WINDOW_PRESETS: Record<string, { center: number; width: number; en: string; zh: string }> = {
  soft: { center: 40, width: 400, en: 'Soft tissue', zh: '软组织' },
  lung: { center: -600, width: 1500, en: 'Lung', zh: '肺' },
  bone: { center: 300, width: 1500, en: 'Bone', zh: '骨' },
  brain: { center: 40, width: 80, en: 'Brain', zh: '脑' },
};

// ---- statistics -------------------------------------------------------------

export interface StatsSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  /** Population standard deviation (divide by n). */
  std: number;
}

export function statsOf(values: ArrayLike<number>): StatsSummary {
  const n = values.length;
  if (n === 0) return { count: 0, min: NaN, max: NaN, mean: NaN, std: NaN };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i += 1) {
    const d = values[i]! - mean;
    sq += d * d;
  }
  return { count: n, min, max, mean, std: Math.sqrt(sq / n) };
}

export interface RoiStats extends StatsSummary {
  /** Clamped rectangle actually measured (image pixel coordinates). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Statistics of a rectangular ROI on one slice. Coordinates are rounded and
 * clamped to the image; a null result means an empty (degenerate) ROI.
 */
export function roiStats(
  slice: Float32Array,
  columns: number,
  rows: number,
  x: number,
  y: number,
  w: number,
  h: number,
): RoiStats | null {
  const x0 = Math.min(Math.max(Math.round(x), 0), columns - 1);
  const y0 = Math.min(Math.max(Math.round(y), 0), rows - 1);
  const x1 = Math.min(Math.max(Math.round(x + w), x0 + 1), columns);
  const y1 = Math.min(Math.max(Math.round(y + h), y0 + 1), rows);
  if (x1 <= x0 || y1 <= y0) return null;
  const vals: number[] = [];
  for (let ry = y0; ry < y1; ry += 1) {
    for (let rx = x0; rx < x1; rx += 1) vals.push(slice[ry * columns + rx]!);
  }
  if (vals.length === 0) return null;
  const s = statsOf(vals);
  return { ...s, x: x0, y: y0, w: x1 - x0, h: y1 - x0 };
}

// ---- volume shaping ----------------------------------------------------------

/**
 * Host voxel-field layout: row-major with z fastest,
 * index = (x * ny + y) * nz + z, x = column, y = row, z = slice index.
 */
export interface ImagingVolume {
  nx: number;
  ny: number;
  nz: number;
  values: Float32Array;
}

export function buildVolume(huSlices: Float32Array[], columns: number, rows: number): ImagingVolume {
  const nz = huSlices.length;
  const values = new Float32Array(columns * rows * nz);
  for (let z = 0; z < nz; z += 1) {
    const s = huSlices[z]!;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        values[(x * rows + y) * nz + z] = s[y * columns + x]!;
      }
    }
  }
  return { nx: columns, ny: rows, nz, values };
}

/**
 * Sort slice pairs into stack order by InstanceNumber, falling back to
 * SliceLocation, then to the current order. Returns a new array.
 */
export function sortSlicePairs<T extends { meta: DicomSlice }>(pairs: T[]): T[] {
  const keyed = pairs.map((p, i) => ({
    p,
    key: p.meta.instanceNumber ?? p.meta.sliceLocation ?? i,
    i,
  }));
  keyed.sort((a, b) => a.key - b.key || a.i - b.i);
  return keyed.map((k) => k.p);
}

// ---- image processing ---------------------------------------------------------

/**
 * Histogram equalization over the slice's own HU range; output is a
 * normalized 0..1 image (CDF-mapped 256-bin histogram).
 */
export function equalizeSlice(hu: Float32Array, out?: Float32Array): Float32Array {
  const dst = out ?? new Float32Array(hu.length);
  const n = hu.length;
  if (n === 0) return dst;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const v = hu[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) {
    dst.fill(0.5);
    return dst;
  }
  const bins = 256;
  const hist = new Float64Array(bins);
  const scale = (bins - 1) / (max - min);
  for (let i = 0; i < n; i += 1) {
    const bin = Math.round((hu[i]! - min) * scale);
    const idx = Math.min(Math.max(bin, 0), bins - 1);
    hist[idx] = hist[idx]! + 1;
  }
  const cdf = new Float64Array(bins);
  let acc = 0;
  for (let b = 0; b < bins; b += 1) {
    acc += hist[b]!;
    cdf[b] = acc / n;
  }
  for (let i = 0; i < n; i += 1) {
    const bin = Math.min(Math.max(Math.round((hu[i]! - min) * scale), 0), bins - 1);
    dst[i] = cdf[bin]!;
  }
  return dst;
}

/**
 * Sobel gradient magnitude (3x3, clamped borders). Returns raw magnitudes
 * in the same units as the input; callers normalize for display.
 */
export function sobelMagnitude(hu: Float32Array, columns: number, rows: number, out?: Float32Array): Float32Array {
  const dst = out ?? new Float32Array(columns * rows);
  const at = (x: number, y: number): number => {
    const xi = Math.min(Math.max(x, 0), columns - 1);
    const yi = Math.min(Math.max(y, 0), rows - 1);
    return hu[yi * columns + xi]!;
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      dst[y * columns + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return dst;
}

// ---- minimal Part-10 writer (seeded phantom data + round-trip tests) ---------

const MEDIA_STORAGE_CT = '1.2.840.10008.5.1.4.1.1.2';
const IMPLEMENTATION_UID = '1.2.826.0.1.3680043.9.7133.ergalics';

class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(cap = 256) {
    this.buf = new Uint8Array(Math.max(cap, 16));
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  get length(): number {
    return this.len;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len] = v & 0xff;
    this.len += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.buf[this.len] = v & 0xff;
    this.buf[this.len + 1] = (v >>> 8) & 0xff;
    this.len += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.buf[this.len] = v & 0xff;
    this.buf[this.len + 1] = (v >>> 8) & 0xff;
    this.buf[this.len + 2] = (v >>> 16) & 0xff;
    this.buf[this.len + 3] = (v >>> 24) & 0xff;
    this.len += 4;
  }

  ascii(s: string): void {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i += 1) this.buf[this.len + i] = s.charCodeAt(i) & 0xff;
    this.len += s.length;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  zeros(n: number): void {
    this.ensure(n);
    this.buf.fill(0, this.len, this.len + n);
    this.len += n;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function elHeader(w: ByteWriter, group: number, elem: number, vr: string, len: number): void {
  w.u16(group);
  w.u16(elem);
  if (LONG_VR.has(vr)) {
    w.ascii(vr);
    w.u16(0);
    w.u32(len);
  } else {
    w.ascii(vr);
    w.u16(len);
  }
}

function elUs(w: ByteWriter, group: number, elem: number, v: number): void {
  elHeader(w, group, elem, 'US', 2);
  w.u16(v);
}

function elUl(w: ByteWriter, group: number, elem: number, v: number): void {
  elHeader(w, group, elem, 'UL', 4);
  w.u32(v);
}

function elStr(w: ByteWriter, group: number, elem: number, vr: string, s: string): void {
  // UI pads with NUL, other text VRs pad with a trailing space (PS3.5 §6.2).
  const padded = s.length % 2 === 0 ? s : `${s}${vr === 'UI' ? '\0' : ' '}`;
  elHeader(w, group, elem, vr, padded.length);
  w.ascii(padded);
}

function elBytes(w: ByteWriter, group: number, elem: number, vr: string, data: Uint8Array): void {
  elHeader(w, group, elem, vr, data.length);
  w.bytes(data);
}

export interface DicomEncodeOptions {
  sliceThicknessMm?: number;
  pixelSpacingMm?: number;
  windowCenter?: number;
  windowWidth?: number;
  modality?: string;
  /** RescaleIntercept applied to the stored 16-bit values (default -1024). */
  intercept?: number;
  seriesUid?: string;
}

/**
 * Encode HU slices as a stack of explicit-VR little-endian Part-10 files
 * concatenated back-to-back (each with its own preamble + DICM marker).
 * Stored value = HU - intercept, 16-bit signed, MONOCHROME2.
 */
export function encodeDicomStack(
  huSlices: Float32Array[],
  columns: number,
  rows: number,
  opts: DicomEncodeOptions = {},
): Uint8Array {
  const thickness = opts.sliceThicknessMm ?? 5;
  const spacing = opts.pixelSpacingMm ?? 1;
  const wc = opts.windowCenter ?? 40;
  const ww = opts.windowWidth ?? 400;
  const intercept = opts.intercept ?? -1024;
  const modality = opts.modality ?? 'CT';
  const seriesUid = opts.seriesUid ?? '1.2.826.0.1.3680043.9.7133.1.1';
  const n = columns * rows;
  const parts: Uint8Array[] = [];
  for (let z = 0; z < huSlices.length; z += 1) {
    const hu = huSlices[z]!;
    const stored = new Uint8Array(n * 2);
    const sv = new DataView(stored.buffer);
    for (let i = 0; i < n; i += 1) {
      sv.setInt16(i * 2, Math.round(hu[i]!) - intercept, true);
    }
    const sopUid = `${seriesUid}.${z + 1}`;
    const meta = new ByteWriter(256);
    elBytes(meta, 0x0002, 0x0001, 'OB', new Uint8Array([0, 1]));
    elStr(meta, 0x0002, 0x0002, 'UI', MEDIA_STORAGE_CT);
    elStr(meta, 0x0002, 0x0003, 'UI', sopUid);
    elStr(meta, 0x0002, 0x0010, 'UI', TS_EXPLICIT);
    elStr(meta, 0x0002, 0x0012, 'UI', IMPLEMENTATION_UID);

    const ds = new ByteWriter(1024 + stored.length);
    elStr(ds, 0x0008, 0x0016, 'UI', MEDIA_STORAGE_CT);
    elStr(ds, 0x0008, 0x0018, 'UI', sopUid);
    elStr(ds, 0x0008, 0x0060, 'CS', modality);
    elStr(ds, 0x0018, 0x0050, 'DS', String(thickness));
    elStr(ds, 0x0020, 0x0013, 'IS', String(z + 1));
    elStr(ds, 0x0020, 0x1041, 'DS', String(z * thickness));
    elUs(ds, 0x0028, 0x0002, 1);
    elStr(ds, 0x0028, 0x0004, 'CS', 'MONOCHROME2');
    elUs(ds, 0x0028, 0x0010, rows);
    elUs(ds, 0x0028, 0x0011, columns);
    elStr(ds, 0x0028, 0x0030, 'DS', `${spacing}\\${spacing}`);
    elUs(ds, 0x0028, 0x0100, 16);
    elUs(ds, 0x0028, 0x0101, 16);
    elUs(ds, 0x0028, 0x0102, 15);
    elUs(ds, 0x0028, 0x0103, 1);
    elStr(ds, 0x0028, 0x1050, 'DS', String(wc));
    elStr(ds, 0x0028, 0x1051, 'DS', String(ww));
    elStr(ds, 0x0028, 0x1052, 'DS', String(intercept));
    elStr(ds, 0x0028, 0x1053, 'DS', '1');
    elBytes(ds, 0x7fe0, 0x0010, 'OW', stored);

    const file = new ByteWriter(132 + meta.length + ds.length);
    file.zeros(128);
    file.ascii('DICM');
    elUl(file, 0x0002, 0x0000, meta.length);
    file.bytes(meta.toUint8Array());
    file.bytes(ds.toUint8Array());
    parts.push(file.toUint8Array());
  }
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---- seeded phantom -----------------------------------------------------------

export interface PhantomOptions {
  columns?: number;
  rows?: number;
  slices?: number;
  seed?: number;
  noiseSigma?: number;
}

export interface PhantomVolume {
  columns: number;
  rows: number;
  slices: number;
  /** Lesion centre in image pixel coordinates (x = column, y = row). */
  lesion: { x: number; y: number; z: number };
  hu: Float32Array[];
}

/** Deterministic 32-bit PRNG (mulberry32) for reproducible noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the seeded teaching phantom: air background (-1000 HU), a soft
 * tissue ellipsoid (40 HU), a cortical bone shell (850 HU) and an inner
 * lesion disc (120 HU), with Gaussian noise on every voxel.
 */
export function buildPhantomVolume(opts: PhantomOptions = {}): PhantomVolume {
  const columns = Math.max(64, Math.round(opts.columns ?? 96));
  const rows = Math.max(64, Math.round(opts.rows ?? 96));
  const slices = Math.max(8, Math.round(opts.slices ?? 10));
  const sigma = opts.noiseSigma ?? 6;
  const rnd = mulberry32(opts.seed ?? 20261029);
  // Box-Muller transform for unit-normal samples.
  const gauss = (): number => {
    const u = Math.max(rnd(), 1e-12);
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const cx = (columns - 1) / 2;
  const cy = (rows - 1) / 2;
  const cz = (slices - 1) / 2;
  const rx = 0.36 * columns;
  const ry = 0.3 * rows;
  const rz = 0.48 * slices;
  const lesionX = Math.round(cx + 0.22 * columns);
  const lesionY = Math.round(cy - 0.12 * rows);
  const lesionR = 0.085 * columns;
  const boneOuter = 0.78;
  const boneInner = 0.64;
  const hu: Float32Array[] = [];
  for (let z = 0; z < slices; z += 1) {
    const s = new Float32Array(columns * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        let v = -1000;
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const nz = (z - cz) / rz;
        const r2 = nx * nx + ny * ny + nz * nz;
        if (r2 <= 1) {
          v = 40;
          const bo =
            (nx / boneOuter) ** 2 + (ny / boneOuter) ** 2 + (nz / boneOuter) ** 2 <= 1;
          const bi =
            (nx / boneInner) ** 2 + (ny / boneInner) ** 2 + (nz / boneInner) ** 2 <= 1;
          if (bo && !bi) v = 850;
          const dl = Math.hypot(x - lesionX, y - lesionY);
          if (dl <= lesionR && Math.abs(z - cz) <= rz * 0.55) v = 120;
        }
        s[y * columns + x] = v + gauss() * sigma;
      }
    }
    hu.push(s);
  }
  return { columns, rows, slices, lesion: { x: lesionX, y: lesionY, z: Math.round(cz) }, hu };
}
