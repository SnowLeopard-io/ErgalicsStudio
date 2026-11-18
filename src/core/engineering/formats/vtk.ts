// ==========================================================================
// VTK adapter — legacy ASCII UnstructuredGrid + ASCII .vtu — pure TS
// ==========================================================================

import {
  makeStudy,
  type ElementType,
  type EngineeringElement,
  type EngineeringField,
  type EngineeringNode,
  type EngineeringStudy,
} from '../types';

const VTK_TYPES: Record<number, ElementType> = {
  1: 'point', 3: 'line2', 5: 'tri3', 9: 'quad4',
  10: 'tet4', 12: 'hex8', 13: 'wedge6', 14: 'pyramid5',
  21: 'line3', 22: 'tri6', 23: 'quad8', 24: 'tet10',
};

export class VtkParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VtkParseError';
  }
}

function numbers(text: string): number[] {
  return text.trim().split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v));
}

function decodeNodes(values: number[]): EngineeringNode[] {
  const nodes: EngineeringNode[] = [];
  for (let i = 0; i + 2 < values.length; i += 3) {
    nodes.push({ id: nodes.length + 1, x: values[i]!, y: values[i + 1]!, z: values[i + 2]! });
  }
  return nodes;
}

function lineAfter(lines: string[], predicate: (line: string) => boolean): string[] {
  const index = lines.findIndex(predicate);
  if (index < 0) return [];
  return lines.slice(index + 1);
}

function parseLegacy(text: string, name: string): EngineeringStudy {
  const lines = text.split(/\r?\n/);
  const isUnstructured = lines.some((line) =>
    line.trim().toUpperCase().startsWith('DATASET UNSTRUCTURED_GRID'));
  if (!isUnstructured) {
    throw new VtkParseError('only DATASET UNSTRUCTURED_GRID is supported');
  }
  if (lines.some((line) => /^BINARY/i.test(line.trim()))) {
    throw new VtkParseError('binary VTK files are not supported — re-export as ASCII');
  }

  const pointHeader = lines.find((line) => /^POINTS\s/i.test(line.trim()));
  const pointCount = Number(pointHeader?.trim().split(/\s+/)[1] ?? 0);
  const pointLines = lineAfter(lines, (line) => /^POINTS\s/i.test(line.trim()));
  const coords: number[] = [];
  for (let i = 0; i < pointLines.length && coords.length < pointCount * 3; i += 1) {
    if (/^[A-Z]/i.test(pointLines[i]!.trim())) break;
    coords.push(...numbers(pointLines[i]!));
  }
  const nodes = decodeNodes(coords);

  const cellHeader = lines.find((line) => /^CELLS\s/i.test(line.trim()));
  const cellCount = Number(cellHeader?.trim().split(/\s+/)[1] ?? 0);
  const cellLines = lineAfter(lines, (line) => /^CELLS\s/i.test(line.trim()));
  const expectedIntegers = Number(cellHeader?.trim().split(/\s+/)[2] ?? 0);
  const cellTokens: number[] = [];
  for (const line of cellLines) {
    if (cellTokens.length >= expectedIntegers) break;
    // Uppercase lines are the next section keyword, not cell data.
    if (/^[A-Z]/i.test(line.trim()) && !/^-?\d/.test(line.trim())) break;
    cellTokens.push(...numbers(line));
  }

  const typeLines = lineAfter(lines, (line) => /^CELL_TYPES\s/i.test(line.trim()));
  const typeValues: number[] = [];
  for (const line of typeLines) {
    if (/^[A-Z]/i.test(line.trim())) break;
    typeValues.push(...numbers(line));
    if (typeValues.length >= cellCount) break;
  }

  const elements: EngineeringElement[] = [];
  let cursor = 0;
  for (let i = 0; i < cellCount && cursor < cellTokens.length; i += 1) {
    const length = cellTokens[cursor++] ?? 0;
    const cellNodes = cellTokens.slice(cursor, cursor + length);
    cursor += length;
    elements.push({ id: i + 1, type: VTK_TYPES[typeValues[i]!] ?? 'polyhedron', nodes: cellNodes });
  }

  const fields: EngineeringField[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^SCALARS\s+(\S+)\s+\S+(?:\s+(\d+))?/i.exec(lines[i]!.trim());
    if (!match) continue;
    const nameField = match[1]!;
    const components = Number(match[2] ?? 1);
    const data: number[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j]!.trim();
      if (/^LOOKUP_TABLE/i.test(line)) continue;
      if (/^[A-Z]/i.test(line)) break;
      data.push(...numbers(line));
    }
    fields.push({
      name: nameField,
      location: 'node',
      components,
      values: Float64Array.from(data),
    });
  }

  return makeStudy(name, 'vtk', { nodes, elements, groups: [], bounds: [0, 0, 0, 0, 0, 0] }, {
    fields,
    metadata: {
      title: lines[1]?.trim() ?? '',
      dataset: 'unstructured-grid',
      cellTypes: typeValues.slice(0, cellCount).join(','),
    },
  });
}

