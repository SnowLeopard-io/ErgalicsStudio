// ==========================================================================
// Shared E2E harness for the verify-*.mjs scripts
// ==========================================================================
//
// Every verify script used to hardcode three things that only exist on one
// machine: an absolute Edge path under `C:/Program Files (x86)/...`, a
// screenshot directory under one user's Temp folder, and a fixed preview
// port. On any other machine — or when the port was already taken — the
// scripts failed before running a single assertion.
//
// This module resolves all three from the environment with sane defaults and
// guarantees cleanup, so a failing assertion can no longer leak a preview
// server or a headless browser process.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Preview server startup budget. CI machines are slower than dev boxes. */
const SERVER_TIMEOUT_MS = Number(process.env.VERIFY_SERVER_TIMEOUT_MS ?? 60_000);

// ---- browser resolution ---------------------------------------------------

/** Well-known install locations per platform, most likely first. */
function browserCandidates() {
  switch (platform()) {
    case 'win32':
      return [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      ];
    case 'darwin':
      return [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ];
    default:
      return ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  }
}

/**
 * Browser executable to drive.
 *
 * Precedence: `$BROWSER_PATH` (or the legacy `$EDGE_PATH` / `$CHROME_PATH`)
 * → a well-known install location → `undefined`, which lets Playwright fall
 * back to its own bundled Chromium. Returning `undefined` instead of throwing
 * keeps the scripts useful on machines with only Playwright's download.
 */
export function resolveBrowser() {
  const explicit =
    process.env.BROWSER_PATH || process.env.EDGE_PATH || process.env.CHROME_PATH;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`BROWSER_PATH points at a missing file: ${explicit}`);
    }
    return explicit;
  }
  return browserCandidates().find((candidate) => existsSync(candidate));
}

/** Playwright launch options shared by every script. */
export function launchOptions() {
  const executablePath = resolveBrowser();
  return {
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--no-sandbox'],
  };
}

// ---- screenshot output ----------------------------------------------------

/**
 * Directory for verification screenshots.
 * Override with `$SHOTS_DIR`; defaults to a per-user temp folder that exists
 * on every platform instead of one developer's absolute path.
 */
export function shotsDir() {
  const dir = process.env.SHOTS_DIR
    ? path.resolve(process.env.SHOTS_DIR)
    : path.join(tmpdir(), 'ergalics-shots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute screenshot path inside `shotsDir()`. */
export function shot(name) {
  return path.join(shotsDir(), name);
}

// ---- preview server -------------------------------------------------------

/** Ask the OS for a free port, then release it for Vite to bind. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }
  throw new Error(`preview server did not become ready at ${url}: ${String(lastError)}`);
}

/**
 * Kill a `detached` child and everything it spawned.
 *
 * `child.kill()` only signals the direct child — on Windows the detached
 * `vite` wrapper survives and holds the port, so the next run of the script
 * (or the dev server) fails with EADDRINUSE. `taskkill /t` walks the tree.
 */
export function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (platform() === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/**
 * Start Vite and wait until it answers.
 *
 * @param {number} [preferred] preferred port; falls back to a free one when
 *   it is already in use (the old scripts hardcoded a port and died).
 * @param {'preview'|'dev'} [mode] `preview` serves `dist/`, `dev` runs the
 *   dev server (needed by scripts that load `/tests/e2e/*.html`).
 * @returns {Promise<{ url: string, port: number, stop: () => void }>}
 */
export async function startPreview(preferred, mode = 'preview') {
  const envPort = Number(process.env.PREVIEW_PORT);
  const requested = Number.isFinite(envPort) && envPort > 0 ? envPort : preferred;
  const port =
    requested && Number.isFinite(requested) && requested > 0
      ? await freePortIsUsable(requested)
      : await freePort();

  const child = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      ...(mode === 'dev' ? [] : ['preview']),
      // Pin to the IPv4 loopback: on machines where `localhost` resolves to
      // ::1 first, Vite binds IPv6-only and the 127.0.0.1 readiness probe fails.
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true },
  );
  child.unref();

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(url, SERVER_TIMEOUT_MS);
  } catch (err) {
    stopServer(child);
    throw err;
  }
  return { url, port, stop: () => stopServer(child) };
}

/** Use `preferred` when it is free, otherwise let the OS choose. */
async function freePortIsUsable(preferred) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => resolve(freePort()));
    probe.listen(preferred, '127.0.0.1', () => {
      probe.close(() => resolve(preferred));
    });
  });
}

// ---- page helpers ---------------------------------------------------------

/**
 * Open the global sample dialog and load the card whose title contains `title`.
 *
 * The dialog renders only the active category's cards, so switch the left-nav
 * category until the card becomes visible. Throws when it is not found in any.
 */
export async function loadSampleFromDialog(page, title, { label = '示例' } = {}) {
  await page.locator('.topbar-cluster .cluster-btn', { hasText: label }).click();
  await sleep(400);
  const card = page.locator('.plugin-card', { hasText: title });
  const cats = page.locator('.example-cat');
  const n = await cats.count();
  for (let i = 0; i < n && (await card.count()) === 0; i += 1) {
    await cats.nth(i).click();
    await sleep(150);
  }
  if ((await card.count()) === 0) {
    await closeDialog(page);
    throw new Error(`sample card not found for title: ${title}`);
  }
  await card.locator('button', { hasText: '加载' }).click();
}

/** Dismiss the sample dialog via Escape when it is still open. */
export async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
}

/**
 * Attach console/page error collection to a page.
 * Returns the array (live) and a helper that renders it for the report.
 */
export function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Step recorder used by every script's report. */
export function createReporter() {
  const out = [];
  return {
    step: (label, value) => out.push(`${label}: ${JSON.stringify(value)}`),
    note: (text) => out.push(text),
    finish(errors) {
      out.push('=== ERRORS ===');
      out.push(errors.length ? errors.join('\n') : '(none)');
      console.log(out.join('\n'));
      return errors.length;
    },
  };
}
