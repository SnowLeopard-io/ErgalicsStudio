// ==========================================================================
// Ergalics Studio — assistant provider protocol layer (chat completions)
//
// One OpenAI-compatible request shape covers every service we target (OpenAI,
// DeepSeek, GLM/Zhipu, local proxies). Two capabilities are layered on top of
// plain text:
//
//   • tool calling — `tools` + `tool_calls` in the standard OpenAI `functions`
//     dialect (also what GLM/Zhipu and most gateways speak), and
//   • multimodal input — user messages may carry `image_url` parts holding a
//     base64 data URL, which is how GLM-4.6V / GPT-4o / Qwen-VL accept a
//     viewport screenshot.
//
// Everything here is pure request/response marshalling: no policy, no
// storage. `provider.ts` owns authorization; `agent.ts` owns the loop.
// ==========================================================================

import type { Locale } from '@/i18n/types';

/** A content part of an OpenAI-style message. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** One message in the conversation sent to the model. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** `null` is legal for an assistant turn that only emits tool calls. */
  content: string | ContentPart[] | null;
  /** Assistant tool invocations. */
  tool_calls?: ToolCall[];
  /** Set on `role: 'tool'` messages: which call this answers. */
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-encoded arguments, exactly as the model emitted them. */
    arguments: string;
  };
}

/** Tool descriptor in the OpenAI `functions` dialect. */
export interface OpenAiToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequestOptions {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAiToolSpec[];
  temperature?: number;
  /** Ask the service for a streamed response (not used by the agent loop yet). */
  signal?: AbortSignal;
  /** Cap on output tokens, when the service supports it. */
  maxTokens?: number;
}

export interface ChatResponse {
  /** Assistant text (may be empty when the model only calls tools). */
  text: string;
  /** Tool calls the model requested this turn. */
  toolCalls: ToolCall[];
  /** `finish_reason` from the service, e.g. `stop` / `tool_calls`. */
  finishReason: string | null;
  /** Raw usage block when the service reports it. */
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** Text-only message helper used all over the agent loop. */
export function textMessage(role: 'system' | 'user' | 'assistant', text: string): ChatMessage {
  return { role, content: text };
}

/** Build a user message carrying text plus inline images (data URLs). */
export function userMessageWithImages(text: string, imageDataUrls: readonly string[]): ChatMessage {
  if (imageDataUrls.length === 0) return { role: 'user', content: text };
  const parts: ContentPart[] = [{ type: 'text', text }];
  for (const url of imageDataUrls) parts.push({ type: 'image_url', image_url: { url } });
  return { role: 'user', content: parts };
}

/** Mark the request as multimodal when any message carries an image part. */
export function requestHasImages(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
  );
}

// ---- response parsing -------------------------------------------------------

interface RawChoice {
  message?: {
    content?: unknown;
    tool_calls?: unknown;
  };
  finish_reason?: unknown;
}

interface RawToolCall {
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/**
 * Parse an OpenAI-compatible response. Tolerant by design: services differ in
 * how they represent an empty message (null content, missing tool_calls, a
 * legacy `function_call`), and a mis-parse here would look like model failure.
 */
export function parseChatResponse(data: unknown): ChatResponse {
  if (!data || typeof data !== 'object') throw new Error('response is not a JSON object');
  const choices = (data as { choices?: unknown }).choices;
  const first = Array.isArray(choices) ? (choices[0] as RawChoice | undefined) : undefined;
  if (!first) throw new Error('response has no choices[0]');
  const msg = first.message ?? {};
  const text = extractText(msg.content);
  const toolCalls = extractToolCalls(msg.tool_calls);
  const usage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
  return {
    text,
    toolCalls,
    finishReason: typeof first.finish_reason === 'string' ? first.finish_reason : null,
    usage:
      usage && typeof usage === 'object'
        ? {
            promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
            completionTokens:
              typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
          }
        : undefined,
  };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  // Some gateways return the multipart content array back on the assistant
  // turn; flatten the text parts rather than dropping the reply.
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && (p as { type?: unknown }).type === 'text'
        ? String((p as { text?: unknown }).text ?? '')
        : ''))
      .join('');
  }
  return '';
}

function extractToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const call = raw[i] as RawToolCall | undefined;
    const name = call?.function?.name;
    if (typeof name !== 'string' || !name) continue;
    const args = call?.function?.arguments;
    out.push({
      id: typeof call?.id === 'string' && call.id ? call.id : `call_${i}`,
      type: 'function',
      function: {
        name,
        // Always a string: models emit a JSON string, but a few proxies pass
        // an object through untouched.
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    });
  }
  return out;
}

// ---- system prompt ----------------------------------------------------------

/**
 * The agent's operating instructions. Deliberately short: every extra
 * paragraph costs tokens on every turn, and the tool descriptions already
 * carry the per-tool contract.
 */
export function buildSystemPrompt(locale: Locale, opts: { canOperate: boolean; vision: boolean }): string {
  const zh = locale === 'zh-CN';
  if (zh) {
    const op = opts.canOperate
      ? '你可以调用工具操作本应用：切换插件、读写参数、按按钮、截取视图、读取数据与科研指标、运行 studio.* Python 代码。'
      : '你目前只能读取应用状态（只读工具）；用户未授权你修改参数或运行代码，需要时请明确请用户开启「允许助手操作应用」。';
    const vision = opts.vision
      ? '你可以查看视图截图（get_canvas_snapshot）来判断视觉效果。'
      : '';
    return [
      '你是 Ergalics Studio（浏览器内科学计算工作站）的智能体助手。',
      '回答简洁、有依据：数值必须来自工具结果，不要编造数据或统计量。',
      op,
      vision,
      '先探查再行动：不确定插件 id 时调用 list_plugins，不确定参数键时调用 get_plugin_params。',
      '每次工具调用后根据结果决定下一步；任务完成时用一句话总结你做了什么。',
      '当用户要求的操作涉及破坏性后果（清除数据、覆盖文件）时，先询问确认。',
    ]
      .filter(Boolean)
      .join('\n');
  }
  const op = opts.canOperate
    ? 'You can call tools to operate this app: switch plugins, read/write parameters, press buttons, capture the viewport, read datasets and scientific metrics, and run studio.* Python code.'
    : 'You currently have read-only access to app state. The user has not authorized changes, so ask them to enable "let the assistant operate the app" when a task needs one.';
  const vision = opts.vision
    ? 'You can inspect viewport screenshots (get_canvas_snapshot) to judge visual results.'
    : '';
  return [
    'You are the agentic assistant of Ergalics Studio, an in-browser scientific-computing workstation.',
    'Be concise and grounded: every number must come from a tool result — never invent data or statistics.',
    op,
    vision,
    'Probe before acting: call list_plugins when unsure of a plugin id and get_plugin_params before setting values.',
    'After each tool call, decide the next step from its result; when the task is done, summarize what you did in one sentence.',
    'Ask for confirmation before anything destructive (clearing data, overwriting files).',
  ]
    .filter(Boolean)
    .join('\n');
}
