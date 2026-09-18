// Quick E2E check: Point Cloud 3D plugin renders into the host three scene.
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, shot, sleep } from './_harness.mjs';

let server;
let browser;

(async () => {
  server = await startPreview(4199);
  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const out = [];
  const step = (l, v) => out.push(`${l}: ${JSON.stringify(v)}`);

  await page.goto(`${server.url}/#/`, { waitUntil: 'networkidle' });
  await sleep(1000);
  await page.locator('.welcome-enter').click();
  await sleep(1800);

  // Activate the 3D point cloud plugin
  await page.locator('.plugin-item[data-plugin-id="example.point-cloud-3d"]').click();
  await sleep(1500);
  step('3D canvas mounted', await page.locator('.scene3d-canvas').count() > 0);
  step('2D canvas hidden behind 3D', await page.evaluate(() => {
    const s = document.querySelector('.scene3d-canvas');
    return s ? { w: s.width, h: s.height } : null;
  }));

  // Load sample data (斐波那契 / diamond.xyz). The datasets dialog renders only
  // the active category's cards, so switch the left-nav category until the card
  // becomes visible.
  await page.locator('.topbar-cluster .cluster-btn[data-tour="examples"]').click();
  await sleep(400);
  const galaxyCard = page.locator('.plugin-card', { hasText: '斐波那契' });
  const cats = page.locator('.example-cat');
  const n = await cats.count();
  for (let i = 0; i < n && (await galaxyCard.count()) === 0; i += 1) {
    await cats.nth(i).click();
    await sleep(150);
  }
  if ((await galaxyCard.count()) === 0) throw new Error('diamond sample card not found');
  await galaxyCard.locator('button', { hasText: '加载' }).click();
  await sleep(1800);

  step('3D canvas still mounted after load', await page.locator('.scene3d-canvas').count() > 0);
  step('data scale reported', await page.evaluate(() => {
    const el = [...document.querySelectorAll('.perf-value, .status-bar span')].map((e) => e.textContent).join(' | ');
    return el;
  }));
  await page.screenshot({ path: shot('pointcloud3d.png') });

  // Params should expose the 3D controls (point size slider + color select)
  step('3D params present', await page.locator('.param-panel .param-range').count() > 0);

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  if (errors.length) process.exitCode = 1;
})()
  .catch((e) => {
    console.error('VERIFY 3D FAILED:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close().catch(() => {});
    server?.stop();
  });
