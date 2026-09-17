import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BannerStack, ToastStack } from '@/components/Feedback';
import { initProjectStore } from '@/stores/projectStore';
import { initExperimentStore } from '@/stores/experimentStore';
import { initLineageStore } from '@/stores/lineageStore';
import { RESEARCH_TOOLS } from '@/pages/research/toolRegistry';

const WelcomePage = lazy(() => import('@/pages/welcome/WelcomePage'));
const WorkbenchPage = lazy(() => import('@/pages/workbench/WorkbenchPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const PluginViewPage = lazy(() => import('@/pages/plugin/PluginViewPage'));
const ShareLinkPage = lazy(() => import('@/pages/share/ShareLinkPage'));
// All research tools resolve through one /studio/:toolId route + registry.
const StudioToolPage = lazy(() => import('@/pages/studio/StudioToolPage'));

initProjectStore();
initExperimentStore();
initLineageStore();

/** Legacy hash routes kept alive as client-side redirects (bookmarks). */
const LegacyToolRedirects = RESEARCH_TOOLS.map((toolDef) => (
  <Route
    key={toolDef.legacyPath}
    path={toolDef.legacyPath}
    element={<Navigate to={toolDef.path} replace />}
  />
));

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
            <Route path="/studio/:toolId" element={<StudioToolPage />} />
            {LegacyToolRedirects}
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
