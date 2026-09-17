import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installGlobalErrorHandlers } from '@/core/errors';
import './styles/global.css';
import './styles/app.css';
import './styles/blocks.css';
import './styles/animations.css';

// Global error capture (spec §11.2 application-level boundary). Every
// uncaught error / rejection is normalised into the error registry (dedup,
// bounded ring, logger + subscriber notification); the teardown is kept for
// hot-reload environments so listeners are not attached twice.
const teardownGlobalHandlers = installGlobalErrorHandlers();

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