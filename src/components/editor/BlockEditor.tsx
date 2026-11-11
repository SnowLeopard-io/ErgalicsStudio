// ==========================================================================
// Ergalics Studio — block editor (Blockly, block mode)
//
// The Scratch-like editor: a Blockly workspace plus a run/view-code toolbar,
// a variable panel, a console, and a result preview area that renders
// `studio.plot(...)` outputs through the existing plugin bridge.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import type * as BlocklyNS from 'blockly/core';
import { useLocale, useT } from '@/i18n';
import { useTheme } from '@/theme';
import { DownloadIcon, LoaderIcon, PlayIcon } from '@/components/icons';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { clearHostPreview } from '@/stores/pluginStore';
import { interpret } from '@/editor/runtime/interpreter';
import { createWorkbenchStudioApi } from '@/editor/runtime/workbench-host';
import { hashString } from '@/core/repro/random';
import { useExperimentStore, numericMetrics } from '@/stores/experimentStore';
import { codegenJS, codegenPython } from '@/editor/codegen';
import {
  initBlocklyEngine,
  createWorkspace,
  workspaceToIR,
  loadIRIntoWorkspace,
  disposeWorkspace,
} from '@/editor/block';
import { SurfaceToolbar } from './SurfaceToolbar';
import { useAiPanelStore, type AiRunResult } from '@/stores/aiPanelStore';
import { parseCodeToIR } from '@/editor/code/parse';

