// ==========================================================================
// Engineering file layer (public surface)
//
// One entry point turns a supported CAD/CAE file into the neutral domain
// model. Format detection uses the extension first and file content second,
// so a mislabelled `.dat` still resolves correctly when its header is clear.
// ==========================================================================

export * from './types';
export * from './mesh';
export { parseGmsh, GmshParseError } from './formats/gmsh';
export { parseAbaqus, AbaqusParseError } from './formats/abaqus';
export { parseVtk, VtkParseError } from './formats/vtk';

import type { EngineeringFormat, EngineeringStudy } from './types';
import { parseGmsh, GmshParseError } from './formats/gmsh';
import { parseAbaqus, AbaqusParseError } from './formats/abaqus';
import { parseVtk, VtkParseError } from './formats/vtk';

const EXTENSIONS: Record<string, EngineeringFormat> = {
  '.msh': 'gmsh',
  '.inp': 'abaqus',
  '.vtk': 'vtk',
  '.vtu': 'vtu',
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

/** Guess a format from the file name, falling back to distinctive headers. */
export function detectEngineeringFormat(name: string, text = ''): EngineeringFormat | null {
  const dot = name.lastIndexOf('.');
  const fromName = dot >= 0 ? EXTENSIONS[name.slice(dot).toLowerCase()] : undefined;
  if (fromName) return fromName;
  if (/\$MeshFormat/.test(text)) return 'gmsh';
  if (/^\s*\*HEADING|\*\s*NODE\b/im.test(text)) return 'abaqus';
  if (/<VTKFile\b/i.test(text)) return 'vtu';
  if (/vtk DataFile Version/i.test(text) && /UNSTRUCTURED_GRID/i.test(text)) return 'vtk';
  return null;
}

/** Parse a supported engineering file into an EngineeringStudy. */
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
    }
  } catch (err) {
    if (
      err instanceof GmshParseError ||
      err instanceof AbaqusParseError ||
      err instanceof VtkParseError
    ) {
      throw new EngineeringParseError(`${format}: ${err.message}`);
    }
    throw err;
  }
}
