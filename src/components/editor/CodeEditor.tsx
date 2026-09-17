// ==========================================================================
// Ergalics Studio — code editor (Monaco, code mode)
//
// A Monaco editor with three switchable languages:
//
//   • Python — backed by the Pyodide worker runtime: full CPython semantics,
//     `import studio`, free-form syntax (list comprehensions, f-strings…).
//   • R / JavaScript — the same studio DSL that block mode generates. Text
//     is parsed into the canonical IR and executed by the in-process IR
//     interpreter (createWorkbenchStudioApi), identical to block mode.
//
// Switching a language translates the program from the IR hub (codegen), so
// block / flow / code stay three-way synchronized. Keystrokes are debounced
// before being parsed back to IR. Run payloads render through the plugin
// bridge; a Python-only REPL evaluates single expressions (§12).
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import type * as MonacoNS from 'monaco-editor';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore, setHostContainers, rerenderActivePlugin } from '@/stores/pluginStore';
import { resolveDataFile, listDataFiles } from '@/core/dataFiles';
import { monaco, applyMonacoTheme, monacoThemeData } from '@/core/monaco/setup';
import { createCodeRuntime, type CodeRuntime } from '@/core/pyodide/runtime';
import { hashString } from '@/core/repro/random';
import { useExperimentStore, numericMetrics } from '@/stores/experimentStore';
import { codegen } from '@/editor/codegen';
import { parseCodeToIR } from '@/editor/code/parse';
import { interpret } from '@/editor/runtime/interpreter';
import { createWorkbenchStudioApi } from '@/editor/runtime/workbench-host';
import type { CodeLanguage } from '@/types/editor';
import { VariablePanel } from './VariablePanel';
import { ConsolePanel } from './ConsolePanel';

/** Keystroke → IR debounce (mirrors block mode's 120ms, slightly roomier). */
const SYNC_DEBOUNCE_MS = 150;

type MonacoLang = 'python' | 'r' | 'javascript';

const MONACO_LANG: Record<CodeLanguage, MonacoLang> = {
  python: 'python',
  r: 'r',
  js: 'javascript',
};

const LANG_TAB_SIZE: Record<CodeLanguage, number> = { python: 4, r: 2, js: 2 };

