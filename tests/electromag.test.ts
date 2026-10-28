// Electromag physics regression tests: the Lorentz force (F = q·v×B) must be
// integrated with a Boris pusher so a single charge in a uniform B field keeps
// |v| constant (uniform circular motion). Explicit Euler on the pure rotation
// inflated |v| by √(1+(ω·dt)²) per step — ~8%/orbit — making the charge spiral
// outward. The Coulomb/damping parts are unchanged (symplectic Euler).
import { describe, it, expect } from 'vitest';
import { ElectromagPlugin } from '@/plugins/builtin/physics/electromag/plugin';
import type { PluginApi } from '@/types/plugin';

function makeApi(): PluginApi {
  return {
    locale: 'en-US',
    notify: () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    log: () => {},
  } as unknown as PluginApi;
}

async function freshElectromag() {
  const plugin = new ElectromagPlugin();
  await plugin.init(makeApi());
  return plugin;
}

describe('electromag Lorentz force (Boris pusher)', () => {
  it('keeps |v| constant for a single charge in a uniform B field (regression: explicit Euler grew it ~8%/orbit)', async () => {
    const plugin = await freshElectromag();
    const internal = plugin as unknown as {
      state: { B: number; damping: number };
      charges: Array<{ x: number; y: number; vx: number; vy: number; q: number }>;
      trails: number[][][];
      step: (dt: number) => void;
    };
    // Single charge: no Coulomb partner, no air damping — only the Lorentz force.
    internal.charges = [{ x: 300, y: 200, vx: 0, vy: 100, q: 1 }];
    internal.trails = internal.charges.map(() => []);
    internal.state.B = 1.5;
    internal.state.damping = 0;

    const dt = 1 / 60;
    const v0 = Math.hypot(internal.charges[0]!.vx, internal.charges[0]!.vy);
    // ω = q·B/m = 1.5 rad/s → T ≈ 4.19 s ≈ 251 steps. 6000 steps ≈ 24 orbits,
    // enough for the old Euler integrator to reach |v| ≈ 100·1.0816²⁴ ≈ 660.
    for (let s = 0; s < 6000; s += 1) internal.step(dt);
    const v1 = Math.hypot(internal.charges[0]!.vx, internal.charges[0]!.vy);

    // Boris preserves |v| to floating-point precision; the old explicit Euler
    // would have grown it by ~6.6× over the same interval.
    expect(v1).toBeCloseTo(v0, 6);
  });

  it('still accelerates a charge under a pure Coulomb partner (attraction unchanged)', async () => {
    const plugin = await freshElectromag();
    const internal = plugin as unknown as {
      state: { B: number; damping: number };
      charges: Array<{ x: number; y: number; vx: number; vy: number; q: number }>;
      trails: number[][][];
      step: (dt: number) => void;
    };
    // Two opposite charges at rest with B = 0: they must attract (Coulomb path
    // still drives the integration).
    internal.charges = [
      { x: 300, y: 200, vx: 0, vy: 0, q: 1 },
      { x: 340, y: 200, vx: 0, vy: 0, q: -1 },
    ];
    internal.trails = internal.charges.map(() => []);
    internal.state.B = 0;
    internal.state.damping = 0;

    const dt = 1 / 60;
    // A few steps only: the two charges are 40 px apart with a ≈ 2500 px/s²
    // mutual acceleration, so they pass each other within a fraction of a
    // second. Assert the initial attraction (displacement, not velocity).
    const x0 = internal.charges[0]!.x;
    const x1 = internal.charges[1]!.x;
    for (let s = 0; s < 10; s += 1) internal.step(dt);
    // Opposite charges pull toward each other: the left one moves right (+x).
    expect(internal.charges[0]!.x).toBeGreaterThan(x0);
    expect(internal.charges[1]!.x).toBeLessThan(x1);
  });
});
