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
    response = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
  } catch {
    throw new Error(t('python.runtime.unavailable'));
  }
  // 405/501: the host serves the file but does not implement HEAD — not a
  // missing runtime. Anything else non-2xx means the bundle is absent.
  if (response.ok || response.status === 405 || response.status === 501) return;
  throw new Error(t('python.runtime.unavailable'));
}
