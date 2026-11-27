// ==========================================================================
// Ergalics Studio — assistant tools barrel
//
// Registers the built-in host tools once, at module load, so both the panel
// and any future external MCP bridge read from the same registry.
// ==========================================================================

import { toolRegistry } from './registry';
import { registerHostTools } from './hostTools';

let initialized = false;

/** Idempotently publish the built-in host tools into the shared registry. */
export function ensureHostToolsRegistered(): void {
  if (initialized) return;
  initialized = true;
  registerHostTools(toolRegistry);
}

export { toolRegistry } from './registry';
export { HOST_TOOLS } from './hostTools';
export type { JsonSchema, ToolContent, ToolDefinition, ToolResult, RegisteredTool } from './types';
export { errorResult, textResult, textWithImage } from './types';
export { isMutatingTool, isReadOnlyTool, validateToolArgs } from './registry';
