// ==========================================================================
// Ergalics Studio — code editor (Monaco, code mode)
//
// A Monaco editor with three switchable languages:
//
//   • Python — backed by the Pyodide worker runtime: full CPython semantics,
//     `import studio`, free-form syntax (list comprehensions, f-strings…).
//   • R — pluggable runtime (FR-04): the full webR engine when the vendored
//     bundle is available (free syntax + CRAN packages), otherwise the same
//     studio DSL that block mode generates (built-in IR engine), with the
//     fallback reason surfaced to the user.
//   • JavaScript — the same studio DSL that block mode generates. Text
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
import {
  CornerDownLeftIcon,
  DownloadIcon,
  LoaderIcon,
  PlayIcon,
  StopIcon,
  ToolIcon,
} from '@/components/icons';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { clearHostPreview } from '@/stores/pluginStore';
import { collectRuntimeFiles } from '@/core/dataFiles';
import { monaco, applyMonacoTheme, monacoThemeData } from '@/core/monaco/setup';
import { STUDIO_COMPLETIONS } from '@/core/monaco/completions';
import type { CodeRuntime } from '@/core/pyodide/runtime';
import {
  getPythonRuntime,
  subscribePythonOutput,
  warmPythonRuntime,
} from '@/core/pyodide/code-runtime';
import { createRRuntime } from '@/core/r/runtime-factory';
import type { RLanguageRuntime, REngine } from '@/core/r/types';
import { hashString } from '@/core/repro/random';
import { useExperimentStore, numericMetrics } from '@/stores/experimentStore';
import { codegen } from '@/editor/codegen';
import { parseCodeToIR } from '@/editor/code/parse';
import { interpret } from '@/editor/runtime/interpreter';
import { createWorkbenchStudioApi } from '@/editor/runtime/workbench-host';
import type { CodeLanguage } from '@/types/editor';

import { ConsolePanel } from './ConsolePanel';
import { SurfaceToolbar } from './SurfaceToolbar';
import { useEditorSplit } from './useEditorSplit';
import { useAiPanelStore, type AiRunResult } from '@/stores/aiPanelStore';

/** Keystroke → IR debounce (mirrors block mode's 120ms, slightly roomier). */
const SYNC_DEBOUNCE_MS = 150;

type MonacoLang = 'python' | 'r' | 'javascript';

const MONACO_LANG: Record<CodeLanguage, MonacoLang> = {
  python: 'python',
  r: 'r',
  js: 'javascript',
};

const LANG_TAB_SIZE: Record<CodeLanguage, number> = { python: 4, r: 2, js: 2 };

