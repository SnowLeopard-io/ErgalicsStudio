import { describe, expect, it } from 'vitest';
import { analyseTensile, parseStressStrain } from '../src/plugins/builtin/materials/mech/kernel';

/**
 * Build a synthetic tensile curve with a clean elastic region followed by
 * plastic hardening. `pct` controls whether strain is emitted in %.
 */
function synthCurve(opts: {
  eGPa: number;
  epsF: number; // fracture strain in fraction (mm/mm)
  utsMpa: number;
  pct: boolean;
}): string {
  const { eGPa, epsF, utsMpa, pct } = opts;
  const eMpa = eGPa * 1000;
  const epsY = epsF * 0.3; // yield at 30% of fracture
  const n = 200;
  const lines: string[] = [];
  lines.push(pct ? '# strain (%), stress (MPa)' : '# strain (mm/mm), stress (MPa)');
  for (let i = 0; i <= n; i += 1) {
    const frac = (i / n) * epsF;
    let stress: number;
    if (frac <= epsY) {
      stress = eMpa * frac;
    } else {
      const t = (frac - epsY) / (epsF - epsY);
      stress = eMpa * epsY + (utsMpa - eMpa * epsY) * t;
    }
    lines.push(`${pct ? (frac * 100).toFixed(4) : frac.toFixed(6)},${stress.toFixed(3)}`);
  }
  return lines.join('\n');
}

describe('mats-mech strain unit normalisation', () => {
  it('handles brittle material reported in % with max strain < 1.5%', () => {
    // Cast iron: E = 170 GPa, UTS = 250 MPa, fracture strain 0.8% (given in %).
    const text = synthCurve({ eGPa: 170, epsF: 0.008, utsMpa: 250, pct: true });
    const curve = parseStressStrain(text);
    expect(curve.length).toBeGreaterThan(5);
    // Max strain must be ~0.008 mm/mm, not 0.8.
    const maxS = Math.max(...curve.map((p) => p.strain));
    expect(maxS).toBeLessThan(0.01);
    const r = analyseTensile(curve);
    expect(r).not.toBeNull();
    expect(r!.youngsModulus).toBeGreaterThan(100); // GPa order, not 1.7
    expect(r!.youngsModulus).toBeLessThan(200);
    expect(r!.elongation).toBeCloseTo(0.8, 0); // %, not 80
  });

  it('keeps fraction input (mm/mm) unchanged', () => {
    const text = synthCurve({ eGPa: 210, epsF: 0.25, utsMpa: 430, pct: false });
    const curve = parseStressStrain(text);
    const maxS = Math.max(...curve.map((p) => p.strain));
    expect(maxS).toBeGreaterThan(0.1); // ~0.25 mm/mm
    expect(maxS).toBeLessThan(0.3);
    const r = analyseTensile(curve);
    expect(r).not.toBeNull();
    expect(r!.youngsModulus).toBeCloseTo(210, 0);
  });

  it('keeps legacy % heuristic for ductile material (max ≥ 1.5%)', () => {
    // No header comment: strains 0..25 (%) must still be detected as percent.
    const lines: string[] = [];
    for (let i = 0; i <= 25; i += 1) lines.push(`${i},${i * 30}`);
    const curve = parseStressStrain(lines.join('\n'));
    const maxS = Math.max(...curve.map((p) => p.strain));
    expect(maxS).toBeCloseTo(0.25, 2);
  });

  it('falls back to physical plausibility when header is silent and strain < 1.5%', () => {
    // Brittle, % input, no header comment: E as mm/mm would be ~1.7 GPa (< 10).
    const lines: string[] = [];
    for (let i = 0; i <= 8; i += 1) {
      const sPct = (i / 8) * 0.8;
      lines.push(`${sPct.toFixed(4)},${(170000 * (sPct / 100)).toFixed(2)}`);
    }
    const curve = parseStressStrain(lines.join('\n'));
    const maxS = Math.max(...curve.map((p) => p.strain));
    expect(maxS).toBeLessThan(0.01); // correctly converted to fraction
  });
});
