import { useEffect } from 'react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { CentralArea } from './CentralArea';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';
import { PerfPanel } from './PerfPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAppStore } from '@/stores/appStore';
import { perfMonitor } from '@/core/perf';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { loadWasm } from '@/core/wasm';
import { BlockWorkbench } from '@/components/blocks/BlockWorkbench';
import { initBlockSystem } from '@/blocks';

/** Process-wide guard: the project restore must run once per page load even
 *  under React StrictMode (which mounts/unmounts/remounts in dev). */
let restoreStarted = false;

export default function WorkbenchPage() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const blockMode = useAppStore((s) => s.blockMode);

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
        await useProjectStore.getState().loadRecent();
        const { project, recent } = useProjectStore.getState();
        if (!project) {
          if (recent[0]) {
            await useProjectStore.getState().openProject(recent[0].id);
          } else {
            await useProjectStore.getState().createProject('');
          }
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
          {blockMode ? (
            <BlockWorkbench />
          ) : (
            <>
              {sidebarOpen && <Sidebar />}
              <CentralArea />
              <RightPanel />
            </>
          )}
        </ErrorBoundary>
      </div>
      <StatusBar />
      <PerfPanel />
    </div>
  );
}