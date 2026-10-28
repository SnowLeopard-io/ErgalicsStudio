import { describe, expect, it } from 'vitest';
import { verifyBundledManifestSignature } from '../src/core/plugin-signing';
import { acousticsManifest } from '../src/plugins/builtin/acoustics/manifest';
import { tuningManifest } from '../src/plugins/builtin/tuning/manifest';
import { synthManifest } from '../src/plugins/builtin/synth/manifest';
import { colorScienceManifest } from '../src/plugins/builtin/color-science/manifest';
import { runAcousticBenchmarks } from '../src/plugins/builtin/acoustics/kernel';
import { runTuningBenchmarks } from '../src/plugins/builtin/tuning/kernel';
import { runSynthBenchmarks } from '../src/plugins/builtin/synth/kernel';
import { runColorBenchmarks } from '../src/plugins/builtin/color-science/kernel';
import { AcousticsPlugin } from '../src/plugins/builtin/acoustics/plugin';
import { TuningPlugin } from '../src/plugins/builtin/tuning/plugin';
import { SynthPlugin } from '../src/plugins/builtin/synth/plugin';
import { ColorSciencePlugin } from '../src/plugins/builtin/color-science/plugin';

const signed = [
  ['acoustics', acousticsManifest],
  ['tuning', tuningManifest],
  ['synth', synthManifest],
  ['color-science', colorScienceManifest],
] as const;

describe('music & art science · pinned ed25519 signatures', () => {
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
    const tampered = { ...acousticsManifest, name: `${acousticsManifest.name} (edited)` };
    const result = verifyBundledManifestSignature(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-invalid');
  });
});

describe('music & art science · numerical benchmarks', () => {
  const suites = [
    ['acoustics', runAcousticBenchmarks()],
    ['tuning', runTuningBenchmarks()],
    ['synth', runSynthBenchmarks()],
    ['color-science', runColorBenchmarks()],
  ] as const;

  for (const [name, bench] of suites) {
    it(`${name} benchmarks all pass`, () => {
      expect(bench.length).toBeGreaterThan(0);
      const failed = bench.filter((b) => !b.passed);
      expect(failed.map((b) => b.id)).toEqual([]);
    });
  }
});

interface AcousticsInternals {
  clip: unknown;
}
interface TuningInternals {
  imported: unknown;
}
interface SynthInternals {
  presets: unknown[];
}
interface ColorInternals {
  palette: unknown[];
}

describe('music & art science · plugins start in an empty state', () => {
  it('acoustics has no clip until audio is imported', () => {
    const plugin = new AcousticsPlugin() as unknown as AcousticsInternals;
    expect(plugin.clip).toBeNull();
  });

  it('tuning has no imported table until a CSV loads', () => {
    const plugin = new TuningPlugin() as unknown as TuningInternals;
    expect(plugin.imported).toBeNull();
  });

  it('synth has no presets until JSON is imported or “New preset” is pressed', () => {
    const plugin = new SynthPlugin() as unknown as SynthInternals;
    expect(plugin.presets).toHaveLength(0);
  });

  it('colour science has no palette until a CSV loads', () => {
    const plugin = new ColorSciencePlugin() as unknown as ColorInternals;
    expect(plugin.palette).toHaveLength(0);
  });
});

describe('music & art science · block/flow payload import', () => {
  it('synth imports preset JSON handed over as a plain-text RenderedView payload', async () => {
    const plugin = new SynthPlugin() as unknown as SynthInternals & {
      init(api: unknown): Promise<void>;
      loadData(file: File): Promise<void>;
    };
    const api = { locale: 'en-US', notify: () => {}, onLocaleChange: () => () => {} };
    await plugin.init(api);
    const payload = [{ name: 'Block preset', wave: 'triangle', midi: 62, duration: 1.2 }];
    await plugin.loadData(new File([JSON.stringify(payload)], 'data.txt', { type: 'text/plain' }));
    expect(plugin.presets).toHaveLength(1);
    expect((plugin.presets[0] as { name: string }).name).toBe('Block preset');
  });
});
