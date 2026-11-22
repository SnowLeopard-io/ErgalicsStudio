// ==========================================================================
// Ergalics Studio — FR-07 AI assistant panel (项目全局悬浮窗)
//
// Chat-style panel with two engines behind one input:
//   • online + authorized + configured → the *agent* (core/ai/chat.ts): the
//     model may call app tools (switch plugins, set parameters, press
//     buttons, snapshot the viewport, read data, run studio.* code) and its
//     whole trajectory is shown inline — including a thumbnail for every
//     screenshot it took.
//   • otherwise → the offline intent engine, which synthesizes an editable
//     `studio.*` draft.
// Conversation history lives in component state; in offline mode nothing ever
// leaves the machine, and online mode requires an explicit authorization flag
// (see @/core/ai/provider). Operating the app is a *separate* opt-in, so a user
// can chat online while keeping the workspace read-only.
//
// Rendered inside <AiAssistantOverlay />, a project-wide floating window
// toggled from the shared top bar. The host supplies `runCode` (the active
// editor's execution hook, registered via aiPanelStore) so the agent's
// `run_code` tool reuses that editor's own runtime.
// ==========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { parseCodeToIR } from '@/editor/code/parse';
import { mdToHtml } from '@/core/notebook/notebook';
import { enhanceMarkdownDom } from '@/core/markdown/enhance';
import type { AiRunResult } from '@/stores/aiPanelStore';
import {
  adviseOnRunError,
  getAssistantMode,
  getProviderConfig,
  isOnlineAuthorized,
  isOnlineConfigured,
  isOperateAuthorized,
  setAssistantMode,
  setOnlineAuthorized,
  setOperateAuthorized,
  setProviderConfig,
  type AiProviderConfig,
  type AssistantMode,
} from '@/core/ai/provider';
import { matchIntent, synthesizeCode, type IntentKind, type IntentSlots } from '@/core/ai/intents';
import { availableTools, runAgentChat, type AgentToolCallLog } from '@/core/ai/chat';
import { AgentCapabilityPanel } from './AgentCapabilityPanel';
import { SparklesIcon } from './icons';

interface AiAssistantPanelProps {
  /** Host editor's insert-and-run hook (Pyodide / IR interpreter). */
  runCode?: (code: string) => Promise<AiRunResult>;
  /** Dismiss the floating panel (projects-wide switcher). */
  onClose?: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  confidence?: number;
  code?: string;
  /** Subtle transparency note (e.g. "answered via the offline engine"). */
  note?: string;
  /** Tool calls this assistant turn performed (agent turns only). */
  calls?: AgentToolCallLog[];
}

/**
 * One tool call, rendered as a compact, collapsible activity line: the tool
 * name is the headline, the arguments and result sit behind a details/summary
 * so a long trajectory stays scannable.
 */
function ToolCallList({
  calls,
  label,
  live = false,
}: {
  calls: AgentToolCallLog[];
  label: string;
  live?: boolean;
}) {
  return (
    <div className={`ai-tools${live ? ' is-live' : ''}`}>
      <div className="ai-tools-label">{label}</div>
      {calls.map((c, i) => (
        <details key={i} className={`ai-tool${c.isError ? ' is-error' : ''}`}>
          <summary className="ai-tool-summary">
            <span className="ai-tool-name">{c.name}</span>
            {c.hasImage && <span className="ai-tool-badge">PNG</span>}
            {c.isError && <span className="ai-tool-badge ai-tool-badge-error">ERR</span>}
            <span className="ai-tool-args">{summarizeArgs(c.args)}</span>
          </summary>
          <pre className="ai-tool-body">{c.summary}</pre>
        </details>
      ))}
    </div>
  );
}

/** One-line preview of a tool's arguments (values truncated per key). */
function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const rendered =
      typeof value === 'string'
        ? value.replace(/\s+/g, ' ').slice(0, 40)
        : typeof value === 'object'
          ? Array.isArray(value)
            ? `[${value.length}]`
            : '{…}'
          : String(value);
    parts.push(`${key}=${rendered}`);
    if (parts.join(', ').length > 60) break;
  }
  return parts.join(', ');
}

