// ==========================================================================
// FEM core — Poisson solver tests: L² convergence order ≈ 2 on the analytic
// sine case over uniformly refined structured grids, an unstructured-domain
// sanity solve against the radial analytic solution, and an exact
// two-material interface test with flux continuity.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { rectStructuredMesh, circleDomain } from '../../src/core/fem/mesh/domain';
import { meshDomain } from '../../src/core/fem/mesh/delaunay';
import { solvePoisson, POISSON_SINE_CASE } from '../../src/core/fem/physics/poisson';
import { l2Error, convergenceOrder } from '../../src/core/fem/post/stress';
import { nodeX, nodeY } from '../../src/core/fem/mesh/types';

const DIRICHLET_ALL = [1, 2, 3, 4]; // rectangle tags: bottom/right/top/left

describe('fem poisson: L² convergence on the analytic sine case', () => {
  it('error decays at second order under uniform refinement', () => {
    // −Δu = f on the unit square, u = 0 on ∂Ω,
    // u = sin(πx)·sin(πy), f = 2π²·sin(πx)·sin(πy).
    const hs: number[] = [];
    const errs: number[] = [];
    for (const n of [4, 8, 16, 32]) {
      const mesh = rectStructuredMesh(1, 1, n, n);
      const r = solvePoisson({
        mesh,
        k: POISSON_SINE_CASE.k,
        source: POISSON_SINE_CASE.source,
        dirichlet: { edgeTags: DIRICHLET_ALL, value: 0 },
        cg: { tol: 1e-12 },
      });
      expect(r.residual).toBeLessThan(1e-8);
      const err = l2Error(mesh, r.values, POISSON_SINE_CASE.exact);
      hs.push(1 / n);
      errs.push(err);
    }
    // Monotone decay with observed orders approaching 2.
    for (let i = 1; i < errs.length; i += 1) {
      expect(errs[i]!).toBeLessThan(errs[i - 1]!);
      const p = convergenceOrder(hs[i - 1]!, errs[i - 1]!, hs[i]!, errs[i]!);
      expect(p).toBeGreaterThan(1.8);
    }
    // Finest-grid error is small in absolute terms.
    expect(errs[errs.length - 1]!).toBeLessThan(5e-3);
  });
});

describe('fem poisson: unstructured domain sanity solve', () => {
  it('unit disc with f = 1 approaches u = (1 − r²)/4', () => {
    const domain = circleDomain(1);
    const mesh = meshDomain(domain, { targetSize: 0.09, seed: 20260420 });
    const r = solvePoisson({
      mesh,
      source: () => 1,
      dirichlet: { edgeTags: [1], value: 0 },
      cg: { tol: 1e-12 },
    });
    expect(r.residual).toBeLessThan(1e-10);
    const exact = (x: number, y: number): number => (1 - x * x - y * y) / 4;
    const err = l2Error(mesh, r.values, exact);
    expect(err).toBeLessThan(0.02);

    // Value at the node closest to the centre near the analytic maximum 0.25.
    let centre = -1;
    let best = Infinity;
    for (let i = 0; i < mesh.nodes.length / 2; i += 1) {
      const d = nodeX(mesh, i) * nodeX(mesh, i) + nodeY(mesh, i) * nodeY(mesh, i);
      if (d < best) {
        best = d;
        centre = r.values[i]!;
      }
    }
    expect(Math.abs(centre - 0.25)).toBeLessThan(0.02);
  });
});

describe('fem poisson: two-material interface (piecewise-constant k)', () => {
  it('reproduces the 1-D kinked solution exactly and keeps the flux continuous', () => {
    // Layered square: k = 10 for y < 0.5, k = 1 for y ≥ 0.5, u = 1 on the top,
    // u = 0 on the bottom, natural (zero-flux) side walls. Steady 1-D solution
    // with constant flux q = −20/11:
    //   u(y) = 2y/11          (lower layer, u′ = 2/11)
    //   u(y) = 1 − 20(1−y)/11 (upper layer, u′ = 20/11)
    // The kink sits on a mesh line, so the exact field lives in the P1 space
    // and the FEM solution must reproduce it to solver tolerance.
    const mesh = rectStructuredMesh(1, 1, 20, 20);
    for (const el of mesh.elements) {
      const yc = (nodeY(mesh, el.a) + nodeY(mesh, el.b) + nodeY(mesh, el.c)) / 3;
      el.tag = yc < 0.5 ? 1 : 2;
    }
    const r = solvePoisson({
      mesh,
      k: { 1: 10, 2: 1 },
      source: () => 0,
      dirichlet: { edgeTags: [1, 3], value: (_x, y) => (y > 0.5 ? 1 : 0) },
      cg: { tol: 1e-12 },
    });
    expect(r.residual).toBeLessThan(1e-8);

    const exact = (_x: number, y: number): number =>
      y < 0.5 ? (2 * y) / 11 : 1 - (20 / 11) * (1 - y);
    const n = mesh.nodes.length / 2;
    let maxErr = 0;
    for (let i = 0; i < n; i += 1) {
      maxErr = Math.max(maxErr, Math.abs(r.values[i]! - exact(nodeX(mesh, i), nodeY(mesh, i))));
    }
    expect(maxErr).toBeLessThan(1e-7);

    // Flux −k·∇u must match on both sides of the interface (q = −20/11).
    const q = -20 / 11;
    let lowerFlux = 0;
    let upperFlux = 0;
    let nLower = 0;
    let nUpper = 0;
    for (let e = 0; e < mesh.elements.length; e += 1) {
      const el = mesh.elements[e]!;
      const yc = (nodeY(mesh, el.a) + nodeY(mesh, el.b) + nodeY(mesh, el.c)) / 3;
      if (Math.abs(yc - 0.5) > 0.06) continue; // elements adjacent to the interface
      const gy = r.elementFlux[e * 2 + 1]!;
      if (yc < 0.5) {
        lowerFlux += gy;
        nLower += 1;
      } else {
        upperFlux += gy;
        nUpper += 1;
      }
    }
    expect(nLower).toBeGreaterThan(0);
    expect(nUpper).toBeGreaterThan(0);
    const avgLower = lowerFlux / nLower;
    const avgUpper = upperFlux / nUpper;
    expect(Math.abs(avgLower - q)).toBeLessThan(1e-6);
    expect(Math.abs(avgUpper - q)).toBeLessThan(1e-6);
    expect(Math.abs(avgLower - avgUpper)).toBeLessThan(1e-6);
  });
});
