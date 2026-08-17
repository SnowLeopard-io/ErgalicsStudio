// Diagnostic E2E: load each AI Training sample from the sample dialog and
// capture the resulting toast text, so a parse failure is observable instead
// of inferred.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLES = [
  'AI 训练 · 线性回归',
  'AI 训练 · 非线性回归',
  'AI 训练 · 逻辑回归',
  'AI 训练 · MNIST 分类',
];

(async () => {
  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', '4211'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true },
  );
  server.unref();
  await sleep(3500);

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  const out = [];
  await page.goto('http://localhost:4211/#/workbench', { waitUntil: 'networkidle' });
  await sleep(1500);

  for (const name of SAMPLES) {
    // Clear any lingering toasts so we only read this round's message.
    await page.evaluate(() => {
      document.querySelectorAll('.toast').forEach((t) => t.click());
    });
    await sleep(300);

    await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
    await sleep(500);
    const card = page.locator('.plugin-card', { hasText: name });
    const found = (await card.count()) > 0;
    if (!found) {
      out.push(`${name} -> CARD NOT FOUND in dialog`);
      await page.keyboard.press('Escape');
      await sleep(300);
      continue;
    }
    await card.locator('button', { hasText: '加载' }).click();
    await sleep(2500);

    const toasts = await page
      .locator('.toast')
      .evaluateAll((els) => els.map((e) => `${e.className}|${e.textContent}`));
    out.push(`${name} -> ${JSON.stringify(toasts)}`);
    await page.keyboard.press('Escape');
    await sleep(400);
  }

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  await browser.close();
  server.kill();
})().catch((e) => {
  console.error('VERIFY AI SAMPLES FAILED:', e);
  process.exit(1);
});