/** Return the full <DataArray …>…</DataArray> element for a named field. */
function dataArrayElement(xml: string, name: string): string {
  const regex = new RegExp(`<DataArray\\b(?=[^>]*\\bName="${name}")[^>]*>[\\s\\S]*?<\\/DataArray>`, 'i');
  return regex.exec(xml)?.[0] ?? '';
}

function dataArrayInner(element: string): string {
  return />([\s\S]*?)<\/DataArray>/i.exec(element)?.[1] ?? '';
}

function arrayByAttribute(xml: string, attribute: string, value: string): string {
  const regex = new RegExp(`<DataArray\\b(?=[^>]*\\b${attribute}="${value}")[^>]*>([\\s\\S]*?)<\\/DataArray>`, 'i');
  return regex.exec(xml)?.[1] ?? '';
}

function parseVtu(text: string, name: string): EngineeringStudy {
  if (/format="binary"/i.test(text) || /<AppendedData/i.test(text)) {
    throw new VtkParseError('binary .vtu files are not supported — re-export with format="ascii"');
  }
  const pointsXml = /<Points>([\s\S]*?)<\/Points>/i.exec(text)?.[1] ?? '';
  const nodes = decodeNodes(numbers(pointsXml));

  const cellsXml = /<Cells>([\s\S]*?)<\/Cells>/i.exec(text)?.[1] ?? '';
  const connectivity = numbers(arrayByAttribute(cellsXml, 'Name', 'connectivity'));
  const offsets = numbers(arrayByAttribute(cellsXml, 'Name', 'offsets'));
  const typeValues = numbers(arrayByAttribute(cellsXml, 'Name', 'types'));
  const elements: EngineeringElement[] = [];
  let start = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const end = offsets[i]!;
    elements.push({
      id: i + 1,
      type: VTK_TYPES[typeValues[i]!] ?? 'polyhedron',
      nodes: connectivity.slice(start, end),
    });
    start = end;
  }

  const fields: EngineeringField[] = [];
  const pointData = /<PointData[^>]*>([\s\S]*?)<\/PointData>/i.exec(text)?.[1] ?? '';
  const cellData = /<CellData[^>]*>([\s\S]*?)<\/CellData>/i.exec(text)?.[1] ?? '';
  const arrayNames = (xml: string): string[] => {
    const out: string[] = [];
    const regex = /<DataArray\b[^>]*\bName="([^"]+)"/gi;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(xml)) !== null) {
      if (!out.includes(match[1]!)) out.push(match[1]!);
    }
    return out;
  };
  for (const [xml, location] of [[pointData, 'node'], [cellData, 'element']] as const) {
    for (const fieldName of arrayNames(xml)) {
      const block = dataArrayElement(xml, fieldName);
      const components = Number(/NumberOfComponents="(\d+)"/i.exec(block)?.[1] ?? 1);
      fields.push({
        name: fieldName,
        location,
        components,
        values: Float64Array.from(numbers(dataArrayInner(block))),
      });
    }
  }

  return makeStudy(name, 'vtu', { nodes, elements, groups: [], bounds: [0, 0, 0, 0, 0, 0] }, {
    fields,
    metadata: { dataset: 'unstructured-grid-xml' },
  });
}

/** Parse a VTK legacy ASCII or ASCII .vtu file. */
export function parseVtk(text: string, name = 'mesh.vtk'): EngineeringStudy {
  return /<VTKFile\b/i.test(text) ? parseVtu(text, name) : parseLegacy(text, name);
}
