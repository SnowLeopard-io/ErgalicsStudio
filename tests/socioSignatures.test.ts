import { describe, expect, it } from 'vitest';
import { verifyBundledManifestSignature } from '../src/core/plugin-signing';
import { popForecastManifest } from '../src/plugins/builtin/socio/popforecast/manifest';
import { votingManifest } from '../src/plugins/builtin/socio/voting/manifest';
import { snaManifest } from '../src/plugins/builtin/socio/sna/manifest';
import { inequalityManifest } from '../src/plugins/builtin/socio/inequality/manifest';
import { opinionManifest } from '../src/plugins/builtin/socio/opinion/manifest';

const signed = [
  ['socio-popforecast', popForecastManifest],
  ['socio-voting', votingManifest],
  ['socio-sna', snaManifest],
  ['socio-inequality', inequalityManifest],
  ['socio-opinion', opinionManifest],
] as const;

describe('social science plugin manifests · pinned ed25519 signatures', () => {
  for (const [name, manifest] of signed) {
    it(`${name} carries a valid self-verifying signature`, () => {
      expect(manifest.signature?.alg).toBe('ed25519');
      expect(manifest.signature?.fingerprint).toMatch(/^ed25519:[0-9a-f]{32}$/);
      expect(manifest.signature?.pub).toHaveLength(64);
      const result = verifyBundledManifestSignature(manifest);
      expect(result.ok).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  }

  it('detects a tampered manifest field', () => {
    const tampered = { ...popForecastManifest, name: `${popForecastManifest.name} (edited)` };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });
});
