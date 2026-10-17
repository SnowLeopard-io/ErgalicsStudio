import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type TrussModel,
  parseTrussModel,
  solveTruss,
} from '../src/plugins/builtin/eng-truss/kernel';

/** Unified relative-error yardstick: |computed − analytic| / |analytic|. */
function relErr(computed: number, analytic: number): number {
  return Math.abs(computed - analytic) / Math.abs(analytic);
}

const EA = 2.0e8; // E = 200 GPa, A = 1e-3 m²

describe('eng-truss FEM kernel', () => {
  it('two-bar tripod matches the method-of-joints solution (rel. err < 1e-9)', () => {
    // Nodes: A(0,0) pin, B(4,0) pin, C(2,3) loaded with P = 1000 N downward.
    // Members A–C and B–C, L = √13, sinθ = 3/√13.
    // Joint C, vertical equilibrium: 2·|N|·sinθ = P → |N| = P·√13/6 ≈ 600.925 N (compression).
    const model: TrussModel = {
      E: 2.0e11,
      A: 1.0e-3,
      nodes: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 }],
      elements: [{ a: 0, b: 2 }, { a: 1, b: 2 }],
      constraints: [
        { node: 0, dx: true, dy: true },
        { node: 1, dx: true, dy: true },
      ],
      loads: [{ node: 2, fx: 0, fy: -1000 }],
    };
    const r = solveTruss(model);
    const Nanalytic = -1000 * Math.sqrt(13) / 6;
    for (const el of r.elements) {
      expect(relErr(el.axialForce, Nanalytic)).toBeLessThan(1e-9);
      expect(relErr(el.stress, Nanalytic / 1.0e-3)).toBeLessThan(1e-9);
    }
    // Tip displacement: δ = P·L / (2·EA·sin²θ) = P·√13·13/(2·EA·9).
    const delta = (1000 * Math.sqrt(13)) / (2 * EA * (9 / 13));
    expect(relErr(-r.displacements[2]!.y, delta)).toBeLessThan(1e-9);
    // Symmetry: no horizontal tip motion.
    expect(Math.abs(r.displacements[2]!.x)).toBeLessThan(1e-12);
    // Reactions: R_Ay = R_By = 500 N, R_Ax = −R_Bx = +P/2·(2/3)·... = ±333.33 N.
    const rAy = r.reactions.find((x) => x.node === 0 && x.dof === 'y')!.force;
    const rBy = r.reactions.find((x) => x.node === 1 && x.dof === 'y')!.force;
    expect(relErr(rAy, 500)).toBeLessThan(1e-9);
    expect(relErr(rBy, 500)).toBeLessThan(1e-9);
    // Equilibrium self-check: ΣR + ΣF ≈ 0.
    expect(Math.abs(r.equilibriumResidual.fy)).toBeLessThan(1e-6);
    expect(Math.abs(r.equilibriumResidual.fx)).toBeLessThan(1e-6);
  });

  it('three-member indeterminate truss matches the compatibility solution and load symmetry', () => {
    // Nodes L(−1,0), M(0,0), R(1,0) pinned; top node T(0,1), P = 1000 N down.
    // Members L–T, M–T, R–T. Compatibility (u_Tx = 0 by symmetry):
    //   δ_LT = u_y/√2, L_LT = √2 → N_LT = EA·u_y/2 ; N_MT = EA·u_y.
    //   Equilibrium: 2·N_LT·(1/√2) + N_MT = P → u_y = P/(EA·(1 + 1/√2)).
    const model: TrussModel = {
      E: 2.0e11,
      A: 1.0e-3,
      nodes: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      elements: [{ a: 0, b: 3 }, { a: 1, b: 3 }, { a: 2, b: 3 }],
      constraints: [
        { node: 0, dx: true, dy: true },
        { node: 1, dx: true, dy: true },
        { node: 2, dx: true, dy: true },
      ],
      loads: [{ node: 3, fx: 0, fy: -1000 }],
    };
    const r = solveTruss(model);
    const uy = -1000 / (EA * (1 + 1 / Math.SQRT2));
    expect(relErr(-r.displacements[3]!.y, -uy)).toBeLessThan(1e-9);
    expect(Math.abs(r.displacements[3]!.x)).toBeLessThan(1e-12);
    const nOuter = (EA * uy) / 2;
    const nMid = EA * uy;
    expect(relErr(r.elements[0]!.axialForce, nOuter)).toBeLessThan(1e-9);
    expect(relErr(r.elements[2]!.axialForce, nOuter)).toBeLessThan(1e-9);
    expect(relErr(r.elements[1]!.axialForce, nMid)).toBeLessThan(1e-9);
    // Symmetric structure + symmetric load → symmetric member forces.
    expect(relErr(r.elements[0]!.axialForce, r.elements[2]!.axialForce)).toBeLessThan(1e-12);
    // Global equilibrium.
    expect(Math.abs(r.equilibriumResidual.fy)).toBeLessThan(1e-6);
  });

  it('cantilever truss tip deflection is a plausible multiple of the beam-theory value', () => {
    // Order-of-magnitude screen (NOT an exact check): a truss is shear- and
    // axially more flexible than the Euler–Bernoulli beam built from its
    // chords, but must stay within a factor of a few of δ = PL³/(3EI),
    // I ≈ 2·A·(h/2)² for two chord areas A spaced by h.
    const model: TrussModel = {
      E: 2.0e11,
      A: 1.0e-3,
      nodes: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
      ],
      elements: [
        { a: 0, b: 2 },
        { a: 2, b: 4 }, // bottom chord
        { a: 1, b: 3 },
        { a: 3, b: 5 }, // top chord
        { a: 2, b: 3 },
        { a: 4, b: 5 }, // verticals
        { a: 0, b: 3 },
        { a: 2, b: 5 }, // diagonals
      ],
      constraints: [
        { node: 0, dx: true, dy: true },
        { node: 1, dx: true, dy: true },
      ],
      loads: [{ node: 5, fx: 0, fy: -1000 }],
    };
    const r = solveTruss(model);
    const L = 2;
    const h = 1;
    const Ieq = 2 * 1.0e-3 * (h / 2) * (h / 2);
    const deltaBeam = (1000 * L * L * L) / (3 * 2.0e11 * Ieq); // ≈ 2.67e-5 m
    const tipDeflection = -r.displacements[5]!.y;
    expect(tipDeflection).toBeGreaterThan(0); // deflects downward
    const ratio = tipDeflection / deltaBeam;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(30);
    // Equilibrium self-check.
    expect(Math.abs(r.equilibriumResidual.fy)).toBeLessThan(1e-6);
  });

  it('bundled sample bridge (eng-truss-bridge.json) solves in equilibrium', () => {
    const text = readFileSync(
      new URL('../examples/data/eng-truss-bridge.json', import.meta.url),
      'utf8',
    );
    const model = parseTrussModel(text);
    const r = solveTruss(model);
    // Simply supported: two vertical reactions must carry the 50 kN load.
    const r0y = r.reactions.find((x) => x.node === 0 && x.dof === 'y')!.force;
    const r2y = r.reactions.find((x) => x.node === 2 && x.dof === 'y')!.force;
    expect(relErr(r0y + r2y, 50000)).toBeLessThan(1e-9);
    // Symmetric span + centred load → equal reactions.
    expect(relErr(r0y, r2y)).toBeLessThan(1e-9);
    expect(Math.abs(r.equilibriumResidual.fy)).toBeLessThan(1e-6);
    // Top chord in compression, bottom chord in tension for a gravity load.
    expect(r.elements[2]!.axialForce).toBeLessThan(0);
    expect(r.elements[0]!.axialForce).toBeGreaterThan(0);
    expect(r.elements[1]!.axialForce).toBeGreaterThan(0);
  });

  it('rejects mechanisms (singular stiffness) and malformed models', () => {
    // Two nodes joined by one member with only one fixed DOF → rigid-body
    // rotation remains → singular condensed matrix.
    const mechanism: TrussModel = {
      E: 2.0e11,
      A: 1.0e-3,
      nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      elements: [{ a: 0, b: 1 }],
      constraints: [{ node: 0, dy: true }],
      loads: [{ node: 1, fy: -100 }],
    };
    expect(() => solveTruss(mechanism)).toThrow(/singular|mechanism/i);
    expect(() => solveTruss({ ...mechanism, constraints: [] })).toThrow(/constraint/i);
    expect(() =>
      parseTrussModel('{"E":2e11,"A":1e-3,"nodes":[{"x":0,"y":0}],"elements":[{"a":0,"b":1}],"constraints":[]}'),
    ).toThrow(/at least two/);
    expect(() =>
      parseTrussModel('{"E":2e11,"A":1e-3,"nodes":[{"x":0,"y":0},{"x":1,"y":0}],"elements":[{"a":0,"b":5}],"constraints":[]}'),
    ).toThrow(/out of range/);
    expect(() => parseTrussModel('{broken')).toThrow(/JSON/);
  });

  it('solve is deterministic for repeated runs on the same model', () => {
    const model: TrussModel = {
      E: 2.0e11,
      A: 1.0e-3,
      nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
      elements: [{ a: 0, b: 2 }, { a: 1, b: 2 }, { a: 0, b: 1 }],
      constraints: [{ node: 0, dx: true, dy: true }, { node: 1, dy: true }],
      loads: [{ node: 2, fx: 300, fy: -400 }],
    };
    expect(solveTruss(model)).toEqual(solveTruss(model));
  });
});
