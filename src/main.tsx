import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installGlobalErrorHandlers } from '@/core/errors';
import { initPwa, registerServiceWorker } from '@/core/pwa';
import { restoreAppliedTheme } from '@/core/theme-pack/registry';
import './styles/global.css';
import './styles/app.css';
import './styles/blocks.css';
import './styles/animations.css';
import './styles/lab-polish.css';

// Global error capture (spec §11.2 application-level boundary). Every
// uncaught error / rejection is normalised into the error registry (dedup,
// bounded ring, logger + subscriber notification); the teardown is kept for
// hot-reload environments so listeners are not attached twice.
const teardownGlobalHandlers = installGlobalErrorHandlers();

// FR-20: PWA — capture install prompt / connectivity and register the
// hand-written offline service worker (production builds only).
initPwa();
window.addEventListener('load', () => void registerServiceWorker());

// FR-21: re-apply the user's chosen .cstheme before first paint.
restoreAppliedTheme();

// FR-05: restore user-added trusted publisher keys from IndexedDB so sources
// the user trusted in an earlier session install without re-confirming.
// Fire-and-forget: a storage failure must never block startup (built-in keys
// are already in the in-memory registry).
void import('@/core/plugin-signing')
  .then(({ loadTrustedKeysFromStorage }) => loadTrustedKeysFromStorage())
  .catch(() => undefined);

// Keyboard shortcut: Ctrl+S saves the current project (spec §4.2).
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void import('@/stores/projectStore').then(({ useProjectStore }) => useProjectStore.getState().save());
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Release listeners on HMR re-execution so dev re-runs do not stack them.
if (import.meta.hot) {
  import.meta.hot.dispose(teardownGlobalHandlers);
}