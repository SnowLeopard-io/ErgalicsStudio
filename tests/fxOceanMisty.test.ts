// FX plugin tests — open-sea swell (fx.ocean) and misty peaks (fx.misty):
// the Pierson–Moskowitz sea-state kernel, the shared atmospheric-optics
// helpers, the ridge-layer geometry and the registry wiring.
import { describe, it, expect } from 'vitest';
import {
  peakFrequency,
  piersonMoskowitz,
  pmVariance,
  significantWaveHeight,
  waveComponents,
  peakPeriod,
  deepWaterWavelength,
  beaufort,
} from '@/plugins/builtin/fx/ocean/plugin';
import { WAVE_COUNT, OCEAN_FRAGMENT } from '@/plugins/builtin/fx/ocean/shader';
import { oceanManifest } from '@/plugins/builtin/fx/ocean/manifest';
import { layerDistances } from '@/plugins/builtin/fx/misty/plugin';
import { MISTY_FRAGMENT } from '@/plugins/builtin/fx/misty/shader';
import { mistyManifest } from '@/plugins/builtin/fx/misty/manifest';
import {
  airmassKastenYoung,
  twilightClass,
  koschmiederVisibility,
  hazeToExtinction,
  sunDiskTint,
} from '@/core/raytrace';
import { BUILTIN_PLUGINS } from '@/plugins/builtin';
import { disciplineOf } from '@/plugins/categories';
import { BUILTIN_EXAMPLES } from '@/core/examples';

describe('fx.ocean — Pierson–Moskowitz sea-state kernel', () => {
  it('peak frequency fp = 0.13 g / U10 falls as the wind rises', () => {
    expect(peakFrequency(11)).toBeCloseTo(0.115936, 5);
    expect(peakFrequency(20)).toBeCloseTo(0.063765, 5);
    expect(peakFrequency(5)).toBeGreaterThan(peakFrequency(20));
  });

  it('the PM spectrum peaks at fp and vanishes for f ≤ 0 or U ≤ 0', () => {
    const u = 11;
    const fp = peakFrequency(u);
    const sPeak = piersonMoskowitz(fp, u);
    expect(sPeak).toBeGreaterThan(piersonMoskowitz(fp * 0.8, u));
    expect(sPeak).toBeGreaterThan(piersonMoskowitz(fp * 1.25, u));
    expect(sPeak / piersonMoskowitz(fp * 1.25, u)).toBeCloseTo(1.459, 2);
    expect(piersonMoskowitz(0, u)).toBe(0);
    expect(piersonMoskowitz(-1, u)).toBe(0);
    expect(piersonMoskowitz(fp, 0)).toBe(0);
  });

  it('variance scales as U10⁴ and Hs = 4√m0 ≈ 0.0246 U10²', () => {
    expect(pmVariance(2) / pmVariance(1)).toBeCloseTo(16, 9);
    expect(significantWaveHeight(11) / 4).toBeCloseTo(Math.sqrt(pmVariance(11)), 12);
    expect(significantWaveHeight(11) / (11 * 11)).toBeCloseTo(0.0246, 4);
    expect(significantWaveHeight(1)).toBeCloseTo(0.0246, 3);
  });

  it('discretises into WAVE_COUNT trains whose variance equals m0', () => {
    const u = 11;
    const c = waveComponents(u, 0, 1);
    expect(c.amp.length).toBe(WAVE_COUNT);
    expect(c.freq.length).toBe(WAVE_COUNT);
    const variance = c.amp.reduce((acc, a) => acc + (a * a) / 2, 0);
    expect(variance).toBeCloseTo(pmVariance(u), 10);
  });

  it('spans the documented band [fp/2.5, 2.5 fp] with a train on fp', () => {
    const u = 11;
    const fp = peakFrequency(u);
    const c = waveComponents(u, 0, 1);
    expect(c.freq[0]!).toBeCloseTo(fp / 2.5, 10);
    expect(c.freq[WAVE_COUNT - 1]!).toBeCloseTo(fp * 2.5, 10);
    // The middle train sits on the spectral peak, so the discrete peak period
    // reproduces the analytic Tp = 1 / fp without interpolation.
    expect(peakPeriod(c)).toBeCloseTo(1 / fp, 5);
  });

  it('directions are unit vectors, deterministic from the seed', () => {
    const a = waveComponents(11, 0.4, 3);
    const b = waveComponents(11, 0.4, 3);
    for (let i = 0; i < WAVE_COUNT; i++) {
      expect(Math.hypot(a.dirX[i]!, a.dirZ[i]!)).toBeCloseTo(1, 12);
    }
    expect(a.phase).toEqual(b.phase);
    expect(waveComponents(11, 0.4, 4).phase).not.toEqual(a.phase);
  });

  it('deep-water wavelength L = g T² / 2π and steepness Hs/Lp is U-invariant', () => {
    expect(deepWaterWavelength(1)).toBeCloseTo(1.5613, 3);
    expect(deepWaterWavelength(2 * Math.PI)).toBeCloseTo(9.81 * 2 * Math.PI, 9);
    expect(deepWaterWavelength(6) / deepWaterWavelength(3)).toBeCloseTo(4, 9);
    const steep = (u: number) => {
      const tp = peakPeriod(waveComponents(u, 0, 1));
      return significantWaveHeight(u) / deepWaterWavelength(tp);
    };
    expect(steep(11)).toBeCloseTo(0.0256, 3);
    expect(steep(20)).toBeCloseTo(steep(11), 6);
  });

  it('Beaufort force follows the WMO lower bounds', () => {
    expect(beaufort(0)).toBe(0);
    expect(beaufort(0.3)).toBe(1);
    expect(beaufort(10)).toBe(5);
    expect(beaufort(10.8)).toBe(6);
    expect(beaufort(11)).toBe(6);
    expect(beaufort(20)).toBe(8);
    expect(beaufort(25)).toBe(10);
    expect(beaufort(40)).toBe(12);
    expect(beaufort(20)).toBeGreaterThan(beaufort(10));
  });

  it('shader array sizes match WAVE_COUNT', () => {
    expect(OCEAN_FRAGMENT).toContain(`uniform float uWaveAmp[${WAVE_COUNT}];`);
    expect(OCEAN_FRAGMENT).toContain(`i < ${WAVE_COUNT}`);
  });
});

