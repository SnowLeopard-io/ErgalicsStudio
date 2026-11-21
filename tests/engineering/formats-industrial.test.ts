import { describe, expect, it } from 'vitest';
import {
  detectEngineeringFormat,
  parseEngineeringFile,
  isEngineeringExtension,
  ENGINEERING_EXTENSIONS,
} from '@/core/engineering';
import { parseNastran } from '@/core/engineering/formats/nastran';
import { parseAnsys } from '@/core/engineering/formats/ansys';
import { parseOpenfoam } from '@/core/engineering/formats/openfoam';

const NASTRAN = `\
CEND
TITLE = plate
BEGIN BULK
GRID,1,,0.,0.,0.
GRID,2,,1.,0.,0.
GRID,3,,0.,1.,0.
CTRIA3,1,1,1,2,3
MAT1,1,2.1e11,0.3,7.8e3
SPC1,1,12,1
FORCE,1,3,,100.,0.,-1.,0.
ENDDATA
`;

/** Build a fixed-field line (8 columns per field). */
const fixed = (...values: string[]): string =>
  values.map((value) => value.padStart(8, ' ')).join('');

/** Build a fixed-field continuation line ('+' in column 1). */
const continuation = (...values: string[]): string =>
  `+${' '.repeat(7)}${values.map((value) => value.padStart(8, ' ')).join('')}`;

const NASTRAN_FIXED = [
  'BEGIN BULK',
  fixed('GRID', '1', '', '0.', '0.', '0.'),
  fixed('GRID', '2', '', '1.', '0.', '0.'),
  fixed('GRID', '3', '', '0.', '1.', '0.'),
  fixed('GRID', '4', '', '1.', '1.', '0.'),
  fixed('GRID', '5', '', '2.', '1.', '0.'),
  fixed('GRID', '6', '', '2.', '2.', '0.'),
  fixed('GRID', '7', '', '1.', '2.', '0.'),
  fixed('GRID', '8', '', '0.', '2.', '0.'),
  // Blank CP and PID must not shift the following columns.
  fixed('CQUAD8', '1', '', '1', '2', '3', '4'),
  continuation('', '5', '6', '7', '8'),
  // G (field 4) is blank; NU is still field 5.
  fixed('MAT1', '2', '2.1E11', '', '0.3', '7.8E3'),
  fixed('SPC1', '1', '12', '1', '2'),
  fixed('FORCE', '1', '3', '', '100.', '0.', '-1.', '0.'),
  'ENDDATA',
].join('\n');

const NASTRAN_HIGH_ORDER = [
  'BEGIN BULK',
  ...Array.from({ length: 10 }, (_, i) => `GRID,${i + 1},,${i},0.,0.`),
  'CTETRA,1,1,1,2,3,4',
  '+,5,6,7,8,9,10',
  '*CQUAD4,2,1,1,2,3,4',
  'ENDDATA',
].join('\n');

const ANSYS = `\
/PREP7
ET,1,SOLID45
MP,EX,1,2.1e11
MP,PRXY,1,0.3
N,1,0,0,0
N,2,1,0,0
N,3,1,1,0
N,4,0,1,0
N,5,0,0,1
N,6,1,0,1
N,7,1,1,1
N,8,0,1,1
E,1,2,3,4,5,6,7,8
D,1,UX,0
F,3,FY,-100
`;

const FOAM = `\
FoamFile { version 2.0; class vectorList; object points; }
4
(
(0 0 0)
(1 0 0)
(0 1 0)
(0 0 1)
)
FoamFile { version 2.0; class labelList; object faces; }
2
(
4(0 1 2 0)
4(0 2 3 0)
)
FoamFile { class labelList; object owner; }
2
(
0
1
)
`;

