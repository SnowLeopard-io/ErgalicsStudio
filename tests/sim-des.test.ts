import { describe, expect, it } from 'vitest';
import {
  DES_TEMPLATES,
  EventHeap,
  mmcFormulas,
  mm1Formulas,
  mulberry32,
  parseDesModel,
  runDES,
  sampleDuration,
  templateById,
  type DesModel,
} from '../src/plugins/builtin/sim/des/kernel';

/** M/M/1 with rho = 0.5 (lambda = 1, mu = 2). */
const MM1: DesModel = {
  source: { arrival: { type: 'exponential', rate: 1 }, entityLimit: 20000 },
  stations: [
    {
      id: 'srv',
      name: 'Server',
      servers: 1,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'exponential', rate: 2 },
      routing: { kind: 'exit' },
    },
  ],
};

describe('sim-des event heap', () => {
  it('pops in (time, seq) order — FIFO tie-break on equal times', () => {
    const h = new EventHeap<string>();
    h.push(5, 2, 'b');
    h.push(3, 7, 'x');
    h.push(5, 1, 'a');
    h.push(5, 3, 'c');
    h.push(1, 0, 'first');
    const popped: string[] = [];
    for (let e = h.pop(); e !== undefined; e = h.pop()) popped.push(e.data);
    expect(popped).toEqual(['first', 'x', 'a', 'b', 'c']);
  });

  it('respects LIFO-free deterministic ordering regardless of push order', () => {
    const h = new EventHeap<number>();
    const seqs = [9, 3, 7, 1, 5];
    for (const s of seqs) h.push(10, s, s);
    const out: number[] = [];
    for (let e = h.pop(); e !== undefined; e = h.pop()) out.push(e.data);
    expect(out).toEqual([1, 3, 5, 7, 9]);
  });
});

describe('sim-des distributions', () => {
  it('deterministic spec returns its value exactly', () => {
    const rng = mulberry32(1);
    expect(sampleDuration({ type: 'deterministic', value: 2.5 }, rng)).toBe(2.5);
  });

  it('exponential samples have the right mean and never go negative', () => {
    const rng = mulberry32(7);
    const rate = 2;
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      const v = sampleDuration({ type: 'exponential', rate }, rng);
      expect(v).toBeGreaterThan(0);
      sum += v;
    }
    expect(Math.abs(sum / n - 1 / rate) / (1 / rate)).toBeLessThan(0.05);
  });

  it('normal samples are clamped strictly positive', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 5000; i += 1) {
      expect(sampleDuration({ type: 'normal', mu: 0.01, sigma: 5 }, rng)).toBeGreaterThan(0);
    }
  });

  it('triangular samples stay inside [low, high]', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 5000; i += 1) {
      const v = sampleDuration({ type: 'triangular', low: 2, mode: 5, high: 9 }, rng);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(9);
    }
  });
});

describe('sim-des deterministic D/D/1 schedule', () => {
  it('3 entities, interval 1, service 2 reproduce waits 0, 1, 2 and sojourns 2, 3, 4', () => {
    const model: DesModel = {
      source: { arrival: { type: 'deterministic', value: 1 }, entityLimit: 3 },
      stations: [
        {
          id: 's',
          servers: 1,
          queueDiscipline: 'fifo',
          serviceTime: { type: 'deterministic', value: 2 },
          routing: { kind: 'exit' },
        },
      ],
    };
    const r = runDES(model, { seed: 1 });
    expect(r.stations[0]!.waitTimes).toEqual([0, 1, 2]);
    expect(r.sojourns).toEqual([2, 3, 4]);
    expect(r.entitiesExited).toBe(3);
    expect(r.simTime).toBeCloseTo(6, 9);
    // Server busy 0..6 → utilization exactly 1 for this tiny overloaded burst.
    expect(r.stations[0]!.utilization).toBeCloseTo(1, 9);
  });
});

