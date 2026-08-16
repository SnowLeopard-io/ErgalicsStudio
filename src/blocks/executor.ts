// ==========================================================================
// Ergalics Studio — DAG executor (block system)
//
// Runs a compiled region with incremental recompute: outputs are cached per
// node, and `invalidate` marks a node plus its transitive downstream dirty.
// Only dirty nodes re-run. Node-scoped contexts are built here.
// ==========================================================================

import type { DataValue } from '@/types/datatable';
import type { CompiledNode, CompiledRegion, DagExecutionContext } from '@/types/dag';
import type { RuntimeEnvironment } from './context';

export class DagExecutor {
  private readonly cache = new Map<string, DataValue>();
  private readonly dirty = new Set<string>();
  private readonly region: CompiledRegion;
  private readonly env: RuntimeEnvironment;
  private readonly nodeById = new Map<string, CompiledNode>();

  constructor(region: CompiledRegion, env: RuntimeEnvironment) {
    this.region = region;
    this.env = env;
    for (const node of region.nodes) {
      this.nodeById.set(node.id, node);
    }
    // Everything starts dirty so the first run computes the whole graph.
    for (const id of region.executionOrder) {
      this.dirty.add(id);
    }
  }

  /** Run all dirty nodes in topological order. Returns the full cache. */
  async run(): Promise<ReadonlyMap<string, DataValue>> {
    for (const id of this.region.executionOrder) {
      if (!this.dirty.has(id)) continue;
      const node = this.nodeById.get(id);
      if (!node) continue;
      this.env.onNodeStatus?.(id, 'computing');
      try {
        await this.runNode(node);
        this.dirty.delete(id);
        this.env.onNodeStatus?.(id, 'done');
      } catch (err) {
        this.env.onNodeStatus?.(id, 'error');
        throw err;
      }
    }
    return this.cache;
  }

  /** Mark a node and all its transitive downstream as dirty. */
  invalidate(nodeId: string): void {
    const stack: string[] = [nodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (this.dirty.has(id)) continue;
      this.dirty.add(id);
      const node = this.nodeById.get(id);
      if (!node) continue;
      for (const downstream of Object.values(node.outputs)) {
        for (const d of downstream) stack.push(d);
      }
    }
  }

  getOutput(nodeId: string): DataValue | undefined {
    return this.cache.get(nodeId);
  }

  getCache(): ReadonlyMap<string, DataValue> {
    return this.cache;
  }

  isDirty(nodeId: string): boolean {
    return this.dirty.has(nodeId);
  }

  private async runNode(node: CompiledNode): Promise<void> {
    if (!node.execute) {
      throw new Error(`node "${node.id}" (block "${node.blockId}") has no executor`);
    }
    const result = await node.execute(this.createNodeContext(node));
    if (result !== undefined) {
      this.cache.set(node.id, result);
    } else {
      // Evict so a stale value from an earlier run is never served for a node
      // that has since stopped producing output.
      this.cache.delete(node.id);
    }
  }

  private createNodeContext(node: CompiledNode): DagExecutionContext {
    const self = this;
    const { gpu, storage, onProgress } = this.env;
    return {
      nodeId: node.id,
      getInput: (portId) => {
        const upstream = node.inputs[portId];
        return upstream ? self.cache.get(upstream) : undefined;
      },
      getParam: (name) => node.params[name],
      markDirty: () => self.invalidate(node.id),
      gpu,
      storage,
      onProgress: (progress) => onProgress?.(progress),
    };
  }
}
