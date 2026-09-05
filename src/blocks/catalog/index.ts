// ==========================================================================
// Ergalics Studio — built-in block catalog bootstrap (block system)
//
// Registers every built-in block (metadata + executor) into a registry.
// ==========================================================================

import type { BlockRegistry } from '@/types/block';
import { dataSourceBlocks } from './dataSource';
import { transformBlocks } from './transform';
import { filterBlocks } from './filter';
import { mathBlocks } from './math';
import { statisticsBlocks } from './statistics';
import { visualizeBlocks } from './visualize';
import { plotBlocks } from './plot';
import type { BlockDefinition } from './types';

export function registerBuiltinBlocks(registry: BlockRegistry): void {
  const definitions: BlockDefinition[] = [
    ...dataSourceBlocks,
    ...transformBlocks,
    ...filterBlocks,
    ...mathBlocks,
    ...statisticsBlocks,
    ...visualizeBlocks,
    ...plotBlocks,
  ];
  for (const def of definitions) {
    registry.register(def.meta, def.executor);
  }
}

export {
  dataSourceBlocks,
  transformBlocks,
  filterBlocks,
  mathBlocks,
  statisticsBlocks,
  visualizeBlocks,
  plotBlocks,
};
