// E2E verification of the real WebGPU compute path on a live device.
//
// Two stages:
//   A. Numeric harness (tests/e2e/webgpu.html): acquires a real WebGPU device
//      in Edge, drives the compiled Rust/WASM core (GpuBuffer, ComputeKernel,
//      dispatch, mapAsync readback) with the real WGSL kernel from
//      src/core/wgsl.ts, and compares the GPU result against the
//      CPU-equivalent integrator within tolerance.
//   B. App integration: loads the Particles plugin + galaxy sample in the
//      workbench, triggers the "GPU compute" button, and asserts the success
//      toast reports a real engine and measured GPU time — proving the
//      `api.gpu` surface works end to end.
//
// Requires a WebGPU-capable browser build. Headless Edge is launched with the
// Chromium SwiftShader WebGPU flags so the test is deterministic on any
// machine (software adapter, no physical GPU required).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4289;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WEBGPU_ARGS = [
  '--no-sandbox',
  '--enable-unsafe-webgpu',
  '--use-webgpu-adapter=swiftshader',
  '--enable-dawn-features=allow_unsafe_apis',
  '--disable-dawn-features=use_dxc',
  '--enable-webgpu-developer-features',
  '--use-gpu-in-tests',
  '--enable-accelerated-2d-canvas',
  '--ignore-gpu-blocklist',
];

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`server not ready at ${url}`);
}

async function waitForResult(page, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page
      .evaluate(() => (window.__webgpuTest ? window.__webgpuTest.status : 'running'))
      .catch(() => 'running');
    if (state !== 'running') {
      return page.evaluate(() => window.__webgpuTest);
    }
    await sleep(500);
  }
  throw new Error('harness did not finish in time');
}

(async () => {
  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true },
  );
  server.unref();
  const out = [];
  const step = (label, v) => out.push(`${label}: ${JSON.stringify(v)}`);
  let browser;
  try {
    await waitForServer(`${BASE}/`);
    browser = await chromium.launch({
      executablePath: EDGE,
      headless: true,
      args: WEBGPU_ARGS,
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const pageErrors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // ---- Stage A: numeric harness on a real WebGPU device ----
    await page.goto(`${BASE}/tests/e2e/webgpu.html`, { waitUntil: 'load' });
    const harness = await waitForResult(page);
    step('harness status', harness.status);
    step('adapter', harness.adapter ?? harness.error ?? null);
    step('strict run', harness.strict ?? null);
    step('boundary run', harness.boundary ?? null);
    step('harness pass', harness.pass ?? false);
    if (harness.status !== 'done') {
      step('harness error', harness.error ?? harness.stack ?? '');
      step('harness lastStep', harness.lastStep ?? null);
      step('harness diagnostics', harness.diagnostics ?? null);
      step('harness stack', harness.stack ?? null);
    }

    // ---- Stage B: full app integration (particles plugin, api.gpu) ----
    let appStep = { engine: null, gpuMs: null, toast: null };
    try {
      await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
      await page.locator('.welcome-enter').click();
      await sleep(1800);
      await page.locator('.plugin-item', { hasText: 'Particles' }).click();
      await sleep(1200);
      await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例数据' }).click();
      await sleep(400);
      const galaxyCard = page.locator('.plugin-card', {
        hasText: /星系粒子数据|Galaxy Particle Data/,
      });
      await galaxyCard.locator('button', { hasText: '加载' }).click();
      await sleep(1500);
      await page.locator('button', { hasText: '⚡' }).first().click();
      await sleep(2500);
      const toasts = await page.locator('.toast-stack .toast').allTextContents();
      const success = toasts.find((t) => /ms/.test(t)) ?? '';
      const engineMatch = success.match(/（(\w+)）/);
      const msMatch = success.match(/([\d.]+)\s*ms/);
      appStep = {
        toast: success.trim(),
        engine: engineMatch ? engineMatch[1] : null,
        gpuMs: msMatch ? msMatch[1] : null,
      };
    } catch (err) {
      appStep.error = String(err);
    }
    step('app toast', appStep.toast ?? appStep.error ?? null);
    step('app engine', appStep.engine);
    step('app gpuMs', appStep.gpuMs);

    out.push('=== PAGE ERRORS ===');
    out.push(pageErrors.length ? pageErrors.join('\n') : '(none)');
    out.push('=== CONSOLE ERRORS ===');
    out.push(errors.length ? errors.join('\n') : '(none)');

    const pass =
      harness.status === 'done' &&
      harness.pass === true &&
      pageErrors.length === 0 &&
      appStep.toast !== null &&
      /ms/.test(appStep.toast ?? '') &&
      appStep.gpuMs !== null;
    step('PASS', pass);

    console.log(out.join('\n'));
    if (!pass) process.exitCode = 1;
  } catch (err) {
    console.error('VERIFY WEBGPU FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
})();
