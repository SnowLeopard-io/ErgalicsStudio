import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WINDOW_PRESETS,
  buildPhantomVolume,
  buildVolume,
  encodeDicomStack,
  equalizeSlice,
  parseDicom,
  parseDicomStack,
  roiStats,
  sliceToHu,
  sobelMagnitude,
  sortSlicePairs,
  statsOf,
  windowBounds,
  windowLevel,
  windowLevelSlice,
  type DicomSlice,
} from '../src/plugins/builtin/med/imaging/imaging';

// ---- minimal hand-built DICOM buffers (parser cross-check) ------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const asciiBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const u16b = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
const u32b = (v: number): Uint8Array =>
  new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
const padEven = (s: string, ch: string): string => (s.length % 2 === 0 ? s : s + ch);
const dss = (s: string): Uint8Array => asciiBytes(padEven(s, ' ')); // DS / IS / CS pad with space
const uis = (s: string): Uint8Array => asciiBytes(padEven(s, '\0')); // UI pads with NUL

const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);

function elExplicit(group: number, elem: number, vr: string, payload: Uint8Array): Uint8Array {
  const head = LONG_VRS.has(vr)
    ? concatBytes([u16b(group), u16b(elem), asciiBytes(vr), u16b(0), u32b(payload.length)])
    : concatBytes([u16b(group), u16b(elem), asciiBytes(vr), u16b(payload.length)]);
  return concatBytes([head, payload]);
}

function elImplicit(group: number, elem: number, payload: Uint8Array): Uint8Array {
  return concatBytes([u16b(group), u16b(elem), u32b(payload.length), payload]);
}

function preamble(): Uint8Array {
  return concatBytes([new Uint8Array(128), asciiBytes('DICM')]);
}

function fileMeta(transferSyntax: string): Uint8Array {
  const tsEl = elExplicit(0x0002, 0x0010, 'UI', uis(transferSyntax));
  return concatBytes([elExplicit(0x0002, 0x0000, 'UL', u32b(tsEl.length)), tsEl]);
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const EXPLICIT_TS = '1.2.840.10008.1.2.1';

describe('med-imaging DICOM header parsing', () => {
  it('parses an explicit-VR Part-10 buffer and cross-checks the key tags', () => {
    const pixels = new Uint8Array(4 * 5 * 2);
    const dataset = [
      elExplicit(0x0008, 0x0060, 'CS', dss('CT')),
      elExplicit(0x0018, 0x0050, 'DS', dss('2.5')),
      elExplicit(0x0020, 0x0013, 'IS', dss('7')),
      elExplicit(0x0020, 0x1041, 'DS', dss('30.0')),
      elExplicit(0x0028, 0x0002, 'US', u16b(1)),
      elExplicit(0x0028, 0x0010, 'US', u16b(4)), // rows
      elExplicit(0x0028, 0x0011, 'US', u16b(5)), // columns
      elExplicit(0x0028, 0x0030, 'DS', dss('0.5\\0.5')),
      elExplicit(0x0028, 0x0100, 'US', u16b(16)), // bits allocated
      elExplicit(0x0028, 0x0103, 'US', u16b(1)), // signed
      elExplicit(0x0028, 0x1050, 'DS', dss('40')), // window center
      elExplicit(0x0028, 0x1051, 'DS', dss('400')), // window width
      elExplicit(0x0028, 0x1052, 'DS', dss('-1024')), // intercept
      elExplicit(0x0028, 0x1053, 'DS', dss('2')), // slope
      elExplicit(0x7fe0, 0x0010, 'OW', pixels),
    ];
    const res = parseDicom(toBuffer(concatBytes([preamble(), fileMeta(EXPLICIT_TS), ...dataset])));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.slice;
    expect(s.rows).toBe(4);
    expect(s.columns).toBe(5);
    expect(s.samplesPerPixel).toBe(1);
    expect(s.bitsAllocated).toBe(16);
    expect(s.pixelRepresentation).toBe(1);
    expect(s.slope).toBe(2);
    expect(s.intercept).toBe(-1024);
    expect(s.windowCenter).toBe(40);
    expect(s.windowWidth).toBe(400);
    expect(s.sliceThickness).toBeCloseTo(2.5, 10);
    expect(s.pixelSpacing).toEqual([0.5, 0.5]);
    expect(s.instanceNumber).toBe(7);
    expect(s.sliceLocation).toBeCloseTo(30, 10);
    expect(s.modality).toBe('CT');
    expect(s.transferSyntax).toBe(EXPLICIT_TS);
    expect(s.pixelData.length).toBe(40);
  });

  it('falls back to implicit VR when a file has no meta group (best effort)', () => {
    const pixels = new Uint8Array(3 * 3); // 8-bit
    const dataset = [
      elImplicit(0x0028, 0x0002, u16b(1)),
      elImplicit(0x0028, 0x0010, u16b(3)),
      elImplicit(0x0028, 0x0011, u16b(3)),
      elImplicit(0x0028, 0x0100, u16b(8)),
      elImplicit(0x0028, 0x0103, u16b(0)),
      elImplicit(0x7fe0, 0x0010, pixels),
    ];
    const res = parseDicom(toBuffer(concatBytes([preamble(), ...dataset])));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.slice.rows).toBe(3);
    expect(res.slice.columns).toBe(3);
    expect(res.slice.bitsAllocated).toBe(8);
    expect(res.slice.pixelRepresentation).toBe(0);
    expect(res.slice.pixelData.length).toBe(9);
  });

  it('rejects compressed transfer syntaxes and non-DICOM buffers', () => {
    const jpeg = parseDicomStack(toBuffer(concatBytes([preamble(), fileMeta('1.2.840.10008.1.2.4.50')])));
    expect(jpeg.ok).toBe(false);
    if (!jpeg.ok) expect(jpeg.reason).toBe('unsupported-transfer-syntax');
    const garbage = parseDicomStack(toBuffer(asciiBytes('this is not a dicom file at all........')));
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.reason).toBe('no-dicom-marker');
  });

  it('flags missing pixel data', () => {
    const dataset = [
      elExplicit(0x0028, 0x0002, 'US', u16b(1)),
      elExplicit(0x0028, 0x0010, 'US', u16b(2)),
      elExplicit(0x0028, 0x0011, 'US', u16b(2)),
      elExplicit(0x0028, 0x0100, 'US', u16b(16)),
    ];
    const res = parseDicomStack(toBuffer(concatBytes([preamble(), fileMeta(EXPLICIT_TS), ...dataset])));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no-pixel-data');
  });
});

