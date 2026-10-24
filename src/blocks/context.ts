// ==========================================================================
// Ergalics Studio — runtime environment & storage (block system)
//
// The executor's *external* environment (GPU, storage, progress) and a
// trivial in-memory StorageApi. Node-scoped contexts are built by the
// executor itself (see executor.ts).
// ==========================================================================

import type { StorageApi } from '@/types/dag';
import type { ComputeProgress, GpuComputeApi } from '@/types/plugin';

export interface RuntimeEnvironment {
  /** GPU compute surface; undefined when WebGPU is unavailable. */
  gpu?: GpuComputeApi;
  storage: StorageApi;
  onProgress?: (progress: ComputeProgress) => void;
  /** Optional hook so the UI can reflect per-node status. */
  onNodeStatus?: (nodeId: string, status: 'computing' | 'done' | 'error') => void;
}

/** In-memory StorageApi, used when no persistent backend is wired up. */
export class MemoryStorage implements StorageApi {
  private readonly map = new Map<string, unknown>();

  async save(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }

  async load(key: string): Promise<unknown> {
    return this.map.get(key);
  }
}

export function createMemoryStorage(): MemoryStorage {
  return new MemoryStorage();
}
