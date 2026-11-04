import { describe, expect, it } from 'vitest';
import { verifyBundledManifestSignature } from '../src/core/plugin-signing';
import { statsDoeManifest } from '../src/plugins/builtin/stats/doe/manifest';
import { statsTimeseriesManifest } from '../src/plugins/builtin/stats/timeseries/manifest';
import { statsMultivariateManifest } from '../src/plugins/builtin/stats/multivariate/manifest';
import { statsNonparametricManifest } from '../src/plugins/builtin/stats/nonparametric/manifest';
import { statsSurvivalManifest } from '../src/plugins/builtin/stats/survival/manifest';
import { statsMetaManifest } from '../src/plugins/builtin/stats/meta/manifest';
import { statsBayesManifest } from '../src/plugins/builtin/stats/bayes/manifest';

const signed = [
  ['doe', statsDoeManifest],
  ['timeseries', statsTimeseriesManifest],
  ['multivariate', statsMultivariateManifest],
  ['nonparametric', statsNonparametricManifest],
  ['survival', statsSurvivalManifest],
  ['meta', statsMetaManifest],
  ['bayes', statsBayesManifest],
] as const;

describe('statistics plugin manifests · pinned ed25519 signatures', () => {
  for (const [name, manifest] of signed) {
    it(`${name} carries a valid self-verifying signature`, () => {
      expect(manifest.signature?.alg).toBe('ed25519');
      expect(manifest.signature?.pub).toHaveLength(64);
      const result = verifyBundledManifestSignature(manifest);
      expect(result.ok).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  }

  it('detects a tampered statistics manifest field', () => {
    const tampered = { ...statsMetaManifest, description: `${statsMetaManifest.description} (edited)` };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });
});
