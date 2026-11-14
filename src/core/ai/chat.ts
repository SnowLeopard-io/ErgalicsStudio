// ==========================================================================
// Ergalics Studio — agentic chat entry point
//
// This is what the panel calls. It decides *which* engine answers:
//
//   • online + authorized + configured → the tool-calling agent loop
//                                              (agent.ts + tools/)
//   • anything else                    → the offline rule engine
//                                              (intents.ts, unchanged)
//
// The offline engine stays reachable in every configuration, including as the
// degrade path when a network call fails, so the assistant never dead-ends.
// ==========================================================================

import type { Locale } from '@/i18n/types';
import { matchIntent, synthesizeCode } from './intents';
import {
  isOnlineAuthorized,
  isOnlineConfigured,
  isOperateAuthorized,
  isVisionEnabled,
  getAssistantMode,
  getProviderConfig,
  onlineFailedNote,
  onlineNotConfigured,
  assistantUnavailable,
  type AiProviderConfig,
} from './provider';
import { chatCompletion } from './provider';
import { runAgent, type AgentEvent, type AgentRunResult } from './agent';
import { ensureHostToolsRegistered, toolRegistry } from './tools';
import { MUTATING_TOOLS } from './tools/registry';

export interface AgentChatOptions {
  prompt: string;
  locale: Locale;
  /** Prior plain-text turns for context. */
  history?: string[];
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface AgentChatResult {
  /** Which engine answered. */
  via: 'agent' | 'offline';
  /** Final assistant prose (may be empty when the agent stopped mid-tool-use). */
  text: string;
  /** Offline rule engine's synthesized draft, when that engine answered. */
  code: string | null;
  /** Assistant text of every intermediate model turn, in order. */
  texts: string[];
  calls: AgentRunResult['calls'];
  /** Transparency note (degraded online, offline-only, step cap…). */
  note: string | null;
  truncated: boolean;
}

/** Tools the current session is allowed to use, after policy filtering. */
export function availableTools(): { name: string; description: string }[] {
  ensureHostToolsRegistered();
  const canOperate = isOperateAuthorized();
  const vision = isVisionEnabled();
  return toolRegistry
    .list()
    .filter((t) => (canOperate || !MUTATING_TOOLS.has(t.name)))
    .filter((t) => vision || t.name !== 'get_canvas_snapshot')
    .map((t) => ({ name: t.name, description: t.description }));
}

/** True when the agent (not the rule engine) will answer the next turn. */
export function isAgentAvailable(): boolean {
  return getAssistantMode() === 'online' && isOnlineAuthorized() && isOnlineConfigured();
}

/**
 * One user turn. Streams progress through `onEvent` (assistant text, each tool
 * call, notices) and resolves with the final outcome.
 */
export async function runAgentChat(options: AgentChatOptions): Promise<AgentChatResult> {
  const { prompt, locale, onEvent } = options;
  ensureHostToolsRegistered();

  if (!isAgentAvailable()) {
    // Offline (or online-but-unconfigured): the deterministic rule engine.
    const reply = chatForOffline(prompt, locale);
    return { via: 'offline', ...reply };
  }

  const canOperate = isOperateAuthorized();
  const vision = isVisionEnabled();
  const config: AiProviderConfig = getProviderConfig();

  // Interim assistant prose arrives through onEvent; collect it here so the
  // caller gets the whole transcript without re-deriving it from the UI.
  const texts: string[] = [];
  const forward = (event: AgentEvent) => {
    if (event.type === 'assistant-text') texts.push(event.text);
    onEvent?.(event);
  };

  try {
    const result = await runAgent({
      locale,
      prompt,
      history: options.history,
      tools: toolRegistry.list(),
      canOperate,
      vision,
      onEvent: forward,
      signal: options.signal,
      invokeTool: (name, args) =>
        toolRegistry.invoke(name, args, {
          // The registry re-checks policy. Belt and braces: `selectTools`
          // already hid mutating tools, but a hallucinated name must also fail
          // here rather than in a handler.
          allowed: canOperate
            ? undefined
            : new Set(toolRegistry.list().map((t) => t.name).filter((n) => !MUTATING_TOOLS.has(n))),
        }),
      callModel: (messages, tools) =>
        chatCompletion(config, {
          model: config.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          signal: options.signal,
        }),
    });
    return {
      via: 'agent',
      text: result.text || texts.at(-1) || '',
      code: null,
      texts,
      calls: result.calls,
      note: result.truncated ? truncationNote(locale) : null,
      truncated: result.truncated,
    };
  } catch (err) {
    // Network / API failure: fall back to the rule engine so the assistant
    // still answers, and say exactly why.
    const msg = err instanceof Error ? err.message : String(err);
    onEvent?.({ type: 'error', text: msg });
    const reply = chatForOffline(prompt, locale);
    return { via: 'offline', ...reply, note: onlineFailedNote(locale, msg) };
  }
}

/** The deterministic engine's answer, shaped like an agent result. */
function chatForOffline(prompt: string, locale: Locale): Omit<AgentChatResult, 'via'> {
  const intent = matchIntent(prompt, locale);
  if (!intent) {
    // Nothing matched: explain the situation in terms of *why* the agent is
    // unavailable, so the user knows which switch to flip.
    const note = isOnlineConfigured() ? assistantUnavailable(locale) : onlineNotConfigured(locale);
    return { text: note, code: null, texts: [], calls: [], note, truncated: false };
  }
  const code = synthesizeCode(intent.kind, intent.slots);
  return { text: '', code, texts: [], calls: [], note: null, truncated: false };
}

function truncationNote(locale: Locale): string {
  return locale === 'zh-CN'
    ? '已到达单轮工具调用上限，任务可能尚未完成——可以再发一条消息让助手接着做。'
    : 'Hit the per-turn tool-call limit — the task may be incomplete; send another message to continue.';
}

export type { AgentEvent, AgentToolCallLog } from './agent';
