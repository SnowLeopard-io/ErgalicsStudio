// ==========================================================================
// FR-08 — local inference runner tests (device policy, built-in models,
// external model loading) + pretrained model catalog structure
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  resolveDevice,
  softmax,
  tokenizeText,
  runTextClassification,
  runImageClassification,
  imageFeatures,
  loadExternalModel,
  modelFromSpec,
  MAX_WEBGPU_MODEL_MB,
  type ImageInput,
} from '@/core/inference/onnx-runner';
import { PRETRAINED_MODELS, getModelEntry } from '@/core/inference/model-catalog';

const textModel = getModelEntry('sentiment-bow')!.build();
const digitModel = getModelEntry('digit-8x8')!.build();

/** 8×8 glyph rows ('#' = 255, '.' = 0) flattened into an ImageInput. */
function glyphInput(rows: string[]): ImageInput {
  const data: number[] = [];
  for (const row of rows) for (const ch of row) data.push(ch === '#' ? 255 : 0);
  return { width: 8, height: 8, data };
}

const DIGIT0 = ['..####..', '.#....#.', '#......#', '#......#', '#......#', '#......#', '.#....#.', '..####..'];
const DIGIT1 = ['...#....', '..##....', '.#.#....', '...#....', '...#....', '...#....', '...#....', '..###...'];

describe('resolveDevice', () => {
  it('picks WebGPU for small models on a GPU-capable machine', () => {
    expect(resolveDevice(true, 12)).toEqual({ device: 'webgpu' });
  });

  it('falls back to CPU without a GPU', () => {
    const r = resolveDevice(false, 12);
    expect(r.device).toBe('cpu');
    expect(r.warning).toBe('no-gpu');
  });

  it('warns about memory when a large model exceeds the WebGPU budget', () => {
    const r = resolveDevice(true, MAX_WEBGPU_MODEL_MB + 1);
    expect(r.device).toBe('cpu');
    expect(r.warning).toBe('memory-threshold');
  });

  it('reports both reasons for a large model without a GPU', () => {
    expect(resolveDevice(false, 4096).warning).toBe('no-gpu-and-large-model');
  });

  it('treats invalid sizes as CPU with an explicit warning', () => {
    expect(resolveDevice(true, Number.NaN).warning).toBe('invalid-model-size');
    expect(resolveDevice(true, -5).warning).toBe('invalid-model-size');
  });

  it('accepts the exact threshold', () => {
    expect(resolveDevice(true, MAX_WEBGPU_MODEL_MB).device).toBe('webgpu');
  });
});

describe('softmax / tokenize', () => {
  it('softmax sums to 1 and preserves order', () => {
    const s = softmax([2, 0, -1]);
    expect(s[0]! + s[1]! + s[2]!).toBeCloseTo(1, 10);
    expect(s[0]!).toBeGreaterThan(s[1]!);
    expect(s[1]!).toBeGreaterThan(s[2]!);
  });

  it('softmax is stable for large magnitudes', () => {
    const s = softmax([1000, 999, 998]);
    expect(s.every((v) => Number.isFinite(v))).toBe(true);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(s[0]!).toBeGreaterThan(s[1]!);
  });

  it('tokenizes ASCII words and CJK characters', () => {
    expect(tokenizeText("Don't slow 数据")).toEqual(["don't", 'slow', '数', '据']);
  });
});

describe('runTextClassification (built-in sentiment model)', () => {
  it('classifies positive English text', async () => {
    const r = await runTextClassification('this result is great and clearly works', textModel, { device: 'cpu' });
    expect(r.label).toBe('positive');
    expect(r.device).toBe('cpu');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.scores.reduce((a, s) => a + s.score, 0)).toBeCloseTo(1, 6);
    expect(r.scores[0]!.score).toBeGreaterThanOrEqual(r.scores[1]!.score);
  });

  it('classifies negative English text', async () => {
    const r = await runTextClassification('terrible broken and slow, totally wrong', textModel);
    expect(r.label).toBe('negative');
  });

  it('routes unknown text to neutral', async () => {
    const r = await runTextClassification('the cat sat on the mat', textModel);
    expect(r.label).toBe('neutral');
  });

  it('handles Chinese input', async () => {
    const r = await runTextClassification('这个结果很好，数据明确', textModel);
    expect(r.label).toBe('positive');
  });

  it('reports progress and the model id', async () => {
    const seen: number[] = [];
    const r = await runTextClassification('good', textModel, {
      modelId: 'sentiment-bow',
      onProgress: (f) => seen.push(f),
    });
    expect(r.modelId).toBe('sentiment-bow');
    expect(seen).toEqual([0.1, 0.8, 1]);
  });

  it('rejects a mismatched model type', async () => {
    await expect(runTextClassification('hi', digitModel)).rejects.toThrow(/text model/);
  });
});

