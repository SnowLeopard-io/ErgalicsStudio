// E2E checks for this round:
// 1. 3D surface visibility is conditional — switching to a 2D plugin hides
//    the 3D coordinate system (no bleed into 2D viewports).
// 2. Contour plugin renders the vortex field (ramp + contour lines).
// 3. Scatter plugin renders cluster data with color channel.
// 4. New sample data (tornado.xyz) works with the 3D point cloud plugin.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4198'], {
    cwd: process.cwd(), stdio: 'ignore', detached: true,
  });
  server.unref();
  await sleep(3500);
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
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
    const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { distinct: colors.size, all: [...colors.keys()] };
  });
  const loadExample = (title) =>
    page.locator('.plugin-card', { hasText: title }).locator('button', { hasText: '加载' }).click();

  await page.goto('http://localhost:4198/#/', { waitUntil: 'networkidle' });
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

  // ---- 2. Contour plugin (vortex field) ----
  await page.locator('.plugin-item[data-plugin-id="example.contour"]').click();
  await sleep(1200);
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(400);
  await loadExample('涡旋场');
  await sleep(1600);
  let s = await sample();
  step('contour renders many colors (ramp)', s.distinct > 40);
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/contour.png' });

  // ---- 3. Scatter plugin (cluster data) ----
  await page.locator('.plugin-item[data-plugin-id="example.scatter"]').click();
  await sleep(1200);
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(400);
  await loadExample('三簇散点');
  await sleep(1600);
  s = await sample();
  step('scatter has teal+amber points (color channel)', s.all.includes('45,212,191') && s.all.includes('251,191,36'));
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/scatter.png' });

  // ---- 4. Tornado sample in the 3D point cloud ----
  await page.locator('.plugin-item[data-plugin-id="example.point-cloud-3d"]').click();
  await sleep(1200);
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(400);
  await loadExample('龙卷风');
  await sleep(1800);
  step('3D tornado: surface visible + no errors', await threeVisible());
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/tornado3d.png' });

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error('VERIFY PLUGINS FAILED:', e);
  process.exit(1);
});
