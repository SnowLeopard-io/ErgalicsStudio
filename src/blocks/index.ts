// ==========================================================================
// Ergalics Studio — block system public surface
//
// Everything the rest of the app (Workbench, stores, future UI) imports
// from the block system lives here.
// ==========================================================================

export { createBlockRegistry, blockRegistry, BLOCK_CATEGORIES } from './registry';
export { compile } from './compiler';
export type {
  CompileResult,
  CompileDiagnostic,
  DiagnosticSeverity,
} from './compiler';
export { DagExecutor } from './executor';
export { createMemoryStorage, MemoryStorage } from './context';
export type { RuntimeEnvironment } from './context';
export { registerBuiltinBlocks } from './catalog';
export { renderView } from './render';
export type { ViewRenderHost } from './render';

import { blockRegistry } from './registry';
import { registerBuiltinBlocks } from './catalog';

let blockSystemInitialized = false;

/**
 * Register built-in blocks into the default registry. Called once at app
 * startup (before the block store runs anything). Idempotent — safe under
 * React StrictMode, which double-invokes effects in development.
 */
export function initBlockSystem(): void {
  if (blockSystemInitialized) return;
  blockSystemInitialized = true;
  registerBuiltinBlocks(blockRegistry);
}
