// Data Lineage Visualizer kernel tests — impact analysis (upstream/downstream
// BFS with depths, multi-level chains, branching), git version annotation,
// GraphML/JSON exporters and the run-history adapter.
import { describe, it, expect } from 'vitest';
import { buildLineage } from '@/core/lineage/graph';
import type { LineageFile, LineageGraph } from '@/core/lineage/graph';
import type { RunRecord } from '@/core/experiment/record';
import type { PluginRunRecord } from '@/types/plugin';
import {
  annotateVersions,
  computeLineageStats,
  downstreamOf,
  impactAnalysis,
  lineageJsonToGraph,
  longestChainDepth,
  runsFromHistory,
  toGraphml,
  toLineageJson,
  upstreamOf,
} from '@/plugins/builtin/dataeng/lineage/kernel';
import type { CommitRef, LineageJson } from '@/plugins/builtin/dataeng/lineage/kernel';

/** Minimal deterministic RunRecord factory (no crypto dependency). */
function makeRun(partial: Partial<RunRecord> & { id: string }): RunRecord {
  return {
    projectId: 'p1',
    source: 'sql',
    label: `run ${partial.id}`,
    params: {},
    inputFileIds: [],
    outputFileIds: [],
    metrics: {},
    seed: null,
    failed: false,
    createdAt: 0,
    durationMs: 0,
    ...partial,
  };
}

/** Four-level chain: raw.csv → clean → clean.csv → model → report.csv
 *  plus a branch clean.csv → stats → stats.csv. */
function syntheticGraph(): LineageGraph {
  const files: LineageFile[] = [
    { id: 'f-raw', name: 'raw.csv' },
    { id: 'f-clean', name: 'clean.csv' },
    { id: 'f-report', name: 'report.csv' },
    { id: 'f-stats', name: 'stats.csv' },
  ];
  const runs: RunRecord[] = [
    makeRun({ id: 'r-clean', inputFileIds: ['f-raw'], outputFileIds: ['f-clean'] }),
    makeRun({ id: 'r-report', inputFileIds: ['f-clean'], outputFileIds: ['f-report'] }),
    makeRun({ id: 'r-stats', inputFileIds: ['f-clean'], outputFileIds: ['f-stats'], failed: true }),
  ];
  return buildLineage(files, runs);
}

describe('impact analysis', () => {
  const graph = syntheticGraph();

  it('builds a file/run DAG with the expected structure', () => {
    // 4 files + 3 runs
    expect(graph.nodes).toHaveLength(7);
    // raw→clean, clean→report, report (2 edges each side) + stats branch
    expect(graph.edges).toHaveLength(6);
    expect(graph.nodes.filter((n) => n.kind === 'file')).toHaveLength(4);
    expect(graph.nodes.filter((n) => n.kind === 'run')).toHaveLength(3);
  });

  it('walks all upstream data sources across multi-level chains (BFS order)', () => {
    expect(upstreamOf(graph, 'file:f-report')).toEqual([
      'run:r-report',
      'file:f-clean',
      'run:r-clean',
      'file:f-raw',
    ]);
  });

  it('walks all downstream affected outputs across multi-level chains', () => {
    expect(downstreamOf(graph, 'file:f-raw')).toEqual([
      'run:r-clean',
      'file:f-clean',
      'run:r-report',
      'run:r-stats',
      'file:f-report',
      'file:f-stats',
    ]);
  });

  it('returns an empty upstream set for root sources', () => {
    expect(upstreamOf(graph, 'file:f-raw')).toEqual([]);
  });

  it('returns an empty downstream set for terminal outputs', () => {
    expect(downstreamOf(graph, 'file:f-report')).toEqual([]);
  });

  it('reports depths for both directions on a mid-chain node', () => {
    const impact = impactAnalysis(graph, 'file:f-clean');
    expect(impact.root).toBe('file:f-clean');
    expect(impact.upstream).toEqual([
      { id: 'run:r-clean', depth: 1 },
      { id: 'file:f-raw', depth: 2 },
    ]);
    expect(impact.downstream).toEqual([
      { id: 'run:r-report', depth: 1 },
      { id: 'run:r-stats', depth: 1 },
      { id: 'file:f-report', depth: 2 },
      { id: 'file:f-stats', depth: 2 },
    ]);
  });

  it('handles unknown and isolated nodes without throwing', () => {
    const impact = impactAnalysis(graph, 'node:missing');
    expect(impact.upstream).toEqual([]);
    expect(impact.downstream).toEqual([]);
  });

  it('measures the longest chain depth in edges', () => {
    expect(longestChainDepth(graph)).toBe(4);
    expect(longestChainDepth({ nodes: [], edges: [] })).toBe(0);
  });
});

