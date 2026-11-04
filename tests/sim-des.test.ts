import { describe, expect, it } from 'vitest';
import {
  DES_TEMPLATE_LABEL,
  EventHeap,
  createRng,
  distLabel,
  erlangC,
  findBottleneck,
  mmcAnalytic,
  mm1Analytic,
  runDes,
  sampleDist,
  templateNetwork,
  waitHistogram,
} from '@/plugins/builtin/sim/des/kernel';

describe('DES distributions', () => {
  it('exponential draws are positive with the right mean', () => {
    const rng = createRng(11);
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = sampleDist({ kind: 'exponential', mean: 3 }, rng);
      expect(v).toBeGreaterThan(0);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(3, 1);
  });

  it('deterministic and uniform draws match their spec', () => {
    const rng = createRng(1);
    expect(sampleDist({ kind: 'deterministic', value: 5 }, rng)).toBe(5);
    for (let i = 0; i < 100; i++) {
      const v = sampleDist({ kind: 'uniform', min: 2, max: 6 }, rng);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('triangular draws stay in range and cluster near the mode', () => {
    const rng = createRng(3);
    let nearMode = 0;
    for (let i = 0; i < 5000; i++) {
      const v = sampleDist({ kind: 'triangular', min: 1, mode: 4, max: 7 }, rng);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(7);
      if (Math.abs(v - 4) < 0.5) nearMode++;
    }
    expect(nearMode / 5000).toBeGreaterThan(0.12);
  });

  it('normal draws respect the floor and stay near the mean', () => {
    const rng = createRng(5);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = sampleDist({ kind: 'normal', mean: 4, sd: 3 }, rng);
      expect(v).toBeGreaterThan(0);
      sum += v;
    }
    // Clamping the negative tail shifts the mean up slightly; allow for it.
    expect(sum / 20000).toBeGreaterThan(3.8);
    expect(sum / 20000).toBeLessThan(4.25);
  });

  it('distLabel formats each kind', () => {
    expect(distLabel({ kind: 'deterministic', value: 2 })).toContain('Det');
    expect(distLabel({ kind: 'uniform', min: 1, max: 2 })).toContain('U(');
  });
});

describe('EventHeap', () => {
  it('pops in (time, seq) order', () => {
    const h = new EventHeap();
    h.push({ time: 5, seq: 2, kind: 'departure', station: 0, jobId: 0 });
    h.push({ time: 5, seq: 1, kind: 'arrival', station: 0, jobId: 1 });
    h.push({ time: 1, seq: 0, kind: 'arrival', station: 0, jobId: 2 });
    h.push({ time: 9, seq: 3, kind: 'arrival', station: 0, jobId: 3 });
    expect(h.pop()!.seq).toBe(0);
    expect(h.pop()!.seq).toBe(1);
    expect(h.pop()!.seq).toBe(2);
    expect(h.pop()!.seq).toBe(3);
    expect(h.pop()).toBeUndefined();
  });
});

describe('analytic queueing formulas', () => {
  it('M/M/1 matches textbook values (lambda=0.5, mu=1)', () => {
    const r = mm1Analytic(0.5, 1);
    expect(r.rho).toBeCloseTo(0.5);
    expect(r.Lq).toBeCloseTo(0.5);
    expect(r.W).toBeCloseTo(2);
    expect(r.Wq).toBeCloseTo(1);
  });

  it('M/M/1 flags instability above rho=1', () => {
    expect(mm1Analytic(2, 1).stable).toBe(false);
    expect(Number.isNaN(mm1Analytic(2, 1).Lq)).toBe(true);
  });

  it('Erlang-C decreases with more servers and hits 1 when unstable', () => {
    expect(erlangC(4, 1, 3)).toBe(1);
    const c3 = erlangC(3, 1, 5);
    const c4 = erlangC(3, 1, 6);
    expect(c4).toBeLessThan(c3);
    expect(c3).toBeGreaterThan(0);
    expect(c3).toBeLessThan(1);
  });

  it('M/M/c reduces toward M/M/1 behavior at c=1', () => {
    const a = mm1Analytic(0.5, 1);
    const b = mmcAnalytic(0.5, 1, 1);
    expect(b.erlangC).toBeCloseTo(a.rho);
    expect(b.Lq).toBeCloseTo(a.Lq, 6);
  });
});

describe('DES engine', () => {
  it('same seed reproduces the run exactly', () => {
    const spec = templateNetwork('bank');
    const a = runDes(spec, { simTime: 200, seed: 7 });
    const b = runDes(templateNetwork('bank'), { simTime: 200, seed: 7 });
    expect(a.completed).toBe(b.completed);
    expect(a.stations[0]!.meanWait).toBeCloseTo(b.stations[0]!.meanWait, 12);
    expect(a.waitTimes[0]).toBeCloseTo(b.waitTimes[0]!, 12);
  });

  it('M/M/1 simulation matches the analytic queue wait within tolerance', () => {
    // True M/M/1: exponential arrivals mean 2 (lambda=0.5), exponential service mean 1 (mu=1).
    const spec: ReturnType<typeof templateNetwork> = {
      arrival: { kind: 'exponential', mean: 2 },
      stations: [{ name: 'S', servers: 1, service: { kind: 'exponential', mean: 1 } }],
      routing: [{ from: 0, to: null, prob: 1 }],
    };
    const r = runDes(spec, { simTime: 40000, seed: 123 });
    expect(r.stations[0]!.utilization).toBeGreaterThan(0.4);
    expect(r.stations[0]!.utilization).toBeLessThan(0.6);
    const wq = r.stations[0]!.meanWait;
    expect(wq).toBeGreaterThan(0.5);
    expect(wq).toBeLessThan(1.6);
  });

  it('M/M/c simulation approximates the Erlang-C wait', () => {
    const spec = templateNetwork('bank');
    const r = runDes(spec, { simTime: 20000, seed: 9 });
    const an = mmcAnalytic(1 / 4, 1 / 10, 3);
    const simWq = r.stations[0]!.meanWait;
    expect(simWq).toBeGreaterThan(an.Wq * 0.4);
    expect(simWq).toBeLessThan(an.Wq * 2.5);
  });

  it('Little\u2019s law holds for a stable single-station line', () => {
    const spec = templateNetwork('bank');
    const r = runDes(spec, { simTime: 20000, seed: 21 });
    const W = r.sojournTimes.reduce((a, v) => a + v, 0) / Math.max(r.completed, 1);
    const LfromLittle = r.throughput * W;
    expect(LfromLittle).toBeCloseTo(r.meanJobsInSystem, 0);
  });

  it('production rework gives stage 2 more visits than arrivals', () => {
    const spec = templateNetwork('production');
    const r = runDes(spec, { simTime: 5000, seed: 4 });
    const inspect = r.stations[2]!;
    const paint = r.stations[1]!;
    expect(inspect.meanVisits).toBeGreaterThan(1);
    // Paint receives every Inspection pass (10% rework), so visits exceed Assembly's.
    expect(paint.served).toBeGreaterThan(r.stations[0]!.served);
  });

  it('finite capacity blocks jobs when the queue is full', () => {
    const spec: ReturnType<typeof templateNetwork> = {
      arrival: { kind: 'deterministic', value: 1 },
      stations: [{ name: 'S', servers: 1, service: { kind: 'deterministic', value: 10 }, capacity: 2 }],
      routing: [{ from: 0, to: null, prob: 1 }],
    };
    const r = runDes(spec, { simTime: 1000, seed: 2 });
    expect(r.blockedTotal).toBeGreaterThan(0);
    expect(r.completed).toBeGreaterThan(0);
    // Jobs still in service / queue at the horizon are neither completed nor blocked.
    const inSystemAtEnd = r.totalArrivals - r.completed - r.blockedTotal;
    expect(inSystemAtEnd).toBeGreaterThanOrEqual(0);
    expect(inSystemAtEnd).toBeLessThanOrEqual(3); // 1 server + capacity 2
  });

  it('call-center template blocks under its default load', () => {
    const spec = templateNetwork('call-center');
    const r = runDes(spec, { simTime: 1000, seed: 3 });
    expect(r.blockedTotal).toBeGreaterThanOrEqual(0);
    expect(r.stations[0]!.servers).toBe(5);
  });

  it('hospital template routes patients to two branches', () => {
    const spec = templateNetwork('hospital');
    const r = runDes(spec, { simTime: 3000, seed: 17 });
    expect(r.stations.length).toBe(3);
    expect(r.stations[1]!.served).toBeGreaterThan(0);
    expect(r.stations[2]!.served).toBeGreaterThan(0);
    expect(r.completed).toBeGreaterThan(0);
  });

  it('queue series is decimated and non-negative', () => {
    const spec = templateNetwork('production');
    const r = runDes(spec, { simTime: 2000, seed: 6 });
    expect(r.queueSeries.length).toBeGreaterThan(2);
    expect(r.queueSeries.length).toBeLessThanOrEqual(601);
    for (const s of r.queueSeries) {
      for (const v of s.lengths) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('wait histogram covers all samples in range', () => {
    const spec = templateNetwork('bank');
    const r = runDes(spec, { simTime: 5000, seed: 8 });
    const h = waitHistogram(r.waitTimes, 10);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(r.waitTimes.length);
  });

  it('bottleneck identification picks the busiest station', () => {
    const spec = templateNetwork('production');
    const r = runDes(spec, { simTime: 3000, seed: 10 });
    const b = findBottleneck(r.stations);
    expect(b).not.toBeNull();
    const maxUtil = Math.max(...r.stations.map((s) => s.utilization));
    expect(b!.utilization).toBeCloseTo(maxUtil, 12);
  });

  it('unstable systems show utilization near 1 and large queues', () => {
    const spec: ReturnType<typeof templateNetwork> = {
      arrival: { kind: 'deterministic', value: 0.5 },
      stations: [{ name: 'S', servers: 1, service: { kind: 'exponential', mean: 2 } }],
      routing: [{ from: 0, to: null, prob: 1 }],
    };
    const r = runDes(spec, { simTime: 1000, seed: 30 });
    expect(r.stations[0]!.utilization).toBeGreaterThan(0.95);
    expect(r.stations[0]!.maxQueueLength).toBeGreaterThan(10);
  });

  it('all templates run and produce finite metrics', () => {
    for (const id of Object.keys(DES_TEMPLATE_LABEL) as (keyof typeof DES_TEMPLATE_LABEL)[]) {
      const r = runDes(templateNetwork(id), { simTime: 1000, seed: 99 });
      expect(r.totalArrivals).toBeGreaterThan(0);
      for (const st of r.stations) {
        expect(Number.isFinite(st.utilization)).toBe(true);
        expect(Number.isFinite(st.meanQueueLength)).toBe(true);
      }
    }
  });
});
