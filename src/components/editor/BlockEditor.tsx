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
import { usePluginStore, setHostContainers, rerenderActivePlugin } from '@/stores/pluginStore';
import { renderView } from '@/blocks/render';
import type { ViewRenderHost } from '@/blocks/render';
import { createStudioApi } from '@/editor/runtime/studio-api';
import type { StudioApiHost } from '@/editor/runtime/studio-api';
import { interpret } from '@/editor/runtime/interpreter';
import { resolveExampleFile, listExampleFiles } from '@/editor/runtime/data-resolver';
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

export function BlockEditor() {
  const t = useT();
  const { locale } = useLocale();
  const dark = getResolvedTheme() === 'dark';

  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  const isRunning = useEditorStore((s) => s.isRunning);
  const pendingLoad = useEditorStore((s) => s.pendingLoad);
  const error = useEditorStore((s) => s.error);

  const wsRef = useRef<BlocklyNS.WorkspaceSvg | null>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    if (divRef.current) {
      const ws = createWorkspace(divRef.current);
      wsRef.current = ws;
      ws.addChangeListener(() => {
        // Push IR to the store on every change.
        const ir = workspaceToIR(ws);
        const sid = useEditorStore.getState().activeSessionId;
        if (sid) useEditorStore.getState().updateSessionIR(sid, ir);
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
    useEditorStore.getState().consumeLoad();
  }, [pendingLoad]);

  const buildStudioHost = (): StudioApiHost => {
    const viewHost: ViewRenderHost = {
      activate: async (pluginId) => {
        const store = usePluginStore.getState();
        if (store.activeId !== pluginId) {
          await store.activate(pluginId);
        } else {
          // Plugin is already active, but its cached container may still
          // point at a detached canvas after the editor remounted — rebind
          // to the current preview containers before loading data.
          rerenderActivePlugin();
        }
        return store.getActive();
      },
    };
    return {
      loadText: async (path) => {
        const text = resolveExampleFile(path);
        if (text === undefined) {
          throw new Error(`file "${path}" not found (available: ${listExampleFiles().join(', ')})`);
        }
        return text;
      },
      renderView: (view) => renderView(view, viewHost),
      notify: (kind, message) => useAppStore.getState().notify(kind, message),
      print: (text) => useEditorStore.getState().appendConsole({ stream: 'stdout', text }),
    };
  };

  const run = async () => {
    const ws = wsRef.current;
    if (!ws || isRunning) return;
    const ir = workspaceToIR(ws);
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().clearConsole();
    useEditorStore.getState().setError(null);
    useEditorStore.getState().setVariables({});
    try {
      const result = await interpret(ir, createStudioApi(buildStudioHost()));
      if (result.ok) {
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
    }
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

        <div className={`be-status-pill ${isRunning ? 'is-running' : (useEditorStore.getState().error ? 'is-error' : 'is-idle')}`}>
          <span className="be-status-dot" />
          <span className="be-status-text">
            {isRunning ? t('editor.status.running') : useEditorStore.getState().error ? t('editor.status.error') : t('editor.status.idle')}
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

        <div className="block-editor-right">
          <div className="block-editor-preview">
            <div className="block-editor-preview-label">{t('editor.preview.title')}</div>
            <div ref={domRef} className="block-editor-preview-dom" />
            <canvas ref={canvasRef} className="block-editor-preview-canvas" />
          </div>
          <VariablePanel />
          <ConsolePanel />
        </div>
      </div>
    </div>
  );
}
