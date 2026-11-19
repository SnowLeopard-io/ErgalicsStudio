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

const ANSYS = `\
/PREP7
ET,1,SOLID45
MP,EX,1,2.1e11
MP,PRXY,1,0.3
N,1,0,0,0
N,2,1,0,0
N,3,0,1,0
E,1,2,3
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

  it('parses Ansys N/E/MP/D/F commands', () => {
    expect(detectEngineeringFormat('x.unknown', ANSYS)).toBe('ansys');
    const study = parseAnsys(ANSYS, 'model.cdb');
    expect(study.sourceFormat).toBe('ansys');
    expect(study.mesh.nodes).toHaveLength(3);
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
