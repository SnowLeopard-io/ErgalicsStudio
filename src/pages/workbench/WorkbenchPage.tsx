import { Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { ActivityBar } from './ActivityBar';
import { CentralArea } from './CentralArea';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAppStore } from '@/stores/appStore';
import { perfMonitor } from '@/core/perf';
import { logger } from '@/core/logger';
import { useT } from '@/i18n';
import { useProjectStore, getLastOpenedProjectId } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useEditorStore } from '@/stores/editorStore';
import { subscribePythonOutput, warmPythonRuntime } from '@/core/pyodide/code-runtime';
import { loadWasm } from '@/core/wasm';
import { initBlockSystem } from '@/blocks';
import { useFlowSync } from '@/stores/useFlowSync';
import { ModeConvertDialog } from './dialogs/ModeConvertDialog';
import { PythonRuntimeNotice } from '@/components/PythonRuntimeNotice';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { AiAssistantOverlay } from '@/components/AiAssistantOverlay';
import { useTourStore, tourSeen } from '@/stores/tourStore';

/** Process-wide guard: the project restore must run once per page load even
 *  under React StrictMode (which mounts/unmounts/remounts in dev). */
let restoreStarted = false;

export default function WorkbenchPage() {
  const t = useT();
  const location = useLocation();

  // Welcome-page mode cards arrive with { state: { setMode } } — apply once
  // and consume the state so a refresh keeps whatever mode the user chose.
  useEffect(() => {
    const state = location.state as { setMode?: 'standard' | 'flow' | 'block' | 'code' } | null;
    if (state?.setMode) {
      useAppStore.getState().setMode(state.setMode);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Keep the Flow DAG in three-way sync with Block/Code via the IR hub.
  useFlowSync();

  // First visit to the workbench: auto-start the guided tour once the layout
  // has settled. The entry chooser offers two parts — "meet the interface"
  // and "run the research workflow" — so neither is forced. Skipped/completed
  // tours are remembered in localStorage, and the top-bar "?" button reopens
  // the chooser on demand.
  useEffect(() => {
    if (tourSeen()) return;
    const timer = window.setTimeout(() => {
      // The welcome page's debut CTA may already have armed the tour while
      // this page mounts; never clobber that running flow.
      if (useTourStore.getState().active) return;
      useTourStore.getState().start('menu');
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    perfMonitor.start();
    // Pre-load WASM in the background while the user works.
    void loadWasm();
    // Register built-in blocks and make example plugins available.
    initBlockSystem();
    void usePluginStore.getState().ensureBuiltinsLoaded();
    // Restore the most recent project if there is one. Never auto-create a
    // fresh project on cold start: whether to have a project (and which one)
    // is the user's decision — the empty canvas state offers the choices.
    if (!restoreStarted) {
      restoreStarted = true;
      void (async () => {
        try {
          await useProjectStore.getState().loadRecent();
          const { project, recent } = useProjectStore.getState();
          if (project) return;
          // Prefer the project that was actually open at last shutdown (see
          // getLastOpenedProjectId — updatedAt ordering is not "last opened").
          const lastId = getLastOpenedProjectId();
          const target =
            (lastId && recent.find((p) => p.id === lastId)) || recent[0] || null;
          if (target) await useProjectStore.getState().openProject(target.id);
        } catch (err) {
          // A project left in an old or corrupt shape used to fail silently
          // here: no project, no fallback, no message — just an unhandled
          // rejection and an apparently empty workbench on cold start.
          logger.error('project', 'startup restore failed', err);
          useAppStore.getState().notify('error', t('project.open_failed'));
        }
      })();
    }
    return () => perfMonitor.stop();
    // `t` is a stable module-level function and the restore runs once per
    // page load (restoreStarted guard), so re-running here cannot happen.
  }, [t]);

  // One-time Python runtime warm-up once the workspace is idle. The
  // interpreter is session-wide (core/pyodide/code-runtime), so this is the
  // only load the user pays for in this session; later code/notebook/solver
  // runs reuse the booted interpreter (or the now-cached /pyodide/ assets).
  useEffect(() => {
    // Delayed on purpose: the first seconds belong to the workspace chunks
    // and the plugin registry, not to a 30 MB interpreter download.
    const timer = window.setTimeout(() => void warmPythonRuntime({ silent: true }), 6000);
    return () => window.clearTimeout(timer);
  }, []);

  // Global stdout/stderr → console bridge. Subscribed once at the workbench
  // level so interpreter output reaches the console (and the terminal drawer)
  // no matter which surface is in front — it used to live inside CodeEditor,
  // which silently dropped all output while a code tab was not mounted.
  useEffect(() => {
    const unsubscribe = subscribePythonOutput({
      stdout: (text) => useEditorStore.getState().appendConsole({ stream: 'stdout', text }),
      stderr: (text) => useEditorStore.getState().appendConsole({ stream: 'stderr', text }),
    });
    return unsubscribe;
  }, []);

  return (
    <div className="workbench">
      {/* TopBar and StatusBar get their own boundaries: previously a crash in
          either propagated to the App-level boundary and replaced the *whole*
          application with the fallback. */}
      <ErrorBoundary>
        <TopBar />
      </ErrorBoundary>
      <div className="workbench-body">
        <ErrorBoundary>
          <Suspense fallback={<div className="workbench-loading"><span className="spinner" /></div>}>
            {/* One unified IDE shell in every mode: the four modes are canvas
                tabs (flow/block/code) or the plugin canvas (standard), so the
                explorer and side panels never disappear on a mode switch. */}
            {/* 活动栏常驻（即使侧栏收起也可见，供重新打开视图）。 */}
            <ActivityBar />
            {/* Sidebar 自己处理收起态（渲染为贴边小按钮），始终挂载。 */}
            <Sidebar />
            <CentralArea />
            <RightPanel />
          </Suspense>
        </ErrorBoundary>
      </div>
      {/* Terminal drawer sits above the status bar (VS Code style); mounted
          once so it exists in every surface — see components/terminal. */}
      <TerminalPanel />
      <ErrorBoundary>
        <StatusBar />
      </ErrorBoundary>
      <PythonRuntimeNotice />
      <AiAssistantOverlay />
      <ModeConvertDialog />
    </div>
  );
}