export function CodeEditor() {
  const t = useT();
  const { resolved: resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  const session = useEditorStore((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null);
  const language: CodeLanguage = session?.language ?? 'python';
  const isRunning = useEditorStore((s) => s.isRunning);
  const pendingLoad = useEditorStore((s) => s.pendingLoad);
  // Result preview + variables live in the workbench right sidebar now; this
  // surface only keeps the console dock under the editor.
  const { dockHeight, dockHandleProps } = useEditorSplit();

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const runtimeRef = useRef<CodeRuntime | null>(null);
  const replRef = useRef<HTMLInputElement>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const syncLangRef = useRef<CodeLanguage>('python');
  /** Live text of the current buffer (null until Monaco is created), used to
   *  mirror code-mode edits back into the source file tab on unmount. */
  const codeTextRef = useRef<string | null>(null);
  /** Workspace file this code session is bound to (if opened from a file). */
  const filePathRef = useRef<string | undefined>(undefined);
  filePathRef.current = session?.filePath;
  /** Latest "save bound file" action for the Monaco Ctrl/⌘+S command. */
  const saveBoundRef = useRef<() => void>(() => {});
  /** True while WE replace the buffer (session load / language switch). */
  const silentSetRef = useRef(false);
  /** Latest run action, invoked by the Ctrl/⌘+Enter editor command. */
  const runActionRef = useRef<() => void>(() => {});
  const [replInput, setReplInput] = useState('');
  const [runtimeReady, setRuntimeReady] = useState(false);
  // ---- R runtime state (FR-04: full webR with builtin-IR fallback) ------
  const rRuntimeRef = useRef<RLanguageRuntime | null>(null);
  const [rEngine, setREngine] = useState<REngine | null>(null);
  /** Non-null while the full R runtime is booting (drives the progress UI). */
  const [rLoadPercent, setRLoadPercent] = useState<number | null>(null);
  const [rPkgInput, setRPkgInput] = useState('');
  const [rInstalling, setRInstalling] = useState(false);

  // ---- Monaco setup (once per mount; theme applied reactively) ----------

  useEffect(() => {
    applyMonacoTheme(resolvedTheme);
    monaco.editor.defineTheme('ergalics', monacoThemeData(resolvedTheme));
    monaco.editor.setTheme('ergalics');
  }, [dark, resolvedTheme]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initial = useEditorStore.getState().sessions.find((s) => s.id === activeSessionId)?.lastCode ?? '';
    codeTextRef.current = initial;
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

    // When this session came from a workspace file, Ctrl/⌘+S saves that file
    // instead of only persisting the project snapshot.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveBoundRef.current();
    });

    editor.onDidChangeModelContent(() => {
      if (silentSetRef.current) return;
      const sid = useEditorStore.getState().activeSessionId;
      if (!sid) return;
      codeTextRef.current = editor.getValue();
      // Capture the language of THIS edit; a stale flush after a language
      // switch must not parse the old dialect's text as the new dialect.
      syncLangRef.current = useEditorStore.getState().sessions.find((s) => s.id === sid)?.language ?? 'python';
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null;
        const text = editor.getValue();
        const curSid = useEditorStore.getState().activeSessionId;
        if (!curSid) return;
        const curSess = useEditorStore.getState().sessions.find((s) => s.id === curSid);
        // Mirror the text into the source file's tab buffer so returning to
        // the workspace (or saving the project) never shows a stale/empty file.
        if (curSess?.filePath) useAppStore.getState().updateEditorFile(curSess.filePath, text);
        if ((curSess?.language ?? 'python') !== syncLangRef.current) return; // language switched meanwhile
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
     
  }, [activeSessionId]);

  // ---- Pyodide runtime lifecycle (Python engine) -----------------------

  useEffect(() => {
    // The interpreter is session-wide (core/pyodide/code-runtime) and is NOT
    // disposed here: switching modes or projects reuses the already-booted
    // worker instead of paying the Pyodide download/init cost again.
    let alive = true;
    runtimeRef.current = getPythonRuntime();
    const unsubscribe = subscribePythonOutput({
      stdout: (text) => useEditorStore.getState().appendConsole({ stream: 'stdout', text }),
      stderr: (text) => useEditorStore.getState().appendConsole({ stream: 'stderr', text }),
    });
    void warmPythonRuntime().then((ok) => {
      if (alive) setRuntimeReady(ok);
    });
    return () => {
      alive = false;
      unsubscribe();
      runtimeRef.current = null;
    };
  }, []);

  // ---- R runtime lifecycle (FR-04: full webR ⇄ builtin-IR fallback) -----
  //
  // Created lazily the first time a session switches to R (selecting the R
  // tab defaults to the full runtime). If webR cannot be loaded the factory
  // falls back to the built-in IR engine and the reason is surfaced in the
  // console + a host notification — the editor stays usable either way.

  /** Boot (or re-boot after an interrupt) the R runtime and store it. */
  const bootRRuntime = async (): Promise<void> => {
    if (rRuntimeRef.current) return;
    setRLoadPercent(0);
    try {
      const { runtime, engine, fallbackReason } = await createRRuntime({
        preferFull: true,
        getStudioApi: createWorkbenchStudioApi,
        onProgress: (percent) => setRLoadPercent(percent),
      });
      rRuntimeRef.current = runtime;
      setREngine(engine);
      if (fallbackReason) {
        const msg = t('r.fallback.notice', { reason: fallbackReason });
        useEditorStore.getState().appendConsole({ stream: 'info', text: msg });
        useAppStore.getState().notify('warning', msg);
      }
    } catch {
      // The factory never rejects (builtin always boots), but guard anyway:
      // with no runtime at all, R runs fall back to the direct IR path.
      setREngine('builtin-ir');
    } finally {
      setRLoadPercent(null);
    }
  };

  /** Interrupt + restart: a fresh runtime can never be wedged by the old run. */
  const restartRRuntime = async (): Promise<void> => {
    const runtime = rRuntimeRef.current;
    rRuntimeRef.current = null;
    setREngine(null);
    if (runtime) {
      try {
        await runtime.interrupt();
        await runtime.dispose();
      } catch {
        /* a dying runtime cannot block the restart */
      }
    }
    await bootRRuntime();
    useEditorStore.getState().appendConsole({ stream: 'info', text: t('r.restart.done') });
  };

  useEffect(() => {
    if (language !== 'r') return;
    let cancelled = false;
    void bootRRuntime().then(() => {
      // The session switched away from R while booting — drop the runtime.
      if (cancelled && rRuntimeRef.current) {
        const runtime = rRuntimeRef.current;
        rRuntimeRef.current = null;
        void runtime.dispose();
        setREngine(null);
      }
    });
    return () => {
      cancelled = true;
      const runtime = rRuntimeRef.current;
      rRuntimeRef.current = null;
      if (runtime) void runtime.dispose();
      setREngine(null);
      setRLoadPercent(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

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
      // The IR round-trip is lossy for imports/comments/mid-edit text, so a
      // language switch can yield an empty translation. Never let that wipe a
      // non-empty buffer — keep the user's source when there is nothing real
      // to show, so switching languages cannot clear their code. The one-shot
      // forceBlank flag (set after "discard translation") overrides this so the
      // blanked session genuinely stays blank.
      const current = editor.getValue();
      const value =
        sess.forceBlank || sess.lastCode.trim() !== '' || !current || current.trim() === ''
          ? sess.lastCode
          : current;
      // setValue fires onDidChangeModelContent — suppress the echo so a
      // freshly translated buffer is not re-parsed straight back.
      silentSetRef.current = true;
      editor.setValue(value);
      codeTextRef.current = value;
      monaco.editor.setModelLanguage(editor.getModel()!, MONACO_LANG[language]);
      editor.updateOptions({ tabSize: LANG_TAB_SIZE[language] });
      window.requestAnimationFrame(() => {
        silentSetRef.current = false;
      });
      if (sess.forceBlank) useEditorStore.getState().consumeForceBlank(activeSessionId);
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
      codeTextRef.current = code;
      monaco.editor.setModelLanguage(editor.getModel()!, MONACO_LANG[lang]);
      window.requestAnimationFrame(() => {
        silentSetRef.current = false;
      });
      if (sid) useEditorStore.getState().updateSessionIR(sid, pendingLoad, code);
      const filePath = sid ? useEditorStore.getState().sessions.find((s) => s.id === sid)?.filePath : undefined;
      if (filePath) useAppStore.getState().updateEditorFile(filePath, code);
      loadedKeyRef.current = `${sid}:${lang}`;
    }
    clearHostPreview();
    useEditorStore.getState().consumeLoad();
  }, [pendingLoad]);

  // Show verbatim source handed over by the explorer (opening another file in
  // the already-mounted code surface). Keyed by token so switching to a file
  // with identical text still re-syncs the buffer and model language.
  const pendingCode = useEditorStore((s) => s.pendingCode);
  useEffect(() => {
    if (!pendingCode) return;
    const editor = editorRef.current;
    if (editor) {
      silentSetRef.current = true;
      editor.setValue(pendingCode.code);
      codeTextRef.current = pendingCode.code;
      monaco.editor.setModelLanguage(editor.getModel()!, MONACO_LANG[language]);
      window.requestAnimationFrame(() => {
        silentSetRef.current = false;
      });
      loadedKeyRef.current = `${activeSessionId}:${language}`;
    }
    useEditorStore.getState().consumeCodeLoad();
  }, [pendingCode, activeSessionId, language]);

  /** Ship every resolvable file into the worker as _FILES: the explorer
   *  working tree first, then project data files and bundled examples. */
  const collectFiles = async (): Promise<Record<string, string>> => collectRuntimeFiles();

  /** Run JavaScript text through the IR interpreter (block-mode engine). */
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

  /** Run R through the pluggable runtime (FR-04). Falls back to the direct IR
   *  path only if the runtime failed to come up at all. */
  const runR = async (code: string): Promise<{ ok: boolean; outputs: Record<string, unknown> }> => {
    const runtime = rRuntimeRef.current;
    if (!runtime) return runViaIR(code, 'r');
    const result = await runtime.exec(code, await collectFiles());
    if (result.stdout) {
      // Full-R console output is clearly separated from DSL degrade notices.
      useEditorStore
        .getState()
        .appendConsole({ stream: 'stdout', text: `${t('r.console.full_prefix')} ${result.stdout}` });
    }
    if (result.ok) {
      if (result.variables) useEditorStore.getState().setVariables(result.variables);
      // On the full runtime there is no syntax degradation; the builtin IR
      // engine reports its skipped statements with the R-specific notice.
      if (!runtime.isFullRuntime && (result.skippedCount ?? 0) > 0) {
        useEditorStore
          .getState()
          .appendConsole({ stream: 'stderr', text: t('r.dsl.degraded', { count: result.skippedCount ?? 0 }) });
      }
      return { ok: true, outputs: result.variables ?? {} };
    }
    const msg = result.error ?? 'run failed';
    useEditorStore.getState().setError(msg);
    useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
    return { ok: false, outputs: {} };
  };

  const run = async () => {
    const editor = editorRef.current;
    if (!editor || isRunning) return;
    // Python needs the Pyodide worker; R needs its runtime (full or builtin);
    // JS runs on the in-process interpreter.
    if (language === 'python' && !runtimeRef.current) return;
    if (language === 'r' && !rRuntimeRef.current) return;
    const code = editor.getValue();
    const startedAt = Date.now();
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().clearConsole();
    useEditorStore.getState().setError(null);
    useEditorStore.getState().setVariables({});
    clearHostPreview();
    let ok = false;
    let outputs: Record<string, unknown> = {};
    try {
      if (language === 'python') {
        const result = await runtimeRef.current!.runPython(code, await collectFiles(), {});
        if (result.ok) {
          ok = true;
          outputs = result.outputs;
          useEditorStore.getState().setVariables(result.outputs);
        } else {
          const msg = result.error ?? 'run failed';
          useEditorStore.getState().setError(msg);
          useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
        }
      } else if (language === 'r') {
        const rResult = await runR(code);
        ok = rResult.ok;
        outputs = rResult.outputs;
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

  /** Persist the live code-mode buffer into its bound workspace file. */
  const saveBoundFile = async () => {
    const path = filePathRef.current;
    const editor = editorRef.current;
    if (!path || !editor) return;
    const text = editor.getValue();
    codeTextRef.current = text;
    // Write straight to the workspace tree: the mode owns the buffer now and
    // there may be no matching editor tab.
    await useAppStore.getState().saveWorkspaceFile(path, text);
  };
  saveBoundRef.current = () => void saveBoundFile();

  // Leaving code mode (or the whole workbench) must not strand the text in the
  // IR hub: mirror the final buffer into the file tab so the workspace shows
  // what the user typed. The explicit Save / Ctrl+S path writes it to the VFS.
  useEffect(() => {
    return () => {
      const path = filePathRef.current;
      if (!path || codeTextRef.current === null) return;
      useAppStore.getState().updateEditorFile(path, codeTextRef.current);
    };
  }, []);

  const stop = () => {
    // Python and the full R runtime run in workers; interrupting them means
    // tearing the engine down and respawning it so nothing stays wedged.
    // IR programs are short-lived and finish synchronously.
    if (language === 'python') runtimeRef.current?.interrupt();
    if (language === 'r' && rRuntimeRef.current?.isFullRuntime) {
      useEditorStore.getState().appendConsole({ stream: 'info', text: t('r.interrupted') });
      void restartRRuntime();
    }
    useEditorStore.getState().setRunning(false);
  };

  /**
   * FR-07: run an assistant draft through this editor's own runtime WITHOUT
   * touching the user's buffer. Python drafts go to Pyodide (the assistant
   * only emits Python `studio.*` code); other dialects fall back to the IR
   * interpreter so the panel works everywhere.
   */
  const runAssistantCode = async (code: string): Promise<AiRunResult> => {
    if (isRunning) return { ok: false, error: 'editor busy' };
    if (language === 'python' && !runtimeRef.current) return { ok: false, error: 'runtime not ready' };
    const startedAt = Date.now();
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().clearConsole();
    useEditorStore.getState().setError(null);
    useEditorStore.getState().setVariables({});
    clearHostPreview();
    let ok = false;
    let error: string | undefined;
    let outputs: Record<string, unknown> = {};
    try {
      if (language === 'python') {
        const result = await runtimeRef.current!.runPython(code, await collectFiles(), {});
        ok = result.ok;
        if (result.ok) {
          outputs = result.outputs;
          useEditorStore.getState().setVariables(result.outputs);
        } else {
          error = result.error ?? 'run failed';
        }
      } else {
        const { program } = parseCodeToIR(code, 'python');
        const result = await interpret(program, createWorkbenchStudioApi());
        ok = result.ok;
        if (result.ok) {
          outputs = result.variables;
          useEditorStore.getState().setVariables(result.variables);
        } else {
          error = result.error?.message ?? 'run failed';
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (error) {
      useEditorStore.getState().setError(error);
      useEditorStore.getState().appendConsole({ stream: 'stderr', text: error });
    }
    useEditorStore.getState().setRunning(false);
    void useExperimentStore.getState().recordRun({
      source: 'code',
      label: 'AI assistant run',
      params: { codeChars: code.length, language, ai: true },
      inputsHash: hashString(`${language}:${code}`),
      metrics: numericMetrics(outputs),
      durationMs: Date.now() - startedAt,
      failed: !ok,
    });
    return { ok, error };
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
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runRepl();
  };

  /** Install a CRAN package into the full R runtime (memory/time bounded). */
  const installRPackage = async () => {
    const runtime = rRuntimeRef.current;
    const pkg = rPkgInput.trim();
    if (!runtime || !pkg || rInstalling) return;
    setRPkgInput('');
    setRInstalling(true);
    useEditorStore.getState().appendConsole({ stream: 'info', text: t('r.install.hint', { pkg }) });
    try {
      await runtime.install(pkg);
      useEditorStore.getState().appendConsole({ stream: 'info', text: t('r.install.success', { pkg }) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useEditorStore
        .getState()
        .appendConsole({
          stream: 'stderr',
          text: runtime.isFullRuntime ? t('r.install.failed', { pkg, error: msg }) : t('r.install.unsupported'),
        });
    } finally {
      setRInstalling(false);
    }
  };

  const rBooting = language === 'r' && rLoadPercent !== null;
  const rReady = language !== 'r' || (rEngine !== null && !rBooting);
  const engineReady = (language !== 'python' || runtimeReady) && rReady;

  // FR-07: expose this editor's run pipeline to the global floating AI panel.
  // A stable wrapper (one registration) always delegates to the latest
  // runAssistantCode closure so runtime/language state stays fresh.
  const runAssistantRef = useRef(runAssistantCode);
  runAssistantRef.current = runAssistantCode;
  useEffect(() => {
    return useAiPanelStore.getState().registerRun((code) => runAssistantRef.current(code));
  }, []);

  return (
    <div className="block-editor code-editor">
      <SurfaceToolbar>
        <div className="block-editor-toolbar">
        <button
          type="button"
          className="be-run-btn"
          title={t('editor.run.hint')}
          onClick={isRunning ? stop : () => void run()}
          disabled={!isRunning && !engineReady}
        >
          <span className="be-run-icon">{isRunning ? <StopIcon size={12} /> : <PlayIcon size={12} />}</span>
          <span>{isRunning ? t('editor.stop') : t('editor.run')}</span>
        </button>

        {session?.filePath && (
          <button
            type="button"
            className="btn btn-sm"
            title={session.filePath}
            onClick={() => void saveBoundFile()}
          >
            {t('workbench.editor.save')}
          </button>
        )}

        <span
          className="be-code-lang be-code-lang-toolbar"
          title={
            language === 'python'
              ? t('editor.engine.pyodide')
              : language === 'r'
                ? rEngine === 'webr'
                  ? t('r.engine.tooltip.full')
                  : t('r.engine.tooltip.builtin')
                : t('editor.engine.interpreter', { lang: 'JavaScript' })
          }
        >
          {language === 'python'
            ? 'Pyodide'
            : language === 'r'
              ? rEngine === 'webr'
                ? t('r.engine.badge.full')
                : t('r.engine.badge.builtin')
              : 'IR'}
        </span>

        <div className="be-toolbar-spacer" />

        <div className={`be-status-pill ${isRunning ? 'is-running' : engineReady ? 'is-idle' : 'is-loading'}`}>
          <span className="be-status-dot" />
          <span className="be-status-text">
            {isRunning
              ? t('editor.status.running')
              : engineReady
                ? t('editor.status.ready')
                : rBooting
                  ? t('r.loading.full', { percent: rLoadPercent ?? 0 })
                  : t('editor.loading_runtime')}
          </span>
        </div>
        </div>
      </SurfaceToolbar>

      <div className="block-editor-main">
        <div className="block-editor-top">
          <div ref={containerRef} className="code-editor-monaco" />
        </div>

        {/* Bottom dock: console under the editor; result preview and variables
            now render in the workbench right sidebar. */}
        <div
          className="be-splitter is-horizontal"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('editor.dock.resize')}
          aria-valuenow={dockHeight}
          aria-valuemin={96}
          aria-valuemax={460}
          tabIndex={0}
          {...dockHandleProps}
        />

        <div className="block-editor-bottom" style={{ height: dockHeight }}>
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
                  <CornerDownLeftIcon size={12} />
                </button>
              </div>
            )}
            {/* CRAN package install — full R runtime only (builtin IR throws). */}
            {language === 'r' && rEngine === 'webr' && (
              <div className="code-editor-repl code-editor-r-install">
                <span className="code-editor-repl-prompt">
                  <ToolIcon kind="supplement" size={12} />
                </span>
                <input
                  type="text"
                  value={rPkgInput}
                  onChange={(e) => setRPkgInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void installRPackage();
                  }}
                  placeholder={t('r.install.placeholder')}
                  spellCheck={false}
                  disabled={rInstalling}
                />
                <button
                  type="button"
                  className="code-editor-repl-go"
                  onClick={() => void installRPackage()}
                  disabled={rInstalling || rPkgInput.trim().length === 0}
                  title={t('r.install.button')}
                >
                  {rInstalling ? <LoaderIcon size={12} className="is-spinning" /> : <DownloadIcon size={12} />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
