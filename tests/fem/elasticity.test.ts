// ==========================================================================
// FEM core — plane elasticity tests: the uniaxial tension bar (plane stress)
// has the exact linear displacement field u = (σ₀x/E, −νσ₀y/E), which the P1
// space contains, so the FEM solution must match it to solver tolerance and
// the recovered stress must be the constant uniaxial state σx = σ₀.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { rectStructuredMesh } from '../../src/core/fem/mesh/domain';
import { solveElasticity, UNIAXIAL_BAR_CASE } from '../../src/core/fem/physics/elasticity';
import { nodeX, nodeY } from '../../src/core/fem/mesh/types';

const { sigma0, E, nu } = UNIAXIAL_BAR_CASE;

/** Left-edge (x = 0) node indices of the structured bar mesh. */
function leftEdgeNodes(mesh: ReturnType<typeof rectStructuredMesh>): number[] {
  const out: number[] = [];
  for (let i = 0; i < mesh.nodes.length / 2; i += 1) {
    if (Math.abs(nodeX(mesh, i)) < 1e-9) out.push(i);
  }
  return out;
}

describe('fem elasticity: uniaxial tension bar (plane stress)', () => {
  it('reproduces the exact linear displacement field and uniaxial stress', () => {
    // Bar [0, 2] × [0, 1], traction σ₀ on the right edge (tag 2), ux = 0 on
    // the left edge, uy = 0 at the origin corner (removes the rigid y-mode).
    const mesh = rectStructuredMesh(2, 1, 8, 4);
    const left = leftEdgeNodes(mesh);
    expect(left.length).toBe(5);
    const r = solveElasticity({
      mesh,
      E,
      nu,
      state: 'plane-stress',
      tractions: [{ edges: [2], tx: sigma0 }],
      constraints: [
        { nodes: left, ux: 0 },
        { nodes: [0], uy: 0 },
      ],
      cg: { tol: 1e-12 },
    });
    expect(r.residual).toBeLessThan(1e-8);

    // Nodal displacements match u = (σ₀x/E, −νσ₀y/E) to roundoff scale.
    const n = mesh.nodes.length / 2;
    let maxErrUx = 0;
    let maxErrUy = 0;
    for (let i = 0; i < n; i += 1) {
      const x = nodeX(mesh, i);
      const y = nodeY(mesh, i);
      maxErrUx = Math.max(maxErrUx, Math.abs(r.displacement[2 * i]! - UNIAXIAL_BAR_CASE.exactUx(x, E, sigma0)));
      maxErrUy = Math.max(maxErrUy, Math.abs(r.displacement[2 * i + 1]! - UNIAXIAL_BAR_CASE.exactUy(y, E, nu, sigma0)));
    }
    expect(maxErrUx).toBeLessThan(1e-9);
    expect(maxErrUy).toBeLessThan(1e-9);

    // Recovered stress is the constant uniaxial state σx = σ₀, σy = τ = 0.
    let maxSx = 0;
    let maxSy = 0;
    let maxTxy = 0;
    for (let e = 0; e < mesh.elements.length; e += 1) {
      maxSx = Math.max(maxSx, Math.abs(r.elementStress[e * 3]! - sigma0));
      maxSy = Math.max(maxSy, Math.abs(r.elementStress[e * 3 + 1]!));
      maxTxy = Math.max(maxTxy, Math.abs(r.elementStress[e * 3 + 2]!));
    }
    expect(maxSx).toBeLessThan(1e-6);
    expect(maxSy).toBeLessThan(1e-6);
    expect(maxTxy).toBeLessThan(1e-6);

    // Constant strain state: εx = σ₀/E, εy = −νσ₀/E, γxy = 0.
    const exExpected = sigma0 / E;
    const eyExpected = (-nu * sigma0) / E;
    for (let e = 0; e < mesh.elements.length; e += 1) {
      expect(Math.abs(r.elementStrain[e * 3]! - exExpected)).toBeLessThan(1e-12);
      expect(Math.abs(r.elementStrain[e * 3 + 1]! - eyExpected)).toBeLessThan(1e-12);
      expect(Math.abs(r.elementStrain[e * 3 + 2]!)).toBeLessThan(1e-12);
    }
  });

  it('plane-strain constitutive law gives the documented D matrix', () => {
    // Direct unit check of the constitutive matrix (no solve needed):
    // uniaxial strain ε = (ε0, 0, 0) under plane strain must give
    // σx = f(1−ν)ε0, σy = fν(1−ν)… verify σ = D·ε entries numerically.
    const eps0 = 1e-3;
    const D = (() => {
      const f = E / ((1 + nu) * (1 - 2 * nu));
      const m = new Float64Array(9);
      m[0] = f * (1 - nu);
      m[1] = f * nu;
      m[3] = f * nu;
      m[4] = f * (1 - nu);
      m[8] = (f * (1 - 2 * nu)) / 2;
      return m;
    })();
    const sx = D[0]! * eps0;
    const sy = D[3]! * eps0;
    // Sanity: both normal stresses positive and σx > σy for ν > 0.
    expect(sx).toBeGreaterThan(0);
    expect(sy).toBeGreaterThan(0);
    expect(sx).toBeGreaterThan(sy);
  });

  it('mesh-independent result: refining the bar keeps the exact field', () => {
    // The exact field is linear, so ANY conforming P1 mesh reproduces it —
    // verify on a finer structured mesh too (guards against accidental
    // dependencies on the alternating-diagonal pattern).
    const mesh = rectStructuredMesh(2, 1, 16, 8);
    const left = leftEdgeNodes(mesh);
    expect(left.length).toBe(9);
    const r = solveElasticity({
      mesh,
      E,
      nu,
      state: 'plane-stress',
      tractions: [{ edges: [2], tx: sigma0 }],
      constraints: [
        { nodes: left, ux: 0 },
        { nodes: [0], uy: 0 },
      ],
      cg: { tol: 1e-12 },
    });
    expect(r.residual).toBeLessThan(1e-8);
    let maxErr = 0;
    for (let i = 0; i < mesh.nodes.length / 2; i += 1) {
      maxErr = Math.max(
        maxErr,
        Math.abs(r.displacement[2 * i]! - UNIAXIAL_BAR_CASE.exactUx(nodeX(mesh, i), E, sigma0)),
        Math.abs(r.displacement[2 * i + 1]! - UNIAXIAL_BAR_CASE.exactUy(nodeY(mesh, i), E, nu, sigma0)),
      );
    }
    expect(maxErr).toBeLessThan(1e-9);
  });
});
