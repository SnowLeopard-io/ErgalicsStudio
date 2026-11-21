import { describe, expect, it } from 'vitest';
import {
  makeStudy,
  meshBounds,
  meshSummary,
  toPlanarMesh,
  validateMesh,
  type EngineeringMesh,
} from '@/core/engineering';

function triangleMesh(): EngineeringMesh {
  return {
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 },
      { id: 2, x: 1, y: 0, z: 0 },
      { id: 3, x: 0, y: 1, z: 0 },
    ],
    elements: [{ id: 1, type: 'tri3', nodes: [0, 1, 2] }],
    groups: [
      { dimension: 0, tag: 1, name: 'pinned', members: [0] },
      { dimension: 1, tag: 2, name: 'left', members: [0] },
    ],
    bounds: [0, 0, 0, 0, 0, 0],
  };
}

describe('engineering domain model', () => {
  it('computes bounds and fills them into a study', () => {
    const mesh = triangleMesh();
    expect(meshBounds(mesh.nodes)).toEqual([0, 0, 0, 1, 1, 0]);
    const study = makeStudy('t', 'gmsh', mesh);
    expect(study.mesh.bounds).toEqual([0, 0, 0, 1, 1, 0]);
    expect(study.schema).toBe('ergalics.engineering/v1');
  });

  it('validates element arity, index range and duplicate ids', () => {
    expect(validateMesh(triangleMesh())).toEqual([]);
    const broken = triangleMesh();
    broken.elements[0]!.nodes = [0, 1, 99];
    expect(validateMesh(broken).some((issue) => issue.severity === 'error')).toBe(true);
    const duplicate = triangleMesh();
    duplicate.nodes.push({ ...duplicate.nodes[0]! });
    expect(validateMesh(duplicate).some((issue) => issue.message.includes('duplicate node'))).toBe(true);
  });

  it('bridges 2D triangles and quads to the FEM core', () => {
    const planar = toPlanarMesh(triangleMesh())!;
    expect(planar.nodes).toEqual(Float64Array.from([0, 0, 1, 0, 0, 1]));
    expect(planar.elements).toHaveLength(1);
    expect(planar.boundaryEdges).toHaveLength(3);
    expect(planar.nodeTags[0]).toBe(1);
    expect(planar.boundaryEdges.some((edge) => edge.tag === 2)).toBe(true);

    const quad = triangleMesh();
    quad.elements = [{ id: 1, type: 'quad4', nodes: [0, 1, 2, 0] }];
    // Reuse a real quad by adding a fourth node.
    quad.nodes.push({ id: 4, x: 1, y: 1, z: 0 });
    quad.elements[0]!.nodes = [0, 1, 3, 2];
    expect(toPlanarMesh(quad)!.elements).toHaveLength(2);
  });

  it('rejects 3D meshes and reports a compact summary', () => {
    const mesh = triangleMesh();
    mesh.nodes[0]!.z = 1;
    expect(toPlanarMesh(mesh)).toBeNull();
    expect(meshSummary(triangleMesh())).toContain('tri3:1');
  });
});
