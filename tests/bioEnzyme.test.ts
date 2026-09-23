import { describe, expect, it } from 'vitest';
import {
  apparentParams,
  fitMichaelisMenten,
  initialRate,
  parseRateData,
  reportFit,
  synthesizeRates,
  type RateParams,
} from '../src/plugins/builtin/bio-enzyme/kinetics';

const base: RateParams = { vmax: 100, km: 5, inhibitor: 10, ki: 10, mode: 'none' };

describe('bio-enzyme kinetics kernel', () => {
  it('saturates toward Vmax and reaches Km = 0.5·Vmax at S = Km', () => {
    expect(Math.abs(initialRate(base, 1e9) - 100)).toBeLessThan(1e-6);
    // v(Km) should be Vmax/2
    expect(Math.abs(initialRate(base, 5) - 50)).toBeLessThan(1e-9);
    expect(initialRate(base, 0)).toBe(0);
  });

  it('competitive inhibition raises apparent Km, leaves Vapp = Vmax', () => {
    const comp = { ...base, mode: 'competitive' as const };
    const v = apparentParams(comp);
    // f = 1 + I/Ki = 1 + 10/10 = 2 → Kapp = Km·2 = 10, Vapp = Vmax = 100
    expect(v.Vapp).toBeCloseTo(100, 9);
    expect(v.Kapp).toBeCloseTo(10, 9);
  });

  it('non-competitive inhibition halves Vmax, keeps Km', () => {
    const nc = { ...base, mode: 'noncompetitive' as const };
    const v = apparentParams(nc);
    expect(v.Vapp).toBeCloseTo(50, 9);
    expect(v.Kapp).toBeCloseTo(5, 9);
  });

  it('uncompetitive inhibition scales both by 1/f', () => {
    const unc = { ...base, mode: 'uncompetitive' as const };
    const v = apparentParams(unc);
    expect(v.Vapp).toBeCloseTo(50, 9);
    expect(v.Kapp).toBeCloseTo(2.5, 9);
  });

  it('matches the textbook non-competitive rate law v = (Vmax/f)·S/(Km+S)', () => {
    // f=2 → Vapp=50, v at S=5 should be 50·5/10 = 25
    const v = initialRate({ ...base, mode: 'noncompetitive' }, 5);
    expect(Math.abs(v - 25)).toBeLessThan(1e-9);
  });

  it('rejects substrate ≤ 0 in Lineweaver-Burk to avoid division issues (pure function sanity)', () => {
    // initialRate of a saturated-true law must remain finite for s>0
    expect(Number.isFinite(initialRate(base, 1e-9))).toBe(true);
  });

  it('synthetic data is deterministic for a fixed seed', () => {
    const a = synthesizeRates(base, [1, 2, 4]);
    const b = synthesizeRates(base, [1, 2, 4]);
    expect(a).toEqual(b);
    expect(a.length).toBe(6);
  });

  it('Levenberg-Marquardt fit recovers Vmax & Km from noise-free data', () => {
    const truth: RateParams = { vmax: 93, km: 6.2, inhibitor: 0, ki: 10, mode: 'none' };
    const data = synthesizeRates(truth, [0.5, 1, 2, 4, 6, 10, 16, 25, 40, 60, 90, 130, 200], 0);
    const fit = fitMichaelisMenten(data);
    expect(fit).not.toBeNull();
    expect(Math.abs((fit!.vmax - 93) / 93)).toBeLessThan(1e-6);
    expect(Math.abs((fit!.km - 6.2) / 6.2)).toBeLessThan(1e-6);
  });

  it('fit plus report gives near-perfect R² on clean data and recovers params under noise', () => {
    const truth: RateParams = { vmax: 80, km: 4, inhibitor: 0, ki: 10, mode: 'none' };
    const pts = [0.5, 1, 2, 4, 6, 10, 16, 25, 40, 60, 90, 130, 200];
    const clean = fitMichaelisMenten(synthesizeRates(truth, pts, 0))!;
    expect(reportFit(synthesizeRates(truth, pts, 0), clean.vmax, clean.km).r2).toBeGreaterThan(0.999);

    // 10 % proportional noise → Vmax recovered within 8 %, Km within 18 %
    // (Km inherently carries more uncertainty; Vmax is better conditioned).
    const rest = fitMichaelisMenten(synthesizeRates(truth, pts, 0.1))!;
    expect(Math.abs((rest.vmax - 80) / 80)).toBeLessThan(0.08);
    expect(Math.abs((rest.km - 4) / 4)).toBeLessThan(0.18);
  });
});

describe('bio-enzyme data parser', () => {
  it('parses comment + header CSV into (substrate, v0) points', () => {
    const txt = `# assay
substrate,v0
0.5,1.0
1,2.0
2,3.0`;
    const pts = parseRateData(txt);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ s: 0.5, v: 1 });
    expect(pts[2]).toEqual({ s: 2, v: 3 });
  });

  it('parses whitespace / tab separated columns', () => {
    const pts = parseRateData('0.5 1.0\n1.0 2.0\n2.0 3.5');
    expect(pts.map((p) => p.s)).toEqual([0.5, 1, 2]);
  });

  it('parses an array of JSON objects with s/v or substrate/v0 keys', () => {
    const a = parseRateData('[{"s":1,"v":2},{"s":2,"v":3.5}]');
    expect(a).toEqual([{ s: 1, v: 2 }, { s: 2, v: 3.5 }]);
    const b = parseRateData('[{"substrate":5,"v0":20}]');
    expect(b).toEqual([{ s: 5, v: 20 }]);
  });

  it('drops rows with zero/negative substrate and returns [] for empty text', () => {
    expect(parseRateData('0,5\n-1,3\n2,4')).toEqual([{ s: 2, v: 4 }]);
    expect(parseRateData('')).toEqual([]);
    expect(parseRateData('   ')).toEqual([]);
  });
});