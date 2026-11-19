// ==========================================================================
// OpenFOAM adapter (ASCII) — pure TS
//
// OpenFOAM cases are directories (constant/polyMesh/{points,faces,owner,neighbour}
// and time directories with field files). The workbench passes text, so this
// adapter accepts the CONCATENATED contents of those files with FoamFile
// headers/braces, and reconstructs a cell-centred mesh (one representative
// point per cell from the face lists) plus any uniform/nonuniform fields
// found. For a full volumetric case, load each file through the VFS and join
// with '\n' before calling parseOpenfoam.
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

/** Extract the numbered body of a Foam `labelList`/`vectorList` array. */
function foamList(text: string, kind: 'points' | 'faces' | 'owner' | string): string {
  const marker = new RegExp(`(?:class\\s+)?(?:vectorList|labelList|volVectorField|volScalarField)[^;]*;`, 'g');
  void marker;
  // Find the N presection followed by '( ... )' closest to a header line for `kind`.
  const kindIndex = text.toLowerCase().indexOf(kind.toLowerCase());
  const tail = kindIndex >= 0 ? text.slice(kindIndex) : text;
  const open = tail.indexOf('(');
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < tail.length; i += 1) {
    if (tail[i] === '(') depth += 1;
    else if (tail[i] === ')') {
      depth -= 1;
      if (depth === 0) return tail.slice(open + 1, i);
    }
  }
  return '';
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

/** Parse concatenated OpenFOAM mesh + field text into the neutral model. */
export function parseOpenfoam(text: string, name = 'case.foam'): EngineeringStudy {
  const pointBody = foamList(text, 'points');
  const faceBody = foamList(text, 'faces');
  const points = vectors(pointBody);
  if (points.length === 0) throw new OpenFoamParseError('no polyMesh points found');

  // cells: derive one representative node per owner cell from its first face.
  const faces = [...faceBody.matchAll(/\d+\s*\(([^)]*)\)/g)].map((m) =>
    numbers(m[1]!).map((index) => Math.round(index)),
  );
  const owner = numbers(foamList(text, 'owner'));
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

  const fields: EngineeringField[] = [];
  // volVectorField (e.g. U) and volScalarField (e.g. p, T) nonuniform lists.
  const scalarPattern = /(volScalarField|nonuniform\s+List<scalar>)([\s\S]*?)\n\s*\)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = scalarPattern.exec(text)) !== null) {
    const values = numbers(match[2]!);
    if (values.length >= nodes.length) {
      fields.push({
        name: 'scalarField', location: 'node', components: 1,
        values: Float64Array.from(values.slice(0, nodes.length)),
      });
    }
  }
  const vectorValues = vectors(foamList(text, 'U'));
  if (vectorValues.length >= nodes.length) {
    const flat = new Float64Array(nodes.length * 3);
    vectorValues.slice(0, nodes.length).forEach((v, i) => {
      flat[i * 3] = v[0]; flat[i * 3 + 1] = v[1]; flat[i * 3 + 2] = v[2];
    });
    fields.push({ name: 'U', location: 'node', components: 3, values: flat, unit: 'm/s' });
  }

  return makeStudy(name, 'openfoam', { nodes, elements: [], groups: [], bounds: [0, 0, 0, 0, 0, 0] }, {
    fields,
    metadata: { sourceFormat: 'OpenFOAM ASCII', pointCount: String(points.length), faceCount: String(faces.length) },
  });
}
