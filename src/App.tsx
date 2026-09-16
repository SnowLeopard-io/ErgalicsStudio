import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BannerStack, ToastStack } from '@/components/Feedback';
import { initProjectStore } from '@/stores/projectStore';
import { initExperimentStore } from '@/stores/experimentStore';
import { initLineageStore } from '@/stores/lineageStore';

const WelcomePage = lazy(() => import('@/pages/welcome/WelcomePage'));
const WorkbenchPage = lazy(() => import('@/pages/workbench/WorkbenchPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const PluginViewPage = lazy(() => import('@/pages/plugin/PluginViewPage'));
const ShareLinkPage = lazy(() => import('@/pages/share/ShareLinkPage'));
const FigureStudioPage = lazy(() => import('@/pages/figures/FigureStudioPage'));
const NotebookPage = lazy(() => import('@/pages/notebook/NotebookPage'));
const SignalLabPage = lazy(() => import('@/pages/signal/SignalLabPage'));
const SweepsPage = lazy(() => import('@/pages/sweeps/SweepsPage'));
const ReportBuilderPage = lazy(() => import('@/pages/report/ReportBuilderPage'));
const SqlWorkbenchPage = lazy(() => import('@/pages/sql/SqlWorkbenchPage'));
// Lab pages — research tools promoted from TopBar dialogs to full pages.
const RunsPage = lazy(() => import('@/pages/labs/RunsPage'));
const AnalysisPage = lazy(() => import('@/pages/labs/AnalysisPage'));
const UncertaintyPage = lazy(() => import('@/pages/labs/UncertaintyPage'));
const ModelLabPage = lazy(() => import('@/pages/labs/ModelLabPage'));
const ProfilerPage = lazy(() => import('@/pages/labs/ProfilerPage'));
const ReproLockPage = lazy(() => import('@/pages/labs/ReproLockPage'));
const LineagePage = lazy(() => import('@/pages/labs/LineagePage'));
const SupplementPage = lazy(() => import('@/pages/labs/SupplementPage'));
const InferenceForgePage = lazy(() => import('@/pages/labs/InferenceForgePage'));

initProjectStore();
initExperimentStore();
initLineageStore();

function AppShell() {
  const location = useLocation();
  return (
    <>
      <BannerStack />
      <ToastStack />
      <Suspense fallback={<div className="route-loading"><span className="spinner" /></div>}>
        {/* Keyed by pathname so each navigation remounts the stage and replays
            the `.route-stage` fade/settle entrance. `location` is passed through
            so the matched route matches the keyed stage exactly. */}
        <div key={location.pathname} className="route-stage">
          <Routes location={location}>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/workbench" element={<WorkbenchPage />} />
            <Route path="/figures" element={<FigureStudioPage />} />
            <Route path="/notebook" element={<NotebookPage />} />
            <Route path="/signal" element={<SignalLabPage />} />
            <Route path="/sweeps" element={<SweepsPage />} />
            <Route path="/report" element={<ReportBuilderPage />} />
            <Route path="/sql" element={<SqlWorkbenchPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/uncertainty" element={<UncertaintyPage />} />
            <Route path="/model-lab" element={<ModelLabPage />} />
            <Route path="/profiler" element={<ProfilerPage />} />
            <Route path="/reprolock" element={<ReproLockPage />} />
            <Route path="/lineage" element={<LineagePage />} />
            <Route path="/supplement" element={<SupplementPage />} />
            <Route path="/inference" element={<InferenceForgePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/plugin/:pluginId" element={<PluginViewPage />} />
            <Route path="/share/:payload" element={<ShareLinkPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </ErrorBoundary>
  );
}