describe('shared atmospheric optics', () => {
  it('Kasten–Young air mass: unity at zenith, undefined below the horizon', () => {
    expect(airmassKastenYoung(0)).toBeNull();
    expect(airmassKastenYoung(-5)).toBeNull();
    expect(airmassKastenYoung(90)).toBeCloseTo(1, 3);
    expect(airmassKastenYoung(30)).toBeCloseTo(2.0, 1);
    // Air mass grows towards the horizon, so it falls as altitude rises.
    const series = [1, 5, 15, 45, 80].map((a) => airmassKastenYoung(a)!);
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeLessThan(series[i - 1]!);
  });

  it('twilight bands split at 0 / −6 / −12 / −18°', () => {
    expect(twilightClass(1)).toBe('day');
    expect(twilightClass(0)).toBe('civil');
    expect(twilightClass(-5.9)).toBe('civil');
    expect(twilightClass(-6)).toBe('nautical');
    expect(twilightClass(-11.9)).toBe('nautical');
    expect(twilightClass(-12)).toBe('astronomical');
    expect(twilightClass(-17.9)).toBe('astronomical');
    expect(twilightClass(-18)).toBe('night');
    expect(twilightClass(-30)).toBe('night');
  });

  it('Koschmieder visibility V = 3.912 / β decreases with extinction', () => {
    expect(koschmiederVisibility(1e-5)).toBeCloseTo(391200, 3);
    expect(Number.isFinite(koschmiederVisibility(0))).toBe(true);
    expect(koschmiederVisibility(2e-5)).toBeLessThan(koschmiederVisibility(1e-5));
  });

  it('haze slider maps monotonically to extinction, clamped to [0, 1]', () => {
    expect(hazeToExtinction(0)).toBeCloseTo(1.2e-5, 12);
    expect(hazeToExtinction(1)).toBeCloseTo(1.16e-4, 12);
    expect(hazeToExtinction(0.5)).toBeGreaterThan(hazeToExtinction(0.4));
    expect(hazeToExtinction(-1)).toBe(hazeToExtinction(0));
    expect(hazeToExtinction(2)).toBe(hazeToExtinction(1));
  });

  it('sun-disk tint: white at zenith, reddened and dimmed at the horizon', () => {
    const zenith = sunDiskTint(Math.PI / 2);
    expect(zenith.rgb[0]).toBeCloseTo(1, 9);
    expect(zenith.rgb[1]).toBeCloseTo(1, 9);
    expect(zenith.rgb[2]).toBeCloseTo(1, 9);
    expect(zenith.dim).toBeCloseTo(1, 9);

    const horizon = sunDiskTint(0);
    expect(horizon.rgb[0]).toBeCloseTo(1, 6);
    expect(horizon.rgb[1]).toBeCloseTo(0.48, 6);
    expect(horizon.rgb[2]).toBeCloseTo(0.2, 6);
    expect(horizon.dim).toBeCloseTo(0.312, 6);

    const high = sunDiskTint(0.5);
    expect(high.rgb[2]).toBeGreaterThan(horizon.rgb[2]);
    expect(high.dim).toBeGreaterThan(horizon.dim);
    expect(sunDiskTint(-0.1).dim).toBeCloseTo(0.14, 9);
  });
});

