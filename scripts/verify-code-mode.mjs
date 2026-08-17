// Code-mode smoke test: enter workbench, switch to 代码 (code) mode, verify
// Monaco mounts, run a Python program through Pyodide, and check the variable
// panel + console update. Captures console/page errors.
// Usage: node scripts/verify-code-mode.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4175'], {
  cwd: process.cwd(),
  stdio: 'ignore',
  detached: true,
});
server.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(3500);

const errors = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto('http://localhost:4175/#/', { waitUntil: 'networkidle' });
  await sleep(1000);
  await page.locator('.welcome-enter').click();
  await sleep(1500);

  // Switch to 代码 (code) mode.
  const codeBtn = page.locator('.mode-switch .cluster-btn', { hasText: '代码' });
  await codeBtn.click();
  await sleep(3000);

  const monaco = await page.locator('.code-editor-monaco').count();
  const toolbar = await page.locator('.block-editor-toolbar').count();
  const statusPill = await page.locator('.be-status-pill').count();
  console.log('monaco present:', monaco > 0);
  console.log('toolbar present:', toolbar > 0);
  console.log('status pill present:', statusPill > 0);

  // Type a program into Monaco, then run it. Click the first visible view-line
  // to focus the editor (the hidden inputarea is overlapped by the canvas).
  const editorSurface = page.locator('.code-editor-monaco .view-lines');
  await editorSurface.click();
  await sleep(300);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('df = studio.random(50)\nstudio.plot("histogram", df)\nprint("hello from pyodide")');
  await sleep(800);
  const editorText = await page.locator('.code-editor-monaco .view-lines').allTextContents().catch(() => []);
  console.log('editor text:', JSON.stringify(editorText));

  // Click "运行" (run) to exercise the Pyodide path on the typed program.
  let runBtn = page.locator('.block-editor-toolbar .be-run-btn');
  for (let i = 0; i < 150; i += 1) {
    const disabled = await runBtn.isDisabled().catch(() => true);
    if (!disabled) break;
    await sleep(1000);
  }
  console.log('run button enabled:', !(await runBtn.isDisabled().catch(() => true)));

  if (!(await runBtn.isDisabled().catch(() => true))) {
    await runBtn.click();
    // Give Pyodide time to load packages + run (numpy bootstrap can be slow).
    for (let i = 0; i < 40; i += 1) {
      const pill = await page.locator('.be-status-text').textContent().catch(() => '');
      if (pill && pill.includes('运行中') === false && pill.includes('running') === false) break;
      await sleep(1000);
    }
    await sleep(2000);

    const pill = await page.locator('.be-status-text').textContent().catch(() => '');
    const errorText = await page.locator('.block-editor-error').textContent().catch(() => '');
    const consoleText = await page.locator('.editor-console-text').allTextContents().catch(() => []);
    const varNames = await page.locator('.editor-var-name').allTextContents().catch(() => []);
    const previewCanvas = await page.locator('.block-editor-preview-canvas').count();
    const canvasPainted = await page
      .locator('.block-editor-preview-canvas')
      .evaluate((c) => {
        const ctx = c.getContext('2d');
        if (!ctx) return false;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] !== 0) return true;
        }
        return false;
      })
      .catch(() => false);
    const runBtnLabel = await runBtn.textContent().catch(() => '');
    console.log('status pill:', JSON.stringify(pill));
    console.log('error text:', JSON.stringify(errorText));
    console.log('console lines:', JSON.stringify(consoleText));
    console.log('console contains "hello from pyodide":', (consoleText ?? []).some((t) => t.includes('hello from pyodide')));
    console.log('variable panel rows:', JSON.stringify(varNames));
    console.log('preview canvas present:', previewCanvas > 0);
    console.log('preview canvas painted:', canvasPainted);
    console.log('run button label (not stuck running):', runBtnLabel !== '■');
  } else {
    console.log('SKIP: Pyodide runtime did not become ready within 150s');
  }

  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/code-mode.png' });

  console.log('=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : '(none)');
} catch (err) {
  console.error('SMOKE FAILED:', err);
  console.error('errors so far:', errors.join('\n'));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}