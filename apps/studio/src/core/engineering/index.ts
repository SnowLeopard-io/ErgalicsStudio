// ==========================================================================
// Engineering file layer (public surface)
//
// One entry point turns a supported CAD/CAE file into the neutral domain
// model. Format detection uses the extension first and file content second,
// so a mislabelled `.dat` still resolves correctly when its header is clear.
// Geometry formats (DXF / STEP) produce an EngineeringGeometry wrapped as a
// study, keeping a single import contract for the UI.
// ==========================================================================

export * from './types';
export * from './mesh';
export * from './materials';
export * from './cases';
export * from './geometry';
export * from './study';
export * from './solve';
export * from './solve3d';
export * from './volume';
export * from './report';
export * from './examples';
export * from './export';
export { parseGmsh, GmshParseError } from './formats/gmsh';
export { parseAbaqus, AbaqusParseError } from './formats/abaqus';
export { parseVtk, VtkParseError } from './formats/vtk';
export { parseNastran, NastranParseError } from './formats/nastran';
export { parseAnsys, AnsysParseError } from './formats/ansys';
export { parseOpenfoam, OpenFoamParseError } from './formats/openfoam';

import type { EngineeringFormat, EngineeringStudy } from './types';
import { parseGmsh, GmshParseError } from './formats/gmsh';
import { parseAbaqus, AbaqusParseError } from './formats/abaqus';
import { parseVtk, VtkParseError } from './formats/vtk';
import { parseNastran, NastranParseError } from './formats/nastran';
import { parseAnsys, AnsysParseError } from './formats/ansys';
import { parseOpenfoam, OpenFoamParseError } from './formats/openfoam';
import {
  detectGeometryFormat,
  geometryToStudy,
  parseGeometryFile,
  GeometryParseError,
} from './geometry';

const EXTENSIONS: Record<string, EngineeringFormat> = {
  '.msh': 'gmsh',
  '.inp': 'abaqus',
  '.vtk': 'vtk',
  '.vtu': 'vtu',
  '.dxf': 'dxf',
  '.step': 'step',
  '.stp': 'step',
  '.bdf': 'nastran',
  '.dat': 'nastran', // only a default; `.dat` is sniffed for Ansys below
  '.nas': 'nastran',
  '.cdb': 'ansys',
  '.db': 'ansys', // recognized so the router can report a clear binary error
  '.foam': 'openfoam', // case marker; the actual mesh lives in constant/polyMesh
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * `.dat` is ambiguous: Ansys and Nastran both use it. Nastran-only tokens win
 * first (`BEGIN BULK`, `GRID`, `CHEXA`, …); otherwise Ansys block/command
 * hints select Ansys. When the header is inconclusive the historical Nastran
 * default is kept.
 */
function sniffDatFormat(text: string): EngineeringFormat | null {
  if (/BEGIN\s+BULK|\bGRID\b|\bCHEXA\b|\bCTETRA\b|\bCQUAD4\b/i.test(text)) return 'nastran';
  if (/\bNBLOCK\b|\bEBLOCK\b|\*\s*NODE\b|^\s*(?:ET|N)\s*,|^\s*BEGIN\b/im.test(text)) return 'ansys';
  return null;
}

export class EngineeringParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineeringParseError';
  }
}

export function isEngineeringExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return EXTENSIONS[name.slice(dot).toLowerCase()] !== undefined;
}

/** Every extension handled by the engineering import layer. */
export const ENGINEERING_EXTENSIONS = Object.keys(EXTENSIONS);

/** Is this a geometry (as opposed to a mesh) format? */
export function isGeometryExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = name.slice(dot).toLowerCase();
  return ext === '.dxf' || ext === '.step' || ext === '.stp';
}

/** Guess a format from the file name, falling back to distinctive headers. */
export function detectEngineeringFormat(name: string, text = ''): EngineeringFormat | null {
  const ext = extensionOf(name);
  if (ext === '.dat') {
    // Both Ansys and Nastran ship `.dat`; sniff before trusting the extension.
    return sniffDatFormat(text) ?? 'nastran';
  }
  const fromName = ext !== '' ? EXTENSIONS[ext] : undefined;
  if (fromName) return fromName;
  const geometry = detectGeometryFormat(name, text);
  if (geometry) return geometry;
  if (/\$MeshFormat/.test(text)) return 'gmsh';
  if (/^\s*\*HEADING|\*\s*NODE\b/im.test(text)) return 'abaqus';
  if (/<VTKFile\b/i.test(text)) return 'vtu';
  if (/vtk DataFile Version/i.test(text) && /UNSTRUCTURED_GRID/i.test(text)) return 'vtk';
  if (/^GRID[,\s]/im.test(text)) return 'nastran';
  if (/^\s*(?:NBLOCK|EBLOCK)\s*,/im.test(text)) return 'ansys';
  if (/^\s*ET\s*,/im.test(text) && /^\s*N\s*,/im.test(text)) return 'ansys';
  if (/FoamFile|polyMesh|internalField\s+nonuniform/im.test(text)) return 'openfoam';
  return null;
}

/** Parse a supported mesh file into an EngineeringStudy. */
export function parseEngineeringFile(text: string, name: string): EngineeringStudy {
  const ext = extensionOf(name);
  if (ext === '.db') {
    throw new EngineeringParseError(
      'ansys: binary .db databases cannot be read as text — export an ASCII .cdb file (暂不支持二进制 .db，请导出 .cdb)',
    );
  }
  if (ext === '.foam' && !/\bobject\s+points\s*;|^\s*points\s*$|polyMeshPoints/im.test(text)) {
    throw new EngineeringParseError(
      'openfoam: .foam is only a case marker — select the ASCII polyMesh files under constant/polyMesh (points/faces/owner/neighbour) (.foam 只是标记文件，请选择 constant/polyMesh 下的文本网格文件)',
    );
  }
  const format = detectEngineeringFormat(name, text);
  if (!format) {
    throw new EngineeringParseError(`unsupported engineering file: ${name}`);
  }
  try {
    switch (format) {
      case 'gmsh': return parseGmsh(text, name);
      case 'abaqus': return parseAbaqus(text, name);
      case 'vtk':
      case 'vtu': return parseVtk(text, name);
      case 'nastran': return parseNastran(text, name);
      case 'ansys': return parseAnsys(text, name);
      case 'openfoam': return parseOpenfoam(text, name);
      case 'dxf':
      case 'step': return geometryToStudy(parseGeometryFile(text, name), name);
    }
  } catch (err) {
    if (
      err instanceof GmshParseError ||
      err instanceof AbaqusParseError ||
      err instanceof VtkParseError ||
      err instanceof NastranParseError ||
      err instanceof AnsysParseError ||
      err instanceof OpenFoamParseError ||
      err instanceof GeometryParseError
    ) {
      throw new EngineeringParseError(`${format}: ${err.message}`);
    }
    throw err;
  }
}

/** Backward-compatible alias used by the workbench file router. */
export const parseEngineeringInput = parseEngineeringFile;