describe('sim-des M/M/1 statistical agreement (rho = 0.5)', () => {
  const r = runDES(MM1, { seed: 7, buckets: 200 });

  it('measured Wq within 25% of the analytical 0.5', () => {
    const th = mm1Formulas(1, 2)!;
    expect(th.wq).toBeCloseTo(0.5, 9);
    expect(Math.abs(r.stations[0]!.avgWait - th.wq) / th.wq).toBeLessThan(0.25);
  });

  it('measured Lq within 25% of the analytical 0.5', () => {
    const th = mm1Formulas(1, 2)!;
    expect(th.lq).toBeCloseTo(0.5, 9);
    expect(Math.abs(r.stations[0]!.avgQueue - th.lq) / th.lq).toBeLessThan(0.25);
  });

  it('measured utilization matches rho = 0.5', () => {
    expect(Math.abs(r.stations[0]!.utilization - 0.5)).toBeLessThan(0.05);
  });

  it("Little's law residual < 0.05 on the stable run", () => {
    expect(r.littlesResidual).toBeLessThan(0.05);
  });

  it('max queue length ≥ time-averaged queue length (every station)', () => {
    for (const s of r.stations) expect(s.maxQueue).toBeGreaterThanOrEqual(s.avgQueue);
  });

  it('throughput is close to the arrival rate 1', () => {
    expect(Math.abs(r.throughput - 1)).toBeLessThan(0.05);
  });
});

describe('sim-des analytical formulas', () => {
  it('M/M/1 closed form at rho = 0.5', () => {
    const f = mm1Formulas(1, 2)!;
    expect(f.rho).toBeCloseTo(0.5, 12);
    expect(f.pWait).toBeCloseTo(0.5, 12);
    expect(f.wq).toBeCloseTo(0.5, 12);
    expect(f.lq).toBeCloseTo(0.5, 12);
    expect(f.w).toBeCloseTo(1.5, 12);
    expect(f.l).toBeCloseTo(1, 12);
  });

  it('M/M/c Erlang-C matches the hand-computed M/M/3 value at a = 2', () => {
    const f = mmcFormulas(1, 0.5, 3)!;
    expect(f.rho).toBeCloseTo(2 / 3, 12);
    expect(f.pWait).toBeCloseTo(4 / 9, 9);
    expect(f.wq).toBeCloseTo(8 / 9, 9);
    expect(f.lq).toBeCloseTo(8 / 9, 9);
  });

  it('returns null in the unstable region rho >= 1', () => {
    expect(mm1Formulas(2, 1)).toBeNull();
    expect(mmcFormulas(6, 1, 5)).toBeNull();
  });
});

describe('sim-des bottleneck identification', () => {
  it('serial line flags the slowest station as bottleneck', () => {
    const model: DesModel = {
      source: { arrival: { type: 'deterministic', value: 10 }, entityLimit: 30 },
      stations: [
        { id: 'fast', servers: 1, serviceTime: { type: 'deterministic', value: 2 }, routing: { kind: 'next', id: 'slow' } },
        { id: 'slow', servers: 1, serviceTime: { type: 'deterministic', value: 5 }, routing: { kind: 'next', id: 'mid' } },
        { id: 'mid', servers: 1, serviceTime: { type: 'deterministic', value: 3 }, routing: { kind: 'exit' } },
      ],
    };
    const r = runDES(model, { seed: 5 });
    expect(r.bottleneckId).toBe('slow');
    const byId = new Map(r.stations.map((s) => [s.id, s]));
    expect(byId.get('slow')!.utilization).toBeCloseTo(0.5, 6);
    expect(byId.get('fast')!.utilization).toBeCloseTo(0.2, 6);
    expect(byId.get('mid')!.utilization).toBeCloseTo(0.3, 6);
    expect(r.ranking[0]!.id).toBe('slow');
  });
});

describe('sim-des rework routing', () => {
  it('probabilistic rework loops still let every entity exit, and revisits are counted', () => {
    const model: DesModel = {
      source: { arrival: { type: 'deterministic', value: 1 }, entityLimit: 40 },
      stations: [
        { id: 'a', servers: 1, serviceTime: { type: 'deterministic', value: 0.4 }, routing: { kind: 'next', id: 'b' } },
        {
          id: 'b',
          servers: 1,
          serviceTime: { type: 'deterministic', value: 0.4 },
          routing: {
            kind: 'probabilities',
            options: [
              { id: 'a', p: 0.5 },
              { id: 'exit', p: 0.5 },
            ],
          },
        },
      ],
    };
    const r = runDES(model, { seed: 9 });
    expect(r.entitiesExited).toBe(40);
    expect(r.stations[0]!.revisits).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
  });

  it('explicit rework routing loops back and the event-cap valve stops a non-terminating model', () => {
    const model: DesModel = {
      source: { arrival: { type: 'deterministic', value: 5 }, entityLimit: 20 },
      stations: [
        { id: 'a', servers: 1, serviceTime: { type: 'deterministic', value: 1 }, routing: { kind: 'next', id: 'b' } },
        { id: 'b', servers: 1, serviceTime: { type: 'deterministic', value: 1 }, routing: { kind: 'rework', id: 'a' } },
      ],
    };
    const r = runDES(model, { seed: 2 });
    // Unconditional 'rework' never exits — the run must terminate via the
    // safety valve, having revisited station 'a' many times.
    expect(r.truncated).toBe(true);
    expect(r.stations[0]!.revisits).toBeGreaterThan(0);
    expect(Number.isFinite(r.simTime)).toBe(true);
  });
});

