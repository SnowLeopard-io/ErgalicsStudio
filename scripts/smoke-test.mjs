// Verify the functional fixes: auto-loaded plugins, auto-created project,
// reactive params, recent project restore.
// Usage: node scripts/smoke-test.mjs
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, sleep } from './_harness.mjs';

const server = await startPreview(4173);

const errors = [];
let page;
let browser;
try {
  browser = await chromium.launch({
    ...launchOptions(),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  const out = [];
  const step = (label, v) => out.push(`${label}: ${JSON.stringify(v)}`);

  await page.goto(`${server.url}/#/`, { waitUntil: 'networkidle' });
  await sleep(1000);
  await page.locator('.welcome-enter').click();
  await sleep(2000);

  step('auto-created project name', await page.locator('.project-name').textContent());
  step('plugins auto-loaded in sidebar', await page.locator('.plugin-item').allTextContents());
  step('recent list entries', await page.locator('.recent-item').count());

  // Activate first plugin, then move a slider and check the value follows.
  await page.locator('.plugin-item').first().click();
  await sleep(900);
  const slider = page.locator('.param-range input[type=range]').first();
  const sliderBefore = await slider.inputValue();
  const sliderValBefore = await page.locator('.param-value').first().textContent();
  step('slider before', { sliderBefore, sliderValBefore });

  // Set the slider to its legal maximum (fixture sliders use varied ranges, so
  // never assume a fixed target value).
  const sliderMax = await slider.getAttribute('max');
  const target = String(sliderMax ?? '100');
  await slider.fill(target);
  await sleep(400);
  const sliderAfter = await slider.inputValue();
  const sliderValAfter = await page.locator('.param-value').first().textContent();
  step('slider after', { sliderAfter, sliderValAfter, target });
  step('params reactive', sliderAfter === target && sliderValAfter === target);

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  if (errors.length) process.exit(1);
} catch (err) {
  console.error('SMOKE FAILED:', err);
  console.error('errors so far:', errors.join('\n'));
  process.exit(1);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}