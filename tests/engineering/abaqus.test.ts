import { describe, expect, it } from 'vitest';
import { parseAbaqus } from '@/core/engineering/formats/abaqus';
import { toPlanarMesh } from '@/core/engineering';

const DECK = `\
*HEADING
Plane test
*NODE, NSET=Nall
1, 0., 0., 0.
2, 1., 0., 0.
3, 0., 1., 0.
*ELEMENT, TYPE=CPS3, ELSET=Eall
1, 1, 2, 3
*NSET, NSET=left, GENERATE
1, 1, 1
*BOUNDARY
left, 1, 2, 0.
*CLOAD
3, 2, -100.
*MATERIAL, NAME=steel
*DENSITY
7800.
*ELASTIC
2.1e11, 0.3
*SOLID SECTION, ELSET=Eall, MATERIAL=steel
`;

const HEX20 = [
  '*NODE',
  ...Array.from({ length: 20 }, (_, i) => `${i + 1}, ${i}.0, 0., 0.`),
  '*ELEMENT, TYPE=C3D20, ELSET=Eall',
  '1, 1, 2, 3, 4, 5, 6, 7, 8,',
  '9, 10, 11, 12,',
  '13, 14, 15, 16,',
  '17, 18, 19, 20',
  '*ELSET, ELSET=All',
  '1',
].join('\n');

describe('Abaqus adapter', () => {
  it('reads nodes, elements, sets, BCs and materials', () => {
    const study = parseAbaqus(DECK, 'plane.inp');
    expect(study.sourceFormat).toBe('abaqus');
    expect(study.mesh.nodes).toHaveLength(3);
    expect(study.mesh.elements[0]?.type).toBe('tri3');
    expect(study.mesh.elements[0]?.nodes).toEqual([0, 1, 2]);
    expect(study.mesh.groups.find((g) => g.name === 'left')?.members).toEqual([0]);
    expect(study.mesh.groups.find((g) => g.name === 'Eall')?.members).toEqual([0]);

    const fixed = study.boundaryConditions.find((bc) => bc.kind === 'displacement');
    expect(fixed?.components).toEqual({ 0: 0, 1: 0 });
    const load = study.boundaryConditions.find((bc) => bc.kind === 'force');
    expect(load?.components).toEqual({ 1: -100 });

    expect(study.materials[0]?.properties.E).toBeCloseTo(2.1e11);
    expect(study.materials[0]?.properties.nu).toBeCloseTo(0.3);
    expect(study.metadata.sectionMaterial).toBe('steel');
    expect(toPlanarMesh(study.mesh)!.elements).toHaveLength(1);
  });

  it('merges continuation lines of wrapped elements', () => {
    const study = parseAbaqus(HEX20, 'hex20.inp');
    expect(study.mesh.elements).toHaveLength(1);
    expect(study.mesh.elements[0]?.type).toBe('hex20');
    expect(study.mesh.elements[0]?.nodes).toEqual(Array.from({ length: 20 }, (_, i) => i));
    // 续行不应产生假单元，ELSET 仍指向唯一单元 0。
    expect(study.mesh.groups.find((g) => g.name === 'Eall')?.members).toEqual([0]);
    expect(study.mesh.groups.find((g) => g.name === 'All')?.members).toEqual([0]);
  });

  it('does not merge continuations for unknown element types', () => {
    const deck = [
      '*NODE', '1, 0., 0., 0.', '2, 1., 0., 0.', '3, 0., 1., 0.',
      '*ELEMENT, TYPE=MYSTERY',
      '1, 1, 2',
      '2, 3',
    ].join('\n');
    const study = parseAbaqus(deck, 'mystery.inp');
    expect(study.mesh.elements).toHaveLength(2);
    expect(study.mesh.elements[1]?.nodes).toEqual([2]);
  });

  it('rejects unknown node labels instead of guessing an index', () => {
    const deck = [
      '*NODE', '1, 0., 0., 0.', '2, 1., 0., 0.', '3, 0., 1., 0.',
      '*ELEMENT, TYPE=CPS3',
      '1, 1, 2, 99',
    ].join('\n');
    expect(() => parseAbaqus(deck)).toThrow(/单元 1.*99/);
  });

  it('rejects an incomplete wrapped element', () => {
    const deck = [
      '*NODE', '1, 0., 0., 0.', '2, 1., 0., 0.', '3, 0., 1., 0.',
      '*ELEMENT, TYPE=C3D20',
      '1, 1, 2, 3',
    ].join('\n');
    expect(() => parseAbaqus(deck)).toThrow(/单元 1 节点数不足/);
  });

  it('rejects a deck without nodes', () => {
    expect(() => parseAbaqus('*HEADING\nempty')).toThrow(/no \*NODE/);
  });
});
