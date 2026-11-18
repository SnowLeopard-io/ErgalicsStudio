import { describe, expect, it } from 'vitest';
import { parseGmsh, GmshParseError } from '@/core/engineering/formats/gmsh';
import { toPlanarMesh } from '@/core/engineering';

const V2 = `\
$MeshFormat
2.2 0 8
$EndMeshFormat
$PhysicalNames
2
1 1 "left"
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
1 2 1 2 1 2 3
2 2 2 3 1 3
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

describe('Gmsh adapter', () => {
  it('parses ASCII v2 nodes, elements and physical groups', () => {
    const study = parseGmsh(V2, 'plane.msh');
    expect(study.sourceFormat).toBe('gmsh');
    expect(study.mesh.nodes).toHaveLength(3);
    expect(study.mesh.elements).toHaveLength(2);
    expect(study.mesh.elements[0]?.type).toBe('tri3');
    expect(study.mesh.elements[1]?.type).toBe('line2');
    expect(study.mesh.groups.map((g) => g.name)).toEqual(['left', 'right']);
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

  it('rejects binary files and missing sections', () => {
    const binary = V2.replace('2.2 0 8', '2.2 1 8');
    expect(() => parseGmsh(binary)).toThrow(GmshParseError);
    expect(() => parseGmsh('no mesh here')).toThrow(/MeshFormat/);
  });
});
