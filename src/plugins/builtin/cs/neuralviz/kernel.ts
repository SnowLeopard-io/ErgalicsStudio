// ==========================================================================
// neuralviz — pure kernel
//
// A small fully-connected MLP with seeded initialisation, forward/backward
// passes, mini-batch training and synthetic 2-D classification datasets.
// Deterministic for a given seed; no DOM or WebGL required.
// ==========================================================================

export type ActivationId = 'sigmoid' | 'tanh' | 'relu';

export interface MlpConfig {
  sizes: number[];
  activation: ActivationId;
  seed: number;
}

export interface Mlp {
  sizes: number[];
  activation: ActivationId;
  weights: number[][][];
  biases: number[][];
}

export interface Sample {
  x: [number, number];
  y: 0 | 1;
}

export interface ForwardResult {
  z: number[][];
  activations: number[][];
}

export interface Gradients {
  weights: number[][][];
  biases: number[][];
  loss: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function activate(kind: ActivationId, z: number): number {
  if (kind === 'sigmoid') return 1 / (1 + Math.exp(-z));
  if (kind === 'tanh') return Math.tanh(z);
  return Math.max(0, z);
}

export function activationDerivative(kind: ActivationId, z: number, a = activate(kind, z)): number {
  if (kind === 'sigmoid') return a * (1 - a);
  if (kind === 'tanh') return 1 - a * a;
  return z > 0 ? 1 : 0;
}

export function createMlp(config: MlpConfig): Mlp {
  const rng = mulberry32(config.seed);
  const sizes = [...config.sizes];
  const weights: number[][][] = [];
  const biases: number[][] = [];
  for (let l = 0; l < sizes.length - 1; l += 1) {
    const fanIn = sizes[l]!;
    const fanOut = sizes[l + 1]!;
    const limit = Math.sqrt(6 / (fanIn + fanOut));
    const layer: number[][] = [];
    for (let j = 0; j < fanOut; j += 1) {
      layer.push(Array.from({ length: fanIn }, () => (rng() * 2 - 1) * limit));
    }
    weights.push(layer);
    biases.push(new Array<number>(fanOut).fill(0));
  }
  return { sizes, activation: config.activation, weights, biases };
}

export function forward(mlp: Mlp, input: number[]): ForwardResult {
  const z: number[][] = [];
  const activations: number[][] = [[...input]];
  let current = [...input];
  for (let l = 0; l < mlp.weights.length; l += 1) {
    const zl: number[] = [];
    const next: number[] = [];
    for (let j = 0; j < mlp.weights[l]!.length; j += 1) {
      let sum = mlp.biases[l]![j]!;
      const row = mlp.weights[l]![j]!;
      for (let i = 0; i < row.length; i += 1) sum += row[i]! * current[i]!;
      zl.push(sum);
      next.push(activate(mlp.activation, sum));
    }
    z.push(zl);
    activations.push(next);
    current = next;
  }
  return { z, activations };
}

export function predict(mlp: Mlp, input: number[]): number {
  return forward(mlp, input).activations.at(-1)![0]!;
}

/** Backpropagation for one sample with a ½·(out − target)² loss. */
export function backward(mlp: Mlp, sample: Sample): Gradients {
  const { z, activations } = forward(mlp, sample.x);
  const weightGrads = mlp.weights.map((layer) => layer.map((row) => new Array<number>(row.length).fill(0)));
  const biasGrads = mlp.biases.map((row) => new Array<number>(row.length).fill(0));
  const out = activations.at(-1)![0]!;
  const loss = 0.5 * (out - sample.y) ** 2;

  let delta = [(out - sample.y) * activationDerivative(mlp.activation, z.at(-1)![0]!, out)];
  for (let l = mlp.weights.length - 1; l >= 0; l -= 1) {
    const prev = activations[l]!;
    for (let j = 0; j < delta.length; j += 1) {
      biasGrads[l]![j] = delta[j]!;
      for (let i = 0; i < prev.length; i += 1) weightGrads[l]![j]![i] = delta[j]! * prev[i]!;
    }
    if (l > 0) {
      const nextDelta = new Array<number>(prev.length).fill(0);
      for (let i = 0; i < prev.length; i += 1) {
        let sum = 0;
        for (let j = 0; j < delta.length; j += 1) sum += mlp.weights[l]![j]![i]! * delta[j]!;
        nextDelta[i] = sum * activationDerivative(mlp.activation, z[l - 1]![i]!, prev[i]!);
      }
      delta = nextDelta;
    }
  }
  return { weights: weightGrads, biases: biasGrads, loss };
}

export interface TrainOptions {
  epochs: number;
  learningRate: number;
  /** 0 = full batch. */
  batchSize?: number;
  seed?: number;
}

export interface TrainResult {
  losses: number[];
  accuracy: number;
  epochs: number;
}

export function train(mlp: Mlp, data: Sample[], options: TrainOptions): TrainResult {
  const losses: number[] = [];
  const rng = mulberry32(options.seed ?? 12345);
  const batch = options.batchSize && options.batchSize > 0 ? options.batchSize : data.length;
  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const order = data.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    let epochLoss = 0;
    for (let start = 0; start < order.length; start += batch) {
      const slice = order.slice(start, start + batch);
      const gradW = mlp.weights.map((layer) => layer.map((row) => new Array<number>(row.length).fill(0)));
      const gradB = mlp.biases.map((row) => new Array<number>(row.length).fill(0));
      for (const idx of slice) {
        const g = backward(mlp, data[idx]!);
        epochLoss += g.loss;
        for (let l = 0; l < gradW.length; l += 1) {
          for (let j = 0; j < gradW[l]!.length; j += 1) {
            gradB[l]![j]! += g.biases[l]![j]!;
            for (let i = 0; i < gradW[l]![j]!.length; i += 1) gradW[l]![j]![i]! += g.weights[l]![j]![i]!;
          }
        }
      }
      const scale = options.learningRate / Math.max(1, slice.length);
      for (let l = 0; l < mlp.weights.length; l += 1) {
        for (let j = 0; j < mlp.weights[l]!.length; j += 1) {
          mlp.biases[l]![j]! -= scale * gradB[l]![j]!;
          for (let i = 0; i < mlp.weights[l]![j]!.length; i += 1) {
            mlp.weights[l]![j]![i]! -= scale * gradW[l]![j]![i]!;
          }
        }
      }
    }
    losses.push(epochLoss / Math.max(1, data.length));
  }
  return { losses, accuracy: accuracy(mlp, data), epochs: options.epochs };
}

