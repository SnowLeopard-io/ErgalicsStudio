import { describe, expect, it } from 'vitest';
import { verifyBundledManifestSignature } from '../apps/studio/src/core/plugin-signing';
import { medEcgManifest } from '../packages/plugins/src/builtin/med/ecg/manifest';
import { medImagingManifest } from '../packages/plugins/src/builtin/med/imaging/manifest';
import { medBiostatManifest } from '../packages/plugins/src/builtin/med/biostat/manifest';
import { medGenomicsManifest } from '../packages/plugins/src/builtin/med/genomics/manifest';

const signed = [
  ['med-ecg', medEcgManifest],
  ['med-imaging', medImagingManifest],
  ['med-biostat', medBiostatManifest],
  ['med-genomics', medGenomicsManifest],
] as const;

describe('medical plugin manifests · pinned ed25519 signatures', () => {
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
    const tampered = { ...medEcgManifest, name: `${medEcgManifest.name} (edited)` };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });
});
