// ==========================================================================
// Ergalics Studio — data lineage graph & layered layout (pure TS, data layer)
//
// Lineage connects project files (sources) to run records (transformations)
// via the file ids recorded on each run. The layout is a Sugiyama-style
// layered DAG drawing: longest-path layering, single-sweep barycenter
// ordering, centered rows. No React, no stores, no DOM.
// ==========================================================================

import type { RunRecord } from '@/core/experiment/record';

/** A lineage graph node: a project file or a run. */
export interface LineageNode {
  id: string;
  kind: 'file' | 'run';
  label: string;
  createdAt: number;
  /** run nodes only */
  source?: RunRecord['source'];
  failed?: boolean;
}

export interface LineageEdge {
  from: string;
  to: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/** Minimal file shape needed for lineage (subset of project FileEntry). */
export interface LineageFile {
  id: string;
  name: string;
}

/** Computed drawing position of one node. */
export interface LineagePosition {
  /** Layer index (left → right). */
  layer: number;
  /** Row index inside the layer (top → bottom). */
  row: number;
  /** Pixel coordinates (upper-left of the node box). */
  x: number;
  y: number;
}

export interface LineageLayout {
  positions: Record<string, LineagePosition>;
  /** Total drawing width/height in px. */
  width: number;
  height: number;
}

export interface LayoutOptions {
  colWidth?: number;
  rowHeight?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

/**
 * Build the lineage graph. Edges are only emitted between nodes that exist
 * (dangling file references from stale runs are skipped); isolated runs are
 * kept so the graph still shows execution history.
 */
export function buildLineage(files: LineageFile[], runs: RunRecord[]): LineageGraph {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  const fileIds = new Set<string>();
  for (const f of files) {
    if (!fileIds.has(f.id)) {
      fileIds.add(f.id);
      nodes.push({ id: `file:${f.id}`, kind: 'file', label: f.name, createdAt: 0 });
    }
  }
  for (const run of runs) {
    const runId = `run:${run.id}`;
    nodes.push({
      id: runId,
      kind: 'run',
      label: run.label || run.source,
      createdAt: run.createdAt,
      source: run.source,
      failed: run.failed,
    });
    for (const fileId of run.inputFileIds) {
      if (fileIds.has(fileId)) {
        edges.push({ from: `file:${fileId}`, to: runId });
      }
    }
    // Outputs saved back into the project (e.g. SQL result CSV) get a
    // run → file edge so the DAG chains sources → run → derived file.
    for (const fileId of run.outputFileIds) {
      if (fileIds.has(fileId)) {
        edges.push({ from: runId, to: `file:${fileId}` });
      }
    }
  }
  return { nodes, edges };
}

/** Cycle-safe longest-path layering (fixed-point, capped by node count). */
function computeLayers(graph: LineageGraph): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const n of graph.nodes) incoming.set(n.id, []);
  for (const e of graph.edges) incoming.get(e.to)?.push(e.from);

  const layer = new Map<string, number>();
  for (const n of graph.nodes) layer.set(n.id, 0);

  const maxPasses = graph.nodes.length + 1;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const n of graph.nodes) {
      const preds = incoming.get(n.id)!;
      if (preds.length === 0) continue;
      // Skip predecessors that are not placed yet (cycles converge to 0).
      let max = -1;
      for (const p of preds) max = Math.max(max, layer.get(p) ?? 0);
      const next = max + 1;
      if (next !== layer.get(n.id)) {
        // A cycle would oscillate upward forever; a node can never exceed
        // the node count in an acyclic graph, so clamp there.
        if (next > graph.nodes.length) continue;
        layer.set(n.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

/**
 * Layered DAG layout: nodes are grouped into layers (longest path from a
 * root), ordered within each layer by the barycenter of their predecessors'
 * rows (one sweep, tie → input order), then centered vertically. Row/column
 * assignment is unique per node — no two boxes overlap.
 */
export function layoutDag(graph: LineageGraph, opts: LayoutOptions = {}): LineageLayout {
  const colWidth = opts.colWidth ?? 208;
  const rowHeight = opts.rowHeight ?? 56;
  const nodeWidth = opts.nodeWidth ?? 152;
  const nodeHeight = opts.nodeHeight ?? 36;

  if (graph.nodes.length === 0) {
    return { positions: {}, width: 0, height: 0 };
  }

  const layer = computeLayers(graph);

  // Group by layer, preserving insertion order as the initial ordering.
  const layers = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const l = layer.get(n.id) ?? 0;
    const bucket = layers.get(l);
    if (bucket) bucket.push(n.id);
    else layers.set(l, [n.id]);
  }
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);

  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = incoming.get(e.to);
    if (list) list.push(e.from);
    else incoming.set(e.to, [e.from]);
  }

  // One barycenter sweep: sort each layer by the mean predecessor row.
  const rowOf = new Map<string, number>();
  for (const l of sortedLayers) {
    const ids = layers.get(l)!;
    for (let i = 0; i < ids.length; i += 1) rowOf.set(ids[i]!, i);
  }
  for (const l of sortedLayers) {
    const ids = layers.get(l)!;
    const scored = ids.map((id, index) => {
      const preds = incoming.get(id) ?? [];
      const rows = preds.map((p) => rowOf.get(p)).filter((r): r is number => r !== undefined);
      const bary = rows.length > 0 ? rows.reduce((a, b) => a + b, 0) / rows.length : index;
      return { id, bary, index };
    });
    scored.sort((a, b) => a.bary - b.bary || a.index - b.index);
    layers.set(l, scored.map((s) => s.id));
  }

  // Place: x by layer, y centered per layer.
  const positions: Record<string, LineagePosition> = {};
  const maxRows = Math.max(...sortedLayers.map((l) => layers.get(l)!.length));
  const height = maxRows * rowHeight;
  let maxLayer = 0;
  for (const l of sortedLayers) {
    maxLayer = Math.max(maxLayer, l);
    const ids = layers.get(l)!;
    const blockHeight = ids.length * rowHeight;
    const top = (height - blockHeight) / 2;
    ids.forEach((id, row) => {
      rowOf.set(id, row);
      positions[id] = {
        layer: l,
        row,
        x: l * colWidth,
        y: top + row * rowHeight,
      };
    });
  }

  return {
    positions,
    width: (maxLayer + 1) * colWidth - (colWidth - nodeWidth),
    height: Math.max(height - (rowHeight - nodeHeight), nodeHeight),
  };
}