describe('med-imaging HU conversion', () => {
  it('applies rescale slope/intercept to signed 16-bit pixels', () => {
    const stored = [1024, -1, 0, 1536];
    const pixels = new Uint8Array(8);
    const view = new DataView(pixels.buffer);
    stored.forEach((v, i) => view.setInt16(i * 2, v, true));
    const slice = {
      rows: 2,
      columns: 2,
      samplesPerPixel: 1,
      bitsAllocated: 16,
      pixelRepresentation: 1,
      slope: 2,
      intercept: -1024,
      windowCenter: null,
      windowWidth: null,
      sliceThickness: null,
      pixelSpacing: null,
      instanceNumber: null,
      sliceLocation: null,
      modality: null,
      transferSyntax: EXPLICIT_TS,
      pixelData: pixels,
    } satisfies DicomSlice;
    const hu = sliceToHu(slice);
    expect(hu).not.toBeNull();
    expect(Array.from(hu!)).toEqual([1024, -1026, -1024, 2048]);
  });

  it('returns null for unsupported sample layouts', () => {
    const base = {
      rows: 2,
      columns: 2,
      samplesPerPixel: 3,
      bitsAllocated: 16,
      pixelRepresentation: 0,
      slope: 1,
      intercept: 0,
      windowCenter: null,
      windowWidth: null,
      sliceThickness: null,
      pixelSpacing: null,
      instanceNumber: null,
      sliceLocation: null,
      modality: null,
      transferSyntax: EXPLICIT_TS,
      pixelData: new Uint8Array(16),
    } satisfies DicomSlice;
    expect(sliceToHu(base)).toBeNull();
    expect(sliceToHu({ ...base, samplesPerPixel: 1, bitsAllocated: 12 })).toBeNull();
  });
});

describe('med-imaging window/level', () => {
  it('maps linearly inside the window and saturates outside', () => {
    // WC 40 / WW 400 -> lo = -160, hi = 240
    expect(windowLevel(-160, 40, 400)).toBe(0);
    expect(windowLevel(240, 40, 400)).toBe(1);
    expect(windowLevel(-1000, 40, 400)).toBe(0);
    expect(windowLevel(2000, 40, 400)).toBe(1);
    expect(windowLevel(40, 40, 400)).toBeCloseTo(0.5, 12);
    expect(windowLevel(120, 40, 400)).toBeCloseTo(0.7, 12);
    expect(windowBounds(40, 400)).toEqual({ lo: -160, hi: 240 });
    for (const key of Object.keys(WINDOW_PRESETS)) {
      const p = WINDOW_PRESETS[key]!;
      expect(p.width).toBeGreaterThan(0);
    }
  });

  it('degenerate width behaves as a binary threshold', () => {
    expect(windowLevel(10, 40, 0)).toBe(0);
    expect(windowLevel(50, 40, 0)).toBe(1);
  });

  it('windowLevelSlice emits 0..255 grayscale bytes', () => {
    const hu = Float32Array.from([-1000, -160, 40, 240, 2000]);
    const gray = windowLevelSlice(hu, 40, 400);
    expect(Array.from(gray)).toEqual([0, 0, 128, 255, 255]);
  });
});