describe('industrial CAE format adapters', () => {
  it('registers every supported extension', () => {
    for (const ext of ['.bdf', '.dat', '.cdb', '.foam', '.msh', '.inp', '.step']) {
      expect(isEngineeringExtension(`model${ext}`)).toBe(true);
    }
    expect(ENGINEERING_EXTENSIONS.length).toBeGreaterThanOrEqual(13);
  });

  it('parses Nastran GRID/elements/SPC/loads', () => {
    expect(detectEngineeringFormat('x.unknown', NASTRAN)).toBe('nastran');
    const study = parseNastran(NASTRAN, 'plate.bdf');
    expect(study.sourceFormat).toBe('nastran');
    expect(study.mesh.nodes).toHaveLength(3);
    expect(study.mesh.elements[0]?.type).toBe('tri3');
    expect(study.materials[0]?.properties.E).toBeCloseTo(2.1e11);
    expect(study.boundaryConditions.some((bc) => bc.kind === 'displacement')).toBe(true);
    expect(study.boundaryConditions.some((bc) => bc.kind === 'force')).toBe(true);
  });

  it('parses Nastran fixed-field columns, continuations and loads', () => {
    const study = parseNastran(NASTRAN_FIXED, 'fixed.bdf');
    expect(study.mesh.nodes[2]).toMatchObject({ id: 3, x: 0, y: 1, z: 0 });
    expect(study.mesh.elements[0]?.type).toBe('quad8');
    expect(study.mesh.elements[0]?.nodes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(study.materials[0]?.properties.nu).toBeCloseTo(0.3);
    const spc = study.boundaryConditions.find((bc) => bc.kind === 'displacement');
    expect(spc?.components).toEqual({ 0: 0, 1: 0 });
    const force = study.boundaryConditions.find((bc) => bc.kind === 'force');
    expect(force?.components[1]).toBeCloseTo(-100);
  });

  it('parses Nastran high-order, large-field cards and rejects local CS', () => {
    const study = parseNastran(NASTRAN_HIGH_ORDER, 'solid.bdf');
    expect(study.mesh.elements[0]?.type).toBe('tet10');
    expect(study.mesh.elements[0]?.nodes).toHaveLength(10);
    expect(study.mesh.elements[1]?.type).toBe('quad4');

    expect(() => parseNastran('GRID,1,5,0.,0.,0.\nGRID,2,,1.,0.,0.')).toThrow(/CP=5/);

    const wedge15 = [
      'BEGIN BULK',
      ...Array.from({ length: 15 }, (_, i) => `GRID,${i + 1},,${i},0.,0.`),
      'CPENTA,1,1,1,2,3,4,5,6',
      '+,7,8,9,10,11,12,13,14,15',
      'ENDDATA',
    ].join('\n');
    expect(() => parseNastran(wedge15)).toThrow(/wedge15/);
  });

  it('parses Ansys N/E/MP/D/F commands', () => {
    expect(detectEngineeringFormat('x.unknown', ANSYS)).toBe('ansys');
    const study = parseAnsys(ANSYS, 'model.cdb');
    expect(study.sourceFormat).toBe('ansys');
    expect(study.mesh.nodes).toHaveLength(8);
    expect(study.mesh.elements[0]?.type).toBe('hex8'); // SOLID45
    expect(study.materials[0]?.properties.E).toBeCloseTo(2.1e11);
    expect(study.boundaryConditions.some((bc) => bc.kind === 'force')).toBe(true);
  });

  it('parses OpenFOAM polyMesh points/faces/owner', () => {
    expect(detectEngineeringFormat('x.unknown', FOAM)).toBe('openfoam');
    const study = parseOpenfoam(FOAM, 'case.foam');
    expect(study.sourceFormat).toBe('openfoam');
    expect(study.mesh.nodes.length).toBeGreaterThan(0);
    expect(study.metadata.pointCount).toBe('4');
  });

  it('dispatches all formats through the unified entry point', () => {
    expect(parseEngineeringFile(NASTRAN, 'plate.bdf').sourceFormat).toBe('nastran');
    expect(parseEngineeringFile(ANSYS, 'model.cdb').sourceFormat).toBe('ansys');
    expect(parseEngineeringFile(FOAM, 'case.foam').sourceFormat).toBe('openfoam');
  });
});
