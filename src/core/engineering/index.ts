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
  '.dat': 'nastran',
  '.nas': 'nastran',
  '.cdb': 'ansys',
  '.db': 'ansys',
  '.foam': 'openfoam',
};

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
  const dot = name.lastIndexOf('.');
  const fromName = dot >= 0 ? EXTENSIONS[name.slice(dot).toLowerCase()] : undefined;
  if (fromName) return fromName;
  const geometry = detectGeometryFormat(name, text);
  if (geometry) return geometry;
  if (/\$MeshFormat/.test(text)) return 'gmsh';
  if (/^\s*\*HEADING|\*\s*NODE\b/im.test(text)) return 'abaqus';
  if (/<VTKFile\b/i.test(text)) return 'vtu';
  if (/vtk DataFile Version/i.test(text) && /UNSTRUCTURED_GRID/i.test(text)) return 'vtk';
  if (/^GRID[,\s]/im.test(text)) return 'nastran';
  if (/^\s*ET\s*,/im.test(text) && /^\s*N\s*,/im.test(text)) return 'ansys';
  if (/FoamFile|polyMesh|internalField\s+nonuniform/im.test(text)) return 'openfoam';
  return null;
}

/** Parse a supported mesh file into an EngineeringStudy. */
export function parseEngineeringFile(text: string, name: string): EngineeringStudy {
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
