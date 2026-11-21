import { describe, expect, it } from 'vitest';
import { parseGmsh, GmshParseError } from '@/core/engineering/formats/gmsh';
import { toPlanarMesh } from '@/core/engineering';

const V2 = `\
$MeshFormat
2.2 0 8
$EndMeshFormat
$PhysicalNames
2
2 1 "left"
1 2 "right"
$EndPhysicalNames
$Nodes
3
1 0 0 0
2 1 0 0
3 0 1 0
$EndNodes
$Elements
2
1 2 1 1 1 2 3
2 1 1 2 1 2
$EndElements
`;

const V4 = `\
$MeshFormat
4.1 0 8
$EndMeshFormat
$PhysicalNames
1
2 1 "domain"
$EndPhysicalNames
$Nodes
1 3 1 3
2 1 0 3
1
2
3
0 0 0
1 0 0
0 1 0
$EndNodes
$Elements
1 1 1 1
2 1 2 1
1 1 2 3
$EndElements
`;

const V4_HEX20 = [
  '$MeshFormat', '4.1 0 8', '$EndMeshFormat',
  '$Nodes', '1 20 1 20', '2 1 0 20',
  ...Array.from({ length: 20 }, (_, i) => String(i + 1)),
  ...Array.from({ length: 20 }, (_, i) => `${i + 1} 0 0`),
  '$EndNodes',
  '$Elements', '1 1 1 1', '3 1 17 1',
  `1 ${Array.from({ length: 20 }, (_, i) => i + 1).join(' ')}`,
  '$EndElements',
].join('\n');

// 同一物理 tag 同时用于维度 1（线）与维度 2（面）。
const V2_DIM_COLLISION = `\
$MeshFormat
2.2 0 8
$EndMeshFormat
$PhysicalNames
2
1 5 "edge"
2 5 "face"
$EndPhysicalNames
$Nodes
3
1 0 0 0
2 1 0 0
3 0 1 0
$EndNodes
$Elements
2
1 2 2 5 1 1 2 3
2 1 2 5 1 1 2
$EndElements
`;

describe('Gmsh adapter', () => {
  it('parses ASCII v2 nodes, elements and physical groups', () => {
    const study = parseGmsh(V2, 'plane.msh');
    expect(study.sourceFormat).toBe('gmsh');
    expect(study.mesh.nodes).toHaveLength(3);
    expect(study.mesh.elements).toHaveLength(2);
    expect(study.mesh.elements[0]?.type).toBe('tri3');
    expect(study.mesh.elements[0]?.nodes).toEqual([0, 1, 2]);
    expect(study.mesh.elements[1]?.type).toBe('line2');
    expect(study.mesh.elements[1]?.nodes).toEqual([0, 1]);
    expect(study.mesh.groups.map((g) => g.name)).toEqual(['left', 'right']);
    expect(study.mesh.groups[0]?.members).toEqual([0]);
    expect(study.mesh.groups[1]?.members).toEqual([1]);
    expect(toPlanarMesh(study.mesh)!.elements).toHaveLength(1);
  });

  it('parses ASCII v4 block layout', () => {
    const study = parseGmsh(V4, 'v4.msh');
    expect(study.mesh.nodes).toHaveLength(3);
    expect(study.mesh.elements[0]?.type).toBe('tri3');
    expect(study.mesh.groups[0]?.name).toBe('domain');
    expect(study.metadata.formatVersion).toBe('4.1');
  });

  it('maps Gmsh type 17 to hex20', () => {
    const study = parseGmsh(V4_HEX20, 'hex20.msh');
    expect(study.mesh.elements[0]?.type).toBe('hex20');
    expect(study.mesh.elements[0]?.nodes).toHaveLength(20);
  });

  it('rejects unsupported high-order types instead of mislabelling them', () => {
    // 13 = 18 节点二阶棱柱，12 = 27 节点二阶六面体。
    expect(() => parseGmsh(V4_HEX20.replace('3 1 17 1', '3 1 13 1')))
      .toThrow(/18 节点二阶棱柱.*Gmsh 类型 13/);
    expect(() => parseGmsh(V4_HEX20.replace('3 1 17 1', '3 1 12 1')))
      .toThrow(/27 节点二阶六面体.*Gmsh 类型 12/);
  });

  it('rejects MSH 4.0 layouts explicitly', () => {
    expect(() => parseGmsh(V4.replace('4.1 0 8', '4.0 0 8'))).toThrow(/MSH 4\.0/);
  });

  it('rejects malformed version headers instead of treating NaN as 4.1', () => {
    expect(() => parseGmsh(V4.replace('4.1 0 8', '4.1.0 0 8'))).toThrow(/unsupported Gmsh version/);
    expect(() => parseGmsh(V4.replace('4.1 0 8', '4.01.0 0 8'))).toThrow(/unsupported Gmsh version/);
  });

  it('keeps physical groups apart when tags collide across dimensions', () => {
    const study = parseGmsh(V2_DIM_COLLISION, 'collision.msh');
    const edge = study.mesh.groups.find((g) => g.name === 'edge');
    const face = study.mesh.groups.find((g) => g.name === 'face');
    // The tags must not leak into the node list: both elements keep their
    // real topology and node ids, and each group points at its own element.
    expect(study.mesh.elements[0]?.type).toBe('tri3');
    expect(study.mesh.elements[0]?.nodes).toEqual([0, 1, 2]);
    expect(study.mesh.elements[1]?.type).toBe('line2');
    expect(study.mesh.elements[1]?.nodes).toEqual([0, 1]);
    expect(edge?.dimension).toBe(1);
    expect(edge?.members).toEqual([1]);
    expect(face?.dimension).toBe(2);
    expect(face?.members).toEqual([0]);
  });

  it('rejects binary files and missing sections', () => {
    const binary = V2.replace('2.2 0 8', '2.2 1 8');
    expect(() => parseGmsh(binary)).toThrow(GmshParseError);
    expect(() => parseGmsh('no mesh here')).toThrow(/MeshFormat/);
  });
});
