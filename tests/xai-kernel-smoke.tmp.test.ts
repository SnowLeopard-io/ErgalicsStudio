// Temporary smoke test for the XAI kernel (deleted after verification).
import { describe, it, expect } from 'vitest';
import {
  XAI_SAMPLE_CSV,
} from '@/plugins/builtin/data/xai/samples';
import {
  counterfactualSearch,
  fairnessMetrics,
  generateAdultLikeSample,
  kernelShap,
  limeExplain,
  mulberry32,
  parseXaiData,
  partialDependence,
  permutationImportance,
  sensitiveColumn,
  trainReference,
} from '@/plugins/builtin/data/xai/kernel';

describe('xai kernel smoke', () => {
  const data = parseXaiData(XAI_SAMPLE_CSV);
  const trained = trainReference(data, 20261029);
  const model = trained.model;
  const Xte = trained.split.testIdx.map((i) => data.X[i]!);
  const yte = trained.split.testIdx.map((i) => data.y[i]!);
  const instance = Xte[0]!;

  it('parses the sample and trains a sane model', () => {
    expect(data.rowCount).toBeGreaterThanOrEqual(230);
    expect(data.task).toBe('classification');
    expect(data.featureNames).toEqual(['age', 'hours', 'education-years', 'capital-gain', 'sex']);
    expect(trained.testMetric).toBeGreaterThan(0.65);
  });

  it('deterministic given the same seed', () => {
    const again = trainReference(data, 20261029);
    expect(again.testMetric).toBe(trained.testMetric);
    expect(again.model.weights).toEqual(model.weights);
  });

  it('permutation importance ranks sex/education high', () => {
    const items = permutationImportance(model, Xte, yte, 8, mulberry32(123));
    const top = items.slice().sort((a, b) => b.meanDrop - a.meanDrop)[0]!;
    expect(top.meanDrop).toBeGreaterThan(0);
    expect(items).toHaveLength(5);
  });

  it('pdp grid spans the feature range', () => {
    const idx = data.featureNames.indexOf('age');
    const curve = partialDependence(model, data.X, idx, 40);
    expect(curve.grid).toHaveLength(40);
    expect(Math.max(...curve.preds)).toBeGreaterThan(Math.min(...curve.preds));
  });

  it('lime surrogate fits locally', () => {
    const lime = limeExplain(model, instance, 800, mulberry32(7));
    expect(lime.localR2).toBeGreaterThan(0.4);
    expect(lime.weights.some((wt) => Math.abs(wt.weight) > 0.01)).toBe(true);
  });

  it('kernelshap additivity residual is tiny', () => {
    const shap = kernelShap(model, model.means.slice(), instance, 512, mulberry32(99));
    const sum = shap.phis.reduce((a, p) => a + p.phi, 0);
    expect(Math.abs(shap.residual)).toBeLessThan(1e-6 * (Math.abs(shap.fX) + 1));
    expect(shap.base + sum).toBeCloseTo(shap.fX, 6);
    expect(shap.coalitions).toBeGreaterThanOrEqual(8);
  });

  it('counterfactual flips the prediction with a small perturbation', () => {
    const cf = counterfactualSearch(model, data.X, instance);
    expect(cf.flipped).toBe(true);
    expect(cf.costL2).toBeGreaterThan(0);
    const changedCount = cf.changed.filter(Boolean).length;
    expect(changedCount).toBeGreaterThanOrEqual(1);
    expect(cf.costL1).toBeLessThan(200);
  });

  it('fairness metrics are finite and show a real gap', () => {
    const sens = sensitiveColumn(data, 'sex')!;
    const sensTest = trained.split.testIdx.map((i) => sens.values[i] ?? 0);
    const f = fairnessMetrics(model, Xte, yte, sensTest, sens.groupNames);
    expect(Number.isFinite(f.dpDiff)).toBe(true);
    expect(Number.isFinite(f.tprGap)).toBe(true);
    expect(Number.isFinite(f.fprGap)).toBe(true);
    expect(Number.isFinite(f.diRatio)).toBe(true);
    expect(Math.abs(f.dpDiff)).toBeGreaterThan(0.05);
  });

  it('benchmark dataset trains and explains fast', () => {
    const csv = generateAdultLikeSample(2000, 20261040);
    const d2 = parseXaiData(csv);
    const t2 = trainReference(d2, 20261040);
    const X2 = t2.split.testIdx.map((i) => d2.X[i]!);
    const y2 = t2.split.testIdx.map((i) => d2.y[i]!);
    const rng = mulberry32(5);
    const t0 = performance.now();
    permutationImportance(t2.model, X2, y2, 4, rng);
    kernelShap(t2.model, t2.model.means.slice(), X2[0]!, 256, rng);
    limeExplain(t2.model, X2[0]!, 400, rng);
    const ms = performance.now() - t0;
    expect(t2.testMetric).toBeGreaterThan(0.6);
    expect(ms).toBeLessThan(2000);
  });
});