describe('fx.misty — ridge-layer geometry', () => {
  it('six layers at 2500 m growing geometrically by 1.85', () => {
    const d = layerDistances();
    expect(d).toHaveLength(6);
    expect(d[0]!).toBeCloseTo(2500, 6);
    for (let i = 1; i < d.length; i++) {
      expect(d[i]! / d[i - 1]!).toBeCloseTo(1.85, 9);
      expect(d[i]!).toBeGreaterThan(d[i - 1]!);
    }
    expect(d[5]!).toBeCloseTo(54174.97, 1);
  });

  it('the shader layer constants stay in sync with the plugin geometry', () => {
    expect(MISTY_FRAGMENT).toContain('const float LAYER_NEAR = 2500.0;');
    expect(MISTY_FRAGMENT).toContain('const float LAYER_GROW = 1.85;');
    expect(MISTY_FRAGMENT).toContain('const int LAYERS = 6;');
  });
});

describe('colour grading — shared by both scenes', () => {
  it('both fragments declare the grading uniforms and apply the grade pass', () => {
    for (const frag of [OCEAN_FRAGMENT, MISTY_FRAGMENT]) {
      expect(frag).toContain('uniform float uColorTemp;');
      expect(frag).toContain('uniform float uSaturation;');
      expect(frag).toContain('grade(tonemap(');
    }
  });
});

describe('FX plugin registration — fx.ocean / fx.misty', () => {
  it('both are registered in the builtin catalog and loaded eagerly', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.manifest.id);
    expect(ids).toContain('fx.ocean');
    expect(ids).toContain('fx.misty');
    for (const info of BUILTIN_PLUGINS) {
      if (info.manifest.id === 'fx.ocean' || info.manifest.id === 'fx.misty') {
        expect(typeof info.load).toBe('function');
        expect(info.autoload).not.toBe(false);
      }
    }
  });

  it('both land in the 特效渲染 (fx) discipline', () => {
    expect(disciplineOf('fx.ocean')).toBe('fx');
    expect(disciplineOf('fx.misty')).toBe('fx');
  });

  it('manifests are complete and honestly rated', () => {
    expect(oceanManifest.research?.tier).toBe('quasi-research');
    expect(mistyManifest.research?.tier).toBe('demonstration');
    for (const m of [oceanManifest, mistyManifest]) {
      expect(m.entry).toBe(m.id);
      expect(m.nameI18n?.['zh-CN']).toBeTruthy();
      expect(m.descriptionI18n?.['en-US']).toBeTruthy();
      expect(m.formats?.some((f) => f.extension === '.json')).toBe(true);
    }
  });

  it('all six scenery presets are registered with lazy loaders', () => {
    const ids = new Set(BUILTIN_EXAMPLES.map((e) => e.id));
    for (const id of [
      'fx-ocean-dawn-pacific',
      'fx-ocean-golden-atlantic',
      'fx-ocean-blue-hour',
      'fx-misty-morning-sea',
      'fx-misty-dusk-ridges',
      'fx-misty-ink-rain',
    ]) {
      expect(ids.has(id)).toBe(true);
      const ex = BUILTIN_EXAMPLES.find((e) => e.id === id)!;
      expect(ex.filename).toBe(`${id}.json`);
      expect(typeof ex.loadContent).toBe('function');
    }
  });
});
