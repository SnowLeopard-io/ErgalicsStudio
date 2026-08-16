// ==========================================================================
// Ergalics Studio — block-graph compiler (block system)
//
// Pure function: BlockGraph → CompiledRegion. It validates (nodes, ports,
// types, required inputs), detects cycles, topologically sorts, and derives
// per-node input/output maps. It never throws — errors come back as
// diagnostics so the UI can surface them.
// ==========================================================================

import type {
  BlockConnection,
  BlockGraph,
  BlockInstance,
  BlockMeta,
  BlockRegistry,
  PortDef,
} from '@/types/block';
import type { CompiledNode, CompiledRegion } from '@/types/dag';

export type DiagnosticSeverity = 'error' | 'warning';

export interface CompileDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  nodeId?: string;
  portId?: string;
}

export interface CompileResult {
  ok: boolean;
  program?: CompiledRegion;
  diagnostics: CompileDiagnostic[];
}

export function compile(graph: BlockGraph, registry: BlockRegistry): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];

  // 1. Resolve instances → metadata; flag duplicate / unknown ids.
  const instances = new Map<string, BlockInstance>();
  const metas = new Map<string, BlockMeta>();
  for (const inst of graph.instances) {
    if (instances.has(inst.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate_node',
        message: `duplicate node id "${inst.id}"`,
        nodeId: inst.id,
      });
      continue;
    }
    const meta = registry.get(inst.blockId);
    if (!meta) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown_block',
        message: `unknown block "${inst.blockId}"`,
        nodeId: inst.id,
      });
      continue;
    }
    instances.set(inst.id, inst);
    metas.set(inst.id, meta);
  }

  // 2. Validate connections and derive input/output maps.
  const inputs = new Map<string, Record<string, string>>();
  const outputs = new Map<string, Record<string, string[]>>();
  for (const id of instances.keys()) {
    inputs.set(id, {});
    outputs.set(id, {});
  }
  for (const conn of graph.connections) {
    validateConnection(conn, metas, inputs, outputs, diagnostics);
  }

  // 3. Required input ports must be connected.
  for (const inst of graph.instances) {
    const meta = metas.get(inst.id);
    if (!meta) continue;
    const nodeInputs = inputs.get(inst.id) ?? {};
    for (const port of meta.inputs) {
      if (port.required && !nodeInputs[port.id]) {
        diagnostics.push({
          severity: 'error',
          code: 'missing_required_input',
          message: `required input "${port.id}" of node "${inst.id}" is not connected`,
          nodeId: inst.id,
          portId: port.id,
        });
      }
    }
  }

  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics };
  }

  // 4. Topological sort (also detects cycles).
  const order = topoSort([...instances.keys()], inputs, outputs);
  if (!order) {
    diagnostics.push({
      severity: 'error',
      code: 'cycle_detected',
      message: 'the block graph contains a cycle (data-flow must be acyclic)',
    });
    return { ok: false, diagnostics };
  }

  // 5. Build compiled nodes in execution order.
  const nodes: CompiledNode[] = order.map((id) => {
    const inst = instances.get(id)!;
    const meta = metas.get(id)!;
    return {
      id,
      blockId: inst.blockId,
      label: meta.name,
      params: { ...meta.defaultParams, ...inst.params },
      inputs: inputs.get(id) ?? {},
      outputs: outputs.get(id) ?? {},
      execute: registry.getExecutor(inst.blockId),
      control: meta.control?.kind,
    };
  });

  return {
    ok: true,
    program: { id: graph.id, nodes, executionOrder: order },
    diagnostics,
  };
}

function validateConnection(
  conn: BlockConnection,
  metas: Map<string, BlockMeta>,
  inputs: Map<string, Record<string, string>>,
  outputs: Map<string, Record<string, string[]>>,
  diagnostics: CompileDiagnostic[],
): void {
  const fromMeta = metas.get(conn.from.nodeId);
  if (!fromMeta) {
    diagnostics.push({
      severity: 'error',
      code: 'unknown_from_node',
      message: `connection references unknown source node "${conn.from.nodeId}"`,
      nodeId: conn.from.nodeId,
    });
    return;
  }
  const toMeta = metas.get(conn.to.nodeId);
  if (!toMeta) {
    diagnostics.push({
      severity: 'error',
      code: 'unknown_to_node',
      message: `connection references unknown target node "${conn.to.nodeId}"`,
      nodeId: conn.to.nodeId,
    });
    return;
  }

  const fromPort = findPort(fromMeta.outputs, conn.from.portId);
  if (!fromPort) {
    diagnostics.push({
      severity: 'error',
      code: 'unknown_from_port',
      message: `node "${conn.from.nodeId}" has no output port "${conn.from.portId}"`,
      nodeId: conn.from.nodeId,
      portId: conn.from.portId,
    });
    return;
  }
  const toPort = findPort(toMeta.inputs, conn.to.portId);
  if (!toPort) {
    diagnostics.push({
      severity: 'error',
      code: 'unknown_to_port',
      message: `node "${conn.to.nodeId}" has no input port "${conn.to.portId}"`,
      nodeId: conn.to.nodeId,
      portId: conn.to.portId,
    });
    return;
  }

  if (fromPort.type !== toPort.type) {
    diagnostics.push({
      severity: 'error',
      code: 'port_type_mismatch',
      message: `cannot connect a ${fromPort.type} output to a ${toPort.type} input`,
      nodeId: conn.to.nodeId,
      portId: conn.to.portId,
    });
    return;
  }

  if (fromPort.dataType && toPort.dataType && fromPort.dataType !== toPort.dataType) {
    diagnostics.push({
      severity: 'error',
      code: 'type_mismatch',
      message: `cannot connect ${fromPort.dataType} output to ${toPort.dataType} input`,
      nodeId: conn.to.nodeId,
      portId: conn.to.portId,
    });
    return;
  }

  const nodeInputs = inputs.get(conn.to.nodeId)!;
  if (nodeInputs[conn.to.portId]) {
    diagnostics.push({
      severity: 'error',
      code: 'duplicate_input',
      message: `input port "${conn.to.portId}" of node "${conn.to.nodeId}" already has a source`,
      nodeId: conn.to.nodeId,
      portId: conn.to.portId,
    });
    return;
  }

  nodeInputs[conn.to.portId] = conn.from.nodeId;
  const nodeOutputs = outputs.get(conn.from.nodeId)!;
  nodeOutputs[conn.from.portId] = [...(nodeOutputs[conn.from.portId] ?? []), conn.to.nodeId];
}

function findPort(ports: PortDef[], id: string): PortDef | undefined {
  return ports.find((p) => p.id === id);
}

function topoSort(
  nodeIds: string[],
  inputs: Map<string, Record<string, string>>,
  outputs: Map<string, Record<string, string[]>>,
): string[] | null {
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    indegree.set(id, Object.keys(inputs.get(id) ?? {}).length);
  }

  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const out = outputs.get(id) ?? {};
    for (const downstreamIds of Object.values(out)) {
      for (const downstream of downstreamIds) {
        const next = (indegree.get(downstream) ?? 0) - 1;
        indegree.set(downstream, next);
        if (next === 0) queue.push(downstream);
      }
    }
  }

  return order.length === nodeIds.length ? order : null;
}

function hasErrors(diagnostics: CompileDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
