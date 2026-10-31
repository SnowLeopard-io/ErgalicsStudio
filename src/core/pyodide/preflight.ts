// ==========================================================================
// Ergalics Studio — Python runtime preflight
//
// Solver workers import /pyodide/pyodide.mjs inside the worker. When that
// bundle was not vendored (or the CDN is unreachable) the dynamic import
// failed after a long boot window and the user only saw a generic compute
// error. Checking the entry point up front lets the host say exactly what is
// wrong and marks the runtime as unavailable before any solve starts.
// ==========================================================================

import { t } from '@/i18n';

export async function assertPythonRuntimeAssets(indexURL: string): Promise<void> {
  let url: string;
  try {
    url = new URL('pyodide.mjs', indexURL).href;
  } catch {
    throw new Error(t('python.runtime.unavailable'));
  }
  let response: Response;
  try {
    // GET rather than HEAD: the service worker's runtime tier only caches
    // GET responses (Cache.put rejects anything else), and a HEAD would slip
    // through to the network and report a false failure when offline. The
    // body is cancelled right away — only the status matters here.
    response = await fetch(url, { method: 'GET', cache: 'force-cache' });
    void response.body?.cancel();
  } catch {
    throw new Error(t('python.runtime.unavailable'));
  }
  if (response.ok) return;
  throw new Error(t('python.runtime.unavailable'));
}
