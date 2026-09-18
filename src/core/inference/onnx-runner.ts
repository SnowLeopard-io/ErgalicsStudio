// ==========================================================================
// Ergalics Studio — FR-08 local model inference runner
//
// Browser-side inference for the "模型推理" tool page. Two built-in example
// models ship with the app (a bag-of-words text classifier and a small
// digit image classifier). Scoring runs through @tensorflow/tfjs when a DOM
// is present (production path, WebGPU/WebGL/CPU backends); in headless test
// environments the identical linear algebra executes in pure TS so results
// are deterministic. External model files are read best-effort: JSON weight
// specs load; raw ONNX binaries report a readable "runtime not bundled"
// error instead of crashing.
//
// No DOM / navigator access at module top level (spec constraint).
// ==========================================================================

export type InferenceDevice = 'webgpu' | 'cpu';

/** Models above this size are steered to the CPU path with a memory warning. */
export const MAX_WEBGPU_MODEL_MB = 512;
/** Hard ceiling beyond which loading is refused outright. */
export const HARD_MODEL_LIMIT_MB = 2048;

export interface DeviceChoice {
  device: InferenceDevice;
  warning?: string;
}

/**
 * Decide the inference device before a run. WebGPU only when the adapter is
 * available AND the model fits the memory budget; otherwise fall back to CPU
 * with an explicit warning (performance / memory expectations).
 */
export function resolveDevice(gpuAvailable: boolean, modelSizeMb: number): DeviceChoice {
  if (!Number.isFinite(modelSizeMb) || modelSizeMb < 0) {
    return { device: 'cpu', warning: 'invalid-model-size' };
  }
  if (modelSizeMb > MAX_WEBGPU_MODEL_MB) {
    return {
      device: 'cpu',
      warning: gpuAvailable ? 'memory-threshold' : 'no-gpu-and-large-model',
    };
  }
  if (!gpuAvailable) {
    return { device: 'cpu', warning: 'no-gpu' };
  }
  return { device: 'webgpu' };
}

// ---- model shapes -----------------------------------------------------------

export interface TextLinearModel {
  kind: 'text';
  /** Bag-of-words vocabulary (lowercased tokens). */
  vocabulary: string[];
  labels: string[];
  /** [class][vocab] weight matrix. */
  weights: number[][];
  bias: number[];
}

export interface ImageLinearModel {
  kind: 'image';
  width: number;
  height: number;
  labels: string[];
  weights: number[][];
  bias: number[];
}

export interface ImagePrototypeModel {
  kind: 'image-proto';
  width: number;
  height: number;
  labels: string[];
  /** One flattened 0..1 prototype per label. */
  prototypes: number[][];
}

export type InferenceModel = TextLinearModel | ImageLinearModel | ImagePrototypeModel;

export interface ImageInput {
  width: number;
  height: number;
  /** Grayscale (w*h) or RGB (w*h*3) pixels, 0..255 or 0..1. */
  data: ArrayLike<number>;
}

export interface ScoredLabel {
  label: string;
  score: number;
}

export interface InferenceResult {
  label: string;
  scores: ScoredLabel[];
  latencyMs: number;
  device: InferenceDevice;
  modelId: string;
}

export interface RunOptions {
  device?: InferenceDevice;
  onProgress?: (fraction: number) => void;
  /** Identifier reported back on the result. */
  modelId?: string;
}

// ---- tfjs production path (browser only) ------------------------------------

type TF = typeof import('@tensorflow/tfjs');
let tfPromise: Promise<TF | null> | null = null;

/** Lazy tfjs loader: browser-only, never fails the run (pure-TS fallback). */
function tryLoadTf(): Promise<TF | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!tfPromise) {
    tfPromise = import('@tensorflow/tfjs')
      .then(async (m) => {
        try {
          await m.ready();
        } catch {
          /* backend init issues degrade to whatever backend registered */
        }
        return m;
      })
      .catch(() => null);
  }
  return tfPromise;
}