export function accuracy(mlp: Mlp, data: Sample[]): number {
  if (data.length === 0) return 0;
  let correct = 0;
  for (const sample of data) {
    const p = predict(mlp, sample.x);
    if ((p >= 0.5 ? 1 : 0) === sample.y) correct += 1;
  }
  return correct / data.length;
}

export type DatasetId = 'xor' | 'circle' | 'spiral';

export function makeDataset(kind: DatasetId, count = 80, seed = 7): Sample[] {
  if (kind === 'xor') {
    return [
      { x: [0, 0], y: 0 },
      { x: [0, 1], y: 1 },
      { x: [1, 0], y: 1 },
      { x: [1, 1], y: 0 },
    ];
  }
  const rng = mulberry32(seed);
  const out: Sample[] = [];
  if (kind === 'circle') {
    for (let i = 0; i < count; i += 1) {
      const r = Math.sqrt(rng()) * 1.1;
      const theta = rng() * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      const cls: 0 | 1 = r < 0.55 ? 1 : 0;
      out.push({ x: [x, y], y: cls });
    }
    return out;
  }
  for (let i = 0; i < count; i += 1) {
    const cls: 0 | 1 = i % 2 === 0 ? 0 : 1;
    const t = (i / count) * 2.2 * Math.PI + (cls === 1 ? Math.PI : 0);
    const r = 0.15 + 0.8 * (i / count);
    out.push({ x: [r * Math.cos(t), r * Math.sin(t)], y: cls });
  }
  return out;
}

export interface DecisionGrid {
  resolution: number;
  values: Float64Array;
  min: number;
  max: number;
}

