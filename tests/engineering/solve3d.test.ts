import { describe, expect, it } from 'vitest';
import { assembleTetHeat, solve3DSteadyHeat, tetVolume } from '@/core/engineering/solve3d';
import { makeStudy, type EngineeringMesh } from '@/core/engineering';

const TET: EngineeringMesh = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 1, y: 0, z: 0 },
    { id: 3, x: 0, y: 1, z: 0 },
    { id: 4, x: 0, y: 0, z: 1 },
  ],
  elements: [{ id: 1, type: 'tet4', nodes: [0, 1, 2, 3] }],
  groups: [
    { dimension: 0, tag: 1, name: 'cold', members: [0, 1, 2] },
  ],
  bounds: [0, 0, 0, 1, 1, 1],
};

describe('3-D tetrahedral steady heat solver', () => {
  it('computes the tetrahedron volume', () => {
    expect(tetVolume(TET, 0)).toBeCloseTo(1 / 6);
  });

  it('assembles a 4x4 symmetric stiffness matrix', () => {
    const { K, f } = assembleTetHeat(TET, 1, 0);
    expect(K.n).toBe(4);
    expect(f.length).toBe(4);
    // Row sums of the stiffness matrix are ~0 (constant field is in kernel).
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let p = K.indptr[row]!; p < K.indptr[row + 1]!; p += 1) sum += K.data[p]!;
      expect(Math.abs(sum)).toBeLessThan(1e-9);
    }
  });

  it('solves a prescribed-temperature field with zero source', () => {
    const study = makeStudy('tet', 'gmsh', TET, {
      materials: [{ name: 'k', properties: { k: 1 } }],
      boundaryConditions: [{
        name: 'cold', kind: 'temperature',
        target: { dimension: 0, tag: 1 }, components: { 0: 100 },
      }],
    });
    const solution = solve3DSteadyHeat(study, { source: 0 });
    expect(solution.field.values[0]).toBeCloseTo(100);
    expect(solution.field.values[1]).toBeCloseTo(100);
    expect(solution.field.values[2]).toBeCloseTo(100);
    // With all four nodes effectively governed and no source, the free node
    // stays bounded between the prescribed values (maximum principle).
    expect(solution.field.values[3]).toBeGreaterThanOrEqual(99);
    expect(solution.field.values[3]).toBeLessThanOrEqual(101);
  });

  it('rejects a mesh without tet4 elements', () => {
    const flat = { ...TET, elements: [{ id: 1, type: 'tri3' as const, nodes: [0, 1, 2] }] };
    expect(() => solve3DSteadyHeat(makeStudy('x', 'gmsh', flat))).toThrow(/tet4/);
  });
});
