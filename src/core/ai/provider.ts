// ==========================================================================
// Ergalics Studio — FR-07 assistant provider policy (offline / online)
//
// Two modes:
//   • offline (default) — the pure-TS rule engine in `intents.ts`. Runs fully
//     in the browser; conversation content never leaves the machine.
//   • online — an external model service (OpenAI-compatible chat completions).
//     Requires BOTH an explicit authorization flag (`aiOnlineAuthorized`) AND a
//     configured endpoint (`aiProvider`). Without either, every online path is
//     refused / degrades so user prompts can never leak by accident.
//
// The online transport is a thin fetch wrapper. It is never invoked in tests
// (no network in CI). When online is selected but not configured, callers must
// surface a "configure the service" hint (see `onlineNotConfigured`).
// ==========================================================================

import type { Locale } from '@/i18n/types';
import { matchIntent, synthesizeCode, suggestFix, type IntentMatch } from './intents';
import { parseChatResponse, type ChatRequestOptions, type ChatResponse } from './protocol';

export type AssistantMode = 'offline' | 'online';

const AUTH_KEY = 'ergalics:ai-online-authorized';
const MODE_KEY = 'ergalics:ai-mode';
const PROVIDER_KEY = 'ergalics:ai-provider';
const OPERATE_KEY = 'ergalics:ai-operate-authorized';

/** Connection settings for an OpenAI-compatible chat completions endpoint. */
export interface AiProviderConfig {
  /** Full request URL, e.g. https://api.openai.com/v1/chat/completions */
  endpoint: string;
  /** Model name sent in the request body (e.g. gpt-4o-mini, deepseek-chat). */
  model: string;
  /** Bearer token; empty for local proxies that need no auth. */
  apiKey: string;
  /**
   * Whether the model accepts image inputs (GLM-4.6V, GPT-4o, Qwen-VL…).
   * When false the agent never attaches viewport screenshots: sending an
   * image to a text-only model is a hard 400 on most services.
   */
  vision?: boolean;
}

export const EMPTY_PROVIDER_CONFIG: AiProviderConfig = { endpoint: '', model: '', apiKey: '', vision: false };

export interface AssistantRequest {
  /** Natural-language user prompt (stays local unless online + authorized). */
  prompt: string;
  locale: Locale;
  /** Prior turns kept in the panel (never sent anywhere in offline mode). */
  history?: string[];
}

export interface AssistantReply {
  mode: AssistantMode;
  /** Matched intent (offline engine) — null when nothing matched. */
  intent: IntentMatch | null;
  /** Runnable studio.* code, or null when no code applies. */
  code: string | null;
  /** Plain-text answer from the online model (null in offline mode). */
  text: string | null;
  /** Human-readable status / hint (e.g. online refused, no match). */
  note: string | null;
  /** True when the caller should tell the user to configure/authorize online. */
  needsOnline: boolean;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* storage unavailable — mode stays at the safe default */
  }
}

/** Explicit user authorization for sending prompts to an external service. */
export function isOnlineAuthorized(): boolean {
  return readFlag(AUTH_KEY);
}

export function setOnlineAuthorized(authorized: boolean): void {
  writeFlag(AUTH_KEY, authorized);
  if (!authorized) writeMode('offline'); // revoking auth forces offline
}

/** Read + sanitize the persisted provider config (never throws). */
export function getProviderConfig(): AiProviderConfig {
  try {
    const raw = localStorage.getItem(PROVIDER_KEY);
    if (!raw) return { ...EMPTY_PROVIDER_CONFIG };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_PROVIDER_CONFIG };
    const p = parsed as Record<string, unknown>;
    return {
      endpoint: typeof p.endpoint === 'string' ? p.endpoint : '',
      model: typeof p.model === 'string' ? p.model : '',
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      vision: p.vision === true,
    };
  } catch {
    return { ...EMPTY_PROVIDER_CONFIG };
  }
}

export function setProviderConfig(config: AiProviderConfig): void {
  try {
    localStorage.setItem(
      PROVIDER_KEY,
      JSON.stringify({
        endpoint: (config.endpoint ?? '').trim(),
        model: (config.model ?? '').trim(),
        apiKey: config.apiKey ?? '',
        vision: config.vision === true,
      }),
    );
  } catch {
    /* storage unavailable — config stays in memory for this session only */
  }
}

/** Online is usable only when an endpoint has been configured. */
export function isOnlineConfigured(): boolean {
  return getProviderConfig().endpoint.trim() !== '';
}

/**
 * Whether the user lets the assistant *operate* the app (set parameters,
 * press buttons, run code). Separate from the online authorization: a user may
 * happily ask a local model to drive the UI without sending prompts out, and
 * may authorize online chat while keeping the app read-only. Defaults to false
 * — an assistant that can change a running experiment must be opted into.
 */
export function isOperateAuthorized(): boolean {
  return readFlag(OPERATE_KEY);
}

export function setOperateAuthorized(authorized: boolean): void {
  writeFlag(OPERATE_KEY, authorized);
}

/** Whether the configured model accepts image input (viewport screenshots). */
export function isVisionEnabled(): boolean {
  return getProviderConfig().vision === true;
}

function writeMode(mode: AssistantMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage unavailable — mode stays at the safe default */
  }
}

/** Effective assistant mode: online only when selected AND authorized. */
export function getAssistantMode(): AssistantMode {
  try {
    if (localStorage.getItem(MODE_KEY) === 'online' && isOnlineAuthorized()) return 'online';
  } catch {
    /* fall through */
  }
  return 'offline';
}

