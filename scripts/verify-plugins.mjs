// E2E checks for this round:
// 1. 3D surface visibility is conditional — switching to a 2D plugin hides
//    the 3D coordinate system (no bleed into 2D viewports).
// 2. Contour plugin renders the vortex field (ramp + contour lines).
// 3. Scatter plugin renders cluster data with color channel.
// 4. New sample data (tornado.xyz) works with the 3D point cloud plugin.
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, shot, sleep } from './_harness.mjs';

let server;
let browser;

(async () => {
  server = await startPreview(4198);
  browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const out = [];
  const step = (l, v) => out.push(`${l}: ${JSON.stringify(v)}`);

  const threeVisible = () =>
    page.evaluate(() => {
      const s = document.querySelector('.scene3d-canvas');
      return s ? getComputedStyle(s).display !== 'none' : false;
    });
  const sample = () => page.evaluate(() => {
    const c = document.querySelector('.central-canvas');
    const g = c.getContext('2d');
    const { width: w, height: h } = c;
    const data = g.getImageData(0, 0, w, h).data;
    const colors = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      colors.set(key, (colors.get(key) ?? 0) + 1);
    }
    return { distinct: colors.size, all: [...colors.keys()] };
  });
  // The examples dialog buckets samples into left-nav discipline
  // categories (lab/charts/stats/physics/geo/data/fun); walk them until the
  // requested card is visible.
  const loadExample = async (title) => {
    const cats = page.locator('.example-cat');
    const count = await cats.count();
    for (let i = 0; i < count; i += 1) {
      await cats.nth(i).click();
      await sleep(150);
      const card = page.locator('.plugin-card', { hasText: title });
      if ((await card.count()) > 0) {
        await card.locator('button', { hasText: '加载' }).click();
        return;
      }
    }
    throw new Error(`example card not found: ${title}`);
  };

  await page.goto(`${server.url}/#/`, { waitUntil: 'networkidle' });
  await sleep(1000);

  // ---- welcome footer links are functional ----
  const footerHrefs = await page
    .locator('.welcome-footer a')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  step('footer external links', footerHrefs);
  step('footer has real GitHub repo link', footerHrefs.includes('https://github.com/SnowLeopard-io/ErgalicsStudio'));
  step('footer has docs link', footerHrefs.includes('./docs/'));

  // "Market" navigates to the workbench and opens the plugin dialog.
  await page.locator('.welcome-footer .welcome-footer-link').click();
  await sleep(1800);
  step('market opens plugin dialog in workbench', await page.locator('.plugin-dialog').count() > 0);
  await page.keyboard.press('Escape');
  await sleep(400);

  // ---- 1. 3D surface visibility is conditional ----
  await page.locator('.plugin-item[data-plugin-id="example.point-cloud-3d"]').click();
  await sleep(1200);
  step('3D surface visible while 3D plugin active', await threeVisible());

  await page.locator('.plugin-item[data-plugin-id="example.point-cloud"]').click();
  await sleep(1200);
  step('3D surface hidden when 2D plugin active', !(await threeVisible()));

  await page.locator('.plugin-item[data-plugin-id="example.point-cloud-3d"]').click();
  await sleep(1200);
  step('3D surface shows again on re-activation', await threeVisible());

  // ---- 2. Heatmap plugin (vortex field) ----
  await page.locator('.plugin-item[data-plugin-id="example.heatmap"]').click();
  await sleep(1200);
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(400);
  await loadExample('涡旋场');
  await sleep(1600);
  let s = await sample();
  step('heatmap renders many colors (ramp)', s.distinct > 40);
  await page.screenshot({ path: shot('heatmap.png') });

  // ---- 3. Scatter plugin (cluster data) ----
  await page.locator('.plugin-item[data-plugin-id="example.scatter"]').click();
  await sleep(1200);
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(400);
  await loadExample('三簇散点');
  await sleep(1600);
  s = await sample();
  step('scatter has teal+amber points (color channel)', s.all.includes('45,212,191') && s.all.includes('251,191,36'));
  await page.screenshot({ path: shot('scatter.png') });

  // ---- 4. Tornado sample in the 3D point cloud ----
  await page.locator('.plugin-item[data-plugin-id="example.point-cloud-3d"]').click();
  await sleep(1200);
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(400);
  await loadExample('龙卷风');
  await sleep(1800);
  step('3D tornado: surface visible + no errors', await threeVisible());
  await page.screenshot({ path: shot('tornado3d.png') });

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  if (errors.length) process.exitCode = 1;
})()
  .catch((e) => {
    console.error('VERIFY PLUGINS FAILED:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Without a finally, any failed assertion above leaked a headless browser
    // and a detached preview server holding the port.
    await browser?.close().catch(() => {});
    server?.stop();
  });
