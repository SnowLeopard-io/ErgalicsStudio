import { describe, expect, it } from 'vitest';
import {
  commandPaletteItems,
  getActivityItems,
  getVisiblePlugins,
  getVisibleTools,
  gridGroupsForDomain,
  isDomainVisible,
  marketplaceEntries,
  projectDomain,
} from '@/core/domains';
import {
  ENGINEERING_EXTENSIONS,
  parseEngineeringFile,
  isEngineeringExtension,
} from '@/core/engineering';
import { expandDesign, makeStep, parameterLevels } from '@/core/engineering/cases';
import { parseDxf, parseStep } from '@/core/engineering/geometry';
import {
  engineeringFingerprint,
  fromStudySnapshot,
  toStudySnapshot,
  verifyEngineeringFingerprint,
} from '@/core/engineering/study';
import { makeStudy, type EngineeringMesh } from '@/core/engineering';
import { INDUSTRIAL_EXAMPLES } from '@/core/engineering/examples';
import { runUniaxialBenchmark, solveEngineeringStudy } from '@/core/engineering/solve';
import { buildEngineeringReport } from '@/core/engineering/report';
import { RESEARCH_TOOLS } from '@/pages/research/toolRegistry';

const MESH: EngineeringMesh = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 1, y: 0, z: 0 },
    { id: 3, x: 0, y: 1, z: 0 },
  ],
  elements: [{ id: 1, type: 'tri3', nodes: [0, 1, 2], group: 1 }],
  groups: [
    { dimension: 0, tag: 1, name: 'pin', members: [0] },
    { dimension: 1, tag: 2, name: 'edge', members: [0] },
  ],
  bounds: [0, 0, 0, 1, 1, 0],
};

function study() {
  return makeStudy('bracket', 'gmsh', MESH, {
    materials: [{ name: 'Steel', properties: { E: 2.1e11, nu: 0.3 } }],
    cases: [
      {
        name: 'case 1',
        steps: [makeStep('static', 'static-structural')],
        design: { parameters: [], points: [] },
      },
    ],
    materialAssignment: { '1': 'Steel' },
  });
}

describe('capability domains', () => {
  const entries = [
    { id: 'a', domains: undefined },
    { id: 'b', domains: ['industrial' as const] },
    { id: 'c', domains: ['both' as const] },
  ];

  it('defaults missing domains to research and keeps both visible', () => {
    expect(isDomainVisible(undefined, 'research')).toBe(true);
    expect(isDomainVisible(undefined, 'industrial')).toBe(false);
    expect(isDomainVisible(['both'], 'industrial')).toBe(true);
    expect(getVisibleTools(entries, 'industrial').map((e) => e.id)).toEqual(['b', 'c']);
    expect(getVisiblePlugins(entries, 'research').map((e) => e.id)).toEqual(['a', 'c']);
    expect(commandPaletteItems(entries, 'industrial')).toHaveLength(2);
    expect(marketplaceEntries(entries, 'research')).toHaveLength(2);
  });

  it('treats legacy projects as research', () => {
    expect(projectDomain(null)).toBe('research');
    expect(projectDomain({ domain: 'research' })).toBe('research');
    expect(projectDomain({ domain: 'industrial' })).toBe('industrial');
  });

  it('filters activity items and grid groups', () => {
    const items = [
      { id: 'research' },
      { id: 'industrial' },
      { id: 'files', domains: ['both' as const] },
    ];
    expect(getActivityItems(items, 'research').map((i) => i.id)).toEqual(['research', 'files']);
    expect(getActivityItems(items, 'industrial').map((i) => i.id)).toEqual(['industrial', 'files']);
    const tools = [
      { id: 'm1', group: 'mesh', domains: ['industrial' as const] },
      { id: 'r1', group: 'data', domains: ['research' as const] },
    ];
    expect(gridGroupsForDomain(tools, 'industrial', ['mesh', 'data'])).toEqual(['mesh']);
    expect(gridGroupsForDomain(tools, 'research', ['mesh', 'data'])).toEqual(['data']);
  });

  it('registers industrial tools on the industrial list only', () => {
    const industrial = getVisibleTools(RESEARCH_TOOLS, 'industrial');
    expect(industrial.length).toBeGreaterThanOrEqual(10);
    expect(industrial.every((tool) => tool.rightPanel === 'engineering')).toBe(true);
    expect(getVisibleTools(RESEARCH_TOOLS, 'research').some((tool) => tool.domains.includes('industrial'))).toBe(false);
  });
});

