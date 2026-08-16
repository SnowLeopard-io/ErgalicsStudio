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
import { usePluginStore, setHostContainers } from '@/stores/pluginStore';
import { renderView } from '@/blocks/render';
import type { ViewRenderHost } from '@/blocks/render';
import { createStudioApi } from '@/editor/runtime/studio-api';
import type { StudioApiHost } from '@/editor/runtime/studio-api';
import { interpret } from '@/editor/runtime/interpreter';
import { resolveExampleFile, listExampleFiles } from '@/editor/runtime/data-resolver';
import { codegenJS, codegenPython } from '@/editor/codegen';
import { BLOCK_SAMPLES, sampleProgram, sampleName } from '@/editor/block/samples';
import {
  initBlocklyEngine,
  createWorkspace,
  workspaceToIR,
  loadIRIntoWorkspace,
  disposeWorkspace,
} from '@/editor/block';
import { Dropdown } from '@/components/Dropdown';
import { VariablePanel } from './VariablePanel';
import { ConsolePanel } from './ConsolePanel';

export function BlockEditor() {
  const t = useT();
  const { locale } = useLocale();
  const dark = getResolvedTheme() === 'dark';

  const activeSessionId = useEditorStore((s) => s.activeSessionId);
  const isRunning = useEditorStore((s) => s.isRunning);

  const wsRef = useRef<BlocklyNS.WorkspaceSvg | null>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastLoadedId = useRef<string | null>(null);

  const [codeView, setCodeView] = useState<'js' | 'python' | null>(null);
  const [code, setCode] = useState('');

  // Register blocks + create the workspace (idempotent under StrictMode).
  useEffect(() => {
    initBlocklyEngine(locale, dark);
    if (divRef.current) {
      const ws = createWorkspace(divRef.current);
      wsRef.current = ws;
      ws.addChangeListener(() => {
        const ir = workspaceToIR(ws);
        const sid = useEditorStore.getState().activeSessionId;
        if (sid) useEditorStore.getState().updateSessionIR(sid, ir);
        // Keep the "view code" overlay in sync while editing.
        setCode(codegenPython(ir));
      });
      lastLoadedId.current = null;
    }
    return () => {
      if (wsRef.current) {
        disposeWorkspace(wsRef.current);
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return () => setHostContainers(null);
  }, []);

  const buildStudioHost = (): StudioApiHost => {
    const viewHost: ViewRenderHost = {
      activate: async (pluginId) => {
        const store = usePluginStore.getState();
        if (store.activeId !== pluginId) await store.activate(pluginId);
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

  const loadSample = (id: string) => {
    const sample = BLOCK_SAMPLES.find((s) => s.id === id);
    const ws = wsRef.current;
    if (!sample || !ws) return;
    const program = sampleProgram(sample);
    loadIRIntoWorkspace(ws, program);
    const sid = useEditorStore.getState().activeSessionId;
    if (sid) useEditorStore.getState().updateSessionIR(sid, program);
    setCodeView(null);
    useAppStore.getState().notify('success', `${t('workbench.example.pipeline_loaded', { name: sampleName(sample, locale) })}`);
  };

  return (
    <div className="block-editor">
      <div className="block-editor-toolbar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void run()} disabled={isRunning}>
          {isRunning ? t('editor.stop') : t('editor.run')}
        </button>
        <Dropdown
          ariaLabel={t('workbench.example.title')}
          triggerClassName="btn btn-sm"
          trigger={<span>{t('workbench.example.title')} ▾</span>}
          items={BLOCK_SAMPLES.map((s) => ({
            key: s.id,
            label: sampleName(s, locale),
            onClick: () => loadSample(s.id),
          }))}
        />
        <button type="button" className={`btn btn-sm${codeView === 'python' ? ' btn-toggle-on' : ''}`} onClick={() => toggleCode('python')}>
          Python
        </button>
        <button type="button" className={`btn btn-sm${codeView === 'js' ? ' btn-toggle-on' : ''}`} onClick={() => toggleCode('js')}>
          JS
        </button>
      </div>

      <div className="block-editor-main">
        <div className="block-editor-workspace" ref={divRef} />

        {codeView && (
          <div className="block-editor-code">
            <pre>{code}</pre>
            <button type="button" className="btn btn-sm" onClick={refreshCode}>
              {t('common.refresh')}
            </button>
          </div>
        )}

        <div className="block-editor-right">
          <div className="block-editor-preview">
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
