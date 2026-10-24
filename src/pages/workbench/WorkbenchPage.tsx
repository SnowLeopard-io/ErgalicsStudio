import { lazy, Suspense, useEffect } from 'react';
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
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { loadWasm } from '@/core/wasm';
import { BlockWorkbench } from '@/components/blocks/BlockWorkbench';
import { initBlockSystem } from '@/blocks';
import { useFlowSync } from '@/stores/useFlowSync';
import { ModeConvertDialog } from './dialogs/ModeConvertDialog';
import { TourGuide } from '@/components/TourGuide';
import { AiAssistantOverlay } from '@/components/AiAssistantOverlay';
import { useTourStore, tourSeen } from '@/stores/tourStore';

// Blockly (and, later, Monaco/Pyodide) are large and loaded on demand so the
// Standard/Flow first paint is unaffected (editor architecture §1.1).
const BlockEditor = lazy(() =>
  import('@/components/editor/BlockEditor').then((m) => ({ default: m.BlockEditor })),
);
const CodeEditor = lazy(() =>
  import('@/components/editor/CodeEditor').then((m) => ({ default: m.CodeEditor })),
);

/** Process-wide guard: the project restore must run once per page load even
 *  under React StrictMode (which mounts/unmounts/remounts in dev). */
let restoreStarted = false;

export default function WorkbenchPage() {
  const mode = useAppStore((s) => s.mode);
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
  // has settled. Skipped/completed tours are remembered in localStorage and
  // never auto-offered again (the top-bar "?" button re-runs it on demand).
  useEffect(() => {
    if (tourSeen()) return;
    const timer = window.setTimeout(() => useTourStore.getState().start(), 900);
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
          if (!project && recent[0]) {
            await useProjectStore.getState().openProject(recent[0].id);
          }
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
            {mode === 'flow' ? (
              <BlockWorkbench />
            ) : mode === 'block' ? (
              <BlockEditor />
            ) : mode === 'code' ? (
              <CodeEditor />
            ) : (
              <>
                {/* 活动栏常驻（即使侧栏收起也可见，供重新打开视图）。 */}
                <ActivityBar />
                {/* Sidebar 自己处理收起态（渲染为贴边小按钮），始终挂载。 */}
                <Sidebar />
                <CentralArea />
                <RightPanel />
              </>
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
      <ErrorBoundary>
        <StatusBar />
      </ErrorBoundary>
      <TourGuide />
      <AiAssistantOverlay />
      <ModeConvertDialog />
    </div>
  );
}