// AI/ML suite (ai.*) — pinned manifest signatures, registration and kernel tests.
import { describe, expect, it } from 'vitest';

import { verifyBundledManifestSignature } from '../src/core/plugin-signing';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { automlManifest } from '@/plugins/builtin/data/automl/manifest';
import { nlpManifest } from '@/plugins/builtin/data/nlp/manifest';
import { recsysManifest } from '@/plugins/builtin/data/recsys/manifest';
import { rlManifest } from '@/plugins/builtin/data/rl/manifest';
import { xaiManifest } from '@/plugins/builtin/data/xai/manifest';
import { vectordbManifest } from '@/plugins/builtin/data/vectordb/manifest';

import { generateSyntheticDataset, runAutoML } from '@/plugins/builtin/data/automl/kernel';
import { AUTOML_SAMPLE_CSV } from '@/plugins/builtin/data/automl/samples';
import { buildIndex, checkTfidfSanity, parseCorpus } from '@/plugins/builtin/data/nlp/kernel';
import { NLP_SAMPLE_TEXT } from '@/plugins/builtin/data/nlp/samples';
import {
  buildIndex as buildVectorIndex,
  embedText,
  evaluateRecall,
  generateSyntheticVectors,
  searchIndex,
} from '@/plugins/builtin/data/vectordb/kernel';
import { RECSYS_SAMPLE_CSV } from '@/plugins/builtin/data/recsys/samples';
import { runRecsys } from '@/plugins/builtin/data/recsys/kernel';
import { makeGridWorld, runBanditExperiment, runGridExperiment } from '@/plugins/builtin/data/rl/kernel';
import { XAI_SAMPLE_CSV } from '@/plugins/builtin/data/xai/samples';
import { kernelShap, mulberry32 as xaiRng, parseXaiData, trainReference } from '@/plugins/builtin/data/xai/kernel';

// ---- Pinned Ed25519 manifest signatures ------------------------------------

describe('AI suite manifests · pinned ed25519 signatures', () => {
  const manifests = [
    ['ai.automl', automlManifest],
    ['ai.nlp', nlpManifest],
    ['ai.recsys', recsysManifest],
    ['ai.rl', rlManifest],
    ['ai.xai', xaiManifest],
    ['ai.vectordb', vectordbManifest],
  ] as const;

  for (const [name, manifest] of manifests) {
    it(`${name} carries a valid self-verifying signature`, () => {
      expect(manifest.signature?.alg).toBe('ed25519');
      expect(manifest.signature?.pub).toHaveLength(64);
      const result = verifyBundledManifestSignature(manifest);
      expect(result.ok).toBe(true);
    });
  }

  it('detects a tampered manifest', () => {
    const tampered = { ...vectordbManifest, name: 'Tampered Vector Store' };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });

  it('all six plugins are registered in the builtin registry', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    for (const id of ['ai.automl', 'ai.nlp', 'ai.recsys', 'ai.rl', 'ai.xai', 'ai.vectordb']) {
      expect(ids).toContain(id);
    }
  });
});

// ---- AutoML kernel -----------------------------------------------------------

