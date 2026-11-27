// ==========================================================================
// complexity — pure kernel
//
// Least-squares fitting of empirical input-size/runtime measurements to a
// catalogue of asymptotic models, plus log-log power-law regression. Pure
// numbers in, numbers out; used by the UI, Block/Flow and the test-suite.
// ==========================================================================

export interface Measurement {
  n: number;
  time: number;
}

export type ModelId = '1' | 'logn' | 'n' | 'nlogn' | 'n2' | 'n3' | '2n';

export interface ModelDef {
  id: ModelId;
  en: string;
  zh: string;
  latex: string;
  f: (n: number) => number;
}

export const MODELS: Record<ModelId, ModelDef> = {
  '1': { id: '1', en: 'Constant', zh: '常数', latex: 'O(1)', f: () => 1 },
  logn: { id: 'logn', en: 'Logarithmic', zh: '对数', latex: 'O(log n)', f: (n) => Math.log2(Math.max(2, n)) },
  n: { id: 'n', en: 'Linear', zh: '线性', latex: 'O(n)', f: (n) => n },
  nlogn: { id: 'nlogn', en: 'Linearithmic', zh: '线性对数', latex: 'O(n log n)', f: (n) => n * Math.log2(Math.max(2, n)) },
  n2: { id: 'n2', en: 'Quadratic', zh: '平方', latex: 'O(n²)', f: (n) => n * n },
  n3: { id: 'n3', en: 'Cubic', zh: '立方', latex: 'O(n³)', f: (n) => n * n * n },
  '2n': { id: '2n', en: 'Exponential', zh: '指数', latex: 'O(2ⁿ)', f: (n) => 2 ** Math.min(n, 1024) },
};

export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

export interface FitResult {
  id: ModelId;
  /** Multiplicative scale fitted by least squares. */
  scale: number;
  intercept: number;
  r2: number;
  rmse: number;
  predictions: number[];
}

