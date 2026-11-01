// ==========================================================================
// Data Lineage Visualizer — pure kernel (no React, no stores, no DOM).
//
// Extends the core lineage layer (`buildLineage`) with:
//   - upstream/downstream reachability (BFS, cycle-safe) with depths
//   - impact analysis (affected node set + depth per node)
//   - git-commit version annotation for file nodes
//   - self-describing JSON export (round-trippable) and GraphML export
//   - an adapter turning the host plugin-store run history into RunRecord-
//     shaped inputs so `buildLineage` can consume it unchanged
// ==========================================================================

import type { RunRecord } from '@/core/experiment/record';
import type { LineageEdge, LineageFile, LineageGraph, LineageNode } from '@/core/lineage/graph';
import type { PluginRunRecord } from '@/types/plugin';

// ---- Impact analysis --------------------------------------------------------

/** One reachable node with its BFS depth (1 = direct neighbour). */
export interface ImpactNode {
  id: string;
  depth: number;
}

export interface ImpactAnalysisResult {
  /** The node the analysis was rooted at. */
  root: string;
  /** Data sources feeding the root, nearest first. */
  upstream: ImpactNode[];
  /** Outputs affected by the root, nearest first. */
  downstream: ImpactNode[];
}

interface Adjacency {
  succ: Map<string, string[]>;
  pred: Map<string, string[]>;
}

function adjacencyOf(graph: LineageGraph): Adjacency {
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  for (const n of graph.nodes) {
    succ.set(n.id, []);
    pred.set(n.id, []);
  }
  for (const e of graph.edges) {
    succ.get(e.from)?.push(e.to);
    pred.get(e.to)?.push(e.from);
  }
  return { succ, pred };
}

/** BFS over one direction of the DAG; returns reachable ids with depths. */
function bfs(
  adjacency: Map<string, string[]>,
  start: string,
): ImpactNode[] {
  const out: ImpactNode[] = [];
  const visited = new Set<string>([start]);
  let frontier = [start];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        out.push({ id: neighbour, depth });
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return out;
}

/** All upstream (data source) node ids of `nodeId`, BFS order, root excluded. */
export function upstreamOf(graph: LineageGraph, nodeId: string): string[] {
  return bfs(adjacencyOf(graph).pred, nodeId).map((n) => n.id);
}

/** All downstream (affected output) node ids of `nodeId`, BFS order, root excluded. */
export function downstreamOf(graph: LineageGraph, nodeId: string): string[] {
  return bfs(adjacencyOf(graph).succ, nodeId).map((n) => n.id);
}

/**
 * Impact analysis of `nodeId`: its upstream data sources and downstream
 * affected outputs, each with BFS depth. Unknown / isolated nodes yield two
 * empty sets (never throws).
 */
export function impactAnalysis(graph: LineageGraph, nodeId: string): ImpactAnalysisResult {
  const adj = adjacencyOf(graph);
  return {
    root: nodeId,
    upstream: bfs(adj.pred, nodeId),
    downstream: bfs(adj.succ, nodeId),
  };
}

/**
 * Longest chain depth: the number of edges on the longest directed path.
 * Fixed-point layering (same semantics as the core layout), capped by node
 * count so cycles converge instead of looping forever.
 */
