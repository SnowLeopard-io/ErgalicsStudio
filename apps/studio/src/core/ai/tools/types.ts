// ==========================================================================
// Ergalics Studio — assistant tool contract (MCP-shaped)
//
// The assistant operates the app through *tools* rather than free-form DOM
// scripting. The descriptors deliberately mirror MCP's `tools/list` shape
// (`name` / `description` / `inputSchema` as JSON Schema) so that:
//   • today's built-in host tools can be advertised to an OpenAI-compatible
//     model as `functions` without translation, and
//   • a later external MCP server can be registered into the same registry —
//     `tools/call` results already use MCP content blocks.
//
// Keeping the surface MCP-compatible is the whole point: the agent loop in
// agent.ts never learns where a tool lives, it just sees descriptors.
// ==========================================================================

/**
 * JSON Schema subset used by tool input schemas. Intentionally loose: MCP
 * servers publish arbitrary JSON Schema, so the assistant must not choke on
 * keywords it does not understand (they are forwarded verbatim to the model).
 */
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

/**
 * MCP content block. The agent only consumes `text` (fed back to the model as
 * the tool result) and `image` (fed back as a vision input part when the
 * configured model supports images).
 */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  /** MCP `isError`: the call ran but failed (bad argument, no active plugin…).
   *  The model still sees the message and can correct itself. */
  isError?: boolean;
}

/** A tool as advertised to the model (MCP `tools/list` element). */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Optional human title for the transcript UI. */
  title?: string;
  /** Origin of the tool — `host` for built-ins, `mcp` for external servers. */
  source?: 'host' | 'mcp';
}

/** Host-side implementation. Arguments are already JSON-parsed by the caller. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/** Convenience constructors so tool modules stay declarative. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** A text result carrying an attached image (screenshot) for vision models. */
export function textWithImage(text: string, dataUrl: string): ToolResult {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return textResult(text);
  return {
    content: [
      { type: 'text', text },
      { type: 'image', data: parsed.data, mimeType: parsed.mimeType },
    ],
  };
}

/** Split `data:<mime>;base64,<payload>` into its parts (null when malformed). */
export function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(url);
  if (!m) return null;
  const mimeType = m[1] ?? 'image/png';
  const data = m[3] ?? '';
  if (!data) return null;
  // The agent forwards `data` as base64. A non-base64 data URL (rare) is
  // rejected rather than silently sending percent-encoded bytes as base64.
  return m[2] ? { mimeType, data } : null;
}