export function setAssistantMode(mode: AssistantMode): void {
  // Switching to online without explicit authorization is refused: the mode
  // silently degrades to offline (the safe default). Persist the *mode string*
  // so getAssistantMode() can read it back (a prior bug wrote 'true' here but
  // read 'online' above, so online never stuck).
  writeMode(mode === 'online' && isOnlineAuthorized() ? 'online' : 'offline');
}

/**
 * Single transport for every online call — the plain-text assistant path and
 * the agent loop both go through here so headers, timeouts and error shapes
 * stay identical. Returns the parsed response (text + tool calls).
 *
 * Callers must check `getAssistantMode()` (which enforces authorization) and
 * `isOnlineConfigured()` before invoking this.
 */
export async function chatCompletion(
  config: AiProviderConfig,
  options: ChatRequestOptions,
): Promise<ChatResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey.trim()) headers.authorization = `Bearer ${config.apiKey.trim()}`;
  const body: Record<string, unknown> = {
    model: options.model.trim() || config.model.trim() || 'gpt-4o-mini',
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  const res = await fetch(config.endpoint.trim(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) {
    // Surface a server-provided message when there is one: "HTTP 400" alone
    // leaves the user unable to tell a bad model name from a missing vision
    // capability.
    let detail = '';
    try {
      const errBody: unknown = await res.json();
      const msg =
        errBody && typeof errBody === 'object'
          ? (errBody as { error?: { message?: unknown }; message?: unknown }).error?.message ??
            (errBody as { message?: unknown }).message
          : undefined;
      if (typeof msg === 'string' && msg) detail = `: ${msg.slice(0, 300)}`;
    } catch {
      /* non-JSON error body — keep the status code only */
    }
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  const data: unknown = await res.json();
  return parseChatResponse(data);
}

/**
 * Plain-text convenience wrapper used by the non-agentic path. Kept as a
 * separate export because existing callers (and tests) speak in strings.
 */
export async function queryOnlineService(
  config: AiProviderConfig,
  request: AssistantRequest,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const system =
    request.locale === 'zh-CN'
      ? '你是 Ergalics Studio 的科学计算分析助手。请用简洁中文回答数据分析问题；涉及代码时使用 studio.* API。'
      : 'You are the Ergalics Studio scientific-computing analysis assistant. Answer data-analysis questions concisely; use studio.* APIs for code.';
  const history = (request.history ?? []).slice(-8).map((h) => ({ role: 'user' as const, content: h }));
  const reply = await chatCompletion(config, {
    model: config.model,
    messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: request.prompt }],
    signal: opts.signal,
  });
  if (!reply.text) throw new Error('响应缺少 choices[0].message.content');
  return reply.text;
}

/** Run the request through the active provider. */
export async function askAssistant(request: AssistantRequest): Promise<AssistantReply> {
  const mode = getAssistantMode();
  if (mode === 'online') {
    if (!isOnlineConfigured()) {
      // Online selected but no endpoint configured — do NOT leak the prompt.
      // Degrade to the offline engine and tell the user to configure it.
      const intent = matchIntent(request.prompt, request.locale);
      return {
        mode: 'online',
        intent,
        code: intent ? synthesizeCode(intent.kind, intent.slots) : null,
        text: null,
        note: onlineNotConfigured(request.locale),
        needsOnline: true,
      };
    }
    try {
      const text = await queryOnlineService(getProviderConfig(), request);
      return { mode: 'online', intent: null, code: null, text, note: null, needsOnline: false };
    } catch (err) {
      // Network / API failure: surface it and fall back to the offline engine
      // so the assistant still answers, but say so explicitly.
      const msg = err instanceof Error ? err.message : String(err);
      const intent = matchIntent(request.prompt, request.locale);
      return {
        mode: 'online',
        intent,
        code: intent ? synthesizeCode(intent.kind, intent.slots) : null,
        text: null,
        note: onlineFailedNote(request.locale, msg),
        needsOnline: false,
      };
    }
  }
  const intent = matchIntent(request.prompt, request.locale);
  if (!intent) {
    return {
      mode: 'offline',
      intent: null,
      code: null,
      text: null,
      note: assistantUnavailable(request.locale),
      needsOnline: true,
    };
  }
  return {
    mode: 'offline',
    intent,
    code: synthesizeCode(intent.kind, intent.slots),
    text: null,
    note: null,
    needsOnline: false,
  };
}

/** Hint shown when online is selected but no endpoint has been configured. */
export function onlineNotConfigured(locale: Locale): string {
  return locale === 'zh-CN'
    ? '在线模型服务尚未配置：请在下方「服务设置」填写 API 地址与密钥。当前已用离线规则引擎作答。'
    : 'The online model service is not configured — set the API endpoint and key under “Service settings”. Answered with the offline rule engine for now.';
}

/** Hint shown when an online request failed (network / API error). */
export function onlineFailedNote(locale: Locale, error: string): string {
  return locale === 'zh-CN'
    ? `在线服务请求失败（${error}），已改用离线规则引擎作答。`
    : `Online request failed (${error}) — answered with the offline rule engine instead.`;
}

/** Hint shown when the offline engine cannot answer and online is disabled. */
export function assistantUnavailable(locale: Locale): string {
  return locale === 'zh-CN'
    ? '离线助手未能识别该请求。当前为离线规则引擎（对话内容不离开本地）；如需更灵活的生成，请切换到在线模式并在「服务设置」中配置模型服务。'
    : 'The offline assistant did not recognize this request. You are on the offline rule engine (conversation stays local); switch to online mode and configure the model service under “Service settings” for more flexible generation.';
}

/** Fix suggestion for a failed run (offline rules; same in both modes). */
export function adviseOnRunError(error: string, lastCode: string, locale: Locale): string {
  return suggestFix(error, lastCode, locale);
}
