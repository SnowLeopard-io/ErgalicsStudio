import { describe, expect, it } from 'vitest';
import { analyseThermal, estimateBaseline, type ThermalPoint } from '../src/plugins/builtin/mats-thermal/kernel';

/** Build a synthetic DSC curve: a triangular endothermic peak on a flat zero baseline.
 *  The baseline-subtracted area of a triangle of base `w` and height `h` is w·h/2. */
function dscTriangle(t0: number, w: number, h: number, step = 0.5): ThermalPoint[] {
  const pts: ThermalPoint[] = [];
  // Flat pre-transition region.
  for (let t = t0 - 10; t < t0; t += step) pts.push({ temperature: t, signal: 0 });
  // Rising edge.
  for (let t = t0; t < t0 + w / 2; t += step) {
    const f = (t - t0) / (w / 2);
    pts.push({ temperature: t, signal: h * f });
  }
  // Falling edge.
  for (let t = t0 + w / 2; t <= t0 + w; t += step) {
    const f = 1 - (t - t0 - w / 2) / (w / 2);
    pts.push({ temperature: t, signal: h * f });
  }
  // Flat post-transition region.
  for (let t = t0 + w + step; t < t0 + w + 10; t += step) pts.push({ temperature: t, signal: 0 });
  return pts;
}

describe('mats-thermal DSC integration', () => {
  it('integrates the baseline-corrected heat-flow area (mW·°C)', () => {
    // Triangle base 10 °C, height 5 mW → area = 10·5/2 = 25 mW·°C.
    const pts = dscTriangle(100, 10, 5);
    const a = analyseThermal(pts, 'dsc');
    expect(a.peaks.length).toBe(1);
    // Trapezoidal integration of the sampled triangle ≈ analytic area.
    expect(a.peaks[0]!.integral).toBeCloseTo(25, 0);
    expect(a.totalEnthalpy).toBeCloseTo(a.peaks[0]!.integral, 6);
  });

  it('reports integral in the curve units × °C, not J/g', () => {
    const pts = dscTriangle(200, 20, 2);
    const a = analyseThermal(pts, 'dsc');
    expect(a.peaks.length).toBe(1);
    // 20 °C base × 2 mW height / 2 = 20 mW·°C.
    expect(a.peaks[0]!.integral).toBeCloseTo(20, 0);
  });

  it('detects both endothermic and exothermic peaks', () => {
    const pts = dscTriangle(100, 10, 5);
    const exo = pts.map((p) => ({ temperature: p.temperature, signal: -p.signal }));
    const a = analyseThermal(exo, 'dsc');
    expect(a.peaks.length).toBe(1);
    // Integral is signed: negative heat flow (exothermic) → negative area.
    expect(a.peaks[0]!.integral).toBeCloseTo(-25, 0);
  });
});

describe('mats-thermal TGA mass loss', () => {
  it('measures mass lost and residual mass (%)', () => {
    // Start at 100 %, step down to 80 % (20 % loss) then stay flat.
    const pts: ThermalPoint[] = [];
    for (let t = 30; t < 300; t += 1) {
      let signal = 100;
      if (t >= 150 && t < 250) signal = 100 - (t - 150) * 0.2; // 150→250: 100→80
      else if (t >= 250) signal = 80;
      pts.push({ temperature: t, signal });
    }
    const a = analyseThermal(pts, 'tga');
    expect(a.peaks.length).toBe(1);
    expect(a.peaks[0]!.integral).toBeCloseTo(20, 0);
    expect(a.totalMassLoss).toBeCloseTo(20, 0);
    // Residual mass = final signal value (%).
    expect(a.residualMass).toBeCloseTo(80, 0);
  });

  it('keeps the baseline at the pre-step plateau', () => {
    const pts: ThermalPoint[] = [];
    for (let t = 30; t < 300; t += 1) {
      let signal = 100;
      if (t >= 150 && t < 250) signal = 100 - (t - 150) * 0.2;
      else if (t >= 250) signal = 80;
      pts.push({ temperature: t, signal });
    }
    const base = estimateBaseline(pts, 'tga');
    expect(base[0]).toBeCloseTo(100, 6);
    expect(base[base.length - 1]!).toBeCloseTo(80, 6);
  });
});
