import { describe, expect, it } from 'vitest';
import { marchingTets } from '@/core/mesh3d';
import { sampleTetField } from '@/core/engineering/volume';
import { solve3DSteadyHeat } from '@/core/engineering/solve3d';
import { makeStudy, type EngineeringMesh } from '@/core/engineering';

const PRISM: EngineeringMesh = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1, y: 0, z: 0 },
    { id: 3, x: 0, y: 1, z: 0 }, { id: 4, x: 0, y: 0, z: 1 },
    { id: 5, x: 1, y: 0, z: 1 }, { id: 6, x: 0, y: 1, z: 1 },
  ],
  elements: [
    { id: 1, type: 'tet4', nodes: [0, 1, 2, 4] },
    { id: 2, type: 'tet4', nodes: [0, 2, 3, 4] },
    { id: 3, type: 'tet4', nodes: [2, 3, 4, 5] },
  ],
  groups: [
    { dimension: 0, tag: 1, name: 'bottom', members: [0, 1, 2] },
    { dimension: 0, tag: 2, name: 'top', members: [3, 4, 5] },
  ],
  bounds: [0, 0, 0, 1, 1, 1],
};

describe('3-D volume sampling / isosurface', () => {
  it('samples a nodal field onto a regular voxel grid', () => {
    const study = makeStudy('prism', 'gmsh', PRISM, {
      materials: [{ name: 'k', properties: { k: 1 } }],
      boundaryConditions: [
        { name: 'hot', kind: 'temperature', target: { dimension: 0, tag: 1 }, components: { 0: 1 } },
        { name: 'cold', kind: 'temperature', target: { dimension: 0, tag: 2 }, components: { 0: 0 } },
      ],
    });
    const solved = solve3DSteadyHeat(study, { source: 0 });
    const voxel = sampleTetField(PRISM, solved.field, { resolution: 24 });
    expect(voxel.nx).toBeGreaterThan(2);
    expect(voxel.values.length).toBe(voxel.nx * voxel.ny * voxel.nz);
    const inside = Array.from(voxel.values).filter((v) => Number.isFinite(v));
    expect(inside.length).toBeGreaterThan(0);
    // The solved field spans values between the two prescribed temperatures.
    expect(Math.max(...inside)).toBeLessThanOrEqual(1.0001);
    expect(Math.min(...inside)).toBeGreaterThanOrEqual(-0.0001);
  });

  it('feeds marchingTets to produce a non-empty isosurface', () => {
    const field = {
      name: 'linear', location: 'node' as const, components: 1,
      values: Float64Array.from(PRISM.nodes.map((n) => n.z)), // T = z
    };
    const voxel = sampleTetField(PRISM, field, { resolution: 24 });
    const surface = marchingTets(voxel, 0.5);
    expect(surface.positions.length).toBeGreaterThan(0);
    expect(surface.positions.length % 9).toBe(0); // non-indexed triangles
  });
});
