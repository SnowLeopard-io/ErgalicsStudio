import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BannerStack, ToastStack } from '@/components/Feedback';
import { CrossSiteSwitcher } from '@/components/CrossSiteSwitcher';
import { TemplateTourOverlay } from '@/components/TemplateTourOverlay';
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

/** View Transitions API is feature-detected; node typings may or may not
 *  declare it, so we widen with an intersection rather than re-declaring the
 *  interface (which would conflict when TS already ships the type). */
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

function AppShell() {
  const location = useLocation();
  // The stage renders a *snapshot* of the router location so a navigation can
  // be cross-faded: we keep the previous page mounted over the new one for the
  // duration of the transition, then let `loc` catch up. `key` (unique per
  // navigation, unlike pathname) decides what counts as a real navigation.
  const lastKey = useRef(location.key);
  const [loc, setLoc] = useState(location);

  useLayoutEffect(() => {
    if (location.key === lastKey.current) return;
    lastKey.current = location.key;
    const commit = () => flushSync(() => setLoc(location));
    const doc = document as ViewTransitionDocument;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof doc.startViewTransition === 'function' && !reduced) {
      doc.startViewTransition(commit);
    } else {
      commit();
    }
  }, [location]);

  return (
    <>
      <BannerStack />
      <ToastStack />
      <TemplateTourOverlay />
      <CrossSiteSwitcher />
      <Suspense fallback={<div className="route-loading"><span className="spinner" /></div>}>
        {/* Keyed by pathname so each navigation remounts the stage and replays
            the `.route-stage` fade/settle entrance. `loc` is passed through
            so the matched route matches the keyed stage exactly. */}
        <div key={loc.pathname} className="route-stage">
          <Routes location={loc}>
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
