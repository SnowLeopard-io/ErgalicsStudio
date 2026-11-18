// ==========================================================================
// Abaqus .inp adapter (ASCII) — pure TS
// ==========================================================================
//
// Reads the subset that matters for an engineering study: nodes, elements,
// node/element sets, boundary conditions, concentrated/distributed loads and
// basic material data. Solver controls (*STEP, *STATIC, …) are preserved as
// metadata rather than interpreted.
// ==========================================================================

import {
  makeStudy,
  type BoundaryCondition,
  type ElementType,
  type EngineeringElement,
  type EngineeringGroup,
  type EngineeringMaterial,
  type EngineeringNode,
  type EngineeringStudy,
} from '../types';

const ABAQUS_TYPES: Record<string, ElementType> = {
  C3D4: 'tet4', C3D10: 'tet10', C3D8: 'hex8', C3D8R: 'hex8',
  C3D20: 'hex20', C3D6: 'wedge6', C3D5: 'pyramid5',
  CPS3: 'tri3', CPS6: 'tri6', CPS4: 'quad4', CPS8: 'quad8',
  CPE3: 'tri3', CPE4: 'quad4', CPE4R: 'quad4',
  S3: 'tri3', S4: 'quad4', S4R: 'quad4',
  T2D2: 'line2', B31: 'line2', B32: 'line3',
};

export class AbaqusParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbaqusParseError';
  }
}

interface Line {
  raw: string;
  parts: string[];
}

function readLines(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((raw) => ({ raw, parts: raw.split(',').map((part) => part.trim()).filter(Boolean) }))
    .filter((line) => line.parts.length > 0 && !line.raw.trim().startsWith('**'));
}

