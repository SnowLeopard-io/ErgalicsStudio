// Pinned Ed25519 manifest signatures for the engineering suite plugins.
// The public key is embedded in each manifest (self-verifying, FR-05).
import { describe, expect, it } from 'vitest';
import { verifyBundledManifestSignature } from '@/core/plugin-signing';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { engFluidManifest } from '@/plugins/builtin/engineering/fluid-mech/manifest';
import { engVibrationManifest } from '@/plugins/builtin/engineering/vibration/manifest';
import { engHeatManifest } from '@/plugins/builtin/engineering/heat-transfer/manifest';
import { engMechanismManifest } from '@/plugins/builtin/engineering/mechanism/manifest';

describe('engineering suite manifests · pinned ed25519 signatures', () => {
  const manifests = [
    ['eng.fluid', engFluidManifest],
    ['eng.vibration', engVibrationManifest],
    ['eng.heat', engHeatManifest],
    ['eng.mechanism', engMechanismManifest],
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
    const tampered = { ...engFluidManifest, name: 'Tampered Fluid' };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });

  it('all four plugins are registered in the builtin registry', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    for (const id of ['example.eng-fluid', 'example.eng-vibration', 'example.eng-heat', 'example.eng-mechanism']) {
      expect(ids).toContain(id);
    }
  });
});
