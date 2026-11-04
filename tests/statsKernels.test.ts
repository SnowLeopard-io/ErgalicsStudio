import { describe, expect, it } from 'vitest';
import {
  doeBenchmark,
  factorEffects,
  fitDoe,
  orthogonalityDefect,
  parseDoeTable,
} from '../src/plugins/builtin/stats/doe/kernel';
import {
  acf,
  adfTest,
  fitArima,
  forecastArima,
  kpssTest,
  parseSeries,
  runTimeSeriesBenchmark,
  seasonalDecompose,
} from '../src/plugins/builtin/stats/timeseries/kernel';
import {
  dbscan,
  kmeans,
  mahalanobisOutliers,
  parseMultivariate,
  pca,
  runMultivariateBenchmark,
} from '../src/plugins/builtin/stats/multivariate/kernel';
import {
  kruskalWallis,
  mannWhitney,
  parseNonparametric,
  rankCorrelations,
  runNonparametricBenchmark,
} from '../src/plugins/builtin/stats/nonparametric/kernel';
import {
  kaplanMeier,
  logRank,
  parseSurvival,
  runSurvivalBenchmark,
} from '../src/plugins/builtin/stats/survival/kernel';
import { metaAnalyze, parseMeta, runMetaBenchmark } from '../src/plugins/builtin/stats/meta/kernel';
import { convergence, parseBayes, runBayes, runBayesBenchmark } from '../src/plugins/builtin/stats/bayes/kernel';

const DOE_CSV = `run,A,B,C,response
1,-1,-1,-1,7.42
2,1,-1,-1,11.18
3,-1,1,-1,8.61
4,1,1,-1,13.02
5,-1,-1,1,7.88
6,1,-1,1,11.55
7,-1,1,1,9.14
8,1,1,1,13.41
9,-1,-1,-1,7.51
10,1,-1,-1,11.09
11,-1,1,-1,8.72
12,1,1,-1,12.91
13,-1,-1,1,7.79
14,1,-1,1,11.63
15,-1,1,1,9.21
16,1,1,1,13.35`;

const NP_CSV = `group,value
control,4.8
control,5.6
control,5.1
control,6.3
control,4.4
treated,6.7
treated,7.4
treated,6.2
treated,8.1
treated,7.8`;

const SURV_CSV = `time,event,group,age
6,1,treatment,58
9,1,treatment,61
12,1,treatment,55
15,1,treatment,63
18,0,treatment,60
21,1,treatment,57
4,1,control,64
7,1,control,67
10,1,control,62
13,1,control,69
16,0,control,65
19,1,control,70`;

describe('statistics kernels · DOE', () => {
  it('recovers the 2³ design and reports a near-perfect fit', () => {
    const dataset = parseDoeTable(DOE_CSV);
    expect(dataset.factors).toEqual(['A', 'B', 'C']);
    expect(dataset.rows).toHaveLength(16);
    const fit = fitDoe(dataset, 2);
    expect(fit).not.toBeNull();
    expect(fit!.r2).toBeGreaterThan(0.98);
    expect(orthogonalityDefect(fit!.design)).toBeLessThan(1e-9);
    expect(factorEffects(dataset)).toHaveLength(3);
  });

  it('passes the embedded validation benchmarks', () => {
    expect(doeBenchmark().every((b) => b.passed)).toBe(true);
  });
});

describe('statistics kernels · time series', () => {
  it('computes ACF, decomposition and an ARIMA forecast', () => {
    const values = Array.from({ length: 60 }, (_, i) => 10 + 0.1 * i + Math.sin((2 * Math.PI * i) / 12));
    const series = parseSeries(['t,value', ...values.map((v, i) => `${i + 1},${v}`)].join('\n'));
    expect(series.values).toHaveLength(60);
    expect(acf(series.values, 12)).toHaveLength(13);
    const decomp = seasonalDecompose(series.values, 12, 'additive');
    expect(decomp.seasonal).toHaveLength(60);
    const model = fitArima(series.values, { p: 1, q: 0, d: 1 });
    expect(model).not.toBeNull();
    const forecast = forecastArima(model!, 6);
    expect(forecast).toHaveLength(6);
    expect(forecast.every((f) => Number.isFinite(f.mean))).toBe(true);
  });

  it('classifies white noise as stationary and passes benchmarks', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const values = Array.from({ length: 180 }, () => (rand() - 0.5) * 2);
    expect(adfTest(values, 1).stationary).toBe(true);
    expect(Number.isFinite(kpssTest(values).statistic)).toBe(true);
    expect(runTimeSeriesBenchmark().every((b) => b.passed)).toBe(true);
  });
});

