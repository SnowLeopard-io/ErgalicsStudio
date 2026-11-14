import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { lazyRetry } from '@/core/lazyRetry';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BootGate } from '@/components/BootGate';
import { BannerStack, ToastStack } from '@/components/Feedback';
import { AmbienceLayer } from '@/components/ambience/AmbienceLayer';
// import { CrossSiteSwitcher } from '@/components/CrossSiteSwitcher';
import { TemplateTourOverlay } from '@/components/TemplateTourOverlay';
import { TourGuide } from '@/components/TourGuide';
import { CommandPalette } from '@/components/CommandPalette';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { PortraitGuard } from '@/components/PortraitGuard';
import { initProjectStore } from '@/stores/projectStore';
import { initExperimentStore } from '@/stores/experimentStore';
import { initLineageStore } from '@/stores/lineageStore';
import { RESEARCH_TOOLS } from '@/pages/research/toolRegistry';

const WelcomePage = lazyRetry(() => import('@/pages/welcome/WelcomePage'));
const WorkbenchPage = lazyRetry(() => import('@/pages/workbench/WorkbenchPage'));
const SettingsPage = lazyRetry(() => import('@/pages/settings/SettingsPage'));
const PluginViewPage = lazyRetry(() => import('@/pages/plugin/PluginViewPage'));
const ShareLinkPage = lazyRetry(() => import('@/pages/share/ShareLinkPage'));
// All research tools resolve through one /studio/:toolId route + registry.
const StudioToolPage = lazyRetry(() => import('@/pages/studio/StudioToolPage'));

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
  // duration of the transition, then let `loc` catch up. Native hash changes
  // can share the same history key, so compare router location objects.
  const lastLocation = useRef(location);
  const [loc, setLoc] = useState(location);

  useLayoutEffect(() => {
    if (location === lastLocation.current) return;
    lastLocation.current = location;
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
      <AmbienceLayer />
      <TemplateTourOverlay />
      <TourGuide />
      {/* 站点悬浮窗（官网/工作台/文档切换）：暂时注释掉，暂不显示。 */}
      {/* <CrossSiteSwitcher /> */}
      <CommandPalette />
      <ShortcutsDialog />
      {/* Landscape-only layout: blocks portrait on touch devices where the
          platform refused the orientation lock (see core/orientation.ts). */}
      <PortraitGuard />
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
        {/* Reveals the app only after the boot checklist (static resources +
            first-screen chunks + compute probes) completes — see core/boot.ts. */}
        <BootGate>
          <AppShell />
        </BootGate>
      </HashRouter>
    </ErrorBoundary>
  );
}