/** softmax over raw class scores (numerically stable). */
export function softmax(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function pureLinearScores(weights: number[][], bias: number[], features: number[]): number[] {
  return weights.map((row, i) => {
    let acc = bias[i] ?? 0;
    for (let j = 0; j < row.length; j += 1) acc += row[j]! * (features[j] ?? 0);
    return acc;
  });
}

/** Linear head scores: tfjs matmul in the browser, identical pure math elsewhere. */
async function linearScores(
  weights: number[][],
  bias: number[],
  features: number[],
): Promise<number[]> {
  const tf = await tryLoadTf();
  if (!tf) return pureLinearScores(weights, bias, features);
  try {
    const out = tf.tidy(() => {
      const w = tf.tensor2d(weights);
      const x = tf.tensor1d(features);
      const b = tf.tensor1d(bias);
      return tf.matMul(w, x.reshape([features.length, 1]), false, false)
        .reshape([weights.length])
        .add(b);
    });
    const scores = Array.from(await out.data());
    out.dispose();
    return scores;
  } catch {
    return pureLinearScores(weights, bias, features);
  }
}

// ---- text classification ------------------------------------------------------

/** Tokenize for the bag-of-words head: ASCII words + single CJK characters. */
export function tokenizeText(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9]+(?:['-][a-z0-9]+)?/g) ?? [];
  const cjk = lower.match(/[\u3400-\u9fff]/g) ?? [];
  return [...words, ...cjk];
}

function bagOfWords(text: string, vocabulary: string[]): number[] {
  const counts = new Map<string, number>();
  for (const tok of tokenizeText(text)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  return vocabulary.map((word) => counts.get(word) ?? 0);
}

/** Run the text classifier over a string; returns softmax-ranked labels. */
export async function runTextClassification(
  input: string,
  model: InferenceModel,
  opts: RunOptions = {},
): Promise<InferenceResult> {
  if (model.kind !== 'text') {
    throw new Error(`runTextClassification needs a text model, got "${model.kind}"`);
  }
  const startedAt = Date.now();
  opts.onProgress?.(0.1);
  const features = bagOfWords(input, model.vocabulary);
  const raw = await linearScores(model.weights, model.bias, features);
  opts.onProgress?.(0.8);
  const scores = softmax(raw);
  const ranked: ScoredLabel[] = model.labels
    .map((label, i) => ({ label, score: scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  opts.onProgress?.(1);
  return {
    label: ranked[0]?.label ?? '',
    scores: ranked,
    latencyMs: Math.max(0, Date.now() - startedAt),
    device: opts.device ?? 'cpu',
    modelId: opts.modelId ?? 'text-linear',
  };
}

// ---- image classification ------------------------------------------------------

/** Normalize an arbitrary image input to a 0..1 feature vector of w*h. */
export function imageFeatures(
  input: ImageInput,
  width: number,
  height: number,
): number[] {
  const n = input.width * input.height;
  const rgb = input.data.length === n * 3;
  const out = new Array<number>(width * height).fill(0);
  if (width === input.width && height === input.height) {
    for (let i = 0; i < width * height; i += 1) {
      const v = rgb
        ? (Number(input.data[i * 3]) + Number(input.data[i * 3 + 1]) + Number(input.data[i * 3 + 2])) / 3
        : Number(input.data[i]);
      out[i] = normalizePixel(v);
    }
    return out;
  }
  // Nearest-neighbor resample.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(input.width - 1, Math.floor((x * input.width) / width));
      const sy = Math.min(input.height - 1, Math.floor((y * input.height) / height));
      const idx = sy * input.width + sx;
      const v = rgb
        ? (Number(input.data[idx * 3]) + Number(input.data[idx * 3 + 1]) + Number(input.data[idx * 3 + 2])) / 3
        : Number(input.data[idx]);
      out[y * width + x] = normalizePixel(v);
    }
  }
  return out;
}

function normalizePixel(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v > 1 ? Math.min(1, Math.max(0, v / 255)) : Math.min(1, Math.max(0, v));
}

/** Run the image classifier over a pixel buffer. */
export async function runImageClassification(
  input: ImageInput,
  model: InferenceModel,
  opts: RunOptions = {},
): Promise<InferenceResult> {
  if (model.kind === 'text') {
    throw new Error(`runImageClassification needs an image model, got "${model.kind}"`);
  }
  const startedAt = Date.now();
  opts.onProgress?.(0.1);
  const features = imageFeatures(input, model.width, model.height);
  let raw: number[];
  if (model.kind === 'image') {
    raw = await linearScores(model.weights, model.bias, features);
  } else {
    // Nearest-prototype (negative squared distance) — a tiny template matcher.
    raw = model.prototypes.map((proto) => {
      let acc = 0;
      for (let i = 0; i < proto.length; i += 1) {
        const d = features[i] ?? 0;
        acc += (d - proto[i]!) * (d - proto[i]!);
      }
      return -acc;
    });
  }
  opts.onProgress?.(0.8);
  const scores = softmax(raw);
  const ranked: ScoredLabel[] = model.labels
    .map((label, i) => ({ label, score: scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  opts.onProgress?.(1);
  return {
    label: ranked[0]?.label ?? '',
    scores: ranked,
    latencyMs: Math.max(0, Date.now() - startedAt),
    device: opts.device ?? 'cpu',
    modelId: opts.modelId ?? (model.kind === 'image' ? 'image-linear' : 'image-proto'),
  };
}

// ---- external model files (best effort) ----------------------------------------

/**
 * Parse an imported model file. JSON weight specs become runnable linear
 * models; raw ONNX binaries report a readable error because no ONNX runtime
 * is bundled (keeps the dependency budget fixed).
 */
export function loadExternalModel(fileName: string, buffer: ArrayBuffer): InferenceModel {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.onnx')) {
    throw new Error(
      'ONNX 二进制推理需要 onnxruntime-web（当前发行版未捆绑）。请改用 JSON 权重规格（{ kind, labels, weights, bias, vocabulary? }）或内置示例模型。',
    );
  }
  if (!lower.endsWith('.json')) {
    throw new Error(`unsupported model file extension: ${fileName} (expected .onnx or .json)`);
  }
  let spec: unknown;
  try {
    spec = JSON.parse(new TextDecoder().decode(buffer));
  } catch (err) {
    throw new Error(`model file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return modelFromSpec(spec);
}

/** Validate + convert a JSON weight spec into a runnable model. */
export function modelFromSpec(spec: unknown): InferenceModel {
  if (!spec || typeof spec !== 'object') throw new Error('model spec must be a JSON object');
  const s = spec as Record<string, unknown>;
  const labels = Array.isArray(s.labels) ? s.labels.map(String) : null;
  const weights = Array.isArray(s.weights)
    ? (s.weights as unknown[]).map((row) =>
        Array.isArray(row) ? row.map((v) => Number(v)) : [],
      )
    : null;
  if (!labels || !weights || labels.length === 0 || weights.length !== labels.length) {
    throw new Error('model spec needs "labels" and a matching "weights" matrix');
  }
  const bias = Array.isArray(s.bias) ? (s.bias as unknown[]).map(Number) : new Array<number>(labels.length).fill(0);
  if (s.kind === 'text') {
    const vocabulary = Array.isArray(s.vocabulary) ? s.vocabulary.map(String) : null;
    if (!vocabulary || vocabulary.length === 0) throw new Error('text model spec needs "vocabulary"');
    if (weights.some((row) => row.length !== vocabulary.length)) {
      throw new Error('text model weights rows must match the vocabulary length');
    }
    return { kind: 'text', vocabulary, labels, weights, bias };
  }
  if (s.kind === 'image') {
    const width = Number(s.width);
    const height = Number(s.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error('image model spec needs positive "width" and "height"');
    }
    if (weights.some((row) => row.length !== width * height)) {
      throw new Error('image model weights rows must match width*height');
    }
    return { kind: 'image', width, height, labels, weights, bias };
  }
  throw new Error(`model spec kind must be "text" or "image", got ${JSON.stringify(s.kind)}`);
}
