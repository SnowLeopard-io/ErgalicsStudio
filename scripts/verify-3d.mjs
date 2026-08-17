// Quick E2E check: Point Cloud 3D plugin renders into the host three scene.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4199'], {
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

  await page.goto('http://localhost:4199/#/', { waitUntil: 'networkidle' });
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

  // Load sample data (斐波那契 / diamond.xyz)
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
  await sleep(400);
  await page.locator('.plugin-card', { hasText: '斐波那契' }).locator('button', { hasText: '加载' }).click();
  await sleep(1800);

  step('3D canvas still mounted after load', await page.locator('.scene3d-canvas').count() > 0);
  step('data scale reported', await page.evaluate(() => {
    const el = [...document.querySelectorAll('.perf-value, .status-bar span')].map((e) => e.textContent).join(' | ');
    return el;
  }));
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/pointcloud3d.png' });

  // Params should expose the 3D controls (point size slider + color select)
  step('3D params present', await page.locator('.param-panel .param-range').count() > 0);

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error('VERIFY 3D FAILED:', e);
  process.exit(1);
});
