// ==========================================================================
// fx.sky / fx.stars pure-model tests.
//
// 1. Kasten–Young (1989) optical air mass: zenith ≈ 1, 30° altitude ≈ 2,
//    undefined below the horizon.
// 2. Twilight classification at the standard 0/−6/−12/−18° bands.
// 3. Bortle reference tables: monotone sky brightness and limiting magnitude.
// 4. Whole-sky naked-eye star-count integral: 9096 at m = 6.5, ~1400 at m = 4.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { airmassKastenYoung, twilightClass } from '@/plugins/builtin/fx/sky/plugin';
import { bortleLimitingMag, bortleSkyBrightness, visibleStarCount } from '@/plugins/builtin/fx/stars/plugin';

describe('Kasten–Young air mass', () => {
  it('is 1 at the zenith', () => {
    const am = airmassKastenYoung(90);
    expect(am).not.toBeNull();
    expect(am as number).toBeGreaterThan(0.999);
    expect(am as number).toBeLessThan(1.001);
  });

  it('matches the ~2.0 reference at 30° altitude', () => {
    const am = airmassKastenYoung(30) as number;
    expect(am).toBeGreaterThan(1.98);
    expect(am).toBeLessThan(2.01);
  });

  it('grows steeply toward the horizon', () => {
    const am5 = airmassKastenYoung(5) as number;
    const am10 = airmassKastenYoung(10) as number;
    expect(am5).toBeGreaterThan(8); // ~9–10 at 5°
    expect(am10).toBeGreaterThan(4); // ~5 at 10°
    expect(am5).toBeGreaterThan(am10);
  });

  it('is undefined below the horizon', () => {
    expect(airmassKastenYoung(0)).toBeNull();
    expect(airmassKastenYoung(-10)).toBeNull();
  });
});

describe('twilight classification', () => {
  it('follows the standard 0/−6/−12/−18° bands', () => {
    expect(twilightClass(15)).toBe('day');
    expect(twilightClass(0.1)).toBe('day');
    expect(twilightClass(-3)).toBe('civil');
    expect(twilightClass(-9)).toBe('nautical');
    expect(twilightClass(-15)).toBe('astronomical');
    expect(twilightClass(-18.5)).toBe('night');
  });
});

describe('Bortle reference tables', () => {
  it('have 9 entries each', () => {
    expect(bortleSkyBrightness(1)).toBeGreaterThan(0);
    expect(bortleLimitingMag(9)).toBeGreaterThan(0);
  });

  it('darken (brighter magnitude) with rising light pollution', () => {
    for (let b = 1; b < 9; b++) {
      // Sky brightness in mag/arcsec² decreases (sky gets brighter).
      expect(bortleSkyBrightness(b + 1)).toBeLessThan(bortleSkyBrightness(b));
      // Limiting magnitude decreases (fewer visible stars).
      expect(bortleLimitingMag(b + 1)).toBeLessThan(bortleLimitingMag(b));
    }
  });

  it('anchor on the classical values (B1: 22 mag, 7.8 mag; B9: ≈18.2, 4.5)', () => {
    expect(bortleSkyBrightness(1)).toBeCloseTo(21.95, 1);
    expect(bortleLimitingMag(1)).toBeCloseTo(7.8, 1);
    expect(bortleSkyBrightness(9)).toBeCloseTo(18.2, 1);
    expect(bortleLimitingMag(9)).toBeCloseTo(4.5, 1);
  });
});

describe('naked-eye star-count integral', () => {
  it('gives ≈9096 whole-sky stars at m = 6.5', () => {
    const n = visibleStarCount(6.5);
    expect(n).toBeGreaterThan(8600);
    expect(n).toBeLessThan(9600);
  });

  it('falls to roughly 1400 at m = 4 and rises monotonically', () => {
    const n4 = visibleStarCount(4);
    expect(n4).toBeGreaterThan(1200);
    expect(n4).toBeLessThan(1700);
    expect(visibleStarCount(7)).toBeGreaterThan(visibleStarCount(6));
  });
});
