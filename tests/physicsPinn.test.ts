// physics-pinn — kernel checks (analytic reference, determinism, training).
import { describe, it, expect } from 'vitest';
import {
  PinnTrainer,
  burgersReference,
  heatExact,
  runPinnBenchmarks,
} from '@/plugins/builtin/physics/pinn/kernel';

describe('pinn benchmarks', () => {
  it('analytic heat solution satisfies the PDE and references are sane', () => {
    const bench = runPinnBenchmarks();
    expect(bench.every((b) => b.ok)).toBe(true);
  });

  it('heat analytic collapses with the expected decay', () => {
    expect(heatExact(0.5, 0, 0.1)).toBeCloseTo(1, 12);
    expect(heatExact(0.5, 1, 0.1)).toBeCloseTo(Math.exp(-0.1 * Math.PI * Math.PI), 12);
    expect(heatExact(0, 0.4, 0.1)).toBeCloseTo(0, 12);
  });

  it('Burgers reference keeps zero Dirichlet boundaries', () => {
    const rows = burgersReference(0.05, [0, 0.5, 1], [0, 0.5, 1]);
    for (const row of rows) {
      expect(Math.abs(row[0] as number)).toBeLessThan(1e-12);
      expect(Math.abs(row[2] as number)).toBeLessThan(1e-12);
    }
  });
});

describe('pinn training', () => {
  it('reduces the loss and lands near the analytic heat solution', () => {
    const trainer = new PinnTrainer({
      pde: 'heat',
      width: 20,
      depth: 2,
      lr: 0.01,
      collocation: 200,
      epochs: 260,
      seed: 7,
      coef: 0.1,
      discover: false,
    });
    const first = trainer.step();
    while (!trainer.done) trainer.step();
    const snap = trainer.snapshot();
    expect(snap.loss.at(-1) as number).toBeLessThan(first);
    // A small net plus a 2nd-order FD residual: <10% L2 is a working solve.
    expect(snap.relL2).toBeLessThan(0.1);
    expect(Number.isFinite(snap.residualRms)).toBe(true);
    expect(snap.profiles).toHaveLength(5);
  });

  it('solves viscous Burgers against the FD reference', () => {
    const trainer = new PinnTrainer({
      pde: 'burgers',
      width: 24,
      depth: 2,
      lr: 0.02,
      collocation: 300,
      epochs: 400,
      seed: 11,
      coef: 0.05,
      discover: false,
    });
    while (!trainer.done) trainer.step();
    const snap = trainer.snapshot();
    expect(snap.profiles).toHaveLength(5);
    expect(snap.relL2).toBeLessThan(0.15);
  });

  it('recovers the diffusivity in inverse mode via interior sensors', () => {
    const trainer = new PinnTrainer({
      pde: 'heat',
      width: 20,
      depth: 2,
      lr: 0.02,
      collocation: 200,
      epochs: 400,
      seed: 7,
      coef: 0.1,
      discover: true,
    });
    while (!trainer.done) trainer.step();
    const snap = trainer.snapshot();
    expect(snap.coefHat).not.toBeNull();
    expect(Math.abs((snap.coefHat as number) - 0.1) / 0.1).toBeLessThan(0.2);
  });

  it('is deterministic for a fixed seed', () => {    const cfg = {
      pde: 'heat' as const,
      width: 8,
      depth: 1,
      lr: 0.01,
      collocation: 32,
      epochs: 5,
      seed: 3,
      coef: 0.1,
      discover: false,
    };
    const a = new PinnTrainer(cfg);
    const b = new PinnTrainer(cfg);
    for (let i = 0; i < 5; i += 1) {
      a.step();
      b.step();
    }
    expect(a.history).toEqual(b.history);
  });
});