describe('version annotation', () => {
  const graph = syntheticGraph();
  const commits: CommitRef[] = [
    { hash: 'a111111fffffffffffffffffffffffffffffff', shortHash: 'a111111', message: 'data: raw.csv import', timestamp: 100 },
    { hash: 'b222222fffffffffffffffffffffffffffffff', shortHash: 'b222222', message: 'run: clean pipeline (clean.csv)', timestamp: 200 },
    { hash: 'c333333fffffffffffffffffffffffffffffff', shortHash: 'c333333', message: 'data: report.csv export', timestamp: 300 },
    { hash: 'd444444fffffffffffffffffffffffffffffff', shortHash: 'd444444', message: 'data: raw.csv corrected', timestamp: 400 },
  ];

  it('associates each file with its latest matching commit', () => {
    const { versions } = annotateVersions(graph, commits);
    expect(versions['file:f-raw']?.shortHash).toBe('d444444');
    expect(versions['file:f-report']?.shortHash).toBe('c333333');
    expect(versions['file:f-clean']?.shortHash).toBe('b222222');
    // stats.csv is never committed — stays unversioned.
    expect(versions['file:f-stats']).toBeUndefined();
  });

  it('degrades to an unversioned graph with no commits', () => {
    const { versions } = annotateVersions(graph, []);
    expect(versions).toEqual({});
  });

  it('never version-annotates run nodes', () => {
    const { versions } = annotateVersions(graph, commits);
    for (const key of Object.keys(versions)) {
      expect(key.startsWith('file:')).toBe(true);
    }
  });
});

describe('GraphML export', () => {
  const graph = syntheticGraph();

  it('emits a valid GraphML document with the right node/edge counts', () => {
    const xml = toGraphml(graph);
    expect(xml).toContain('<graphml');
    expect(xml.trim().endsWith('</graphml>')).toBe(true);
    expect(xml).toContain('<graph id="lineage" edgedefault="directed">');
    expect(xml.match(/<node /g)).toHaveLength(7);
    expect(xml.match(/<edge /g)).toHaveLength(6);
    expect(xml).toContain('attr.name="kind"');
    expect(xml).toContain('attr.name="label"');
    expect(xml).toContain('<data key="d_kind">file</data>');
    expect(xml).toContain('<data key="d_kind">run</data>');
    expect(xml).toContain('<edge source="file:f-raw" target="run:r-clean"/>');
  });

  it('escapes XML-special characters in labels', () => {
    const g = buildLineage([{ id: 'x', name: 'a<b>&"c.csv"' }], []);
    const xml = toGraphml(g);
    expect(xml).toContain('a&lt;b&gt;&amp;&quot;c.csv&quot;');
    expect(xml).not.toContain('a<b>');
  });

  it('carries the version annotation as a node data key', () => {
    const annotated = annotateVersions(graph, [
      { hash: 'a111111fffffffffffffffffffffffffffffff', shortHash: 'a111111', message: 'data: raw.csv', timestamp: 1 },
    ]);
    const xml = toGraphml(annotated.graph, annotated.versions);
    expect(xml).toContain('<data key="d_version">a111111</data>');
  });
});