describe('engineering cases + DOE', () => {
  it('expands a full factorial deterministically', () => {
    const points = expandDesign({
      parameters: [
        { name: 'a', min: 0, max: 1, levels: 2 },
        { name: 'b', min: 10, max: 20, levels: 3 },
      ],
      points: [],
    });
    expect(points).toHaveLength(6);
    expect(points.map((p) => p.params.a)).toContain(0);
    expect(points[0]!.params.b).toBe(10);
    expect(parameterLevels({ name: 'x', min: 1, max: 3, levels: 3 })).toEqual([1, 2, 3]);
  });

  it('switches to a seeded Latin hypercube above the limit', () => {
    const points = expandDesign({
      parameters: [{ name: 'a', min: 0, max: 1, levels: 5000 }],
      points: [],
    }, { samples: 32 });
    expect(points).toHaveLength(32);
    expect(new Set(points.map((p) => p.params.a)).size).toBe(32);
  });
});

describe('geometry readers', () => {
  const DXF = `0
SECTION
2
ENTITIES
0
LINE
8
OUTLINE
10
0
20
0
11
10
21
0
0
CIRCLE
8
HOLES
10
5
20
5
40
2
0
ENDSEC
0
EOF
`;

  it('parses DXF lines and tessellated circles', () => {
    const geometry = parseDxf(DXF, 'plate.dxf');
    expect(geometry.sourceFormat).toBe('dxf');
    expect(geometry.entities.map((e) => e.kind)).toEqual(['line', 'circle']);
    expect(geometry.layers).toEqual(['OUTLINE', 'HOLES']);
    expect(geometry.bounds[3]).toBe(10);
  });

  it('reads STEP cartesian points and dispatches through the index', () => {
    const STEP = `ISO-10303-21;
HEADER; FILE_DESCRIPTION(('x'),'2;1'); ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.,0.,0.));
#2 = CARTESIAN_POINT('',(10.,0.,0.));
#3 = CARTESIAN_POINT('',(10.,5.,0.));
ENDSEC;
END-ISO-10303-21;`;
    expect(parseStep(STEP).entities[0]!.points).toHaveLength(3);
    expect(isEngineeringExtension('part.step')).toBe(true);
    expect(ENGINEERING_EXTENSIONS).toContain('.msh');
    expect(parseEngineeringFile(STEP, 'part.step').geometry?.entities.length).toBe(1);
  });
});

describe('study persistence + fingerprint', () => {
  it('round-trips a study through its JSON snapshot', () => {
    const original = study();
    const restored = fromStudySnapshot(toStudySnapshot(original))!;
    expect(restored.name).toBe('bracket');
    expect(restored.materials[0]!.properties.E).toBe(2.1e11);
    expect(restored.cases?.[0]?.steps[0]?.kind).toBe('static-structural');
    expect(restored.materialAssignment).toEqual({ '1': 'Steel' });
  });

  it('detects mesh, material, case and solver drift', () => {
    const original = study();
    const fingerprint = engineeringFingerprint(original);
    expect(verifyEngineeringFingerprint(fingerprint, original)).toEqual([]);

    const changed = fromStudySnapshot(toStudySnapshot(original))!;
    changed.materials[0]!.properties.E = 1e11;
    changed.mesh.nodes[0]!.x = 0.5;
    changed.cases![0]!.steps[0]!.solver.tolerance = 1e-4;
    const drift = verifyEngineeringFingerprint(fingerprint, changed);
    expect(drift.some((item) => item.field === 'mesh')).toBe(true);
    expect(drift.some((item) => item.field === 'material')).toBe(true);
    expect(drift.some((item) => item.field === 'case')).toBe(true);
    expect(drift.some((item) => item.field === 'solver')).toBe(true);
  });
});

describe('analytic benchmark', () => {
  it('uniaxial tension converges to the exact solution', () => {
    const benchmark = runUniaxialBenchmark();
    expect(benchmark.relativeError).toBeLessThan(1e-6);
    expect(benchmark.maxDisplacement).toBeGreaterThan(0);
    expect(benchmark.order).not.toBeNull();
  });
});

describe('industrial examples + report', () => {
  it('ships sample studies that solve out of the box', () => {
    expect(INDUSTRIAL_EXAMPLES.length).toBeGreaterThanOrEqual(3);
    for (const example of INDUSTRIAL_EXAMPLES) {
      const built = example.build();
      expect(built.mesh.nodes.length).toBeGreaterThan(0);
      expect(built.cases?.[0]?.steps.length).toBe(1);
      const result = solveEngineeringStudy(built);
      expect(result.fields.length).toBeGreaterThan(0);
      expect(result.metrics.elementCount).toBe(built.mesh.elements.length);
    }
  });

  it('localises the report while keeping English the default', () => {
    const built = INDUSTRIAL_EXAMPLES[0]!.build();
    const result = solveEngineeringStudy(built);
    const en = buildEngineeringReport({ study: built, result });
    expect(en.markdown).toContain('Engineering report');
    expect(en.markdown).toContain('## Model');
    const zh = buildEngineeringReport({ study: built, result, locale: 'zh' });
    expect(zh.markdown).toContain('工程报告');
    expect(zh.markdown).toContain('## 模型');
    expect(zh.markdown).not.toContain('## Model');
  });
});