/** Clear the 2D preview canvas + DOM overlay before a fresh run. */
function clearPreviewSurface(canvas: HTMLCanvasElement | null, dom: HTMLDivElement | null): void {
  if (canvas) {
    const g = canvas.getContext('2d');
    if (g) g.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (dom) dom.innerHTML = '';
}

const STUDIO_COMPLETIONS: Omit<MonacoNS.languages.CompletionItem, 'range'>[] = [
  { label: 'studio.load', kind: 3, insertText: 'studio.load("")', detail: 'load a data file' },
  { label: 'studio.random', kind: 3, insertText: 'studio.random(100)', detail: 'random numbers' },
  { label: 'studio.range', kind: 3, insertText: 'studio.range(0, 10)', detail: 'numeric range' },
  { label: 'studio.normalize', kind: 3, insertText: 'studio.normalize(df, "col")', detail: 'normalize a column' },
  { label: 'studio.sort', kind: 3, insertText: 'studio.sort(df, "col")', detail: 'sort a table' },
  { label: 'studio.select', kind: 3, insertText: 'studio.select(df, ["col"])', detail: 'pick columns' },
  { label: 'studio.addColumn', kind: 3, insertText: 'studio.addColumn(df, "name", values)', detail: 'append a column from values' },
  { label: 'studio.addConstantColumn', kind: 3, insertText: 'studio.addConstantColumn(df, "name", 1)', detail: 'append a constant column' },
  { label: 'studio.exampleData', kind: 3, insertText: 'studio.exampleData(200, 1)', detail: 'sine + noise sample data' },
  { label: 'studio.grid', kind: 3, insertText: 'studio.grid(20)', detail: 'size×size x/y grid' },
  { label: 'studio.filterRange', kind: 3, insertText: 'studio.filterRange(df, "x", 0, 1)', detail: 'inclusive numeric range filter' },
  { label: 'studio.topK', kind: 3, insertText: 'studio.topK(df, "x", 10, "largest")', detail: 'top K rows by column' },
  { label: 'studio.renameColumn', kind: 3, insertText: 'studio.renameColumn(df, "x", "z")', detail: 'rename a column' },
  { label: 'studio.filter', kind: 3, insertText: 'studio.filter(df, "col", ">", 5)', detail: 'filter rows' },
  { label: 'studio.summary', kind: 3, insertText: 'studio.summary(df, "col")', detail: 'column stats' },
  { label: 'studio.histogram', kind: 3, insertText: 'studio.histogram(df, "col", 10)', detail: 'column histogram' },
  { label: 'studio.plot', kind: 3, insertText: 'studio.plot("scatter", df)', detail: 'render a plot' },
  { label: 'studio.print', kind: 3, insertText: 'studio.print("hello")', detail: 'print to console' },
  { label: 'studio.notify', kind: 3, insertText: 'studio.notify("info", "done")', detail: 'host notification' },
  { label: 'studio.getParam', kind: 3, insertText: 'studio.getParam("key")', detail: 'read a project param' },
  { label: 'studio.setParam', kind: 3, insertText: 'studio.setParam("key", value)', detail: 'write a project param' },
];

export function CodeEditor() {
  const t = useT();
  const { resolved: resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  const session = useEditorStore((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null);
  const language: CodeLanguage = session?.language ?? 'python';
  const isRunning = useEditorStore((s) => s.isRunning);
  const pendingLoad = useEditorStore((s) => s.pendingLoad);
  // Right pane (preview / variables / console) toggled by the top-bar ☰.
  const panelOpen = useAppStore((s) => s.modePanelOpen);

  const containerRef = useRef<HTMLDivElement>(null);
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const runtimeRef = useRef<CodeRuntime | null>(null);
  const replRef = useRef<HTMLInputElement>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const syncLangRef = useRef<CodeLanguage>('python');
  /** True while WE replace the buffer (session load / language switch). */
  const silentSetRef = useRef(false);
  /** Latest run action, invoked by the Ctrl/⌘+Enter editor command. */
  const runActionRef = useRef<() => void>(() => {});
  const [replInput, setReplInput] = useState('');
  const [runtimeReady, setRuntimeReady] = useState(false);

  // ---- Monaco setup (once per mount; theme applied reactively) ----------

  useEffect(() => {
    applyMonacoTheme(resolvedTheme);
    monaco.editor.defineTheme('ergalics', monacoThemeData(resolvedTheme));
    monaco.editor.setTheme('ergalics');
  }, [dark, resolvedTheme]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initial = useEditorStore.getState().sessions.find((s) => s.id === activeSessionId)?.lastCode ?? '';
    const editor = monaco.editor.create(containerRef.current, {
      value: initial,
      language: MONACO_LANG[useEditorStore.getState().sessions.find((s) => s.id === activeSessionId)?.language ?? 'python'],
      theme: 'ergalics',
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 4,
      insertSpaces: true,
      renderWhitespace: 'selection',
      wordWrap: 'on',
      padding: { top: 12, bottom: 12 },
    });
    editorRef.current = editor;

    // Notebook-style run shortcut: Ctrl/⌘ + Enter.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runActionRef.current();
    });

    editor.onDidChangeModelContent(() => {
      if (silentSetRef.current) return;
      const sid = useEditorStore.getState().activeSessionId;
      if (!sid) return;
      // Capture the language of THIS edit; a stale flush after a language
      // switch must not parse the old dialect's text as the new dialect.
      syncLangRef.current = useEditorStore.getState().sessions.find((s) => s.id === sid)?.language ?? 'python';
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null;
        const text = editor.getValue();
        const curSid = useEditorStore.getState().activeSessionId;
        if (!curSid) return;
        const curLang = useEditorStore.getState().sessions.find((s) => s.id === curSid)?.language ?? 'python';
        if (curLang !== syncLangRef.current) return; // language switched meanwhile
        // Parse the edited code back into the IR hub so Block/Flow regenerate.
        useEditorStore.getState().syncFromCode(curSid, text);
      }, SYNC_DEBOUNCE_MS);
    });

    // `studio.*` completions for every supported language. Registration
    // handles must be disposed — editor.dispose() does not unregister
    // providers, so remounts used to stack duplicates and keep closures.
    const providers = (['python', 'r', 'javascript'] as MonacoLang[]).map((lang) =>
      monaco.languages.registerCompletionItemProvider(lang, {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range: MonacoNS.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return { suggestions: STUDIO_COMPLETIONS.map((c) => ({ ...c, range })) };
        },
      }),
    );

    return () => {
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      providers.forEach((p) => p.dispose());
      editor.dispose();
      editorRef.current = null;
    };
    // Editor instance is bound to the active session (matches prior design).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // ---- Pyodide runtime lifecycle (Python engine) -----------------------

  useEffect(() => {
    const runtime = createCodeRuntime({
      // Serve Pyodide same-origin from public/pyodide (vendored by the
      // copy-pyodide build step) instead of cdn.jsdelivr.net — far more
      // reliable from mainland China and cached by the app's own origin.
      indexURL: new URL('pyodide/', document.baseURI).href,
      activatePlugin: async (pluginId) => {
        const store = usePluginStore.getState();
        if (store.activeId !== pluginId) {
          await store.activate(pluginId);
        } else {
          rerenderActivePlugin();
        }
        return store.getActive();
      },
      onStdout: (text) => useEditorStore.getState().appendConsole({ stream: 'stdout', text }),
      onStderr: (text) => useEditorStore.getState().appendConsole({ stream: 'stderr', text }),
      onNotify: (kind, message) => useAppStore.getState().notify(kind, message),
    });
    runtimeRef.current = runtime;
    void runtime.runPython('import studio', {}, {}).then(
      () => setRuntimeReady(true),
      () => setRuntimeReady(false),
    );
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
      setRuntimeReady(false);
    };
  }, []);

  // Register render containers for the preview area (2D plugins), mirroring
  // block mode so plot payloads draw into the code editor's preview surface.
  useEffect(() => {
    if (!domRef.current || !canvasRef.current) return;
    setHostContainers({
      dom: domRef.current,
      canvas2d: canvasRef.current,
      reportDataScale: (n) => useAppStore.getState().setDataScale(n),
      clearCanvas2d: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const g = canvas.getContext('2d');
        if (g) g.clearRect(0, 0, canvas.width, canvas.height);
      },
    });
    rerenderActivePlugin();
    return () => setHostContainers(null);
  }, []);

  // Ensure a code session exists; when the session OR its language changes,
  // (re)load the translated text and switch Monaco's model language.
  useEffect(() => {
    if (!activeSessionId) {
      useEditorStore.getState().createSession('code', language);
      return;
    }
    const key = `${activeSessionId}:${language}`;
    if (loadedKeyRef.current === key) return;
    const sess = useEditorStore.getState().sessions.find((s) => s.id === activeSessionId);
    const editor = editorRef.current;
    if (editor && sess) {
      // setValue fires onDidChangeModelContent — suppress the echo so a
      // freshly translated buffer is not re-parsed straight back.
      silentSetRef.current = true;
      editor.setValue(sess.lastCode);
      monaco.editor.setModelLanguage(editor.getModel()!, MONACO_LANG[language]);
      editor.updateOptions({ tabSize: LANG_TAB_SIZE[language] });
      window.requestAnimationFrame(() => {
        silentSetRef.current = false;
      });
    }
    loadedKeyRef.current = key;
  }, [activeSessionId, language]);

  // Consume a program requested by an external caller (e.g. the samples
  // dialog) by loading its code form (in the session's language) in.
  useEffect(() => {
    if (!pendingLoad) return;
    const editor = editorRef.current;
    if (editor) {
      // A code session renders `lastCode`; requestLoad only carries IR, so
      // generate text in the active dialect here (empty branch previously
      // made loading a sample in code mode appear to do nothing).
      const sid = useEditorStore.getState().activeSessionId;
      const lang = useEditorStore.getState().sessions.find((s) => s.id === sid)?.language ?? 'python';
      const code = codegen(pendingLoad, lang === 'js' ? 'js' : lang === 'r' ? 'r' : 'python');
      silentSetRef.current = true;
      editor.setValue(code);
      monaco.editor.setModelLanguage(editor.getModel()!, MONACO_LANG[lang]);
      window.requestAnimationFrame(() => {
        silentSetRef.current = false;
      });
      if (sid) useEditorStore.getState().updateSessionIR(sid, pendingLoad, code);
      loadedKeyRef.current = `${sid}:${lang}`;
    }
    clearPreviewSurface(canvasRef.current, domRef.current);
    useEditorStore.getState().consumeLoad();
  }, [pendingLoad]);

  /** Ship every resolvable data file into the worker as _FILES. */
  const collectFiles = (): Record<string, string> => {
    const files: Record<string, string> = {};
    for (const name of listDataFiles()) {
      const text = resolveDataFile(name);
      if (text !== undefined) files[name] = text;
    }
    return files;
  };

  /** Run R / JavaScript text through the IR interpreter (block-mode engine). */
  const runViaIR = async (code: string, lang: CodeLanguage): Promise<{ ok: boolean; outputs: Record<string, unknown> }> => {
    const { program, rawCount } = parseCodeToIR(code, lang);
    if (rawCount > 0) {
      useEditorStore
        .getState()
        .appendConsole({ stream: 'stderr', text: t('editor.run.unsupported_notice', { count: rawCount, lang: lang === 'r' ? 'R' : 'JavaScript' }) });
    }
    const result = await interpret(program, createWorkbenchStudioApi());
    if (result.ok) {
      useEditorStore.getState().setVariables(result.variables);
      return { ok: true, outputs: result.variables };
    }
    const msg = result.error?.message ?? 'run failed';
    useEditorStore.getState().setError(msg);
    useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
    return { ok: false, outputs: {} };
  };

  const run = async () => {
    const editor = editorRef.current;
    if (!editor || isRunning) return;
    // Python needs the Pyodide worker; R/JS run on the in-process interpreter.
    if (language === 'python' && !runtimeRef.current) return;
    const code = editor.getValue();
    const startedAt = Date.now();
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().clearConsole();
    useEditorStore.getState().setError(null);
    useEditorStore.getState().setVariables({});
    clearPreviewSurface(canvasRef.current, domRef.current);
    let ok = false;
    let outputs: Record<string, unknown> = {};
    try {
      if (language === 'python') {
        const result = await runtimeRef.current!.runPython(code, collectFiles(), {});
        if (result.ok) {
          ok = true;
          outputs = result.outputs;
          useEditorStore.getState().setVariables(result.outputs);
        } else {
          const msg = result.error ?? 'run failed';
          useEditorStore.getState().setError(msg);
          useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
        }
      } else {
        const irResult = await runViaIR(code, language);
        ok = irResult.ok;
        outputs = irResult.outputs;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useEditorStore.getState().setError(msg);
      useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
    } finally {
      useEditorStore.getState().setRunning(false);
      // Experiment tracking: record every finished attempt (successes and
      // failures alike) so the run history reflects real research practice.
      void useExperimentStore.getState().recordRun({
        source: 'code',
        params: { codeChars: code.length, language },
        inputsHash: hashString(`${language}:${code}`),
        metrics: numericMetrics(outputs),
        durationMs: Date.now() - startedAt,
        failed: !ok,
      });
    }
  };

  const stop = () => {
    // Only the Pyodide worker is interruptible; IR programs are short-lived.
    if (language === 'python') runtimeRef.current?.interrupt();
    useEditorStore.getState().setRunning(false);
  };

  // Keep the keyboard command bound to the latest run/stop closures.
  runActionRef.current = () => {
    if (isRunning) stop();
    else void run();
  };

  const runRepl = async () => {
    const runtime = runtimeRef.current;
    const line = replInput.trim();
    if (!runtime || !line) return;
    setReplInput('');
    try {
      const result = await runtime.repl(line);
      if (result.ok) {
        if (result.text) useEditorStore.getState().appendConsole({ stream: 'stdout', text: result.text });
      } else {
        useEditorStore.getState().appendConsole({ stream: 'stderr', text: result.error ?? 'repl error' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
    }
  };

  const handleReplKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void runRepl();
  };

  /** Translate the whole buffer from the IR hub into another dialect. */
  const switchLanguage = (lang: CodeLanguage) => {
    if (lang === language || isRunning) return;
    const sid = activeSessionId;
    if (!sid) return;
    // Flush any pending edit first so the IR reflects the latest keystrokes
    // in the current dialect before the dialect changes.
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      useEditorStore.getState().syncFromCode(sid, editorRef.current?.getValue() ?? '');
    }
    useEditorStore.getState().setSessionLanguage(sid, lang);
  };

  const engineReady = language !== 'python' || runtimeReady;
  const langButtons: { id: CodeLanguage; label: string }[] = [
    { id: 'python', label: 'Python' },
    { id: 'r', label: 'R' },
    { id: 'js', label: 'JS' },
  ];

  return (
    <div className="block-editor code-editor">
      <div className="block-editor-toolbar">
        <button
          type="button"
          className="be-run-btn"
          title={t('editor.run.hint')}
          onClick={isRunning ? stop : () => void run()}
          disabled={!isRunning && !engineReady}
        >
          <span className="be-run-icon">{isRunning ? '■' : '▶'}</span>
          <span>{isRunning ? t('editor.stop') : t('editor.run')}</span>
        </button>

        <div className="block-editor-toggle code-editor-lang-toggle" role="group" aria-label={t('editor.language')}>
          {langButtons.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`btn btn-sm${language === b.id ? ' btn-toggle-on' : ''}`}
              onClick={() => switchLanguage(b.id)}
              disabled={isRunning}
            >
              {b.label}
            </button>
          ))}
        </div>

        <span className="be-code-lang be-code-lang-toolbar" title={language === 'python' ? t('editor.engine.pyodide') : t('editor.engine.interpreter', { lang: language === 'r' ? 'R' : 'JavaScript' })}>
          {language === 'python' ? 'Pyodide' : 'IR'}
        </span>

        <div className="be-toolbar-spacer" />

        <div className={`be-status-pill ${isRunning ? 'is-running' : engineReady ? 'is-idle' : 'is-loading'}`}>
          <span className="be-status-dot" />
          <span className="be-status-text">
            {isRunning
              ? t('editor.status.running')
              : engineReady
                ? t('editor.status.ready')
                : t('editor.loading_runtime')}
          </span>
        </div>
      </div>

      <div className="block-editor-main">
        <div ref={containerRef} className="code-editor-monaco" />

        <div className={`block-editor-right${panelOpen ? '' : ' is-panel-hidden'}`}>
          <div className="block-editor-preview">
            <div className="block-editor-preview-label">{t('editor.preview.title')}</div>
            <div ref={domRef} className="block-editor-preview-dom" />
            <canvas ref={canvasRef} className="block-editor-preview-canvas" />
          </div>
          <VariablePanel />
          <div className="editor-panel editor-console-wrap">
            <ConsolePanel />
            {/* REPL needs a persistent Python namespace — Pyodide only. */}
            {language === 'python' && (
              <div className="code-editor-repl">
                <span className="code-editor-repl-prompt">&gt;&gt;&gt;</span>
                <input
                  ref={replRef}
                  type="text"
                  value={replInput}
                  onChange={(e) => setReplInput(e.target.value)}
                  onKeyDown={handleReplKey}
                  placeholder={t('editor.repl.placeholder')}
                  spellCheck={false}
                />
                <button type="button" className="code-editor-repl-go" onClick={() => void runRepl()} title={t('editor.run')}>
                  ↵
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