describe('statistics kernels · multivariate', () => {
  const csv = ['x1,x2,x3,group', ...[
    [1, 1.1, 0.9, 'a'], [1.2, 0.8, 1.1, 'a'], [0.9, 1.3, 1, 'a'],
    [5, 5.2, 4.8, 'b'], [5.3, 4.9, 5.1, 'b'], [4.8, 5.1, 5.2, 'b'],
    [9, 9.1, 8.8, 'c'], [9.2, 8.9, 9.1, 'c'], [8.8, 9.2, 9, 'c'],
  ].map((row) => row.join(','))].join('\n');

  it('orders PCA components and separates three clusters', () => {
    const data = parseMultivariate(csv);
    expect(data.variables).toEqual(['x1', 'x2', 'x3']);
    const model = pca(data.x, true);
    expect(model).not.toBeNull();
    expect(model!.explained[0]).toBeGreaterThan(model!.explained[1]!);
    const km = kmeans(data.x, 3, 7);
    expect(km).not.toBeNull();
    expect(km!.k).toBe(3);
    expect(km!.silhouette).toBeGreaterThan(0.5);
    expect(mahalanobisOutliers(data.x, 0.975).threshold).toBeGreaterThan(0);
  });

  it('passes the embedded validation benchmarks', () => {
    expect(runMultivariateBenchmark().every((b) => b.passed)).toBe(true);
  });

  it('keeps DBSCAN noise as -1 and still reports usable cluster statistics', () => {
    // Two dense triples plus one far-away point that no eps-ball reaches.
    const x = [
      [0, 0], [0.1, 0.1], [0.2, 0],
      [5, 5], [5.1, 5.1], [5.2, 5],
      [50, 50],
    ];
    const res = dbscan(x, 0.5, 2);
    expect(res.k).toBe(2);
    expect(res.labels).toEqual([0, 0, 0, 1, 1, 1, -1]);
    expect(res.centers).toHaveLength(2);
    expect(res.wss).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(res.silhouette)).toBe(true);
  });

  it('survives DBSCAN when no core points exist', () => {
    // Every point is isolated, so there are zero clusters and all noise.
    const x = [[0], [10], [20], [30]];
    const res = dbscan(x, 1, 3);
    expect(res.k).toBe(0);
    expect(res.labels).toEqual([-1, -1, -1, -1]);
    expect(res.centers).toEqual([]);
    expect(res.wss).toBe(0);
    expect(res.silhouette).toBe(0);

    const empty = dbscan([], 1, 3);
    expect(empty.k).toBe(0);
    expect(empty.labels).toEqual([]);
    expect(empty.centers).toEqual([]);
  });
});

describe('statistics kernels · nonparametric', () => {
  it('detects a location shift and recovers rank correlations', () => {
    const dataset = parseNonparametric(NP_CSV);
    expect(dataset.groups).toHaveLength(2);
    const mw = mannWhitney(dataset.groups[0]!.values, dataset.groups[1]!.values);
    expect(mw).not.toBeNull();
    expect(mw!.p).toBeLessThan(0.05);
    expect(kruskalWallis(dataset.groups)).not.toBeNull();
    const corr = rankCorrelations([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]);
    expect(corr).not.toBeNull();
    expect(corr!.rho).toBeGreaterThan(0.5);
  });

  it('passes the embedded validation benchmarks', () => {
    expect(runNonparametricBenchmark().every((b) => b.passed)).toBe(true);
  });
});

describe('statistics kernels · survival', () => {
  it('builds monotone KM curves and a log-rank test', () => {
    const data = parseSurvival(SURV_CSV);
    expect(data.time).toHaveLength(12);
    const km = kaplanMeier(data.time, data.event, 'all');
    expect(km.points[0]!.survival).toBe(1);
    for (let i = 1; i < km.points.length; i += 1) {
      expect(km.points[i]!.survival).toBeLessThanOrEqual(km.points[i - 1]!.survival);
      expect(km.points[i]!.survival).toBeGreaterThanOrEqual(0);
    }
    const lr = logRank(data.time, data.event, data.groups!);
    expect(lr).not.toBeNull();
    expect(lr!.df).toBe(1);
    expect(Number.isFinite(lr!.p)).toBe(true);
  });

  it('passes the embedded validation benchmarks', () => {
    expect(runSurvivalBenchmark().every((b) => b.passed)).toBe(true);
  });
});

describe('statistics kernels · meta-analysis', () => {
  it('pools effects and bounds heterogeneity', () => {
    const data = parseMeta(`study,effect,se
A,0.2,0.1
B,0.4,0.1
C,0.3,0.2
D,0.25,0.15`);
    expect(data.studies).toHaveLength(4);
    const res = metaAnalyze(data.studies);
    expect(res).not.toBeNull();
    expect(res!.fixed.lo).toBeLessThan(res!.fixed.estimate);
    expect(res!.fixed.hi).toBeGreaterThan(res!.fixed.estimate);
    expect(res!.i2).toBeGreaterThanOrEqual(0);
    expect(res!.i2).toBeLessThanOrEqual(1);
    expect(res!.tau2).toBeGreaterThanOrEqual(0);
  });

  it('passes the embedded validation benchmarks', () => {
    expect(runMetaBenchmark().every((b) => b.passed)).toBe(true);
  });
});

describe('statistics kernels · Bayesian inference', () => {
  it('recovers the posterior mean of a normal sample', () => {
    const data = parseBayes(`value
2.1
1.8
2.4
2.0
1.9
2.2
2.3
1.7`);
    expect(data.values).toHaveLength(8);
    const result = runBayes(data.values, { iterations: 1200, chains: 4, seed: 12345 });
    expect(result.muSummary.mean).toBeGreaterThan(1.4);
    expect(result.muSummary.mean).toBeLessThan(2.8);
    expect(result.muSummary.lo).toBeLessThan(result.muSummary.mean);
    expect(result.muSummary.hi).toBeGreaterThan(result.muSummary.mean);
    expect(result.sigmaSummary.mean).toBeGreaterThan(0);
    expect(result.rhat).toBeLessThan(1.1);
  });

  it('computes R-hat on well-mixed chains', () => {
    const chains = [
      [0, 1, 0, 1, 0, 1],
      [0.1, 0.9, 0.2, 0.8, 0.1, 0.9],
    ];
    const conv = convergence(chains);
    expect(conv.rhat).toBeGreaterThan(0.9);
    expect(conv.ess).toBeGreaterThan(0);
  });

  it('passes the embedded validation benchmarks', () => {
    expect(runBayesBenchmark().every((b) => b.passed)).toBe(true);
  });
});
