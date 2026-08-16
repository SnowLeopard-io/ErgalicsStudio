// Block-mode smoke test: enter workbench, switch to 积木 mode, capture errors.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4174'], {
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

  await page.goto('http://localhost:4174/#/', { waitUntil: 'networkidle' });
  await sleep(1000);
  await page.locator('.welcome-enter').click();
  await sleep(1500);

  // Switch to 积木 (block) mode.
  const blockBtn = page.locator('.mode-switch .cluster-btn', { hasText: '积木' });
  await blockBtn.click();
  await sleep(2500);

  const workspaceCount = await page.locator('.block-editor-workspace').count();
  const injectionSvg = await page.locator('.block-editor-workspace svg').count();
  const toolbar = await page.locator('.block-editor-toolbar').count();
  console.log('workspace present:', workspaceCount > 0);
  console.log('blockly svg present:', injectionSvg > 0);
  console.log('toolbar present:', toolbar > 0);

  // Click "运行" (run) to exercise the interpreter path on an empty program.
  const runBtn = page.locator('.block-editor-toolbar .btn', { hasText: '运行' });
  if (await runBtn.count()) {
    await runBtn.click();
    await sleep(1500);
    console.log('run clicked, no throw');
  }

  // Load a block sample from the top-bar 示例 dialog → 积木示例 tab.
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(500);
  await page.locator('.data-dialog-tab', { hasText: '积木示例' }).click();
  await sleep(300);
  const loadBtn = page.locator('.plugin-card .btn', { hasText: '加载' }).first();
  if (await loadBtn.count()) {
    await loadBtn.click();
    await sleep(1800);
    console.log('block sample loaded via top-bar dialog');
  } else {
    console.log('no block sample load button found');
  }

  // Verify block labels resolved (i18n) — Chinese text, no literal %{BKY_}.
  const blockText = await page.evaluate(() => {
    const ws = document.querySelector('.block-editor-workspace');
    return ws ? ws.textContent ?? '' : '';
  });
  console.log('block label has "载入":', blockText.includes('载入'));
  console.log('block label has "设":', blockText.includes('设'));
  console.log('block label leaks BKY ref:', blockText.includes('%{BKY_'));

  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/block-mode.png' });

  console.log('=== ERRORS ===');
  console.log(errors.length ? errors.join('\n') : '(none)');
} catch (err) {
  console.error('SMOKE FAILED:', err);
  console.error('errors so far:', errors.join('\n'));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
