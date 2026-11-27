// ==========================================================================
// OpenFOAM adapter (ASCII) — pure TS
//
// OpenFOAM cases are directories (constant/polyMesh/{points,faces,owner,neighbour}
// and time directories with field files). The workbench passes text, so this
// adapter accepts the CONCATENATED contents of those files with FoamFile
// headers/braces, and reconstructs a cell-centred mesh (one representative
// point per cell from the face lists) plus any internal fields found.
//
// List values are read from *inside* the list parentheses so dictionary
// headers and the leading element count never leak into the numeric data.
// Binary cases are rejected explicitly instead of being parsed as text.
// ==========================================================================

import {
  makeStudy,
  type EngineeringField,
  type EngineeringNode,
  type EngineeringStudy,
} from '../types';

export class OpenFoamParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenFoamParseError';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drop `//` line comments and C-style block comments before scanning tokens. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Body inside the first balanced `( … )` in `text`. */
function listBody(text: string): string {
  const open = text.indexOf('(');
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return '';
}

/** Locate a named object's text via `object <name>;` or `<name> { … }`. */
function findObjectBlock(text: string, name: string): string {
  const escaped = escapeRegExp(name);
  const objectMatch = new RegExp(`\\bobject\\s+${escaped}\\s*;`, 'i').exec(text);
  if (objectMatch) {
    const rest = text.slice(objectMatch.index + objectMatch[0].length);
    const next = /\bobject\s+[A-Za-z_][\w.-]*\s*;/i.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
  }
  // Dictionary style: the name alone on a line, followed by an opening brace.
  const dictMatch = new RegExp(`(?:^|\\n)[ \\t]*${escaped}[ \\t]*\\n[ \\t]*\\{`, 'i').exec(text);
  if (!dictMatch) return '';
  const open = text.indexOf('{', dictMatch.index + dictMatch[0].length - 1);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return '';
}

/** Body of the list belonging to `kind` (e.g. points/faces/owner/U). */
function foamList(text: string, kind: string): string {
  const block = findObjectBlock(text, kind);
  return block ? listBody(block) : '';
}

function vectors(body: string): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const vec = /\(\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s*\)/g;
  let match: RegExpExecArray | null = null;
  while ((match = vec.exec(body)) !== null) {
    out.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  return out;
}

function numbers(body: string): number[] {
  const list = body.replace(/[()]/g, ' ').trim().split(/[\s]+/).filter(Boolean);
  return list.map(Number).filter((v) => Number.isFinite(v));
}

/**
 * Numeric values of a list, skipping the leading element count. The count is
 * normally the last token before `(`; some writers put it on the first line
 * inside the parentheses instead.
 */
function listNumbers(header: string, body: string): number[] {
  const values = numbers(body);
  const headerTokens = header.trim().split(/[\s,]+/).filter(Boolean);
  const declared = Number(headerTokens[headerTokens.length - 1]);
  if (Number.isFinite(declared) && declared > 0) {
    if (values.length === declared + 1 && values[0] === declared) return values.slice(1);
    return values;
  }
  if (values.length > 0 && values[0] === values.length - 1) return values.slice(1);
  return values;
}

/** Read every `internalField` (scalar/vector) into the neutral field list. */
function parseFields(text: string, nodeCount: number): EngineeringField[] {
  const fields: EngineeringField[] = [];
  if (nodeCount === 0) return fields;
  const marker = /\binternalField\b/gi;
  let match: RegExpExecArray | null = null;
  while ((match = marker.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const open = text.indexOf('(', start);
    if (open < 0) continue;
    const header = text.slice(start, open);
    if (/\binternalField\b/i.test(header)) continue;
    const body = listBody(text.slice(start));
    if (!body) continue;
    if (/List<scalar>/i.test(header)) {
      const values = listNumbers(header, body);
      if (values.length >= nodeCount) {
        fields.push({
          name: 'scalarField', location: 'node', components: 1,
          values: Float64Array.from(values.slice(0, nodeCount)),
        });
      }
    } else if (/List<vector>/i.test(header) || /\buniform\b/i.test(header)) {
      const vectorValues = vectors(body);
      if (vectorValues.length >= nodeCount) {
        const flat = new Float64Array(nodeCount * 3);
        vectorValues.slice(0, nodeCount).forEach((v, i) => {
          flat[i * 3] = v[0]; flat[i * 3 + 1] = v[1]; flat[i * 3 + 2] = v[2];
        });
        fields.push({ name: 'U', location: 'node', components: 3, values: flat, unit: 'm/s' });
      }
    }
  }
  return fields;
}

/** Parse concatenated OpenFOAM mesh + field text into the neutral model. */
export function parseOpenfoam(text: string, name = 'case.foam'): EngineeringStudy {
  const clean = stripComments(text);
  if (/\bformat\s+binary\s*;/i.test(clean)) {
    throw new OpenFoamParseError(
      '暂不支持二进制 OpenFOAM 格式，请以 ascii 导出 (binary format is not supported)',
    );
  }

  const pointBody = foamList(clean, 'points');
  const faceBody = foamList(clean, 'faces');
  const points = vectors(pointBody);
  if (points.length === 0) throw new OpenFoamParseError('no polyMesh points found');

  // cells: derive one representative node per owner cell from its first face.
  const faces = [...faceBody.matchAll(/\d+\s*\(([^)]*)\)/g)].map((m) =>
    numbers(m[1]!).map((index) => Math.round(index)),
  );
  const owner = numbers(foamList(clean, 'owner'));
  const cellPoint = new Map<number, number>();
  faces.forEach((face, faceIndex) => {
    const cell = owner[faceIndex] ?? faceIndex;
    if (!cellPoint.has(cell) && face.length > 0) {
      const p = face[0]!;
      if (points[p]) cellPoint.set(cell, p);
    }
  });
  const nodes: EngineeringNode[] = [...cellPoint.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cell, point]) => ({
      id: cell + 1,
      x: points[point]![0], y: points[point]![1], z: points[point]![2],
    }));

  const fields = parseFields(clean, nodes.length);

  return makeStudy(name, 'openfoam', { nodes, elements: [], groups: [], bounds: [0, 0, 0, 0, 0, 0] }, {
    fields,
    metadata: { sourceFormat: 'OpenFOAM ASCII', pointCount: String(points.length), faceCount: String(faces.length) },
  });
}
