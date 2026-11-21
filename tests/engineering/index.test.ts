import { describe, expect, it } from 'vitest';
import {
  detectEngineeringFormat,
  EngineeringParseError,
  isEngineeringExtension,
  parseEngineeringFile,
} from '@/core/engineering';

const MSH = `\
$MeshFormat
2.2 0 8
$EndMeshFormat
$Nodes
1
1 0 0 0
$EndNodes
$Elements
0
$EndElements
`;

describe('engineering file entry point', () => {
  it('detects formats by extension and by content', () => {
    expect(isEngineeringExtension('a.msh')).toBe(true);
    expect(isEngineeringExtension('a.csv')).toBe(false);
    expect(detectEngineeringFormat('a.msh')).toBe('gmsh');
    expect(detectEngineeringFormat('unknown.unknown', MSH)).toBe('gmsh');
    expect(detectEngineeringFormat('unknown.unknown', '*NODE\n1,0,0')).toBe('abaqus');
    expect(detectEngineeringFormat('a.txt')).toBeNull();
  });

  it('dispatches to the matching adapter and wraps errors', () => {
    const study = parseEngineeringFile(MSH, 'a.msh');
    expect(study.mesh.nodes).toHaveLength(1);
    expect(() => parseEngineeringFile('not a mesh', 'a.msh')).toThrow(EngineeringParseError);
    expect(() => parseEngineeringFile('x', 'a.csv')).toThrow(/unsupported engineering file/);
  });
});
