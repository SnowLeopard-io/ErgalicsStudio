// ==========================================================================
// Ergalics Studio — FR-07 assistant provider policy (offline / online)
//
// Two modes:
//   • offline (default) — the pure-TS rule engine in `intents.ts`. Runs fully
//     in the browser; conversation content never leaves the machine.
//   • online — an external model service. Requires an EXPLICIT authorization
//     flag persisted in settings (`aiOnlineAuthorized`): without it, every
//     online path is refused so user prompts can never leak by accident.
//
// The online transport is a thin fetch wrapper kept interface-only: it is
// never invoked in tests (no network in CI). When the offline engine cannot
// answer and online is not authorized, callers must surface a "switch to
// online mode" hint (see `assistantUnavailable`).
// ==========================================================================

import type { Locale } from '@/i18n/types';
import { matchIntent, synthesizeCode, suggestFix, type IntentMatch } from './intents';

export type AssistantMode = 'offline' | 'online';

const AUTH_KEY = 'ergalics:ai-online-authorized';
const MODE_KEY = 'ergalics:ai-mode';

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
  /** Runnable studio.* code, or a plain-text answer when no code applies. */
  code: string | null;
  /** Human-readable status / hint (e.g. online refused, no match). */
  note: string | null;
  /** True when the caller should tell the user to enable/authorize online. */
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
  if (!authorized) writeFlag(MODE_KEY, false); // revoking auth forces offline
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
  // silently degrades to offline (the safe default).
  writeFlag(MODE_KEY, mode === 'online' && isOnlineAuthorized());
}

/**
 * Online transport — interface only. Posts the prompt to an external model
 * service and returns its text reply. Callers must check `getAssistantMode()`
 * (which already enforces authorization) before invoking this.
 */
export async function queryOnlineService(
  endpoint: string,
  prompt: string,
  opts: { locale?: Locale; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, locale: opts.locale ?? 'zh-CN' }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`AI service responded ${res.status}`);
  const data: unknown = await res.json();
  if (data && typeof data === 'object' && 'text' in data && typeof (data as { text: unknown }).text === 'string') {
    return (data as { text: string }).text;
  }
  throw new Error('AI service response missing a "text" field');
}

/** Run the request through the active provider. */
export async function askAssistant(request: AssistantRequest): Promise<AssistantReply> {
  const mode = getAssistantMode();
  if (mode === 'online') {
    // The online transport is interface-only until a real endpoint is
    // configured (none is deployed). Degrade gracefully to the offline rule
    // engine so online mode always answers instead of leaving the user with
    // silence, but say so explicitly on EVERY reply — matching success still
    // came from the offline engine, and acting otherwise would mislead.
    const intent = matchIntent(request.prompt, request.locale);
    return {
      mode: 'online',
      intent,
      code: intent ? synthesizeCode(intent.kind, intent.slots) : null,
      note: onlineUnavailableNote(request.locale),
      needsOnline: false,
    };
  }
  const intent = matchIntent(request.prompt, request.locale);
  if (!intent) {
    return {
      mode: 'offline',
      intent: null,
      code: null,
      note: assistantUnavailable(request.locale),
      needsOnline: true,
    };
  }
  return {
    mode: 'offline',
    intent,
    code: synthesizeCode(intent.kind, intent.slots),
    note: null,
    needsOnline: false,
  };
}

/** Hint shown when online mode is selected but the model service is not
 *  wired up yet — the assistant still answers via the offline engine. */
export function onlineUnavailableNote(locale: Locale): string {
  return locale === 'zh-CN'
    ? '在线模型服务尚未接入，已用离线规则引擎作答。可继续发送分析需求。'
    : 'The online model service is not wired up yet — answered with the offline rule engine. You can keep sending analysis requests.';
}

/** Hint shown when the offline engine cannot answer and online is disabled. */
export function assistantUnavailable(locale: Locale): string {
  return locale === 'zh-CN'
    ? '离线助手未能识别该请求。当前为离线规则引擎（对话内容不离开本地）；如需更灵活的生成，请在设置中开启并授权在线模型服务。'
    : 'The offline assistant did not recognize this request. You are on the offline rule engine (conversation stays local); enable and authorize the online model service in settings for more flexible generation.';
}

/** Fix suggestion for a failed run (offline rules; same in both modes). */
export function adviseOnRunError(error: string, lastCode: string, locale: Locale): string {
  return suggestFix(error, lastCode, locale);
}