export function fitModel(id: ModelId, data: Measurement[]): FitResult {
  const model = MODELS[id];
  const ys = data.map((d) => d.time);
  const mean = ys.reduce((s, y) => s + y, 0) / Math.max(1, ys.length);
  const predictions = new Array<number>(data.length).fill(mean);
  if (id === '1' || data.length === 0) {
    let ssRes = 0;
    for (let i = 0; i < data.length; i += 1) ssRes += (ys[i]! - mean) ** 2;
    return { id, scale: mean, intercept: mean, r2: data.length ? 1 - ssRes / Math.max(1e-12, totalSumSquares(ys)) : 0, rmse: Math.sqrt(ssRes / Math.max(1, data.length)), predictions };
  }
  const fs = data.map((d) => model.f(d.n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < data.length; i += 1) {
    num += fs[i]! * ys[i]!;
    den += fs[i]! * fs[i]!;
  }
  const scale = den === 0 ? 0 : num / den;
  let ssRes = 0;
  for (let i = 0; i < data.length; i += 1) {
    predictions[i] = scale * fs[i]!;
    ssRes += (ys[i]! - predictions[i]!) ** 2;
  }
  const sst = totalSumSquares(ys);
  return {
    id,
    scale,
    intercept: 0,
    r2: sst === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / sst,
    rmse: Math.sqrt(ssRes / Math.max(1, data.length)),
    predictions,
  };
}

function totalSumSquares(ys: number[]): number {
  const mean = ys.reduce((s, y) => s + y, 0) / Math.max(1, ys.length);
  return ys.reduce((s, y) => s + (y - mean) ** 2, 0);
}

export interface Analysis {
  fits: FitResult[];
  ranked: FitResult[];
  best: FitResult;
  /** Slope of log(time) vs log(n). */
  exponent: number;
  powerR2: number;
}

export function analyseComplexity(data: Measurement[]): Analysis {
  const fits = MODEL_IDS.map((id) => fitModel(id, data));
  const ranked = [...fits].sort((a, b) => b.r2 - a.r2 || a.rmse - b.rmse);
  const power = powerLaw(data);
  return {
    fits,
    ranked,
    best: ranked[0] ?? fits[0]!,
    exponent: power.slope,
    powerR2: power.r2,
  };
}

export interface PowerLaw {
  slope: number;
  intercept: number;
  r2: number;
}

/** Ordinary least squares on log(time) = intercept + slope·log(n). */
export function powerLaw(data: Measurement[]): PowerLaw {
  const points = data.filter((d) => d.n > 0 && d.time > 0).map((d) => ({ x: Math.log(d.n), y: Math.log(d.time) }));
  if (points.length < 2) return { slope: 0, intercept: 0, r2: 0 };
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

export type SyntheticId = 'linear' | 'nlogn' | 'quadratic' | 'cubic' | 'exponential' | 'constant';

export function syntheticRuns(kind: SyntheticId, sizes: number[], noise = 0, seed = 11): Measurement[] {
  const rng = (() => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  return sizes.map((n) => {
    const base =
      kind === 'linear'
        ? n
        : kind === 'nlogn'
          ? n * Math.log2(Math.max(2, n))
          : kind === 'quadratic'
            ? n * n
            : kind === 'cubic'
              ? n * n * n
              : kind === 'exponential'
                ? 2 ** Math.min(n, 40)
                : 10;
    const jitter = noise > 0 ? 1 + (rng() * 2 - 1) * noise : 1;
    return { n, time: base * jitter };
  });
}

/** Parse `n,time` rows; a header row is skipped automatically. */
export function parseMeasurements(text: string): Measurement[] {
  const out: Measurement[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(/[,\t;\s]+/).map(Number);
    if (cells.length < 2) continue;
    const [n, time] = cells;
    if (Number.isFinite(n) && Number.isFinite(time) && n! > 0 && time! >= 0) out.push({ n: n!, time: time! });
  }
  return out;
}

export interface ComplexityBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runComplexityBenchmarks(): ComplexityBenchmark[] {
  const sizes = [8, 16, 32, 64, 128, 256];
  const linear = syntheticRuns('linear', sizes);
  const quadratic = syntheticRuns('quadratic', sizes);
  const nlogn = syntheticRuns('nlogn', sizes);
  const constant = syntheticRuns('constant', sizes);
  const linearAnalysis = analyseComplexity(linear);
  const quadPower = powerLaw(quadratic);
  const nlognAnalysis = analyseComplexity(nlogn);
  const constantAnalysis = analyseComplexity(constant);

  const cases = [
    {
      id: 'linear-fit',
      labelEn: 'Linear data → best model O(n) with R² = 1',
      labelZh: '线性数据 → 最佳模型 O(n)，R² = 1',
      measured: linearAnalysis.best.id === 'n' ? linearAnalysis.best.r2 : 0,
      expected: 1,
      tol: 1e-9,
    },
    {
      id: 'quadratic-exponent',
      labelEn: 'Quadratic data → log-log slope 2',
      labelZh: '平方数据 → 双对数斜率 2',
      measured: quadPower.slope,
      expected: 2,
      tol: 1e-9,
    },
    {
      id: 'nloglogn-ranking',
      labelEn: 'n log n data → best model O(n log n)',
      labelZh: 'n log n 数据 → 最佳模型 O(n log n)',
      measured: nlognAnalysis.best.id === 'nlogn' ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'loglog-recover',
      labelEn: 'Log-log R² on quadratic data = 1',
      labelZh: '平方数据的双对数 R² = 1',
      measured: quadPower.r2,
      expected: 1,
      tol: 1e-9,
    },
    {
      id: 'constant-fit',
      labelEn: 'Constant data → best model O(1)',
      labelZh: '常数数据 → 最佳模型 O(1)',
      measured: constantAnalysis.best.id === '1' ? 1 : 0,
      expected: 1,
      tol: 0,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}
