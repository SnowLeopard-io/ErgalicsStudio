import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BannerStack, ToastStack } from '@/components/Feedback';
import { initProjectStore } from '@/stores/projectStore';

const WelcomePage = lazy(() => import('@/pages/welcome/WelcomePage'));
const WorkbenchPage = lazy(() => import('@/pages/workbench/WorkbenchPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const PluginViewPage = lazy(() => import('@/pages/plugin/PluginViewPage'));
const ShareLinkPage = lazy(() => import('@/pages/share/ShareLinkPage'));

initProjectStore();

function AppShell() {
  return (
    <>
      <BannerStack />
      <ToastStack />
      <Suspense fallback={<div className="route-loading"><span className="spinner" /></div>}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/workbench" element={<WorkbenchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/plugin/:pluginId" element={<PluginViewPage />} />
          <Route path="/share/:payload" element={<ShareLinkPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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