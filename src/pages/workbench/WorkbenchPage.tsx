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
import { loadWasm } from '@/core/wasm';

export default function WorkbenchPage() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  useEffect(() => {
    perfMonitor.start();
    // Pre-load WASM in the background while the user works.
    void loadWasm();
    // Restore most recent project if none open yet.
    if (!useProjectStore.getState().project) {
      void useProjectStore.getState().loadRecent();
    }
    return () => perfMonitor.stop();
  }, []);

  return (
    <div className="workbench">
      <TopBar />
      <div className="workbench-body">
        <ErrorBoundary>
          {sidebarOpen && <Sidebar />}
          <CentralArea />
          <RightPanel />
        </ErrorBoundary>
      </div>
      <StatusBar />
      <PerfPanel />
    </div>
  );
}