// ==========================================================================
// Ergalics Studio — FR-07 AI assistant panel (代码/积木模式侧边栏)
//
// Chat-style panel: natural-language prompt → offline intent engine →
// editable `studio.*` code draft → insert into the editor buffer / flow
// canvas → run. On a run failure the panel shows rule-based fix advice
// (suggestFix). Conversation history lives in component state; in offline
// mode nothing ever leaves the machine, and online mode requires an
// explicit authorization flag (see @/core/ai/provider).
//
// Mounted by CodeEditor and BlockEditor as a toggleable right-hand column;
// the host supplies a `runCode` callback so execution reuses each editor's
// own runtime (Pyodide for Python code mode, IR interpreter elsewhere).
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { parseCodeToIR } from '@/editor/code/parse';
import {
  askAssistant,
  adviseOnRunError,
  getAssistantMode,
  isOnlineAuthorized,
  setAssistantMode,
  setOnlineAuthorized,
  type AssistantMode,
} from '@/core/ai/provider';
import { matchIntent, synthesizeCode, type IntentKind, type IntentSlots } from '@/core/ai/intents';

/** Outcome of a host-executed assistant run. */
export interface AiRunResult {
  ok: boolean;
  /** Error message when the run failed. */
  error?: string;
  /** True when the code was only inserted (canvas) — run it in code mode. */
  insertedOnly?: boolean;
}

export interface AiAssistantPanelProps {
  /** Host editor's insert-and-run hook (Pyodide / IR interpreter). */
  runCode?: (code: string) => Promise<AiRunResult>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  confidence?: number;
  code?: string;
}

export function AiAssistantPanel({ runCode }: AiAssistantPanelProps) {
  const t = useT();
  const { locale } = useLocale();

  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<string | null>(null);
  const [mode, setMode] = useState<AssistantMode>(() => getAssistantMode());
  const [authorized, setAuthorized] = useState<boolean>(() => isOnlineAuthorized());
  const lastRequestRef = useRef<{ prompt: string; kind: IntentKind; slots: IntentSlots } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [history, advice]);

  const notify = (kind: 'info' | 'success' | 'warning' | 'error', message: string) => {
    useAppStore.getState().notify(kind, message);
  };

  const submit = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setAdvice(null);
    setHistory((h) => [...h, { role: 'user', text }]);
    setPrompt('');
    try {
      const reply = await askAssistant({ prompt: text, locale, history: history.map((m) => m.text) });
      // Hoist the narrowed values to locals: TS property narrowing does not
      // survive into the setHistory closure below (strict mode).
      const intent = reply.intent;
      const code = reply.code;
      if (code && intent) {
        lastRequestRef.current = { prompt: text, kind: intent.kind, slots: intent.slots };
        setHistory((h) => [
          ...h,
          {
            role: 'assistant',
            text: t('ai.generated', { kind: t(`ai.intent.${intent.kind}`) }),
            confidence: intent.confidence,
            code,
          },
        ]);
        setDraft(code);
      } else {
        lastRequestRef.current = null;
        setHistory((h) => [...h, { role: 'assistant', text: reply.note ?? t('ai.no_match') }]);
      }
    } finally {
      setBusy(false);
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
    setAssistantMode(value ? 'online' : 'offline');
    setMode(getAssistantMode());
  }, []);

  const selectMode = useCallback((next: AssistantMode) => {
    if (next === 'online' && !isOnlineAuthorized()) return; // gate: needs auth
    setAssistantMode(next);
    setMode(getAssistantMode());
  }, []);

  return (
    <aside className="ai-panel" data-testid="ai-assistant-panel">
      <div className="ai-panel-head">
        <span className="ai-panel-title">{t('ai.title')}</span>
        <span className={`ai-mode-pill ${mode === 'online' ? 'is-online' : 'is-offline'}`}>
          {mode === 'online' ? t('ai.mode.online') : t('ai.mode.offline')}
        </span>
      </div>

      <div className="ai-panel-policy">
        <label className="ai-policy-row">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => toggleAuthorize(e.target.checked)}
          />
          <span>{t('ai.authorize_online')}</span>
        </label>
        <div className="ai-policy-row">
          <button
            type="button"
            className={`btn btn-sm${mode === 'offline' ? ' btn-toggle-on' : ''}`}
            onClick={() => selectMode('offline')}
          >
            {t('ai.mode.offline')}
          </button>
          <button
            type="button"
            className={`btn btn-sm${mode === 'online' ? ' btn-toggle-on' : ''}`}
            onClick={() => selectMode('online')}
            disabled={!authorized}
            title={authorized ? t('ai.mode.online') : t('ai.authorize_first')}
          >
            {t('ai.mode.online')}
          </button>
        </div>
        <p className="ai-policy-note">{t('ai.privacy_note')}</p>
      </div>

      <div className="ai-chat" ref={listRef}>
        {history.length === 0 && <p className="ai-chat-empty">{t('ai.empty_hint')}</p>}
        {history.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            <div className="ai-msg-text">{m.text}</div>
            {m.role === 'assistant' && m.confidence !== undefined && (
              <div className="ai-msg-meta">{t('ai.confidence', { n: Math.round(m.confidence * 100) })}</div>
            )}
          </div>
        ))}
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
        <input
          type="text"
          className="input"
          value={prompt}
          placeholder={t('ai.placeholder')}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          disabled={busy}
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void submit()} disabled={busy || !prompt.trim()}>
          {busy ? '…' : t('ai.send')}
        </button>
      </div>
    </aside>
  );
}

export default AiAssistantPanel;