describe('runImageClassification (built-in digit prototypes)', () => {
  it('recognizes a clean 8×8 zero', async () => {
    const r = await runImageClassification(glyphInput(DIGIT0), digitModel, { device: 'cpu' });
    expect(r.label).toBe('0');
    expect(r.scores.reduce((a, s) => a + s.score, 0)).toBeCloseTo(1, 6);
  });

  it('recognizes a one', async () => {
    const r = await runImageClassification(glyphInput(DIGIT1), digitModel);
    expect(r.label).toBe('1');
  });

  it('resamples oversized inputs', async () => {
    // Pixel-repeat 2× horizontally (each glyph column duplicated): nearest-
    // neighbor downscaling back to 8×8 must recover the original exactly.
    const wide = DIGIT0.map((row) => row.split('').map((c) => c + c).join(''));
    const data: number[] = [];
    for (const row of wide) for (const ch of row) data.push(ch === '#' ? 255 : 0);
    const r = await runImageClassification({ width: 16, height: 8, data }, digitModel);
    expect(r.label).toBe('0');
  });

  it('rejects a text model', async () => {
    await expect(runImageClassification(glyphInput(DIGIT0), textModel)).rejects.toThrow(/image model/);
  });

  it('imageFeatures normalizes 0..255 and 0..1 ranges', () => {
    const f = imageFeatures({ width: 2, height: 1, data: [255, 0] }, 2, 1);
    expect(f).toEqual([1, 0]);
    const g = imageFeatures({ width: 2, height: 1, data: [0.5, 1] }, 2, 1);
    expect(g[0]).toBeCloseTo(0.5);
    expect(g[1]).toBeCloseTo(1);
  });
});

describe('loadExternalModel / modelFromSpec', () => {
  const enc = new TextEncoder();
  const buf = (s: string): ArrayBuffer => {
    const v = enc.encode(s);
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  };

  it('reports a readable error for raw ONNX (runtime not bundled)', () => {
    expect(() => loadExternalModel('m.onnx', buf('onnx-bytes'))).toThrow(/onnxruntime-web/);
  });

  it('rejects unknown extensions', () => {
    expect(() => loadExternalModel('m.pt', buf('x'))).toThrow(/unsupported model file extension/);
  });

  it('loads a JSON text weight spec and runs it', async () => {
    const spec = JSON.stringify({
      kind: 'text',
      vocabulary: ['good', 'bad'],
      labels: ['pos', 'neg'],
      weights: [[2, -2], [-2, 2]],
      bias: [0, 0],
    });
    const model = loadExternalModel('tiny.json', buf(spec));
    const r = await runTextClassification('a good day', model);
    expect(r.label).toBe('pos');
  });

  it('validates spec shape', () => {
    expect(() => modelFromSpec(null)).toThrow(/JSON object/);
    expect(() => modelFromSpec({ kind: 'text', labels: ['a'], weights: [[1]] })).toThrow(/vocabulary/);
    expect(() => modelFromSpec({ kind: 'text', labels: ['a'], weights: [[1, 2]], vocabulary: ['x'] })).toThrow(
      /vocabulary length/,
    );
    expect(() => modelFromSpec({ kind: 'weird', labels: ['a'], weights: [[1]] })).toThrow(/kind/);
  });
});

describe('PRETRAINED_MODELS catalog', () => {
  it('ships at least a text and an image model', () => {
    expect(PRETRAINED_MODELS.length).toBeGreaterThanOrEqual(2);
    expect(PRETRAINED_MODELS.some((m) => m.inputType === 'text')).toBe(true);
    expect(PRETRAINED_MODELS.some((m) => m.inputType === 'image')).toBe(true);
  });

  it('every entry has complete metadata and a runnable build()', async () => {
    for (const entry of PRETRAINED_MODELS) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.nameEn).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.sizeMb).toBeGreaterThan(0);
      expect(entry.labels.length).toBeGreaterThan(1);
      const model = entry.build();
      if (entry.inputType === 'text') {
        const r = await runTextClassification('hello world', model, { modelId: entry.id });
        expect(entry.labels).toContain(r.label);
      } else {
        const r = await runImageClassification(glyphInput(DIGIT0), model, { modelId: entry.id });
        expect(entry.labels).toContain(r.label);
      }
    }
  });

  it('getModelEntry resolves ids and rejects unknown ones', () => {
    expect(getModelEntry('sentiment-bow')?.inputType).toBe('text');
    expect(getModelEntry('digit-8x8')?.inputType).toBe('image');
    expect(getModelEntry('nope')).toBeUndefined();
  });
});
