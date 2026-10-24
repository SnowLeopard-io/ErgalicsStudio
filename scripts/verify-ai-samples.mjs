// Diagnostic E2E: load each AI Training sample from the sample dialog and
// capture the resulting toast text, so a parse failure is observable instead
// of inferred.
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, sleep, loadSampleFromDialog, closeDialog } from './_harness.mjs';

const SAMPLES = [
  'AI 训练 · 线性回归',
  'AI 训练 · 非线性回归',
  'AI 训练 · 逻辑回归',
  'AI 训练 · MNIST 分类',
];

const server = await startPreview(4211);
let browser;

(async () => {
  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  const out = [];
  await page.goto(`${server.url}/#/workbench`, { waitUntil: 'networkidle' });
  await sleep(1500);

  for (const name of SAMPLES) {
    // Clear any lingering toasts so we only read this round's message.
    await page.evaluate(() => {
      document.querySelectorAll('.toast').forEach((t) => t.click());
    });
    await sleep(300);

    let found = false;
    try {
      await loadSampleFromDialog(page, name);
      found = true;
    } catch {
      found = false;
    }
    await sleep(2500);

    const toasts = found
      ? await page
          .locator('.toast')
          .evaluateAll((els) => els.map((e) => `${e.className}|${e.textContent}`))
      : '(card not found, skipped)';
    out.push(`${name} -> ${JSON.stringify(toasts)}`);
    if (found) await closeDialog(page);
  }

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  if (errors.length) process.exitCode = 1;
})()
  .catch((e) => {
    console.error('VERIFY AI SAMPLES FAILED:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close().catch(() => {});
    server.stop();
  });
