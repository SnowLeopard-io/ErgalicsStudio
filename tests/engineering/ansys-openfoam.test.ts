import { describe, expect, it } from 'vitest';
import {
  detectEngineeringFormat,
  parseEngineeringFile,
} from '@/core/engineering';
import { parseAnsys } from '@/core/engineering/formats/ansys';
import { parseOpenfoam } from '@/core/engineering/formats/openfoam';

const ANSYS_BLOCK = [
  '/PREP7',
  'NBLOCK,6,SOLID, 8, 1',
  '(3i10,3e16.9)',
  '1,0,0,0',
  '2,1,0,0',
  '3,1,1,0',
  '4,0,1,0',
  '5,0,0,1',
  '6,1,0,1',
  '7,1,1,1',
  '8,0,1,1',
  '-1',
  'EBLOCK,19,SOLID,186, 1',
  '(1i9,3i10)',
  '1,1,2,3,4,5,6,7,8, 1,2,3,4,5,6,7,8, 1,2,3,4',
  '-1',
].join('\n');

const OPENFOAM_MESH = `\
FoamFile { version 2.0; class vectorList; object points; }
4
(
(0 0 0)
(1 0 0)
(1 0 0)
(0 1 0)
)
FoamFile { version 2.0; class labelList; object faces; }
2
(
4(0 1 2 3)
4(0 1 2 3)
)
FoamFile { version 2.0; class labelList; object owner; }
2
(
0
1
)
`;

const SCALAR_FIELD = `\
// written by a solver
FoamFile { version 2.0; format ascii; class volScalarField; object p; }
dimensions [0 2 -2 0 0 0 0];
internalField nonuniform List<scalar>
2
(
/* first cell */ 10
20 // second cell
)
;
${OPENFOAM_MESH}`;

const VECTOR_FIELD = `\
FoamFile { version 2.0; format ascii; class volVectorField; object U; }
dimensions [0 1 -1 0 0 0 0];
internalField nonuniform List<vector>
2
(
(1 0 0)
(0 2 0)
)
boundaryField { inlet { type fixedValue; value uniform (9 9 9); } }
${OPENFOAM_MESH}`;

describe('Ansys block format', () => {
  it('parses NBLOCK nodes and EBLOCK elements (SOLID186)', () => {
    expect(detectEngineeringFormat('model.cdb', ANSYS_BLOCK)).toBe('ansys');
    const study = parseAnsys(ANSYS_BLOCK, 'model.cdb');
    expect(study.mesh.nodes).toHaveLength(8);
    expect(study.mesh.nodes[1]).toMatchObject({ id: 2, x: 1, y: 0, z: 0 });
    expect(study.mesh.elements).toHaveLength(1);
    expect(study.mesh.elements[0]?.type).toBe('hex20');
    expect(study.mesh.elements[0]?.nodes).toHaveLength(20);
  });

  it('infers element topology when EBLOCK declares neither type nor ET', () => {
    const study = parseAnsys([
      'NBLOCK,3,1',
      '1,0,0,0',
      '2,1,0,0',
      '3,1,1,0',
      '4,0,1,0',
      '-1',
      'EBLOCK,19',
      '1,1,2,3,4',
      '-1',
    ].join('\n'));
    expect(study.mesh.elements[0]?.type).toBe('tet4');
    expect(study.mesh.elements[0]?.nodes).toEqual([0, 1, 2, 3]);
  });
});

describe('Ansys ET type resolution', () => {
  const eightNodes = ['N,1,0,0,0', 'N,2,1,0,0', 'N,3,1,1,0', 'N,4,0,1,0',
    'N,5,0,0,1', 'N,6,1,0,1', 'N,7,1,1,1', 'N,8,0,1,1'].join('\n');

  it('maps the TYPE value, not the user slot number', () => {
    const study = parseAnsys(`ET,1,45\n${eightNodes}\nE,1,2,3,4,5,6,7,8`);
    expect(study.mesh.elements[0]?.type).toBe('hex8');
  });

  it('uses node count to correct a mismatched declared type', () => {
    const study = parseAnsys('ET,1,SOLID186\nN,1,0,0,0\nN,2,1,0,0\nN,3,1,1,0\nN,4,0,1,0\nE,1,2,3,4');
    expect(study.mesh.elements[0]?.type).toBe('tet4');
    expect(study.mesh.elements[0]?.nodes).toHaveLength(4);
  });

  it('accumulates continuation lines for 20-node elements', () => {
    const nodeLines = Array.from({ length: 20 }, (_, i) => `N,${i + 1},${i},0,0`);
    const study = parseAnsys([
      'ET,1,186',
      ...nodeLines,
      'E,1,2,3,4,5,6,7,8,9,10',
      '11,12,13,14,15,16,17,18,19,20',
    ].join('\n'));
    expect(study.mesh.elements).toHaveLength(1);
    expect(study.mesh.elements[0]?.type).toBe('hex20');
    expect(study.mesh.elements[0]?.nodes).toHaveLength(20);
  });
});

describe('OpenFOAM list and field parsing', () => {
  it('reads scalar values from inside the list, skipping the leading count', () => {
    const study = parseOpenfoam(SCALAR_FIELD, 'p');
    const field = study.fields.find((f) => f.components === 1);
    expect(field).toBeDefined();
    expect(Array.from(field!.values)).toEqual([10, 20]);
  });

  it('locates the U list without matching "uniform"', () => {
    const study = parseOpenfoam(VECTOR_FIELD, 'U');
    const field = study.fields.find((f) => f.name === 'U');
    expect(field).toBeDefined();
    expect(Array.from(field!.values)).toEqual([1, 0, 0, 0, 2, 0]);
  });

  it('rejects binary cases with an explicit message', () => {
    expect(() => parseOpenfoam(
      'FoamFile { version 2.0; format binary; class vectorList; object points; }',
    )).toThrow(/binary/i);
  });
});

describe('engineering format routing', () => {
  const ANSYS_DAT = 'ET,1,45\nN,1,0,0,0\nN,2,1,0,0\n';
  const NASTRAN_DAT = 'BEGIN BULK\nGRID,1,,0.,0.,0.\n';

  it('sniffs .dat between Ansys and Nastran', () => {
    expect(detectEngineeringFormat('model.dat', ANSYS_DAT)).toBe('ansys');
    expect(detectEngineeringFormat('model.dat', NASTRAN_DAT)).toBe('nastran');
    expect(detectEngineeringFormat('model.dat', '')).toBe('nastran');
    expect(detectEngineeringFormat('model.dat', 'NBLOCK,6,SOLID\n')).toBe('ansys');
  });

  it('reports binary .db and marker-only .foam clearly', () => {
    expect(() => parseEngineeringFile('dummy', 'model.db')).toThrow(/binary|\.db/i);
    expect(() => parseEngineeringFile('', 'case.foam')).toThrow(/polyMesh/);
  });
});
