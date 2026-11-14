// ==========================================================================
// Ergalics Studio — assistant tool registry
//
// Holds every tool the agent may call. The registry is deliberately
// transport-agnostic: host tools are registered here today, an external MCP
// server can register the same `RegisteredTool` shape later (see types.ts).
//
// Two guard rails matter for a tool that can *drive the app*:
//   1. `readOnly` tools run freely; mutating tools must be listed in the
//      turn's `allowed` set, which the panel derives from the user's
//      "allow the assistant to operate the app" toggle.
//   2. Arguments are validated against the tool's own JSON Schema (required
//      fields + primitive types) before the handler runs, so a hallucinated
//      call fails fast with a message the model can act on.
// ==========================================================================

import type { JsonSchema, RegisteredTool, ToolDefinition, ToolResult } from './types';
import { errorResult } from './types';

/** Tools that only read state; safe to run without an explicit opt-in. */
const READ_ONLY_TOOLS = new Set([
  'list_plugins',
  'get_plugin_params',
  'get_canvas_snapshot',
  'list_data_files',
  'read_data_file',
  'get_science_outputs',
]);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

/**
 * Tools whose effect a scientist should see in the transcript before it lands.
 * Kept as a list so the panel can mark them in the UI.
 */
const MUTATING_TOOLS = new Set([
  'activate_plugin',
  'set_plugin_params',
  'press_plugin_action',
  'run_code',
  'notify_user',
]);

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

/** Validate `args` against the subset of JSON Schema the tools publish. */
export function validateToolArgs(
  schema: JsonSchema,
  args: Record<string, unknown>,
): string | null {
  for (const key of schema.required ?? []) {
    const v = args[key];
    if (v === undefined || v === null || v === '') return `missing required argument "${key}"`;
  }
  const props = schema.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    const sub = props[key];
    if (!sub) continue; // unknown keys are ignored, never rejected
    const problem = checkType(key, sub, value);
    if (problem) return problem;
  }
  return null;
}

function checkType(key: string, schema: JsonSchema, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? null : `"${key}" must be a string`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `"${key}" must be a number`;
    case 'integer':
      return Number.isInteger(value) ? null : `"${key}" must be an integer`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `"${key}" must be a boolean`;
    case 'array':
      return Array.isArray(value) ? null : `"${key}" must be an array`;
    case 'object':
      return typeof value === 'object' && !Array.isArray(value) ? null : `"${key}" must be an object`;
    default:
      return null;
  }
}

export interface ToolInvokeOptions {
  /** Names the turn is allowed to call (mutating tools excluded when absent). */
  allowed?: ReadonlySet<string>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    const name = tool.definition.name;
    if (!name) throw new Error('tool definition requires a name');
    this.tools.set(name, tool);
  }

  registerAll(tools: readonly RegisteredTool[]): void {
    for (const tool of tools) this.register(tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** Replace every tool sourced from `source` (used when an MCP server
   *  reconnects and republishes its tool list). */
  replaceSource(source: 'host' | 'mcp', tools: readonly RegisteredTool[]): void {
    for (const [name, tool] of [...this.tools]) {
      if ((tool.definition.source ?? 'host') === source) this.tools.delete(name);
    }
    this.registerAll(tools);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  size(): number {
    return this.tools.size;
  }

  /** Descriptors for `tools/list` — what the model is told it can call. */
  list(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /**
   * Run one call. Every failure path returns a `ToolResult` instead of
   * throwing: a broken tool must not abort the whole agent turn, and the model
   * needs the message to recover.
   */
  async invoke(name: string, rawArgs: unknown, opts: ToolInvokeOptions = {}): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return errorResult(`unknown tool "${name}"`);
    if (!isReadOnlyTool(name) && opts.allowed && !opts.allowed.has(name)) {
      return errorResult(`tool "${name}" is not enabled for this turn`);
    }
    const args = normalizeArgs(rawArgs);
    if (args === null) return errorResult('arguments must be a JSON object');
    const invalid = validateToolArgs(tool.definition.inputSchema, args);
    if (invalid) return errorResult(`invalid arguments for "${name}": ${invalid}`);
    try {
      return await tool.handler(args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`tool "${name}" failed: ${msg}`);
    }
  }
}

/** Models occasionally send `{}` as a string or omit arguments entirely. */
function normalizeArgs(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** The process-wide registry the assistant (and, later, MCP) registers into. */
export const toolRegistry = new ToolRegistry();

export { MUTATING_TOOLS, READ_ONLY_TOOLS };
