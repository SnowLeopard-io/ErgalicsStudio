import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/app.css';

// Global error capture (spec §11.2 application-level boundary).
window.addEventListener('error', (event) => {
  console.error('[global] unhandled error', event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[global] unhandled rejection', event.reason);
});

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