/** Evaluate P(class 1) on a square grid over [min, max]². */
export function decisionGrid(mlp: Mlp, resolution = 48, min = -1.3, max = 1.3): DecisionGrid {
  const values = new Float64Array(resolution * resolution);
  let lo = Infinity;
  let hi = -Infinity;
  for (let iy = 0; iy < resolution; iy += 1) {
    for (let ix = 0; ix < resolution; ix += 1) {
      const x = min + ((ix + 0.5) / resolution) * (max - min);
      const y = min + ((iy + 0.5) / resolution) * (max - min);
      const p = predict(mlp, [x, y]);
      values[iy * resolution + ix] = p;
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
  }
  return { resolution, values, min, max };
}

export function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

/** Central finite-difference check on a random subset of weights. */
export function gradientCheck(mlp: Mlp, sample: Sample, checks = 12, epsilon = 1e-5, seed = 99): number {
  const rng = mulberry32(seed);
  const analytic = backward(mlp, sample);
  let worst = 0;
  for (let k = 0; k < checks; k += 1) {
    const l = Math.floor(rng() * mlp.weights.length);
    const j = Math.floor(rng() * mlp.weights[l]!.length);
    const i = Math.floor(rng() * mlp.weights[l]![j]!.length);
    const original = mlp.weights[l]![j]![i]!;
    mlp.weights[l]![j]![i] = original + epsilon;
    const plus = backward(mlp, sample).loss;
    mlp.weights[l]![j]![i] = original - epsilon;
    const minus = backward(mlp, sample).loss;
    mlp.weights[l]![j]![i] = original;
    const numeric = (plus - minus) / (2 * epsilon);
    const exact = analytic.weights[l]![j]![i]!;
    const denom = Math.max(1e-8, Math.abs(numeric) + Math.abs(exact));
    worst = Math.max(worst, Math.abs(numeric - exact) / denom);
  }
  return worst;
}

export interface NeuralBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runNeuralBenchmarks(): NeuralBenchmark[] {
  const xor = makeDataset('xor');
  const net = createMlp({ sizes: [2, 8, 1], activation: 'tanh', seed: 42 });
  const trained = train(net, xor, { epochs: 600, learningRate: 0.3 });
  const gradErr = gradientCheck(
    createMlp({ sizes: [2, 5, 1], activation: 'sigmoid', seed: 3 }),
    { x: [0.3, -0.4], y: 1 },
  );
  const softmaxSum = softmax([1, 2, 3]).reduce((s, v) => s + v, 0);
  const derivative = activationDerivative('sigmoid', 0);

  const cases = [
    {
      id: 'xor-convergence',
      labelEn: 'MLP learns XOR (4/4 correct)',
      labelZh: 'MLP 学会 XOR（4/4 正确）',
      measured: trained.accuracy,
      expected: 1,
      tol: 0,
    },
    {
      id: 'softmax-normalisation',
      labelEn: 'softmax([1,2,3]) sums to 1',
      labelZh: 'softmax([1,2,3]) 求和为 1',
      measured: softmaxSum,
      expected: 1,
      tol: 1e-12,
    },
    {
      id: 'gradient-check',
      labelEn: 'Analytic vs numeric gradient max relative error < 1e-4',
      labelZh: '解析梯度与数值梯度最大相对误差 < 1e-4',
      measured: gradErr,
      expected: 0,
      tol: 1e-4,
    },
    {
      id: 'activation-derivative',
      labelEn: "sigmoid′(0) = 0.25",
      labelZh: 'sigmoid′(0) = 0.25',
      measured: derivative,
      expected: 0.25,
      tol: 1e-12,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}

/** Serialise the network + dataset for the JSON export/import round-trip. */
export function exportNetworkJson(mlp: Mlp, data: Sample[]): string {
  return JSON.stringify(
    {
      kind: 'ergalics-neuralviz',
      version: 1,
      sizes: mlp.sizes,
      activation: mlp.activation,
      weights: mlp.weights,
      biases: mlp.biases,
      dataset: data,
    },
    null,
    2,
  );
}

export function importNetworkJson(text: string): { mlp: Mlp; data: Sample[] } | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (!Array.isArray(obj.sizes) || !Array.isArray(obj.weights) || !Array.isArray(obj.biases)) return null;
    const sizes = (obj.sizes as unknown[]).map(Number);
    if (sizes.some((n) => !Number.isInteger(n) || n < 1) || sizes.length < 2) return null;
    const mlp: Mlp = {
      sizes,
      activation: (obj.activation === 'tanh' || obj.activation === 'relu' ? obj.activation : 'sigmoid') as ActivationId,
      weights: obj.weights as number[][][],
      biases: obj.biases as number[][],
    };
    const data: Sample[] = Array.isArray(obj.dataset)
      ? (obj.dataset as Array<{ x: number[]; y: number }>).map((s) => ({
          x: [Number(s.x[0]) || 0, Number(s.x[1]) || 0],
          y: s.y ? 1 : 0,
        }))
      : [];
    return { mlp, data };
  } catch {
    return null;
  }
}
