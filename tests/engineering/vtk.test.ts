import { describe, expect, it } from 'vitest';
import { parseVtk } from '@/core/engineering/formats/vtk';

const LEGACY = `\
# vtk DataFile Version 3.0
Triangle
ASCII
DATASET UNSTRUCTURED_GRID
POINTS 3 float
0 0 0 1 0 0 0 1 0
CELLS 1 4
3 0 1 2
CELL_TYPES 1
5
POINT_DATA 3
SCALARS temperature float 1
LOOKUP_TABLE default
300 310 320
`;

const VTU = `\
<?xml version="1.0"?>
<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">
<UnstructuredGrid><Piece NumberOfPoints="3" NumberOfCells="1">
<Points><DataArray type="Float64" NumberOfComponents="3" format="ascii">
0 0 0 1 0 0 0 1 0
</DataArray></Points>
<Cells>
<DataArray type="Int32" Name="connectivity" format="ascii">0 1 2</DataArray>
<DataArray type="Int32" Name="offsets" format="ascii">3</DataArray>
<DataArray type="UInt8" Name="types" format="ascii">5</DataArray>
</Cells>
<PointData><DataArray type="Float64" Name="u" NumberOfComponents="1" format="ascii">1 2 3</DataArray></PointData>
</Piece></UnstructuredGrid></VTKFile>
`;

describe('VTK adapter', () => {
  it('parses legacy ASCII unstructured grids and point data', () => {
    const study = parseVtk(LEGACY, 'triangle.vtk');
    expect(study.sourceFormat).toBe('vtk');
    expect(study.mesh.nodes).toHaveLength(3);
    expect(study.mesh.elements[0]?.type).toBe('tri3');
    expect(study.fields[0]).toMatchObject({ name: 'temperature', location: 'node', components: 1 });
    expect(Array.from(study.fields[0]!.values)).toEqual([300, 310, 320]);
  });

  it('parses ASCII .vtu arrays', () => {
    const study = parseVtk(VTU, 'triangle.vtu');
    expect(study.sourceFormat).toBe('vtu');
    expect(study.mesh.elements[0]?.nodes).toEqual([0, 1, 2]);
    expect(study.fields[0]?.name).toBe('u');
    expect(Array.from(study.fields[0]!.values)).toEqual([1, 2, 3]);
  });

  it('rejects binary content clearly', () => {
    expect(() => parseVtk(LEGACY.replace('ASCII', 'BINARY'))).toThrow(/binary/);
  });
});