export function longestChainDepth(graph: LineageGraph): number {
  if (graph.nodes.length === 0) return 0;
  const { pred } = adjacencyOf(graph);
  const layer = new Map<string, number>();
  for (const n of graph.nodes) layer.set(n.id, 0);
  const maxPasses = graph.nodes.length + 1;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const n of graph.nodes) {
      const preds = pred.get(n.id) ?? [];
      if (preds.length === 0) continue;
      let max = -1;
      for (const p of preds) max = Math.max(max, layer.get(p) ?? 0);
      const next = max + 1;
      // A cycle would oscillate upward forever; a node can never exceed the
      // node count in an acyclic graph, so clamp there.
      if (next !== layer.get(n.id) && next <= graph.nodes.length) {
        layer.set(n.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  let max = 0;
  for (const v of layer.values()) max = Math.max(max, v);
  return max;
}

// ---- Version annotation -----------------------------------------------------

/** Loose commit shape accepted by `annotateVersions` (GitCommit-compatible). */
export interface CommitRef {
  hash: string;
  shortHash?: string;
  message: string;
  timestamp: number;
}

/** Version info attached to one file node. */
export interface LineageVersionInfo {
  hash: string;
  shortHash: string;
  message: string;
  timestamp: number;
}

export interface AnnotatedLineage {
  graph: LineageGraph;
  /** `file:<id>` node id → latest matching commit. Absent = unversioned. */
  versions: Record<string, LineageVersionInfo>;
}

/** Node id prefix used by the core `buildLineage` for project files. */
export function fileNodeId(fileId: string): string {
  return `file:${fileId}`;
}

/**
 * Associate every file node with the most recent commit whose message
 * mentions the file name (auto-commit messages embed the file name, e.g.
 * `data: sensors.csv`). Deterministic: latest timestamp wins, ties break on
 * the first commit in the input order. Files with no matching commit stay
 * unversioned — the caller degrades to the no-version mode.
 */
export function annotateVersions(
  graph: LineageGraph,
  commits: readonly CommitRef[],
): AnnotatedLineage {
  const versions: Record<string, LineageVersionInfo> = {};
  if (commits.length === 0) return { graph, versions };
  for (const node of graph.nodes) {
    if (node.kind !== 'file') continue;
    const needle = node.label.trim().toLowerCase();
    // Names shorter than 3 chars would match almost every message — skip.
    if (needle.length < 3) continue;
    let best: CommitRef | null = null;
    for (const commit of commits) {
      if (!commit.message.toLowerCase().includes(needle)) continue;
      if (!best || commit.timestamp > best.timestamp) best = commit;
    }
    if (best) {
      versions[node.id] = {
        hash: best.hash,
        shortHash: best.shortHash ?? best.hash.slice(0, 7),
        message: best.message,
        timestamp: best.timestamp,
      };
    }
  }
  return { graph, versions };
}

// ---- Exporters --------------------------------------------------------------

export interface LineageJsonNode {
  id: string;
  kind: 'file' | 'run';
  label: string;
  createdAt: number;
  source?: RunRecord['source'];
  failed?: boolean;
  version?: LineageVersionInfo;
}

/** Self-describing JSON document (the `format`/`version` fields make the
 *  payload identifiable and evolvable without external schema). */
export interface LineageJson {
  format: 'ergalics-lineage';
  version: 1;
  generatedAt: string;
  counts: { nodes: number; edges: number; files: number; runs: number };
  nodes: LineageJsonNode[];
  edges: LineageEdge[];
}

/**
 * Serialize a lineage graph to a self-describing JSON document. Pure data —
 * `JSON.stringify` the result for download; `lineageJsonToGraph` reverses it.
 */
export function toLineageJson(
  graph: LineageGraph,
  versions: Record<string, LineageVersionInfo> = {},
): LineageJson {
  return {
    format: 'ergalics-lineage',
    version: 1,
    generatedAt: new Date().toISOString(),
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      files: graph.nodes.filter((n) => n.kind === 'file').length,
      runs: graph.nodes.filter((n) => n.kind === 'run').length,
    },
    nodes: graph.nodes.map((n) => {
      const out: LineageJsonNode = {
        id: n.id,
        kind: n.kind,
        label: n.label,
        createdAt: n.createdAt,
      };
      if (n.kind === 'run') {
        out.source = n.source;
        out.failed = n.failed ?? false;
      }
      const version = versions[n.id];
      if (version) out.version = version;
      return out;
    }),
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

/** Rebuild a lineage graph from a parsed `toLineageJson` document. */
export function lineageJsonToGraph(json: LineageJson): LineageGraph {
  const nodes: LineageNode[] = json.nodes.map((n) => {
    const node: LineageNode = {
      id: n.id,
      kind: n.kind,
      label: n.label,
      createdAt: n.createdAt,
    };
    if (n.kind === 'run') {
      node.source = n.source;
      node.failed = n.failed;
    }
    return node;
  });
  const edges: LineageEdge[] = json.edges.map((e) => ({ from: e.from, to: e.to }));
  return { nodes, edges };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Serialize a lineage graph to GraphML (keyed XML, directed graph). Node
 * elements carry `kind`, `label` and (when annotated) `version` data keys.
 */
export function toGraphml(
  graph: LineageGraph,
  versions: Record<string, LineageVersionInfo> = {},
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"' +
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
      ' xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns' +
      ' http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">',
  );
  lines.push('  <key id="d_kind" for="node" attr.name="kind" attr.type="string"/>');
  lines.push('  <key id="d_label" for="node" attr.name="label" attr.type="string"/>');
  lines.push('  <key id="d_version" for="node" attr.name="version" attr.type="string"/>');
  lines.push('  <graph id="lineage" edgedefault="directed">');
  for (const n of graph.nodes) {
    lines.push(`    <node id="${escapeXml(n.id)}">`);
    lines.push(`      <data key="d_kind">${escapeXml(n.kind)}</data>`);
    lines.push(`      <data key="d_label">${escapeXml(n.label)}</data>`);
    const version = versions[n.id];
    if (version) {
      lines.push(`      <data key="d_version">${escapeXml(version.shortHash)}</data>`);
    }
    lines.push('    </node>');
  }
  for (const e of graph.edges) {
    lines.push(`    <edge source="${escapeXml(e.from)}" target="${escapeXml(e.to)}"/>`);
  }
  lines.push('  </graph>');
  lines.push('</graphml>');
  return lines.join('\n');
}

// ---- Run-history adapter ----------------------------------------------------

/**
 * Convert the host plugin-store run history (`PluginRunRecord[]`, which does
 * not carry file ids) into RunRecord-shaped inputs for `buildLineage`:
 *  - `data-import` runs connect to the project file matching their label
 *    (the imported file is the run's output);
 *  - `compute`/`custom` runs pick up optional `inputFileIds`/`outputFileIds`
 *    string arrays from their `detail`, filtered to known project files;
 *  - runs without any resolvable file stay in the graph as isolated history
 *    nodes (same convention as the core `buildLineage`).
 */
export function runsFromHistory(
  history: readonly PluginRunRecord[],
  files: readonly LineageFile[],
): RunRecord[] {
  const byName = new Map<string, string>();
  for (const f of files) byName.set(f.name.trim().toLowerCase(), f.id);
  const known = new Set(files.map((f) => f.id));

  const fileIdsFrom = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string' && known.has(v));
  };

  return history.map((record): RunRecord => {
    const detail = record.detail ?? {};
    const label = record.label?.trim() ?? '';
    const matchedFileId =
      (label.length > 0 ? byName.get(label.toLowerCase()) : undefined) ?? undefined;
    const isImport = record.kind === 'data-import';

    const inputFileIds = fileIdsFrom(detail['inputFileIds']);
    const outputFileIds = fileIdsFrom(detail['outputFileIds']);
    if (isImport && matchedFileId && !outputFileIds.includes(matchedFileId)) {
      outputFileIds.push(matchedFileId);
    }

    const source: RunRecord['source'] =
      record.kind === 'data-import' ? 'flow' : record.kind === 'compute' ? 'code' : 'inference';

    return {
      id: record.id,
      projectId: 'lineage-view',
      source,
      label: record.label ?? record.kind,
      params: {},
      inputFileIds,
      outputFileIds,
      metrics: {},
      seed: null,
      failed: record.ok === false,
      createdAt: record.startedAt,
      durationMs: record.durationMs ?? 0,
    };
  });
}

// ---- Aggregated statistics (science outputs) --------------------------------

export interface LineageStats {
  nodes: number;
  edges: number;
  files: number;
  runs: number;
  /** Edges on the longest directed chain (0 for an empty graph). */
  longestChainDepth: number;
  /** File nodes carrying a git version annotation. */
  versionedFiles: number;
}

export function computeLineageStats(
  graph: LineageGraph,
  versions: Record<string, LineageVersionInfo> = {},
): LineageStats {
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    files: graph.nodes.filter((n) => n.kind === 'file').length,
    runs: graph.nodes.filter((n) => n.kind === 'run').length,
    longestChainDepth: longestChainDepth(graph),
    versionedFiles: Object.keys(versions).length,
  };
}
