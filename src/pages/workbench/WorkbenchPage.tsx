import { lazy, Suspense, useEffect } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
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
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const mode = useAppStore((s) => s.mode);
  const t = useT();

  // Keep the Flow DAG in three-way sync with Block/Code via the IR hub.
  useFlowSync();

  useEffect(() => {
    perfMonitor.start();
    // Pre-load WASM in the background while the user works.
    void loadWasm();
    // Register built-in blocks and make example plugins available.
    initBlockSystem();
    void usePluginStore.getState().ensureBuiltinsLoaded();
    // Restore the most recent project; create a fresh one if none exists
    // (spec §4.2 "恢复"). Guarded so React StrictMode's double-mount cannot
    // create the empty project twice (two rows in IndexedDB).
    if (!restoreStarted) {
      restoreStarted = true;
      void (async () => {
        try {
          await useProjectStore.getState().loadRecent();
          const { project, recent } = useProjectStore.getState();
          if (!project) {
            if (recent[0]) {
              await useProjectStore.getState().openProject(recent[0].id);
            } else {
              await useProjectStore.getState().createProject('');
            }
          }
        } catch (err) {
          // A project left in an old or corrupt shape used to fail silently
          // here: no project, no fallback, no message — just an unhandled
          // rejection and an apparently empty workbench on cold start.
          logger.error('project', 'startup restore failed', err);
          const store = useProjectStore.getState();
          if (!store.project) {
            await store.createProject('').catch(() => undefined);
          }
          useAppStore.getState().notify('error', t('project.open_failed'));
        }
      })();
    }
    return () => perfMonitor.stop();
  }, []);

  return (
    <div className="workbench">
      <TopBar />
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
                {sidebarOpen && <Sidebar />}
                <CentralArea />
                <RightPanel />
              </>
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
      <StatusBar />
    </div>
  );
}