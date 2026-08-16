// ==========================================================================
// Ergalics Studio — block registry (block system)
//
// Holds block metadata (what a block looks like) and, separately, its
// executor (how it runs). Keeping meta and implementation apart lets the
// compiler stay a pure function over metadata.
// ==========================================================================

import type { BlockCategory, BlockMeta, BlockRegistry } from '@/types/block';
import type { BlockExecutor } from '@/types/dag';

export const BLOCK_CATEGORIES: BlockCategory[] = [
  'data_source',
  'transform',
  'filter',
  'math',
  'statistics',
  'signal',
  'visualize',
  'output',
  'utility',
];

export function createBlockRegistry(): BlockRegistry {
  const blocks = new Map<string, BlockMeta>();
  const executors = new Map<string, BlockExecutor>();
  const categories = Object.fromEntries(
    BLOCK_CATEGORIES.map((c) => [c, [] as BlockMeta[]]),
  ) as Record<BlockCategory, BlockMeta[]>;

  return {
    blocks,
    executors,
    categories,

    register(meta, executor) {
      const existing = blocks.get(meta.id);
      if (existing) {
        // Idempotent re-registration. Triggered by React StrictMode double
        // effects (same meta object) and by HMR reloads (a freshly-built meta
        // object for an id that is already registered). In both cases keep the
        // first meta and only back-fill an executor if one is now provided.
        if (executor && !executors.has(meta.id)) executors.set(meta.id, executor);
        return;
      }
      blocks.set(meta.id, meta);
      if (executor) executors.set(meta.id, executor);
      const bucket = categories[meta.category];
      if (bucket) bucket.push(meta);
      else categories[meta.category] = [meta];
    },

    get: (id) => blocks.get(id),

    getExecutor: (id) => executors.get(id),

    listByCategory: (category) => categories[category] ?? [],

    list: () => [...blocks.values()],
  };
}

/** Process-wide default registry for built-in blocks. */
export const blockRegistry = createBlockRegistry();
