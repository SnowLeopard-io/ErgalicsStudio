// ==========================================================================
// Ergalics Studio — block editor (Blockly, block mode)
//
// The Scratch-like editor: a Blockly workspace plus a run/view-code toolbar,
// a variable panel, a console, and a result preview area that renders
// `studio.plot(...)` outputs through the existing plugin bridge.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import type * as BlocklyNS from 'blockly/core';
import { useLocale, useT } from '@/i18n';
import { getResolvedTheme } from '@/theme';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { setHostContainers, rerenderActivePlugin } from '@/stores/pluginStore';
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
import { VariablePanel } from './VariablePanel';
import { ConsolePanel } from './ConsolePanel';
import { AiAssistantPanel, type AiRunResult } from '@/components/AiAssistantPanel';
import { parseCodeToIR } from '@/editor/code/parse';

/** Clear the 2D preview canvas + DOM overlay so a previous run's plot never
 *  lingers when loading a new sample or starting a fresh run. */
function clearPreviewSurface(canvas: HTMLCanvasElement | null, dom: HTMLDivElement | null): void {
  if (canvas) {
    const g = canvas.getContext('2d');
    if (g) g.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (dom) dom.innerHTML = '';
}

export function BlockEditor() {
  const t = useT();
  const { locale } = useLocale();
  const dark = getResolvedTheme() === 'dark';

  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  const isRunning = useEditorStore((s) => s.isRunning);
  const pendingLoad = useEditorStore((s) => s.pendingLoad);
  const error = useEditorStore((s) => s.error);
  // Right pane (preview / variables / console) toggled by the top-bar ☰.
  const panelOpen = useAppStore((s) => s.modePanelOpen);

  const wsRef = useRef<BlocklyNS.WorkspaceSvg | null>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastLoadedId = useRef<string | null>(null);
  const codeViewRef = useRef<'js' | 'python' | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const [codeView, setCodeView] = useState<'js' | 'python' | null>(null);
  const [code, setCode] = useState('');
  // FR-07: AI assistant side panel (toggled from the toolbar).
  const [aiOpen, setAiOpen] = useState(false);

  // Keep a ref in sync so the workspace change listener (registered once) can
  // read the current code-view state without re-subscribing.
  codeViewRef.current = codeView;

  // Register blocks + create the workspace (recreated on locale or theme change
  // so blocks re-label and re-colour into the new language / dark mode).
  useEffect(() => {
    initBlocklyEngine(locale, dark);
    if (divRef.current) {
      const ws = createWorkspace(divRef.current);
      wsRef.current = ws;
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
      if (wsRef.current) {
        disposeWorkspace(wsRef.current);
        wsRef.current = null;
      }
      window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Register render containers for the preview area (2D plugins).
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
    // If a plugin is still active (e.g. the editor just remounted after a
    // mode toggle), redraw it into the fresh preview containers — otherwise
    // its cached container points at a detached canvas and plotting breaks.
    rerenderActivePlugin();
    return () => setHostContainers(null);
  }, []);

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
    clearPreviewSurface(canvasRef.current, domRef.current);
    useEditorStore.getState().consumeLoad();
  }, [pendingLoad]);

  const run = async () => {
    const ws = wsRef.current;
    if (!ws || isRunning) return;
    const ir = workspaceToIR(ws);
    const startedAt = Date.now();
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().clearConsole();
    useEditorStore.getState().setError(null);
    useEditorStore.getState().setVariables({});
    // Clear the previous run's plot so the preview is blank until the new
    // run produces output.
    clearPreviewSurface(canvasRef.current, domRef.current);
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

  return (
    <div className="block-editor">
      <div className="block-editor-toolbar">
        <button type="button" className="be-run-btn" onClick={() => void run()} disabled={isRunning}>
          <span className="be-run-icon">{isRunning ? '■' : '▶'}</span>
          <span>{isRunning ? t('editor.stop') : t('editor.run')}</span>
        </button>

        <div className="block-editor-toggle">
          <button type="button" className={`btn btn-sm${codeView === 'python' ? ' btn-toggle-on' : ''}`} onClick={() => toggleCode('python')}>
            Python
          </button>
          <button type="button" className={`btn btn-sm${codeView === 'js' ? ' btn-toggle-on' : ''}`} onClick={() => toggleCode('js')}>
            JS
          </button>
        </div>

        <div className="be-toolbar-spacer" />

        <button
          type="button"
          className={`btn btn-sm${aiOpen ? ' btn-toggle-on' : ''}`}
          title={t('ai.title')}
          onClick={() => setAiOpen((v) => !v)}
        >
          {t('ai.toggle')}
        </button>

        <div className={`be-status-pill ${isRunning ? 'is-running' : (error ? 'is-error' : 'is-idle')}`}>
          <span className="be-status-dot" />
          <span className="be-status-text">
            {isRunning ? t('editor.status.running') : error ? t('editor.status.error') : t('editor.status.idle')}
          </span>
        </div>
      </div>

      <div className="block-editor-main">
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

        {/* Kept mounted (only hidden) so plugin host container refs survive
            panel toggles mid-session. */}
        <div className={`block-editor-right${panelOpen ? '' : ' is-panel-hidden'}`}>
          <div className="block-editor-preview">
            <div className="block-editor-preview-label">{t('editor.preview.title')}</div>
            <div ref={domRef} className="block-editor-preview-dom" />
            <canvas ref={canvasRef} className="block-editor-preview-canvas" />
          </div>
          <VariablePanel />
          <ConsolePanel />
        </div>

        {aiOpen && <AiAssistantPanel runCode={runAssistantCode} />}
      </div>
    </div>
  );
}