export function BlockEditor() {
  const t = useT();
  const { locale } = useLocale();
  // Subscribe so switching light/dark re-creates the workspace with the new
  // Blockly theme (a one-shot getResolvedTheme() read would stay stale).
  const { resolved: themeResolved } = useTheme();
  const dark = themeResolved === 'dark';

  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  // A file opened from the explorer binds the mode to that path; saving writes
  // the workspace back without an intermediate file tab.
  const boundPath = useEditorStore(
    (s) => s.sessions.find((session) => session.id === s.activeSessionId)?.filePath ?? null,
  );
  const isRunning = useEditorStore((s) => s.isRunning);
  const pendingLoad = useEditorStore((s) => s.pendingLoad);
  const error = useEditorStore((s) => s.error);

  const wsRef = useRef<BlocklyNS.WorkspaceSvg | null>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const lastLoadedId = useRef<string | null>(null);
  const codeViewRef = useRef<'js' | 'python' | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const [codeView, setCodeView] = useState<'js' | 'python' | null>(null);
  const [code, setCode] = useState('');

  // Keep a ref in sync so the workspace change listener (registered once) can
  // read the current code-view state without re-subscribing.
  codeViewRef.current = codeView;

  // Register blocks + create the workspace (recreated on locale or theme change
  // so blocks re-label and re-colour into the new language / dark mode).
  useEffect(() => {
    initBlocklyEngine(locale, dark);
    let ro: ResizeObserver | null = null;
    if (divRef.current) {
      const host = divRef.current;
      const ws = createWorkspace(host);
      wsRef.current = ws;
      // Blockly only re-measures its SVG on window resize; the splitter and
      // console dock change the host element without a window resize, so
      // observe the host directly or the canvas keeps its old size.
      ro = new ResizeObserver(() => Blockly.svgResize(ws));
      ro.observe(host);
      ws.addChangeListener(() => {
        // Push the edited blocks into the IR hub; this regenerates both the
        // Flow DAG and the Code text so the three modes stay in lockstep.
        const ir = workspaceToIR(ws);
        const sid = useEditorStore.getState().activeSessionId;
        if (sid) useEditorStore.getState().syncFromBlock(sid, ir);
        // Debounce the "view code" overlay so typing does not re-render the
        // whole editor on every block mutation; only refresh when open.
        if (!codeViewRef.current) return;
        window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
          setCode(codeViewRef.current === 'js' ? codegenJS(ir) : codegenPython(ir));
        }, 120);
      });
      // Re-hydrate the fresh workspace from the active session (needed when the
      // workspace is recreated on a locale/theme switch).
      const sid = useEditorStore.getState().activeSessionId;
      const session = useEditorStore.getState().sessions.find((s) => s.id === sid);
      if (session) {
        loadIRIntoWorkspace(ws, session.ir);
        setCode(codegenPython(session.ir));
      }
      lastLoadedId.current = sid ?? null;
    }
    return () => {
      ro?.disconnect();
      if (wsRef.current) {
        disposeWorkspace(wsRef.current);
        wsRef.current = null;
      }
      window.clearTimeout(debounceRef.current);
    };
     
  }, [locale, dark]);

  // Ensure an active session exists, and (re)load its IR into the workspace
  // when it changes (e.g. after opening another project).
  useEffect(() => {
    if (!activeSessionId) {
      useEditorStore.getState().createSession('block', 'python');
      return;
    }
    if (lastLoadedId.current === activeSessionId) return;
    const session = useEditorStore.getState().sessions.find((s) => s.id === activeSessionId);
    const ws = wsRef.current;
    if (ws && session) {
      loadIRIntoWorkspace(ws, session.ir);
      setCode(codegenPython(session.ir));
    }
    lastLoadedId.current = activeSessionId;
  }, [activeSessionId]);

  // Consume a program requested by an external caller (e.g. the samples
  // dialog in the top bar). The session IR is already updated by the caller,
  // so this only refreshes the already-mounted workspace.
  useEffect(() => {
    if (!pendingLoad) return;
    const ws = wsRef.current;
    if (ws) {
      loadIRIntoWorkspace(ws, pendingLoad);
      setCodeView(null);
    }
    // A freshly-loaded sample must not show the previous sample's plot or
    // variables — the store already cleared the latter via resetRunOutputs().
    clearHostPreview();
    useEditorStore.getState().consumeLoad();
  }, [pendingLoad]);

  const run = async () => {
    const ws = wsRef.current;
    if (!ws || isRunning) return;
    const ir = workspaceToIR(ws);
    const startedAt = Date.now();
    // Output lands in the global terminal drawer; bring it up so the user
    // actually sees the run happen.
    if (!useAppStore.getState().terminalOpen) useAppStore.getState().toggleTerminal();
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().clearConsole();
    useEditorStore.getState().setError(null);
    useEditorStore.getState().setVariables({});
    // Clear the previous run's plot so the preview is blank until the new
    // run produces output.
    clearHostPreview();
    let ok = false;
    let outputs: Record<string, unknown> = {};
    try {
      const result = await interpret(ir, createWorkbenchStudioApi());
      if (result.ok) {
        ok = true;
        outputs = result.variables;
        useEditorStore.getState().setVariables(result.variables);
      } else {
        const msg = result.error?.message ?? 'run failed';
        useEditorStore.getState().setError(msg);
        useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useEditorStore.getState().setError(msg);
      useEditorStore.getState().appendConsole({ stream: 'stderr', text: msg });
    } finally {
      useEditorStore.getState().setRunning(false);
      void useExperimentStore.getState().recordRun({
        source: 'block',
        params: { nodes: ir.body.length },
        inputsHash: hashString(JSON.stringify(ir)),
        metrics: numericMetrics(outputs),
        durationMs: Date.now() - startedAt,
        failed: !ok,
      });
    }
  };

  /**
   * FR-07: assistant drafts are Python `studio.*` programs whose math lines
   * (comprehensions, sum()) the IR interpreter cannot execute — running them
   * here would silently skip those statements. So in block mode the run
   * action loads the draft into the workspace (the same path "插入缓冲区"
   * uses, which also syncs the flow canvas) and reports `insertedOnly`: the
   * user runs it from code mode (Pyodide) or continues editing the blocks.
   */
  const runAssistantCode = async (code: string): Promise<AiRunResult> => {
    const { program } = parseCodeToIR(code, 'python');
    useEditorStore.getState().requestLoad(program);
    return { ok: true, insertedOnly: true };
  };

  // FR-07: expose this block canvas to the global floating AI panel. A stable
  // wrapper (one registration) always delegates to the latest closure.
  const runAssistantRef = useRef(runAssistantCode);
  runAssistantRef.current = runAssistantCode;
  useEffect(() => {
    return useAiPanelStore.getState().registerRun((code) => runAssistantRef.current(code));
  }, []);

  const refreshCode = () => {
    const ws = wsRef.current;
    if (!ws) return;
    const ir = workspaceToIR(ws);
    setCode(codeView === 'js' ? codegenJS(ir) : codegenPython(ir));
  };

  const toggleCode = (lang: 'js' | 'python') => {
    const ws = wsRef.current;
    const ir = ws ? workspaceToIR(ws) : undefined;
    if (codeView === lang) {
      setCodeView(null);
      return;
    }
    setCodeView(lang);
    setCode(ir ? (lang === 'js' ? codegenJS(ir) : codegenPython(ir)) : '');
  };

  /** Persist the Blockly workspace into its bound `.block.json` file. */
  const saveBoundFile = async () => {
    const ws = wsRef.current;
    const sid = useEditorStore.getState().activeSessionId;
    const path = useEditorStore.getState().sessions.find((s) => s.id === sid)?.filePath;
    if (!ws || !path) return;
    const payload = JSON.stringify({ version: 1, kind: 'ergalics-block', ir: workspaceToIR(ws) }, null, 2);
    await useAppStore.getState().saveWorkspaceFile(path, payload);
  };

  return (
    <div className="block-editor">
      <SurfaceToolbar>
        <div className="block-editor-toolbar">
        <button type="button" className="be-run-btn" onClick={() => void run()} disabled={isRunning}>
          <span className="be-run-icon">
            {isRunning ? <LoaderIcon size={12} className="is-spinning" /> : <PlayIcon size={12} />}
          </span>
          <span>{isRunning ? t('editor.status.running') : t('editor.run')}</span>
        </button>

        <div className="block-editor-toggle">
          <button type="button" className={`btn btn-sm${codeView === 'python' ? ' btn-toggle-on' : ''}`} onClick={() => toggleCode('python')}>
            Python
          </button>
          <button type="button" className={`btn btn-sm${codeView === 'js' ? ' btn-toggle-on' : ''}`} onClick={() => toggleCode('js')}>
            JS
          </button>
        </div>

        {boundPath && (
          <button type="button" className="btn btn-sm" onClick={() => void saveBoundFile()}>
            <DownloadIcon size={12} />
            <span>{t('workbench.editor.save')}</span>
          </button>
        )}

        <div className="be-toolbar-spacer" />

        <div className={`be-status-pill ${isRunning ? 'is-running' : (error ? 'is-error' : 'is-idle')}`}>
          <span className="be-status-dot" />
          <span className="be-status-text">
            {isRunning ? t('editor.status.running') : error ? t('editor.status.error') : t('editor.status.idle')}
          </span>
        </div>
        </div>
      </SurfaceToolbar>

      <div className="block-editor-main">
        <div className="block-editor-top">
          <div className="block-editor-workspace" ref={divRef} />

          {codeView && (
            <div className="block-editor-code">
              <div className="block-editor-code-head">
                <span className="be-code-lang">{codeView === 'js' ? 'JavaScript' : 'Python'}</span>
                <button type="button" className="be-code-refresh" onClick={refreshCode}>{t('common.refresh')}</button>
              </div>
              <pre>{code}</pre>
            </div>
          )}
        </div>

        {/* The console output lives in the global terminal drawer now (it used
            to duplicate the same store view inline); running auto-opens it. */}
      </div>
    </div>
  );
}