describe('sim-des stability guard', () => {
  it('an overloaded M/M/1 (rho = 2) terminates with a finite entity cap', () => {
    const model: DesModel = {
      source: { arrival: { type: 'exponential', rate: 2 }, entityLimit: 300 },
      stations: [
        {
          id: 'srv',
          servers: 1,
          queueDiscipline: 'fifo',
          serviceTime: { type: 'exponential', rate: 1 },
          routing: { kind: 'exit' },
        },
      ],
    };
    const r = runDES(model, { seed: 4 });
    expect(r.entitiesCreated).toBe(300);
    expect(r.entitiesExited).toBe(300);
    expect(Number.isFinite(r.simTime)).toBe(true);
    expect(r.truncated).toBe(false);
    // The queue must have blown up (unstable system), but stay finite.
    expect(r.stations[0]!.maxQueue).toBeGreaterThan(10);
  });
});

describe('sim-des determinism', () => {
  it('same seed reproduces the run exactly; a different seed differs', () => {
    const a = runDES(MM1, { seed: 123, buckets: 100 });
    const b = runDES(MM1, { seed: 123, buckets: 100 });
    expect(a.sojourns).toEqual(b.sojourns);
    expect(a.stations[0]!.waitTimes).toEqual(b.stations[0]!.waitTimes);
    expect(a.throughput).toBe(b.throughput);
    expect(a.simTime).toBe(b.simTime);
    const c = runDES(MM1, { seed: 124, buckets: 100 });
    expect(Math.abs(c.meanSojourn - a.meanSojourn)).toBeGreaterThan(1e-9);
  });
});

describe('sim-des model validation and templates', () => {
  it('rejects malformed models with readable errors', () => {
    expect(parseDesModel('not json').ok).toBe(false);
    expect(parseDesModel('{}').ok).toBe(false);
    expect(
      parseDesModel(JSON.stringify({ source: { arrival: { type: 'deterministic', value: 1 }, entityLimit: 5 }, stations: [{ id: 'a', servers: 1, serviceTime: { type: 'deterministic', value: 1 }, routing: { kind: 'next', id: 'ghost' } }] })).ok,
    ).toBe(false);
    expect(
      parseDesModel(JSON.stringify({ source: { arrival: { type: 'exponential', rate: -1 }, entityLimit: 5 }, stations: [{ id: 'a', servers: 1, serviceTime: { type: 'deterministic', value: 1 }, routing: { kind: 'exit' } }] })).ok,
    ).toBe(false);
  });

  it('every built-in template is valid, serializable and runs to completion', () => {
    for (const t of DES_TEMPLATES) {
      const parsed = parseDesModel(JSON.stringify(t.model));
      expect(parsed.ok, t.id).toBe(true);
      const m = { ...t.model, source: { ...t.model.source, entityLimit: 200 } };
      const r = runDES(m, { seed: 42 });
      expect(r.entitiesExited).toBe(200);
      expect(r.truncated).toBe(false);
      expect(r.littlesResidual).toBeLessThan(0.05);
      for (const s of r.stations) {
        expect(s.utilization).toBeLessThan(1);
        expect(s.maxQueue).toBeGreaterThanOrEqual(s.avgQueue);
      }
    }
  });

  it('template lookup resolves built-in ids', () => {
    expect(templateById('bank')).toBeDefined();
    expect(templateById('callcenter')).toBeDefined();
    expect(templateById('nope')).toBeUndefined();
  });
});