describe('med-imaging image processing', () => {
  it('Sobel magnitude peaks at a known vertical step edge', () => {
    // 4x4, vertical step: columns 0-1 are 0, columns 2-3 are 10.
    const img = Float32Array.from([0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10]);
    const mag = sobelMagnitude(img, 4, 4);
    const at = (x: number, y: number) => mag[y * 4 + x]!;
    // interior step columns carry gx = (10+20+10) - 0 = 40
    expect(at(1, 1)).toBeCloseTo(40, 10);
    expect(at(2, 1)).toBeCloseTo(40, 10);
    expect(at(1, 3)).toBeCloseTo(40, 10);
    // uniform columns saturate to zero response
    expect(at(0, 1)).toBeCloseTo(0, 10);
    expect(at(3, 1)).toBeCloseTo(0, 10);
    // a flat image yields all zeros
    const flat = sobelMagnitude(new Float32Array(16).fill(7), 4, 4);
    for (const v of flat) expect(v).toBeCloseTo(0, 10);
  });

  it('histogram equalization maps a balanced two-value image to 0.5/1', () => {
    const eq = equalizeSlice(Float32Array.from([0, 1, 0, 1]));
    expect(eq[0]).toBeCloseTo(0.5, 12);
    expect(eq[1]).toBeCloseTo(1, 12);
    expect(eq[2]).toBeCloseTo(0.5, 12);
    expect(eq[3]).toBeCloseTo(1, 12);
    const constant = equalizeSlice(new Float32Array(9).fill(-300));
    for (const v of constant) expect(v).toBeCloseTo(0.5, 12);
  });
});

describe('med-imaging statistics and ROI', () => {
  it('statsOf: mean / population std / min / max', () => {
    const s = statsOf([1, 2, 3, 4]);
    expect(s.mean).toBeCloseTo(2.5, 12);
    expect(s.std).toBeCloseTo(Math.sqrt(1.25), 12);
    expect(s.min).toBe(1);
    expect(s.max).toBe(4);
    expect(s.count).toBe(4);
  });

  it('ROI statistics match hand computation on a 5x4 ramp', () => {
    const slice = Float32Array.from({ length: 20 }, (_, i) => i + 1); // rows of [1..5]
    const roi = roiStats(slice, 5, 4, 1, 1, 2, 2)!;
    // region = {7,8,12,13}
    expect(roi.count).toBe(4);
    expect(roi.mean).toBe(10);
    expect(roi.std).toBeCloseTo(Math.sqrt(6.5), 12);
    expect(roi.min).toBe(7);
    expect(roi.max).toBe(13);
    expect(roi.x).toBe(1);
    expect(roi.y).toBe(1);
    expect(roi.w).toBe(2);
    expect(roi.h).toBe(2);
    // out-of-range ROIs are clamped into the image (shrink, not shift)
    const clamped = roiStats(slice, 5, 4, -5, -5, 2, 2)!;
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
    expect(clamped.w).toBe(1);
    expect(clamped.h).toBe(1);
    expect(clamped.mean).toBe(1); // only the top-left pixel remains
  });
});

