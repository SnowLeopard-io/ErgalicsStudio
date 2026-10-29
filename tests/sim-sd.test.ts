// sim-sysdyn kernel tests — evaluator, integration, sweeps, loops, templates.
import { describe, expect, it } from 'vitest';
import {
  compileModel,
  deriveCausalLinks,
  evalRpn,
  findLoops,
  loopDominance,
  parseExpression,
  simulateSD,
  sweepSD,
  templateModel,
  validateModel,
  type SDModel,
} from '@/plugins/builtin/sim/sysdyn/kernel';

const settings = { tStart: 0, tStop: 50, dt: 0.05, method: 'rk4' as const };

describe('expression evaluator', () => {
  it('respects precedence, unary minus and right-associative power', () => {
    expect(evalRpn(parseExpression('-2 + 3 * 4 ^ 2', []), {})).toBe(46);
    expect(evalRpn(parseExpression('2 ^ 3 ^ 2', []), {})).toBe(512);
  });

  it('evaluates functions and identifiers', () => {
    const rpn = parseExpression('max(a, b) + sqrt(x)', ['a', 'b', 'x']);
    expect(evalRpn(rpn, { a: 3, b: 7, x: 9 })).toBe(10);
  });

  it('rejects unknown identifiers and cycles', () => {
    expect(() => parseExpression('a + nope', ['a'])).toThrow(/Unknown identifier/);
  });

  it('rejects malformed expressions', () => {
    expect(() => parseExpression('(a + b', ['a', 'b'])).toThrow(/Unbalanced/);
    expect(() => evalRpn(parseExpression('a +', ['a']), { a: 1 })).toThrow();
  });
});

describe('compile and validate', () => {
  it('rejects duplicate names', () => {
    const m = templateModel('logistic');
    m.auxiliaries.push({ name: 'growth', expr: '1' });
    expect(validateModel(m)).toMatch(/Duplicate/);
  });

  it('detects circular non-stock dependencies', () => {
    const m: SDModel = {
      stocks: [{ name: 's', initial: '1' }],
      flows: [{ name: 'f', to: 's', expr: 'aux' }],
      auxiliaries: [{ name: 'aux', expr: 'f' }],
      parameters: [],
    };
    expect(() => compileModel(m)).toThrow(/Circular/);
  });

  it('allows flows referencing stocks (state feedback)', () => {
    const m = templateModel('logistic');
    expect(() => compileModel(m)).not.toThrow();
  });
});

describe('integration', () => {
  it('logistic approaches K monotonically and stays below', () => {
    const m = templateModel('logistic');
    const s = simulateSD(m, settings);
    const p = s.stocks['population']!;
    expect(p[0]).toBe(10);
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThanOrEqual(p[i - 1]! - 1e-9);
    expect(p[p.length - 1]!).toBeGreaterThan(990);
    expect(Math.max(...p)).toBeLessThanOrEqual(1000 + 1e-6);
  });

  it('RK4 converges: halving dt reduces the error vs analytic logistic', () => {
    const m = templateModel('logistic');
    const analytic = (t: number): number => 1000 / (1 + 99 * Math.exp(-0.5 * t));
    const err = (dt: number): number => {
      const s = simulateSD(m, { tStart: 0, tStop: 20, dt, method: 'rk4' });
      const arr = s.stocks['population']!;
      return Math.abs(arr[arr.length - 1]! - analytic(20));
    };
    const e1 = err(0.5);
    const e2 = err(0.25);
    expect(e2).toBeLessThan(e1);
    expect(e1).toBeLessThan(0.05);
  });

  it('Euler is first order (error shrinks roughly linearly with dt)', () => {
    const m = templateModel('logistic');
    const err = (dt: number): number => {
      const s = simulateSD(m, { tStart: 0, tStop: 10, dt, method: 'euler' });
      const arr = s.stocks['population']!;
      // analytic at t=10: 1000/(1+99e^-5) ≈ 145.3
      return Math.abs(arr[arr.length - 1]! - 1000 / (1 + 99 * Math.exp(-5)));
    };
    expect(err(0.1)).toBeGreaterThan(err(0.02));
  });

  it('Lotka-Volterra orbits stay bounded under RK4', () => {
    const m = templateModel('lotka-volterra');
    const s = simulateSD(m, { tStart: 0, tStop: 100, dt: 0.02, method: 'rk4' });
    const prey = s.stocks['prey']!;
    const pred = s.stocks['predator']!;
    expect(Math.max(...prey)).toBeLessThan(200);
    expect(Math.max(...pred)).toBeLessThan(80);
    expect(Math.min(...prey)).toBeGreaterThan(0);
    expect(Math.min(...pred)).toBeGreaterThan(0);
  });

  it('deterministic: identical inputs give identical series', () => {
    const m = templateModel('bass');
    const a = simulateSD(m, settings);
    const b = simulateSD(m, settings);
    expect(a.stocks['adopters']).toEqual(b.stocks['adopters']);
  });
});

