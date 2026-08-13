// Verify the fixes: data-driven particles, no auto-run, point-cloud empty
// state + auto-fit, unified mono font, toggle Run control, topbar cluster.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4177'], {
    cwd: process.cwd(), stdio: 'ignore', detached: true,
  });
  server.unref();
  await sleep(3500);
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const out = [];
  const step = (l, v) => out.push(`${l}: ${JSON.stringify(v)}`);

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
    const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { top };
  });
  const hasColor = (s, c) => s.top.some(([k]) => k === c);
  const runLabel = () => page.locator('.param-panel button.btn-block').first().textContent();
  const loadExample = (title) =>
    page
      .locator('.plugin-card', { hasText: title })
      .locator('button', { hasText: '加载' })
      .click();

  await page.goto('http://localhost:4177/#/', { waitUntil: 'networkidle' });
  await sleep(1200);
  await page.locator('.welcome-enter').click();
  await sleep(1800);

  // --- font unification ---
  step('body font', await page.evaluate(() => getComputedStyle(document.body).fontFamily.slice(0, 42)));
  step('panel title matches body', await page.evaluate(() => {
    const el = document.querySelector('.panel-title');
    return el ? getComputedStyle(el).fontFamily === getComputedStyle(document.body).fontFamily : 'n/a';
  }));

  // --- topbar clusters present + overflow not clipping dropdowns ---
  step('topbar clusters', await page.evaluate(() => document.querySelectorAll('.topbar-cluster').length));
  step('cluster overflow visible', await page.evaluate(() => {
    const c = document.querySelector('.topbar-cluster');
    return c ? getComputedStyle(c).overflow : 'missing';
  }));

  // --- language dropdown opens from topbar icon ---
  await page.locator('.cluster-icons .icon-btn').first().click();
  await sleep(300);
  step('language menu opens', await page.locator('.cluster-icons .menu').count() > 0);
  await page.keyboard.press('Escape');
  await sleep(200);

  // --- particles empty state: no auto-run, just hint ---
  await page.locator('.plugin-item', { hasText: 'Particles' }).click();
  await sleep(1200);
  let s = await sample();
  step('particles empty does NOT auto-run', !hasColor(s, '59,130,246'));
  step('run button label (idle)', (await runLabel()).trim());

  // --- attempt run with no data -> toast, still idle ---
  await page.locator('.param-panel button.btn-block').first().click();
  await sleep(500);
  step('run button stays idle without data', (await runLabel()).trim());
  step('warning toast shown', await page.locator('.toast-warning').count() > 0);
  await sleep(4200);

  // --- load galaxy.dat -> teal dots (static) ---
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例数据' }).click();
  await sleep(400);
  await loadExample('星系');
  await sleep(1600);
  s = await sample();
  step('particles galaxy has teal dots (static)', hasColor(s, '45,212,191'));
  step('run button still idle after load', (await runLabel()).trim());
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/fix-02-particles-galaxy.png' });

  // --- press Run -> simulation starts ---
  await page.locator('.param-panel button.btn-block').first().click();
  await sleep(700);
  step('run button label (running)', (await runLabel()).trim());

  // --- point cloud empty state (grid + hint, no crash) ---
  await page.locator('.plugin-item', { hasText: 'Point Cloud' }).click();
  await sleep(1200);
  s = await sample();
  step('pointcloud empty canvas renders', s.top.length > 0);
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/fix-03-pointcloud-empty.png' });

  // --- load diamond.xyz -> blue points, auto-fit ---
  await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例数据' }).click();
  await sleep(400);
  await loadExample('斐波那契');
  await sleep(1600);
  s = await sample();
  step('pointcloud diamond has blue points', hasColor(s, '37,99,235'));
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/fix-04-pointcloud-diamond.png' });

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  await browser.close();
  server.kill();
})().catch((e) => {
  console.error('VERIFY FAILED:', e);
  process.exit(1);
});