describe('med-imaging volume shaping and sorting', () => {
  it('buildVolume uses the (x*ny + y)*nz + z voxel-field layout', () => {
    const z0 = Float32Array.from([1, 2, 3, 4]); // 2x2 slice
    const z1 = Float32Array.from([5, 6, 7, 8]);
    const vol = buildVolume([z0, z1], 2, 2);
    expect(vol).toEqual({ nx: 2, ny: 2, nz: 2, values: vol.values });
    const at = (x: number, y: number, z: number) => vol.values[(x * 2 + y) * 2 + z]!;
    expect(at(0, 0, 0)).toBe(1);
    expect(at(1, 0, 0)).toBe(2);
    expect(at(0, 1, 0)).toBe(3);
    expect(at(1, 1, 0)).toBe(4);
    expect(at(1, 0, 1)).toBe(6);
    expect(at(1, 1, 1)).toBe(8);
  });

  it('sortSlicePairs orders by InstanceNumber with stable fallback', () => {
    const mk = (instance: number | null, location: number | null, tag: string): { meta: DicomSlice; tag: string } => ({
      tag,
      meta: {
        rows: 1,
        columns: 1,
        samplesPerPixel: 1,
        bitsAllocated: 8,
        pixelRepresentation: 0,
        slope: 1,
        intercept: 0,
        windowCenter: null,
        windowWidth: null,
        sliceThickness: null,
        pixelSpacing: null,
        instanceNumber: instance,
        sliceLocation: location,
        modality: null,
        transferSyntax: EXPLICIT_TS,
        pixelData: new Uint8Array(1),
      },
    });
    const sorted = sortSlicePairs([mk(3, null, 'c'), mk(1, null, 'a'), mk(2, null, 'b')]);
    expect(sorted.map((p) => p.tag)).toEqual(['a', 'b', 'c']);
    const byLocation = sortSlicePairs([mk(null, 20, 'b'), mk(null, 10, 'a')]);
    expect(byLocation.map((p) => p.tag)).toEqual(['a', 'b']);
  });

  it('encode/parse round-trip keeps header values and pixel data', () => {
    const hu0 = Float32Array.from([-1000, -500, 0, 40, 120, 850]);
    const hu1 = Float32Array.from([900, 800, 700, 600, 500, 400]);
    const bytes = encodeDicomStack([hu0, hu1], 3, 2, {
      sliceThicknessMm: 4,
      pixelSpacingMm: 0.8,
      windowCenter: -300,
      windowWidth: 1300,
    });
    const parsed = parseDicomStack(toBuffer(bytes));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.slices.length).toBe(2);
    expect(parsed.slices[0]!.instanceNumber).toBe(1);
    expect(parsed.slices[1]!.instanceNumber).toBe(2);
    expect(parsed.slices[0]!.sliceThickness).toBe(4);
    expect(parsed.slices[0]!.pixelSpacing).toEqual([0.8, 0.8]);
    expect(parsed.slices[0]!.windowCenter).toBe(-300);
    expect(parsed.slices[0]!.windowWidth).toBe(1300);
    const back0 = sliceToHu(parsed.slices[0]!)!;
    for (let i = 0; i < hu0.length; i += 1) expect(back0[i]!).toBeCloseTo(hu0[i]!, 6);
    const back1 = sliceToHu(parsed.slices[1]!)!;
    for (let i = 0; i < hu1.length; i += 1) expect(back1[i]!).toBeCloseTo(hu1[i]!, 6);
  });

  it('buildPhantomVolume is seeded and lands on the requested tissue values', () => {
    const a = buildPhantomVolume({ seed: 7, columns: 64, rows: 64, slices: 8 });
    const b = buildPhantomVolume({ seed: 7, columns: 64, rows: 64, slices: 8 });
    expect(Array.from(a.hu[0]!)).toEqual(Array.from(b.hu[0]!));
    const s = statsOf(a.hu[4]!);
    expect(s.min).toBeLessThan(-950); // air background
    expect(s.max).toBeGreaterThan(780); // bone shell
    const { x, y } = a.lesion;
    expect(a.hu[4]![y * a.columns + x]!).toBeGreaterThan(80); // lesion disc
    expect(a.hu[4]![y * a.columns + x]!).toBeLessThan(160);
  });
});

// ---- bundled example file -----------------------------------------------------

const readBinary = (name: string): ArrayBuffer => {
  const buf = readFileSync(new URL(`../examples/data/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

describe('med-imaging bundled phantom stack', () => {
  const parsed = parseDicomStack(readBinary('med-phantom-slices.dcm'));

  it('loads a concatenated 10-slice 96x96 stack with file metadata intact', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.slices.length).toBe(10);
    expect(parsed.slices[0]!.rows).toBe(96);
    expect(parsed.slices[0]!.columns).toBe(96);
    expect(parsed.slices[0]!.bitsAllocated).toBe(16);
    expect(parsed.slices[0]!.pixelRepresentation).toBe(1);
    expect(parsed.slices[0]!.sliceThickness).toBe(5);
    expect(parsed.slices[0]!.pixelSpacing).toEqual([1, 1]);
    expect(parsed.slices[0]!.windowCenter).toBe(40);
    expect(parsed.slices[0]!.windowWidth).toBe(400);
    expect(parsed.slices.map((s) => s.instanceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('yields plausible HU statistics and contains the 120 HU lesion', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const hus = parsed.slices.map((s) => sliceToHu(s)!);
    const all = new Float32Array(hus.reduce((a, h) => a + h.length, 0));
    let off = 0;
    for (const h of hus) {
      all.set(h, off);
      off += h.length;
    }
    const s = statsOf(all);
    expect(s.min).toBeLessThanOrEqual(-950); // air around -1000
    expect(s.max).toBeGreaterThanOrEqual(780); // bone shell above 800 - noise
    expect(s.mean).toBeLessThan(-500); // volume dominated by air
    expect(s.mean).toBeGreaterThan(-900);
    // lesion disc: 3x3 average at the phantom's lesion centre on a middle slice
    const mid = hus[5]!;
    let acc = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) acc += mid[(36 + dy) * 96 + (69 + dx)]!;
    }
    const avg = acc / 9;
    expect(avg).toBeGreaterThan(80);
    expect(avg).toBeLessThan(160);
  });
});