/**
 * Assistant replies are markdown: headings, lists, tables, code fences and
 * TeX all render through the shared mdToHtml pipeline (marked + DOMPurify),
 * with mermaid/KaTeX upgraded in place by the async enhancer.
 */
function MarkdownBody({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => mdToHtml(text), [text]);
  useEffect(() => {
    if (ref.current) void enhanceMarkdownDom(ref.current);
  }, [html]);
  return (
    <div
      ref={ref}
      className="ai-md nb-md"
      // mdToHtml sanitizes through DOMPurify; raw HTML never executes.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function AiAssistantPanel({ runCode, onClose }: AiAssistantPanelProps) {
  const t = useT();
  const { locale } = useLocale();

  /** 对话 / 能力 / 设置: the same surfaces the old /agent dock offered, now in
   *  the original right-hand popup. Keeping this local means the conversation
   *  state survives tab switches and panel close/open (the overlay stays
   *  mounted while hidden). */
  const [tab, setTab] = useState<'chat' | 'capabilities' | 'settings'>('chat');

  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<string | null>(null);
  const [mode, setMode] = useState<AssistantMode>(() => getAssistantMode());
  const [authorized, setAuthorized] = useState<boolean>(() => isOnlineAuthorized());
  const [configured, setConfigured] = useState<boolean>(() => isOnlineConfigured());
  const [operate, setOperate] = useState<boolean>(() => isOperateAuthorized());
  const [form, setForm] = useState<AiProviderConfig>(() => getProviderConfig());
  /** Tool calls of the in-flight agent turn (live activity list). */
  const [liveCalls, setLiveCalls] = useState<AgentToolCallLog[]>([]);
  /** Transient notice from the in-flight turn (step cap, error). */
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const lastRequestRef = useRef<{ prompt: string; kind: IntentKind; slots: IntentSlots } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  /** True when the next turn will be answered by the agent (not the rule engine). */
  const agentReady = mode === 'online' && authorized && configured;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [history, advice, liveCalls]);

  // Composer grows with the draft (up to ~5 lines) and shrinks back on send.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [prompt, tab]);

  const notify = (kind: 'info' | 'success' | 'warning' | 'error', message: string) => {
    useAppStore.getState().notify(kind, message);
  };

  const submit = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setAdvice(null);
    setLiveCalls([]);
    setHistory((h) => [...h, { role: 'user', text }]);
    setPrompt('');
    try {
      // Live tool-call feedback: an agent turn can take a while (several model
      // round-trips, each running app tools), so the activity list grows as
      // tools run instead of the whole thing appearing at the end.
      const reply = await runAgentChat({
        prompt: text,
        locale,
        history: history.map((m) => m.text),
        onEvent: (event) => {
          if (event.type === 'tool-call') setLiveCalls((prev) => [...prev, event.call]);
          else if (event.type === 'notice' || event.type === 'error') setLiveNote(event.text);
        },
      });
      if (reply.via === 'agent') {
        lastRequestRef.current = null;
        setHistory((h) => [
          ...h,
          {
            role: 'assistant',
            text: reply.text || reply.note || '',
            calls: reply.calls,
            ...(reply.note ? { note: reply.note } : {}),
          },
        ]);
      } else if (reply.code) {
        const intent = matchIntent(text, locale);
        if (intent) lastRequestRef.current = { prompt: text, kind: intent.kind, slots: intent.slots };
        setHistory((h) => [
          ...h,
          {
            role: 'assistant',
            text: t('ai.generated', { kind: t(`ai.intent.${intent?.kind ?? 'correlation'}`) }),
            confidence: intent?.confidence,
            code: reply.code ?? undefined,
            note: reply.note ?? undefined,
          },
        ]);
        setDraft(reply.code);
      } else {
        lastRequestRef.current = null;
        setHistory((h) => [
          ...h,
          { role: 'assistant', text: reply.text || reply.note || t('ai.no_match'), note: reply.note ?? undefined },
        ]);
      }
    } finally {
      setBusy(false);
      setLiveCalls([]);
      setLiveNote(null);
    }
  }, [prompt, busy, locale, history, t]);

  const insertToBuffer = useCallback(() => {
    if (!draft) return;
    // Parse into the canonical IR and request a load: CodeEditor swaps the
    // Monaco buffer, BlockEditor reloads the workspace (flow canvas included)
    // — both surfaces regenerate from the same IR hub.
    const { program } = parseCodeToIR(draft, 'python');
    useEditorStore.getState().requestLoad(program);
    notify('success', t('ai.inserted'));
  }, [draft, t]);

  const runDraft = useCallback(async () => {
    if (!draft || !runCode) return;
    setBusy(true);
    setAdvice(null);
    try {
      const result = await runCode(draft);
      if (result.insertedOnly) {
        notify('info', t('ai.inserted_only'));
      } else if (!result.ok && result.error) {
        setAdvice(adviseOnRunError(result.error, draft, locale));
        notify('error', t('ai.run_failed'));
      } else {
        notify('success', t('ai.run_ok'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdvice(adviseOnRunError(msg, draft, locale));
    } finally {
      setBusy(false);
    }
  }, [draft, runCode, locale, t]);

  const retry = useCallback(() => {
    const req = lastRequestRef.current;
    if (req) {
      // Re-synthesize the same intent, re-extracting slots from the prompt.
      const fresh = matchIntent(req.prompt, locale);
      setDraft(synthesizeCode(req.kind, fresh?.slots ?? req.slots));
      setAdvice(null);
      return;
    }
    void submit();
  }, [locale, submit]);

  const editDescription = useCallback(() => {
    setPrompt(lastRequestRef.current?.prompt ?? '');
  }, []);

  const toggleAuthorize = useCallback((value: boolean) => {
    setOnlineAuthorized(value);
    setAuthorized(value);
    if (!value) {
      // Revoking authorization forces offline (provider policy).
      setMode(getAssistantMode());
    }
  }, []);

  const selectMode = useCallback((next: AssistantMode) => {
    if (next === 'online') {
      // Clicking online is explicit consent: grant authorization so the
      // toggle responds instead of silently dead-ending on a disabled button.
      if (!authorized) {
        setOnlineAuthorized(true);
        setAuthorized(true);
      }
      // Online without a configured endpoint can never answer — stay on the
      // settings tab so the API fields are right there.
      if (!isOnlineConfigured()) setTab('settings');
    }
    setAssistantMode(next);
    setMode(getAssistantMode());
  }, [authorized]);

  const toggleOperate = useCallback((value: boolean) => {
    setOperateAuthorized(value);
    setOperate(value);
  }, []);

  const saveConfig = useCallback(() => {
    const endpoint = form.endpoint.trim();
    if (!endpoint) {
      notify('warning', t('ai.config_endpoint_required'));
      return;
    }
    setProviderConfig({ ...form, endpoint });
    setForm((f) => ({ ...f, endpoint }));
    setConfigured(isOnlineConfigured());
    notify('success', t('ai.config_saved'));
  }, [form, t]);

  return (
    <aside className="ai-panel" data-testid="ai-assistant-panel">
      <div className="ai-panel-head">
        <span className="ai-panel-identity">
          <span className="ai-panel-avatar" aria-hidden="true">
            <SparklesIcon size={14} />
          </span>
          <span className="ai-panel-heading">
            <span className="ai-panel-title">{t('ai.title')}</span>
            <span className={`ai-panel-status${mode === 'online' ? ' is-online' : ' is-offline'}`}>
              <span className="ai-panel-status-dot" aria-hidden="true" />
              {mode === 'online' ? t('ai.mode.online') : t('ai.mode.offline')}
            </span>
          </span>
        </span>
        {onClose && (
          <span className="ai-panel-head-actions">
            <button
              type="button"
              className="icon-btn ai-panel-close"
              aria-label={t('ai.close')}
              title={t('ai.close')}
              onClick={onClose}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        )}
      </div>

      <div className="ai-panel-tabs" role="tablist" aria-label={t('agent.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={`ai-panel-tab${tab === 'chat' ? ' is-active' : ''}`}
          onClick={() => setTab('chat')}
        >
          {t('agent.tab_chat')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'capabilities'}
          className={`ai-panel-tab${tab === 'capabilities' ? ' is-active' : ''}`}
          onClick={() => setTab('capabilities')}
        >
          {t('agent.tab_capabilities')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'settings'}
          className={`ai-panel-tab${tab === 'settings' ? ' is-active' : ''}`}
          onClick={() => setTab('settings')}
        >
          {t('agent.tab_settings')}
        </button>
      </div>

      {tab === 'chat' && mode === 'online' && !agentReady && (
        <button type="button" className="ai-chat-banner" onClick={() => setTab('settings')}>
          <span className="ai-chat-banner-dot" aria-hidden="true" />
          <span className="ai-chat-banner-text">{t('ai.settings_banner')}</span>
          <span className="ai-chat-banner-go">{t('ai.settings_open')}</span>
        </button>
      )}

      {tab === 'settings' && (
        <div className="ai-settings">
          <section className="ai-setting-group">
            <h3 className="ai-setting-title">{t('ai.settings_mode')}</h3>
            <div className="ai-mode-seg" role="group" aria-label={t('ai.settings_mode')}>
              <button
                type="button"
                className={`ai-mode-seg-btn${mode === 'offline' ? ' is-active' : ''}`}
                aria-pressed={mode === 'offline'}
                onClick={() => selectMode('offline')}
              >
                {t('ai.mode.offline')}
              </button>
              <button
                type="button"
                className={`ai-mode-seg-btn${mode === 'online' ? ' is-active' : ''}`}
                aria-pressed={mode === 'online'}
                onClick={() => selectMode('online')}
              >
                {t('ai.mode.online')}
              </button>
            </div>
            <p className="ai-policy-note">
              {mode === 'offline' ? t('ai.privacy_note') : t('ai.privacy_note_online')}
            </p>
          </section>

          {mode === 'online' && (
            <>
              <section className="ai-setting-group">
                <h3 className="ai-setting-title">{t('ai.settings_auth')}</h3>
                <label className="ai-policy-row">
                  <input
                    type="checkbox"
                    checked={authorized}
                    onChange={(e) => toggleAuthorize(e.target.checked)}
                  />
                  <span>{t('ai.authorize_online')}</span>
                </label>

                <label className="ai-policy-row">
                  <input
                    type="checkbox"
                    checked={operate}
                    onChange={(e) => toggleOperate(e.target.checked)}
                    disabled={!authorized}
                  />
                  <span>{t('ai.authorize_operate')}</span>
                </label>
                {operate && agentReady && (
                  <p className="ai-policy-note ai-policy-tools">
                    {t('ai.tools_available', { n: availableTools().length })}
                  </p>
                )}
              </section>

              <section className="ai-setting-group">
                <div className="ai-setting-head">
                  <h3 className="ai-setting-title">{t('ai.settings_service')}</h3>
                  <span className={`ai-setting-status${configured ? ' is-ready' : ''}`}>
                    {configured ? t('ai.config_ready') : t('ai.config_not_ready')}
                  </span>
                </div>
                <div className="ai-service-form">
                  <label className="ai-field">
                    <span>{t('ai.endpoint')}</span>
                    <input
                      type="url"
                      className="input"
                      value={form.endpoint}
                      placeholder={t('ai.endpoint_placeholder')}
                      onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
                    />
                  </label>
                  <label className="ai-field">
                    <span>{t('ai.model')}</span>
                    <input
                      type="text"
                      className="input"
                      value={form.model}
                      placeholder={t('ai.model_placeholder')}
                      onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    />
                  </label>
                  <label className="ai-field">
                    <span>{t('ai.api_key')}</span>
                    <input
                      type="password"
                      className="input"
                      autoComplete="off"
                      value={form.apiKey}
                      placeholder={t('ai.api_key_placeholder')}
                      onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                    />
                  </label>
                  <label className="ai-policy-row">
                    <input
                      type="checkbox"
                      checked={form.vision === true}
                      onChange={(e) => setForm((f) => ({ ...f, vision: e.target.checked }))}
                    />
                    <span>{t('ai.vision_model')}</span>
                  </label>
                  <p className="ai-policy-note">{t('ai.vision_hint')}</p>
                  <p className="ai-policy-note">{t('ai.key_hint')}</p>
                  <button type="button" className="btn btn-sm btn-primary" onClick={saveConfig}>
                    {t('ai.save_config')}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {tab === 'chat' && (
        <>
      <div className="ai-chat" ref={listRef}>
        {history.length === 0 && (
          <div className="ai-chat-empty">
            <p className="ai-chat-empty-text">{t('ai.empty_hint')}</p>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            {m.role === 'assistant' ? (
              <MarkdownBody text={m.text} />
            ) : (
              <div className="ai-msg-text">{m.text}</div>
            )}
            {m.role === 'assistant' && m.calls && m.calls.length > 0 && (
              <ToolCallList calls={m.calls} label={t('ai.tools_used')} />
            )}
            {m.role === 'assistant' && m.confidence !== undefined && (
              <div className="ai-msg-meta">{t('ai.confidence', { n: Math.round(m.confidence * 100) })}</div>
            )}
            {m.role === 'assistant' && m.note && <div className="ai-msg-meta ai-msg-note">{m.note}</div>}
          </div>
        ))}
        {busy && liveCalls.length > 0 && (
          <div className="ai-msg ai-msg-assistant ai-msg-live">
            <ToolCallList calls={liveCalls} label={t('ai.tools_running')} live />
          </div>
        )}
        {busy && liveNote && <div className="ai-msg-meta ai-msg-note">{liveNote}</div>}
        {busy && liveCalls.length === 0 && (
          <div className="ai-typing" role="status" aria-label={t('ai.thinking')}>
            <span /><span /><span />
          </div>
        )}
      </div>

      {draft !== null && (
        <div className="ai-draft">
          <div className="ai-draft-label">{t('ai.draft_label')}</div>
          <textarea
            className="ai-draft-code"
            value={draft}
            rows={10}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="ai-draft-actions">
            <button type="button" className="btn btn-sm" onClick={insertToBuffer}>
              {t('ai.insert')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void runDraft()}
              disabled={!runCode || busy}
            >
              {t('ai.run')}
            </button>
            <button type="button" className="btn btn-sm" onClick={retry} disabled={busy}>
              {t('ai.retry')}
            </button>
            <button type="button" className="btn btn-sm" onClick={editDescription}>
              {t('ai.edit_desc')}
            </button>
          </div>
        </div>
      )}

      {advice && (
        <div className="ai-advice" role="alert">
          <div className="ai-advice-title">{t('ai.fix_advice')}</div>
          <p className="ai-advice-text">{advice}</p>
        </div>
      )}

      <div className="ai-panel-input">
        <textarea
          ref={composerRef}
          className="ai-composer"
          rows={1}
          value={prompt}
          placeholder={t('ai.placeholder')}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            // Ignore Enter while an IME composition is in flight (candidate
            // confirmation must not submit the uncommitted pinyin text).
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            // Shift+Enter inserts a newline; plain Enter sends.
            if (e.shiftKey) return;
            e.preventDefault();
            void submit();
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary ai-send"
          onClick={() => void submit()}
          disabled={busy || !prompt.trim()}
        >
          {busy ? '…' : t('ai.send')}
        </button>
      </div>
        </>
      )}

      {tab === 'capabilities' && <AgentCapabilityPanel />}
    </aside>
  );
}

export default AiAssistantPanel;