describe('JSON export round trip', () => {
  const graph = syntheticGraph();
  const annotated = annotateVersions(graph, [
    { hash: 'a111111fffffffffffffffffffffffffffffff', shortHash: 'a111111', message: 'data: raw.csv', timestamp: 1 },
  ]);

  it('produces a self-describing document with counts', () => {
    const doc = toLineageJson(annotated.graph, annotated.versions);
    expect(doc.format).toBe('ergalics-lineage');
    expect(doc.version).toBe(1);
    expect(doc.generatedAt).toBeTruthy();
    expect(doc.counts).toEqual({ nodes: 7, edges: 6, files: 4, runs: 3 });
  });

  it('round-trips through JSON.parse back to an equal graph', () => {
    const doc = toLineageJson(annotated.graph, annotated.versions);
    const reparsed = JSON.parse(JSON.stringify(doc)) as LineageJson;
    expect(reparsed.nodes).toHaveLength(doc.nodes.length);
    expect(reparsed.edges).toEqual(doc.edges);
    const restored = lineageJsonToGraph(reparsed);
    expect(restored.nodes).toEqual(annotated.graph.nodes);
    expect(restored.edges).toEqual(annotated.graph.edges);
  });

  it('keeps run metadata (source/failed) and version info in the payload', () => {
    const doc = toLineageJson(annotated.graph, annotated.versions);
    const failed = doc.nodes.find((n) => n.id === 'run:r-stats');
    expect(failed?.failed).toBe(true);
    expect(failed?.source).toBe('sql');
    const versioned = doc.nodes.find((n) => n.id === 'file:f-raw');
    expect(versioned?.version?.shortHash).toBe('a111111');
  });
});

describe('run-history adapter', () => {
  const files: LineageFile[] = [
    { id: 'f-raw', name: 'raw.csv' },
    { id: 'f-clean', name: 'clean.csv' },
  ];

  it('maps import runs to their project file as output', () => {
    const history: PluginRunRecord[] = [
      { id: 'h-import', pluginId: 'p', kind: 'data-import', label: 'raw.csv', startedAt: 10, ok: true },
    ];
    const runs = runsFromHistory(history, files);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.outputFileIds).toEqual(['f-raw']);
    expect(runs[0]?.inputFileIds).toEqual([]);
    expect(runs[0]?.failed).toBe(false);

    const graph = buildLineage(files, runs);
    expect(graph.edges).toContainEqual({ from: 'run:h-import', to: 'file:f-raw' });
  });

  it('maps compute runs to file ids from detail and keeps failures', () => {
    const history: PluginRunRecord[] = [
      {
        id: 'h-fit',
        pluginId: 'p',
        kind: 'compute',
        label: 'fit model',
        startedAt: 20,
        ok: false,
        detail: { inputFileIds: ['f-raw', 'ghost'], outputFileIds: ['f-clean'] },
      },
    ];
    const runs = runsFromHistory(history, files);
    expect(runs[0]?.inputFileIds).toEqual(['f-raw']); // unknown ids filtered
    expect(runs[0]?.outputFileIds).toEqual(['f-clean']);
    expect(runs[0]?.failed).toBe(true);

    const graph = buildLineage(files, runs);
    expect(graph.edges).toContainEqual({ from: 'file:f-raw', to: 'run:h-fit' });
    // downstream impact through an adapted history run
    expect(downstreamOf(graph, 'file:f-raw')).toContain('file:f-clean');
  });

  it('keeps history runs without resolvable files as isolated nodes', () => {
    const history: PluginRunRecord[] = [
      { id: 'h-custom', pluginId: 'p', kind: 'custom', label: 'mystery step', startedAt: 30 },
    ];
    const graph = buildLineage(files, runsFromHistory(history, files));
    expect(graph.nodes.some((n) => n.id === 'run:h-custom')).toBe(true);
    expect(graph.edges.filter((e) => e.from === 'run:h-custom' || e.to === 'run:h-custom')).toHaveLength(0);
  });
});

describe('aggregated statistics', () => {
  it('summarises counts, depth and versioned files', () => {
    const graph = syntheticGraph();
    const annotated = annotateVersions(graph, [
      { hash: 'a111111fffffffffffffffffffffffffffffff', shortHash: 'a111111', message: 'data: raw.csv', timestamp: 1 },
      { hash: 'c333333fffffffffffffffffffffffffffffff', shortHash: 'c333333', message: 'data: report.csv', timestamp: 2 },
    ]);
    expect(computeLineageStats(annotated.graph, annotated.versions)).toEqual({
      nodes: 7,
      edges: 6,
      files: 4,
      runs: 3,
      longestChainDepth: 4,
      versionedFiles: 2,
    });
  });
});
