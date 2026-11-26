// ==========================================================================
// Ergalics Studio Desktop — Electron main process
// ==========================================================================
// Offline-first distribution shell. The renderer is the exact same Vite build
// the web edition uses, served over a custom standard scheme ("app://") —
// ES module scripts are CORS-blocked on file://, so a privileged scheme with
// a real origin is required. All native capabilities are exposed through a
// whitelisted IPC surface only; the renderer never gets Node integration.

import { app, BrowserWindow, Menu, protocol, session, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import cspPolicy from '../../../../scripts/csp-policy.json';
import { registerIpc } from './ipc';

const isDev = !!process.env.ERGALICS_DEV;

/** Schemes a renderer link may hand to the OS. Deliberately excludes file:,
 *  ms-*, and every custom protocol: those can start local programs or reveal
 *  the filesystem, and nothing in the app needs them. */
const EXTERNAL_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

// Custom scheme must be registered as privileged before app ready so module
// scripts, fetch and workers see a proper (secure) origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve the packaged renderer from app://bundle/<path> with real MIME types. */
function serveRenderer(): void {
  const root = isDev ? path.join(app.getAppPath(), 'dist') : path.join(app.getAppPath(), 'app-dist');
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // app://bundle/index.html → root/index.html
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const abs = path.resolve(root, rel);
    // Path traversal guard: resolved path must stay inside the renderer root.
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const data = fs.readFileSync(abs);
      return new Response(new Uint8Array(data), {
        headers: { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' },
      });
    } catch {
      // SPA fallback: unknown non-asset paths fall back to the shell page.
      if (!path.extname(abs)) {
        const index = fs.readFileSync(path.join(root, 'index.html'));
        return new Response(new Uint8Array(index), {
          headers: { 'content-type': MIME['.html'] },
        });
      }
      return new Response('not found', { status: 404 });
    }
  });
}

/**
 * CSP arrives as a real response header. A `<meta http-equiv=...>` cannot
 * deliver Report-Only policies (browsers ignore them), and the web edition
 * needs the same header from Vite — both read scripts/csp-policy.json.
 */
function installReportOnlyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy-Report-Only': [cspPolicy.reportOnly],
      },
    });
  });
}

function createWindow(): BrowserWindow {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(process.resourcesPath ?? app.getAppPath(), 'resources', iconName);
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e14',
    title: 'Ergalics Studio Desktop',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Chrome-style application: the renderer provides all navigation chrome.
  Menu.setApplicationMenu(null);
  win.setMenu(null);

  // Open external links in the default browser, never in-app — but only the
  // schemes a link is actually allowed to use. Forwarding the URL verbatim
  // would hand file:, ms-*, or any registered custom protocol to the OS,
  // which is the same class of hole as "sandboxed iframes can launch external
  // protocol handlers": page content picks the target the shell activates.
  win.webContents.setWindowOpenHandler(({ url }) => {
    let scheme: string;
    try {
      scheme = new URL(url).protocol;
    } catch {
      return { action: 'deny' };
    }
    if (EXTERNAL_LINK_SCHEMES.has(scheme)) {
      void shell.openExternal(url);
    } else {
      // Do not silently swallow it: blob:/data: previews and app: routes are
      // deliberately not forwarded, and a deny with no trace is hard to debug.
      console.warn(`[window-open] refused external scheme "${scheme}"`);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(process.env.ERGALICS_DEV_URL ?? 'http://localhost:5173/');
  } else {
    void win.loadURL('app://bundle/index.html');
  }

  win.once('ready-to-show', () => win.show());
  return win;
}

// Single-instance lock: a second launch just focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    installReportOnlyCsp();
    serveRenderer();
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
