import { describe, expect, it } from 'vitest';
import { verifyBundledManifestSignature } from '../src/core/plugin-signing';
import { algorithmsManifest } from '../src/plugins/builtin/cs/algorithms/manifest';
import { dataStructuresManifest } from '../src/plugins/builtin/cs/datastructures/manifest';
import { automataManifest } from '../src/plugins/builtin/cs/automata/manifest';
import { cryptoManifest } from '../src/plugins/builtin/cs/crypto/manifest';
import { neuralVizManifest } from '../src/plugins/builtin/cs/neuralviz/manifest';
import { complexityManifest } from '../src/plugins/builtin/cs/complexity/manifest';
import { netProtoManifest } from '../src/plugins/builtin/cs/netproto/manifest';

const signed = [
  ['algorithms', algorithmsManifest],
  ['datastructures', dataStructuresManifest],
  ['automata', automataManifest],
  ['crypto', cryptoManifest],
  ['neuralviz', neuralVizManifest],
  ['complexity', complexityManifest],
  ['netproto', netProtoManifest],
] as const;

describe('cs plugin manifests · pinned ed25519 signatures', () => {
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
    const tampered = { ...algorithmsManifest, name: `${algorithmsManifest.name} (edited)` };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });
});