function option(header: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*=\\s*([^,]+)`, 'i').exec(header);
  return match?.[1]?.trim();
}

function number(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse an Abaqus input deck into the engineering domain model. */
export function parseAbaqus(text: string, name = 'model.inp'): EngineeringStudy {
  const lines = readLines(text);
  const nodes: EngineeringNode[] = [];
  const elements: EngineeringElement[] = [];
  const groups: EngineeringGroup[] = [];
  const nodeIdToIndex = new Map<number, number>();
  const elementIdToIndex = new Map<number, number>();
  const materials: EngineeringMaterial[] = [];
  const boundaryConditions: BoundaryCondition[] = [];
  const metadata: Record<string, string> = {};
  let section = '';
  let currentMaterial: EngineeringMaterial | null = null;
  let currentSet: EngineeringGroup | null = null;
  let setGenerate = false;

  const groupTag = (label: string): number => {
    const existing = groups.find((group) => group.name === label);
    if (existing) return existing.tag;
    const tag = groups.length + 1;
    groups.push({ dimension: 0, tag, name: label, members: [] });
    return tag;
  };

  const flushSet = (): void => {
    if (currentSet) currentSet = null;
    setGenerate = false;
  };

  for (const line of lines) {
    if (line.raw.trim().startsWith('*')) {
      flushSet();
      const header = line.raw.trim();
      const upper = header.toUpperCase();
      if (upper.startsWith('*NODE')) {
        section = 'node';
      } else if (upper.startsWith('*ELEMENT')) {
        section = 'element';
        metadata.elementType = option(header, 'TYPE') ?? '';
        const elset = option(header, 'ELSET');
        if (elset) {
          const tag = groupTag(elset);
          currentSet = groups.find((group) => group.tag === tag)!;
          currentSet.dimension = 2;
          setGenerate = false;
        }
      } else if (upper.startsWith('*NSET')) {
        section = 'nset';
        const label = option(header, 'NSET') ?? `NSET${groups.length + 1}`;
        const tag = groupTag(label);
        currentSet = groups.find((group) => group.tag === tag)!;
        currentSet.dimension = 0;
        setGenerate = upper.includes('GENERATE');
      } else if (upper.startsWith('*ELSET')) {
        section = 'elset';
        const label = option(header, 'ELSET') ?? `ELSET${groups.length + 1}`;
        const tag = groupTag(label);
        currentSet = groups.find((group) => group.tag === tag)!;
        currentSet.dimension = 2;
        setGenerate = upper.includes('GENERATE');
      } else if (upper.startsWith('*BOUNDARY')) {
        section = 'boundary';
      } else if (upper.startsWith('*CLOAD')) {
        section = 'cload';
      } else if (upper.startsWith('*DLOAD')) {
        section = 'dload';
      } else if (upper.startsWith('*MATERIAL')) {
        section = 'material';
        currentMaterial = { name: option(header, 'NAME') ?? `MATERIAL${materials.length + 1}`, properties: {} };
        materials.push(currentMaterial);
      } else if (upper.startsWith('*DENSITY')) {
        section = 'density';
      } else if (upper.startsWith('*ELASTIC')) {
        section = 'elastic';
      } else if (upper.startsWith('*STEP')) {
        section = 'step';
        metadata.step = option(header, 'NLGEOM') ?? 'static';
      } else if (upper.startsWith('*SOLID SECTION')) {
        section = 'solid-section';
        const material = option(header, 'MATERIAL');
        if (material) metadata.sectionMaterial = material;
      } else {
        section = '';
      }
      continue;
    }

    const values = line.parts.map(number);
    switch (section) {
      case 'node': {
        if (values.length < 3) break;
        const id = values[0]!;
        if (nodeIdToIndex.has(id)) break;
        const index = nodes.length;
        nodeIdToIndex.set(id, index);
        nodes.push({ id, x: values[1]!, y: values[2]!, z: values[3] ?? 0 });
        break;
      }
      case 'element': {
        if (values.length < 2) break;
        const type = ABAQUS_TYPES[metadata.elementType?.toUpperCase() ?? ''] ?? 'polyhedron';
        const index = elements.length;
        elementIdToIndex.set(values[0]!, index);
        currentSet?.members.push(index);
        elements.push({
          id: values[0]!,
          type,
          nodes: values.slice(1).map((label) => nodeIdToIndex.get(label) ?? label - 1),
        });
        break;
      }
      case 'nset':
      case 'elset': {
        if (!currentSet) break;
        const source = section === 'nset' ? nodeIdToIndex : elementIdToIndex;
        if (setGenerate && values.length >= 3) {
          const from = values[0]!;
          const to = values[1]!;
          const step = Math.max(1, values[2]!);
          for (let id = from; id <= to; id += step) {
            const index = source.get(id);
            if (index !== undefined) currentSet.members.push(index);
          }
        } else {
          for (const id of values) {
            const index = source.get(id);
            if (index !== undefined) currentSet.members.push(index);
          }
        }
        break;
      }
      case 'boundary': {
        if (values.length < 3) break;
        const label = line.parts[0]!;
        const set = groups.find((group) => group.name === label);
        const target = set
          ? { dimension: set.dimension, tag: set.tag }
          : { dimension: 0, tag: groupTag(`NODE-${label}`) };
        const components: Record<number, number> = {};
        for (let i = 1; i + 1 < values.length; i += 2) components[values[i]! - 1] = values[i + 1]!;
        boundaryConditions.push({
          name: `BC-${label}`,
          kind: 'displacement',
          target,
          components,
        });
        break;
      }
      case 'cload': {
        if (values.length < 3) break;
        const node = nodeIdToIndex.get(values[0]!);
        if (node === undefined) break;
        const tag = groupTag(`LOAD-${values[0]!}`);
        groups.find((group) => group.tag === tag)!.members.push(node);
        boundaryConditions.push({
          name: `CLOAD-${values[0]!}`,
          kind: 'force',
          target: { dimension: 0, tag },
          components: { [values[1]! - 1]: values[2]! },
        });
        break;
      }
      case 'dload': {
        if (values.length < 2) break;
        const label = line.parts[0]!;
        const set = groups.find((group) => group.name === label);
        const tag = set?.tag ?? groupTag(label);
        boundaryConditions.push({
          name: `DLOAD-${label}`,
          kind: 'traction',
          target: { dimension: set?.dimension ?? 2, tag },
          components: { 0: values[1]! },
        });
        break;
      }
      case 'density': {
        if (currentMaterial && values.length > 0) currentMaterial.properties.rho = values[0]!;
        break;
      }
      case 'elastic': {
        if (currentMaterial && values.length >= 2) {
          currentMaterial.properties.E = values[0]!;
          currentMaterial.properties.nu = values[1]!;
        }
        break;
      }
      case 'solid-section': {
        const material = line.parts.find((part) => /material=/i.test(part));
        if (material) metadata.sectionMaterial = material.split('=')[1] ?? '';
        break;
      }
      default:
        break;
    }
  }

  if (nodes.length === 0) throw new AbaqusParseError('deck contains no *NODE data');
  return makeStudy(name, 'abaqus', { nodes, elements, groups, bounds: [0, 0, 0, 0, 0, 0] }, {
    materials,
    boundaryConditions,
    metadata,
  });
}
