// ==========================================================================
// Ergalics Studio — code editor (Monaco + Pyodide, code mode)
//
// A Monaco Python editor backed by a Pyodide worker runtime. The user writes
// free-form Python using the same `studio.*` API block mode generates; Run
// executes the program in the worker (data files shipped as _FILES), plot
// payloads render through the existing plugin bridge, and a REPL line
// evaluates single expressions into the console (editor architecture §12).
//
// The active code session's text is persisted back to the session (lastCode)
// so it survives project save/restore. IR ↔ text sync (block→code) is handled
// when a code session is created from IR; free-form edits are the user's own.
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
import { VariablePanel } from './VariablePanel';
import { ConsolePanel } from './ConsolePanel';

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
  { label: 'studio.addColumn', kind: 3, insertText: 'studio.addColumn(df, "name", values)', detail: 'append a column' },
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
  const isRunning = useEditorStore((s) => s.isRunning);
  const pendingLoad = useEditorStore((s) => s.pendingLoad);

  const containerRef = useRef<HTMLDivElement>(null);
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const runtimeRef = useRef<CodeRuntime | null>(null);
  const replRef = useRef<HTMLInputElement>(null);
  const lastLoadedId = useRef<string | null>(null);
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
      language: 'python',
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

    editor.onDidChangeModelContent(() => {
      const sid = useEditorStore.getState().activeSessionId;
      if (!sid) return;
      const session = useEditorStore.getState().sessions.find((s) => s.id === sid);
      if (!session) return;
      const text = editor.getValue();
      useEditorStore.getState().updateSessionIR(sid, session.ir, text);
    });

    // `studio.*` completions for the Python language.
    monaco.languages.registerCompletionItemProvider('python', {
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
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, [activeSessionId]);

  // ---- Pyodide runtime lifecycle ----------------------------------------

  useEffect(() => {
    const runtime = createCodeRuntime({
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

  // Ensure a code session exists, and (re)load its text when it changes.
  useEffect(() => {
    if (!activeSessionId) {
      useEditorStore.getState().createSession('code', 'python');
      return;
    }
    if (lastLoadedId.current === activeSessionId) return;
    const session = useEditorStore.getState().sessions.find((s) => s.id === activeSessionId);
    const editor = editorRef.current;
    if (editor && session) {
      editor.setValue(session.lastCode);
    }
    lastLoadedId.current = activeSessionId;
  }, [activeSessionId]);

  // Consume a program requested by an external caller (e.g. a block→code
  // sync entry point) by loading its Python form into the editor.
  useEffect(() => {
    if (!pendingLoad) return;
    const editor = editorRef.current;
    if (editor && pendingLoad.functions.length === 0) {
      // The caller already wrote the code text into the session; nothing to do.
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

  const run = async () => {
    const editor = editorRef.current;
    const runtime = runtimeRef.current;
    if (!editor || !runtime || isRunning) return;
    const code = editor.getValue();
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().clearConsole();
    useEditorStore.getState().setError(null);
    useEditorStore.getState().setVariables({});
    clearPreviewSurface(canvasRef.current, domRef.current);
    try {
      const result = await runtime.runPython(code, collectFiles(), {});
      if (result.ok) {
        useEditorStore.getState().setVariables(result.outputs);
      } else {
        const msg = result.error ?? 'run failed';
        useEditorStore.getState().setError(msg);
        useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useEditorStore.getState().setError(msg);
      useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
    } finally {
      useEditorStore.getState().setRunning(false);
    }
  };

  const stop = () => {
    runtimeRef.current?.interrupt();
    useEditorStore.getState().setRunning(false);
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

  return (
    <div className="block-editor code-editor">
      <div className="block-editor-toolbar">
        <button type="button" className="be-run-btn" onClick={isRunning ? stop : () => void run()} disabled={!runtimeReady}>
          <span className="be-run-icon">{isRunning ? '■' : '▶'}</span>
          <span>{isRunning ? t('editor.stop') : t('editor.run')}</span>
        </button>

        <span className="be-code-lang be-code-lang-toolbar">Python · Pyodide</span>

        <div className="be-toolbar-spacer" />

        <div className={`be-status-pill ${isRunning ? 'is-running' : runtimeReady ? 'is-idle' : 'is-loading'}`}>
          <span className="be-status-dot" />
          <span className="be-status-text">
            {isRunning
              ? t('editor.status.running')
              : runtimeReady
                ? t('editor.status.idle')
                : t('editor.loading_runtime')}
          </span>
        </div>
      </div>

      <div className="block-editor-main">
        <div ref={containerRef} className="code-editor-monaco" />

        <div className="block-editor-right">
          <div className="block-editor-preview">
            <div className="block-editor-preview-label">{t('editor.preview.title')}</div>
            <div ref={domRef} className="block-editor-preview-dom" />
            <canvas ref={canvasRef} className="block-editor-preview-canvas" />
          </div>
          <VariablePanel />
          <div className="editor-panel editor-console-wrap">
            <ConsolePanel />
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
          </div>
        </div>
      </div>
    </div>
  );
}