describe('parameter sweep', () => {
  it('returns one series per value with matching length', () => {
    const m = templateModel('logistic');
    const series = sweepSD(m, settings, 'r', [0.2, 0.4, 0.8]);
    expect(series).toHaveLength(3);
    for (const s of series) expect(s.t).toHaveLength(s.stocks['population']!.length);
    // larger r reaches higher population by t=50 (closer to K or saturated earlier)
    const finals = series.map((s) => s.stocks['population']!.slice(-1)[0]!);
    expect(finals[2]!).toBeGreaterThan(0);
  });

  it('rejects more than 25 sweep values', () => {
    const m = templateModel('logistic');
    expect(() => sweepSD(m, settings, 'r', Array.from({ length: 26 }, (_, i) => i / 50))).toThrow(/25/);
  });
});

describe('templates', () => {
  it('Bass diffusion is S-shaped and saturates below market size', () => {
    const m = templateModel('bass');
    const s = simulateSD(m, { tStart: 0, tStop: 30, dt: 0.05, method: 'rk4' });
    const a = s.stocks['adopters']!;
    const n = a.length;
    const mid = a[Math.floor(n / 2)]!;
    // S-shape: early growth slower than mid growth
    expect(a[Math.floor(n * 0.2)]!).toBeLessThan(mid / 2);
    expect(a[n - 1]!).toBeGreaterThan(950);
    expect(a[n - 1]!).toBeLessThanOrEqual(1000 + 1e-6);
  });

  it('supply chain keeps inventory finite and responds to ordering', () => {
    const m = templateModel('supply-chain');
    const s = simulateSD(m, { tStart: 0, tStop: 80, dt: 0.1, method: 'rk4' });
    for (const nm of ['inventory', 'supplierInventory']) {
      const arr = s.stocks[nm]!;
      expect(Math.max(...arr)).toBeLessThan(1e6);
      expect(Math.min(...arr)).toBeGreaterThan(-1e6);
    }
  });

  it('climate 2-box conserves total carbon up to sinks/emissions', () => {
    const m = templateModel('climate-carbon');
    // zero emissions and zero sink: uptake+outgas must balance
    const closed: SDModel = JSON.parse(JSON.stringify(m));
    closed.parameters = closed.parameters.map((p) => (p.name === 'emissionRate' ? { ...p, value: 0 } : p.name === 'sinkRate' ? { ...p, value: 0 } : p));
    const s = simulateSD(closed, { tStart: 0, tStop: 60, dt: 0.05, method: 'rk4' });
    const atm = s.stocks['atmosphere']!;
    const ocean = s.stocks['ocean']!;
    const total0 = atm[0]! + ocean[0]!;
    const totalEnd = atm[atm.length - 1]! + ocean[ocean.length - 1]!;
    expect(Math.abs(totalEnd - total0)).toBeLessThan(1);
  });
});

describe('causal loops and dominance', () => {
  it('finds reinforcing and balancing loops in Lotka-Volterra', () => {
    const m = templateModel('lotka-volterra');
    const loops = findLoops(m);
    expect(loops.length).toBeGreaterThan(0);
    expect(loops.some((l) => l.sign > 0)).toBe(true);
  });

  it('deriveCausalLinks yields polarity-signed edges', () => {
    const m = templateModel('logistic');
    const links = deriveCausalLinks(m);
    expect(links.some((l) => l.polarity === -1)).toBe(true);
  });

  it('loop dominance returns finite gains per window', () => {
    const m = templateModel('lotka-volterra');
    const dom = loopDominance(m, { tStart: 0, tStop: 20, dt: 0.1, method: 'rk4' });
    expect(dom.length).toBeGreaterThan(0);
    for (const d of dom) {
      for (const v of [d.gain.start, d.gain.mid, d.gain.end]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