describe('AutoML kernel', () => {
  it('finds a strong classifier on the synthetic sample', () => {
    const res = runAutoML(generateSyntheticDataset(150, 42), {
      strategy: 'random',
      selection: 'auto',
      folds: 3,
      seed: 42,
      targetColumn: null,
      timeBudgetMs: 4000,
    });
    expect(res.task).toBe('classification');
    expect(res.best.mean).toBeGreaterThan(0.8);
    expect(res.families.length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const text = generateSyntheticDataset(80, 7);
    const a = runAutoML(text, { strategy: 'grid', selection: 'auto', folds: 2, seed: 7, targetColumn: null, timeBudgetMs: 4000 });
    const b = runAutoML(text, { strategy: 'grid', selection: 'auto', folds: 2, seed: 7, targetColumn: null, timeBudgetMs: 4000 });
    expect(a.best.mean).toBe(b.best.mean);
    expect(a.best.model).toBe(b.best.model);
  });

  it('parses the bundled sample', () => {
    const res = runAutoML(AUTOML_SAMPLE_CSV, {
      strategy: 'random',
      selection: 'auto',
      folds: 2,
      seed: 1,
      targetColumn: null,
      timeBudgetMs: 4000,
    });
    expect(Number.isFinite(res.best.mean)).toBe(true);
  });
});

// ---- NLP kernel ---------------------------------------------------------------

describe('NLP kernel', () => {
  it('builds a sane tf-idf index over the sample corpus', () => {
    const docs = parseCorpus(NLP_SAMPLE_TEXT);
    expect(docs.length).toBeGreaterThanOrEqual(12);
    const index = buildIndex(docs, 1);
    expect(index).not.toBeNull();
    expect(checkTfidfSanity(index!)).toBe(true);
  });

  it('is deterministic for repeated indexing', () => {
    const docs = parseCorpus(NLP_SAMPLE_TEXT);
    const a = buildIndex(docs, 1);
    const b = buildIndex(docs, 1);
    expect(a!.docs.length).toBe(b!.docs.length);
    expect(a!.vocab.length).toBe(b!.vocab.length);
  });
});

// ---- Recommender kernel ---------------------------------------------------------

describe('Recommender kernel', () => {
  it('produces finite ranking metrics on the bundled sample', () => {
    const res = runRecsys(RECSYS_SAMPLE_CSV, {
      algorithm: 'als',
      neighbors: 8,
      factors: 6,
      iterations: 8,
      lambda: 0.1,
      topK: 5,
      alpha: 0.5,
      holdout: 0.2,
      seed: 42,
    });
    expect(res.metrics.ndcg).toBeGreaterThanOrEqual(0);
    expect(res.metrics.ndcg).toBeLessThanOrEqual(1);
    expect(Number.isFinite(res.metrics.rmse)).toBe(true);
  });

  it('evaluates user-based CF deterministically', () => {
    const p = { algorithm: 'user-cf' as const, neighbors: 6, factors: 4, iterations: 4, lambda: 0.1, topK: 5, alpha: 0.5, holdout: 0.2, seed: 9 };
    const a = runRecsys(RECSYS_SAMPLE_CSV, p);
    const b = runRecsys(RECSYS_SAMPLE_CSV, p);
    expect(a.metrics.map).toBe(b.metrics.map);
  });
});

// ---- Reinforcement Learning kernel ------------------------------------------------

describe('RL kernel', () => {
  it('Q-learning learns the 4x4 gridworld', async () => {
    const res = await runGridExperiment('qlearning', makeGridWorld({ size: 4 }), {
      episodes: 200,
      alpha: 0.2,
      gamma: 0.95,
      epsilon: 0.1,
      maxSteps: 200,
    }, { seed: 42 });
    expect(res.meanRewardLast50).toBeGreaterThan(-5);
    expect(res.policy).not.toBeNull();
  });

  it('UCB keeps bandit regret competitive with epsilon-greedy', async () => {
    const ucb = await runBanditExperiment('ucb1', { k: 10, type: 'gaussian' }, 600, { epsilon: 0.1 }, { seed: 7 });
    const eps = await runBanditExperiment('eps-greedy', { k: 10, type: 'gaussian' }, 600, { epsilon: 0.1 }, { seed: 7 });
    expect(ucb.finalRegret).not.toBeNull();
    expect(ucb.finalRegret!).toBeLessThanOrEqual(eps.finalRegret! * 1.5 + 1e-9);
  });
});

// ---- XAI kernel ---------------------------------------------------------------------

describe('XAI kernel', () => {
  it('KernelSHAP satisfies local accuracy (additivity)', () => {
    const data = parseXaiData(XAI_SAMPLE_CSV);
    const outcome = trainReference(data, 42);
    const inst = data.X[0]!;
    const shap = kernelShap(
      outcome.model,
      outcome.model.means,
      inst,
      64,
      xaiRng(42),
    );
    expect(Math.abs(shap.residual)).toBeLessThan(1e-6);
    expect(shap.phis).toHaveLength(outcome.model.featureNames.length);
  });

  it('trained reference model beats chance on the planted sample', () => {
    const data = parseXaiData(XAI_SAMPLE_CSV);
    const outcome = trainReference(data, 42);
    expect(outcome.testMetric).toBeGreaterThan(0.6);
  });
});

// ---- Vector database kernel -----------------------------------------------------------

describe('Vector database kernel', () => {
  it('HNSW reaches high recall@10 versus brute force', () => {
    const vectors = generateSyntheticVectors(500, 16, 3, 42);
    const index = buildVectorIndex(vectors, 'cosine', 'hnsw', { m: 8, efConstruction: 64, seed: 42 });
    const recall = evaluateRecall(index, 10, 64, 30, 42);
    expect(recall).toBeGreaterThan(0.9);
  });

  it('exact search returns the query vector itself first', () => {
    const vectors = generateSyntheticVectors(50, 8, 2, 7);
    const index = buildVectorIndex(vectors, 'euclidean', 'brute-force', { m: 4, efConstruction: 16, seed: 7 });
    const top = searchIndex(index, vectors[0]!, 3, 16);
    expect(top[0]?.id).toBe(0);
    expect(top[0]?.distance).toBeCloseTo(0, 9);
  });

  it('text embeddings are L2-normalized and stable', () => {
    const a = embedText('the telescope observes distant galaxies');
    const b = embedText('the telescope observes distant galaxies');
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(a).toEqual(b);
  });
});
