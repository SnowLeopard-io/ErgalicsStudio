// ==========================================================================
// Ergalics Studio — FR-08 pretrained model catalog
//
// The built-in examples the 模型推理 tool page offers without any upload:
// one sentiment-style text classifier (bag-of-words linear head) and one
// digit image classifier (prototype matcher). Each entry carries the input
// type, an approximate size for the memory/device budget, and a factory
// producing the runnable weight model consumed by @/core/inference/onnx-runner.
// ==========================================================================

import type { InferenceModel, ImagePrototypeModel, TextLinearModel } from './onnx-runner';

export type ModelInputType = 'text' | 'image' | 'table';

export interface PretrainedModelEntry {
  id: string;
  /** Default display name (zh). */
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  inputType: ModelInputType;
  /** Approximate on-disk size in MB (drives the device/memory budget). */
  sizeMb: number;
  labels: string[];
  /** Build the runnable weight model (pure, deterministic). */
  build(): InferenceModel;
}

// ---- built-in text model: coarse sentiment over a tiny vocabulary ----------

const TEXT_VOCAB = [
  'good', 'great', 'excellent', 'love', 'wonderful', 'positive', 'clear',
  'accurate', 'works', 'fast', 'bad', 'poor', 'terrible', 'hate', 'awful',
  'negative', 'unclear', 'wrong', 'broken', 'slow',
  '好', '棒', '优', '喜', '爱', '正', '明', '确', '快', '差', '坏', '糟', '厌', '负', '错', '慢',
];

const TEXT_LABELS = ['positive', 'neutral', 'negative'];

// Hand-tuned linear head: positive/negative rows are mirror images (±1.2 per
// matched word); the neutral row is a constant 0.5 bias minus 1.2 per ANY
// sentiment word, so unknown text lands on 'neutral' while sentiment words
// always push the argmax to the matching class (no ties between pos/neg).
const TEXT_WEIGHTS: number[][] = [
  TEXT_VOCAB.map((w) => (isPositiveWord(w) ? 1.2 : isNegativeWord(w) ? -1.2 : 0)),
  TEXT_VOCAB.map((w) => (isPositiveWord(w) || isNegativeWord(w) ? -1.2 : 0)),
  TEXT_VOCAB.map((w) => (isNegativeWord(w) ? 1.2 : isPositiveWord(w) ? -1.2 : 0)),
];

function isPositiveWord(word: string): boolean {
  return ['good', 'great', 'excellent', 'love', 'wonderful', 'positive', 'clear', 'accurate', 'works', 'fast', '好', '棒', '优', '喜', '爱', '正', '明', '确', '快'].includes(word);
}

function isNegativeWord(word: string): boolean {
  return ['bad', 'poor', 'terrible', 'hate', 'awful', 'negative', 'unclear', 'wrong', 'broken', 'slow', '差', '坏', '糟', '厌', '负', '错', '慢'].includes(word);
}

function buildTextModel(): TextLinearModel {
  return {
    kind: 'text',
    vocabulary: TEXT_VOCAB,
    labels: TEXT_LABELS,
    weights: TEXT_WEIGHTS,
    bias: [0, 0.5, 0],
  };
}

// ---- built-in image model: 8×8 digit prototypes (0/1/2) --------------------
//
// Three hand-drawn 8x8 templates. The classifier is a nearest-prototype
// matcher — small, deterministic, and enough to demonstrate the pipeline
// (import → device → run → lineage) without shipping real weights.

function digit0(): number[] {
  const g = [
    '..####..',
    '.#....#.',
    '#......#',
    '#......#',
    '#......#',
    '#......#',
    '.#....#.',
    '..####..',
  ];
  return fromGlyph(g);
}

function digit1(): number[] {
  const g = [
    '...#....',
    '..##....',
    '.#.#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '..###...',
  ];
  return fromGlyph(g);
}

function digit2(): number[] {
  const g = [
    '..####..',
    '.#....#.',
    '......#.',
    '....##..',
    '..##....',
    '.#......',
    '#.......',
    '########',
  ];
  return fromGlyph(g);
}

function fromGlyph(rows: string[]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    for (const ch of row) out.push(ch === '#' ? 1 : 0);
  }
  return out;
}

function buildDigitModel(): ImagePrototypeModel {
  return {
    kind: 'image-proto',
    width: 8,
    height: 8,
    labels: ['0', '1', '2'],
    prototypes: [digit0(), digit1(), digit2()],
  };
}

// ---- catalog ------------------------------------------------------------------

export const PRETRAINED_MODELS: readonly PretrainedModelEntry[] = [
  {
    id: 'sentiment-bow',
    name: '情感文本分类（词袋线性模型）',
    nameEn: 'Sentiment Text Classifier (bag-of-words)',
    description: '内置示例：对输入文本做 positive / neutral / negative 三分类',
    descriptionEn: 'Built-in example: classify text as positive / neutral / negative',
    inputType: 'text',
    sizeMb: 0.01,
    labels: TEXT_LABELS,
    build: buildTextModel,
  },
  {
    id: 'digit-8x8',
    name: '手写数字分类（8×8 原型匹配）',
    nameEn: 'Digit Image Classifier (8×8 prototypes)',
    description: '内置示例：识别 8×8 灰度手写数字（0 / 1 / 2）',
    descriptionEn: 'Built-in example: recognize 8×8 grayscale digits (0 / 1 / 2)',
    inputType: 'image',
    sizeMb: 0.02,
    labels: ['0', '1', '2'],
    build: buildDigitModel,
  },
];

export function getModelEntry(id: string): PretrainedModelEntry | undefined {
  return PRETRAINED_MODELS.find((m) => m.id === id);
}
