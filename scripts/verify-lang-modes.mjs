// R/JS code-mode + cross-mode switching smoke test.
//
// Covers the user-critical paths:
//   1. Code mode → R: type R, run on the in-process IR engine.
//   2. Switch R → JS: buffer is auto-translated; run again.
//   3. Load a bundled flow project (积木示例), then cycle 流程 → 积木 → 代码:
//      every mode mounts its surface and no page/console error is raised.
// Usage: node scripts/verify-lang-modes.mjs
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, shot, sleep } from './_harness.mjs';

const server = await startPreview(4176);

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...launchOptions(),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(`${server.url}/#/`, { waitUntil: 'networkidle' });
  await sleep(1000);
  await page.locator('.welcome-enter').click();
  await sleep(1500);

  // A first-run onboarding tour overlays the workbench — dismiss it.
  for (let i = 0; i < 5; i += 1) {
    const skip = page.locator('.tour-tip-actions .btn', { hasText: '跳过' });
    const finish = page.locator('.tour-tip-actions .btn', { hasText: '完成' });
    if (await skip.count()) {
      await skip.first().click();
      await sleep(300);
      break;
    }
    if (await finish.count()) {
      await finish.first().click();
      await sleep(300);
      break;
    }
    await sleep(300);
  }

  const modeBtn = (label) => page.locator('.mode-switch .mode-btn', { hasText: label });
  const langBtn = (label) => page.locator('.code-editor-lang-toggle .btn', { hasText: label });
  const editorLines = () => page.locator('.code-editor-monaco .view-lines');

  // ---- enter code mode, switch to R --------------------------------------
  await modeBtn('代码').click();
  await sleep(1500);
  await langBtn('R').click();
  await sleep(500);

  const surface = editorLines();
  await surface.click();
  await sleep(200);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('df <- studio.exampleData(100, 42)\nstudio.print("r-ok")');
  await sleep(600);

  const rText = (await editorLines().allTextContents().catch(() => [])).join('');
  console.log('R buffer contains exampleData:', rText.includes('exampleData'));
  console.log('R buffer uses <- assignment:', rText.includes('<-'));

  // Run R via the notebook shortcut (Ctrl/⌘+Enter) instead of the button.
  await page.keyboard.press('Control+Enter');
  for (let i = 0; i < 30; i += 1) {
    const pill = await page.locator('.be-status-text').textContent().catch(() => '');
    if (pill && !pill.includes('运行中') && !pill.includes('running')) break;
    await sleep(300);
  }
  await sleep(800);
  let consoleText = (await page.locator('.editor-console-text').allTextContents().catch(() => [])).join('\n');
  const varNames = await page.locator('.editor-var-name').allTextContents().catch(() => []);
  const rError = await page.locator('.block-editor-error').textContent().catch(() => '');
  console.log('R run console contains "r-ok":', consoleText.includes('r-ok'));
  console.log('R variables include df:', varNames.some((n) => n.includes('df')));
  console.log('R error text:', JSON.stringify(rError));
  await page.screenshot({ path: shot('code-r-mode.png') });

  // ---- switch R → JS (buffer must be translated, then run) ---------------
  await langBtn('JS').click();
  await sleep(600);
  const jsText = (await editorLines().allTextContents().catch(() => [])).join('');
  console.log('JS buffer translated (const/let + exampleData):',
    /(const|let|var)\s+df\s*=/.test(jsText) && jsText.includes('exampleData'));

  await page.locator('.block-editor-toolbar .be-run-btn').click();
  for (let i = 0; i < 30; i += 1) {
    const pill = await page.locator('.be-status-text').textContent().catch(() => '');
    if (pill && !pill.includes('运行中') && !pill.includes('running')) break;
    await sleep(300);
  }
  await sleep(800);
  consoleText = (await page.locator('.editor-console-text').allTextContents().catch(() => [])).join('\n');
  const jsError = await page.locator('.block-editor-error').textContent().catch(() => '');
  console.log('JS run console contains "r-ok":', consoleText.includes('r-ok'));
  console.log('JS error text:', JSON.stringify(jsError));

  // ---- load a bundled flow project and cycle every mode ------------------
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(500);
  await page.locator('.data-dialog-tab', { hasText: '积木示例' }).click();
  await sleep(300);
  const loadBtn = page.locator('.plugin-card .btn', { hasText: '加载' }).first();
  if (await loadBtn.count()) {
    await loadBtn.click();
    await sleep(1500);
    console.log('block sample loaded');
  } else {
    console.log('WARNING: no block sample load button found');
  }

  await modeBtn('流程').click();
  await sleep(1500);
  const flowCanvas = await page.locator('.block-workbench-canvas').count();
  const flowNodes = await page.locator('.block-workbench-canvas .block-node, .block-workbench-canvas [data-node-id]').count();
  console.log('flow surface mounts:', flowCanvas > 0);
  console.log('flow nodes rendered:', flowNodes);

  // Actually RUN the loaded pipeline through the flow engine.
  const flowRunBtn = page.locator('.block-toolbar .btn-primary', { hasText: '运行' });
  if (await flowRunBtn.count()) {
    await flowRunBtn.click();
    await sleep(3000);
    const diagnostics = await page.locator('.block-diagnostic').allTextContents().catch(() => []);
    const previewChips = await page.locator('.block-preview-chip').count();
    const svgChildren = await page
      .locator('.block-preview-svg-canvas')
      .evaluate((el) => el.childElementCount)
      .catch(() => 0);
    console.log('flow run diagnostics:', JSON.stringify(diagnostics));
    console.log('flow preview outputs (chips):', previewChips);
    console.log('flow preview rendered SVG content:', svgChildren > 0);
  }

  await modeBtn('积木').click();
  await sleep(1500);
  const blockSvg = await page.locator('.block-editor-workspace svg.blocklyMainBackground, .block-editor-workspace svg').count();
  const blockText = await page.evaluate(() => document.querySelector('.block-editor-workspace')?.textContent ?? '');
  console.log('block surface mounts:', blockSvg > 0);
  console.log('block workspace non-empty:', blockText.trim().length > 20);

  await modeBtn('代码').click();
  await sleep(1200);
  const codeAfter = (await editorLines().allTextContents().catch(() => [])).join('');
  console.log('code regenerated from project (studio. calls):', codeAfter.includes('studio.'));

  // Back to flow once more — the signature guard must keep nodes stable.
  await modeBtn('流程').click();
  await sleep(1200);
  const flowNodes2 = await page.locator('.block-workbench-canvas .block-node, .block-workbench-canvas [data-node-id]').count();
  console.log('flow nodes stable after re-entry:', flowNodes2 === flowNodes, `(${flowNodes} -> ${flowNodes2})`);

  await page.screenshot({ path: shot('lang-modes.png') });

  console.log('=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : '(none)');
} catch (err) {
  console.error('SMOKE FAILED:', err);
  console.error('errors so far:', errors.join('\n'));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
