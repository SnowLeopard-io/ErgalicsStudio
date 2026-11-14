// ==========================================================================
// Ergalics Studio — assistant agent loop
//
// Turns the single-shot "prompt → answer" assistant into a bounded agent:
//
//   user turn → model → (tool calls?) → run tools → model → … → final text
//
// Design constraints, all deliberate:
//   • Bounded. `MAX_STEPS` caps the tool round-trips so a confused model can
//     never spin the app forever (each step may run a benchmark or a solver).
//   • Observable. Every step is reported through `onEvent`, so the panel can
//     render the transcript as it happens instead of blocking on the whole run.
//   • Grounded. Tool results go back to the model verbatim (MCP content
//     blocks → text parts; images → `image_url` parts only when vision is on),
//     so the model reasons over real numbers, not guesses.
//   • Safe. Mutating tools are gated on `canOperate`; screenshots are gated on
//     `vision`. Both default to off.
//
// The loop is transport-agnostic: it receives a `callModel` function, which
// keeps it unit-testable without a network or a DOM.
// ==========================================================================

import type { Locale } from '@/i18n/types';
import {
  buildSystemPrompt,
  textMessage,
  userMessageWithImages,
  type ChatMessage,
  type ChatResponse,
  type OpenAiToolSpec,
} from './protocol';
import type { ToolContent, ToolDefinition, ToolResult } from './tools/types';

/** Hard cap on model↔tool round-trips in one user turn. */
export const MAX_STEPS = 8;

export interface AgentToolCallLog {
  name: string;
  args: Record<string, unknown>;
  isError: boolean;
  /** Flattened text of the result (images are dropped from the log). */
  summary: string;
  /** True when the result carried an image the model was allowed to see. */
  hasImage: boolean;
}

export type AgentEvent =
  | { type: 'assistant-text'; text: string }
  | { type: 'tool-call'; call: AgentToolCallLog }
  | { type: 'notice'; text: string }
  | { type: 'error'; text: string };

export interface AgentRunOptions {
  locale: Locale;
  /** Prior user/assistant turns for context (plain text). */
  history?: string[];
  /** The latest user prompt. */
  prompt: string;
  /** Tool descriptors to advertise (filtered by the caller's policy). */
  tools: readonly ToolDefinition[];
  /** Execute one tool call. May be synchronous — the loop awaits either way. */
  invokeTool: (name: string, args: unknown) => Promise<ToolResult> | ToolResult;
  /** One model round-trip. */
  callModel: (messages: ChatMessage[], tools: OpenAiToolSpec[]) => Promise<ChatResponse>;
  /** Whether mutating tools are authorized this session. */
  canOperate: boolean;
  /** Whether the model accepts image parts. */
  vision: boolean;
  /** Streamed progress for the transcript UI. */
  onEvent?: (event: AgentEvent) => void;
  /** Aborts the loop between steps. */
  signal?: AbortSignal;
}

export interface AgentRunResult {
  /** Final assistant text (empty when the loop hit its cap mid-tool-use). */
  text: string;
  /** Every tool call performed, in order (for the transcript + debugging). */
  calls: AgentToolCallLog[];
  /** True when the loop stopped because MAX_STEPS was reached. */
  truncated: boolean;
}

/** Convert tool descriptors into the OpenAI `functions` dialect. */
export function toOpenAiTools(tools: readonly ToolDefinition[]): OpenAiToolSpec[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Filter the tool list the model is told about, so it is never offered
 * something it is not allowed to use (an unavailable tool invites a wasted
 * call and an error the user must read).
 */
export function selectTools(
  tools: readonly ToolDefinition[],
  opts: { canOperate: boolean; vision: boolean },
): ToolDefinition[] {
  return tools.filter((t) => {
    if (!opts.vision && t.name === 'get_canvas_snapshot') return false;
    if (!opts.canOperate && MUTATING_TOOL_NAMES.has(t.name)) return false;
    return true;
  });
}

/** Mirrors registry.MUTATING_TOOLS — duplicated to keep this module dependency-free. */
const MUTATING_TOOL_NAMES = new Set([
  'activate_plugin',
  'set_plugin_params',
  'press_plugin_action',
  'run_code',
  'notify_user',
]);

/** Flatten a tool result into the text the model reads. */
function resultText(result: ToolResult): string {
  const parts = result.content
    .filter((c): c is Extract<ToolContent, { type: 'text' }> => c.type === 'text')
    .map((c) => c.text);
  const text = parts.join('\n').trim();
  return result.isError ? `ERROR: ${text || 'tool failed'}` : text || '(no output)';
}

/** Pull image parts out of a tool result (for vision-enabled models). */
function resultImages(result: ToolResult): string[] {
  return result.content
    .filter((c): c is Extract<ToolContent, { type: 'image' }> => c.type === 'image')
    .map((c) => `data:${c.mimeType};base64,${c.data}`);
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const { locale, prompt, invokeTool, callModel, onEvent } = options;
  const emit = (e: AgentEvent) => onEvent?.(e);

  const tools = selectTools(options.tools, {
    canOperate: options.canOperate,
    vision: options.vision,
  });
  const openAiTools = toOpenAiTools(tools);

  const messages: ChatMessage[] = [
    textMessage('system', buildSystemPrompt(locale, { canOperate: options.canOperate, vision: options.vision })),
  ];
  // History is best-effort: kept as user turns because the offline/plain path
  // never stored assistant text. Labeled so the model does not read old
  // prompts as the current instruction.
  for (const h of (options.history ?? []).slice(-8)) {
    if (h.trim()) messages.push(textMessage('user', h));
  }
  messages.push(textMessage('user', prompt));

  const calls: AgentToolCallLog[] = [];
  let truncated = false;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (options.signal?.aborted) throw new Error('aborted');
    const reply = await callModel(messages, openAiTools);

    if (reply.text.trim()) emit({ type: 'assistant-text', text: reply.text.trim() });

    if (reply.toolCalls.length === 0) {
      return { text: reply.text.trim(), calls, truncated };
    }

    // The assistant turn must be appended before its tool results, otherwise
    // the service rejects the conversation ("tool message without preceding
    // assistant tool_calls").
    messages.push({
      role: 'assistant',
      content: reply.text.trim() ? reply.text : null,
      tool_calls: reply.toolCalls,
    });

    for (const call of reply.toolCalls) {
      const args = parseArgs(call.function.arguments);
      const result = await invokeTool(call.function.name, args);
      const text = resultText(result);
      const images = options.vision ? resultImages(result) : [];
      const log: AgentToolCallLog = {
        name: call.function.name,
        args,
        isError: result.isError === true,
        summary: text.length > 600 ? `${text.slice(0, 600)}…` : text,
        hasImage: images.length > 0,
      };
      calls.push(log);
      emit({ type: 'tool-call', call: log });

      // The tool reply: text plus (vision only) the screenshot the tool took.
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: text,
      });
      if (images.length > 0) {
        messages.push(userMessageWithImages('(viewport screenshot from get_canvas_snapshot)', images));
      }
    }

    if (step === MAX_STEPS - 1) truncated = true;
  }

  const note =
    locale === 'zh-CN'
      ? `已达到 ${MAX_STEPS} 步工具调用上限，先停在这里；可以继续追问让助手接着做。`
      : `Stopped at the ${MAX_STEPS}-step tool limit; ask again to continue.`;
  emit({ type: 'notice', text: note });
  return { text: '', calls, truncated };
}

/** Parse the JSON arguments a model emitted (tolerant of empty/invalid). */
export function parseArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through — the tool validator will report the problem */
  }
  return {};
}
