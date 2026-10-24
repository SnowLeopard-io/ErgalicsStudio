// Fluid-CFD Coupler plugin — pure-logic tests (no worker/Pyodide involved).
// PRD CFD-03: the geometry/scale helpers in render.ts are pure & exported,
// so the front-end keeps parity with the eigensolver plugin's test coverage.
import { describe, it, expect } from 'vitest';
import { domainOf, normT, toMs } from '@/plugins/builtin/fluid-cfd-coupler/render';
import { findBuiltin } from '@/plugins/builtin';
import type { FluidWindowRecord } from '@/plugins/builtin/fluid-cfd-coupler/types';

describe('fluid-cfd-coupler manifest', () => {
  it('is registered as a builtin plugin (resolvable by findBuiltin)', () => {
    const found = findBuiltin('example.fluid-cfd-coupler');
    expect(found).toBeDefined();
    expect(found?.manifest.id).toBe('example.fluid-cfd-coupler');
  });
});

describe('domainOf (NaN-safe inclusive range with padding)', () => {
  it('returns the padded [min,max] of a finite sequence', () => {
    const [lo, hi] = domainOf([0, 1, 2, 3, 4]);
    // pad = (4-0)*0.08 = 0.32
    expect(lo).toBeCloseTo(-0.32, 10);
    expect(hi).toBeCloseTo(4.32, 10);
  });

  it('ignores non-finite values', () => {
    const [lo, hi] = domainOf([NaN, Infinity, -Infinity, 10, 20]);
    expect(lo).toBeCloseTo(9.2, 10);
    expect(hi).toBeCloseTo(20.8, 10);
  });

  it('widens a degenerate constant domain symmetrically', () => {
    const [lo, hi] = domainOf([3, 3, 3]);
    // pad = max(|3|*0.1, 0.5) = 0.5
    expect(lo).toBeCloseTo(2.5, 10);
    expect(hi).toBeCloseTo(3.5, 10);
  });

  it('falls back to [0,1] when every value is non-finite', () => {
    expect(domainOf([NaN, Infinity])).toEqual([0, 1]);
    expect(domainOf([])).toEqual([0, 1]);
  });
});

describe('normT (0..1 normalisation over a domain)', () => {
  it('maps the domain endpoints to 0 and 1', () => {
    expect(normT(0, 0, 10)).toBe(0);
    expect(normT(10, 0, 10)).toBe(1);
    expect(normT(5, 0, 10)).toBe(0.5);
  });

  it('clamps the span so a degenerate domain never divides by zero', () => {
    expect(normT(5, 5, 5)).toBe(0);
    expect(Number.isFinite(normT(5, 5, 5))).toBe(true);
  });
});

describe('toMs (window time in seconds to milliseconds)', () => {
  it('scales the 1-D clock to ms', () => {
    const w: FluidWindowRecord = {
      t: 0.16,
      exchange_latency_s: 0,
      md_1d: 0,
      t_1d: 300,
      p_back_3d: 1e5,
      mass_in_3d: 0,
      enthalpy_in_3d: 0,
      iface_error: 0,
      control_sync_ms: 0,
      valve_opening: 1,
    };
    expect(toMs(w)).toBe(160);
  });
});
