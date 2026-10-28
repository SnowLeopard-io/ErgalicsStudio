import { describe, expect, it } from 'vitest';
import { verifyBundledManifestSignature } from '../src/core/plugin-signing';
import { seismicManifest } from '../src/plugins/builtin/geo/seismic/manifest';
import { mineralsManifest } from '../src/plugins/builtin/geo/minerals/manifest';
import { hydrogeologyManifest } from '../src/plugins/builtin/geo/hydrogeology/manifest';

const signed = [
  ['geo-seismic', seismicManifest],
  ['geo-minerals', mineralsManifest],
  ['geo-hydrogeology', hydrogeologyManifest],
] as const;

describe('geoscience plugin manifests · pinned ed25519 signatures', () => {
  for (const [name, manifest] of signed) {
    it(`${name} carries a valid self-verifying signature`, () => {
      expect(manifest.signature?.alg).toBe('ed25519');
      expect(manifest.signature?.pub).toHaveLength(64);
      const result = verifyBundledManifestSignature(manifest);
      expect(result.ok).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  }

  it('detects a tampered manifest field', () => {
    const tampered = { ...seismicManifest, name: `${seismicManifest.name} (edited)` };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });
});
