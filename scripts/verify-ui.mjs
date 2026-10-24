// Post-redesign verification: functional regressions + layout geometry checks.
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, shot, sleep } from './_harness.mjs';

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
  const step = (l, v) => out.push(`${l}: ${JSON.stringify(v)}`);

  await page.goto(`${server.url}/#/`, { waitUntil: 'networkidle' });
  await sleep(1200);

  // Welcome layout geometry
  step('welcome accent color', await page.evaluate(() => {
    const b = document.querySelector('.welcome-enter');
    return b ? getComputedStyle(b).backgroundColor : 'missing';
  }));
  step('welcome title size', await page.evaluate(() => {
    const el = document.querySelector('.welcome-title');
    return el ? getComputedStyle(el).fontSize : 'missing';
  }));
  step('signal line present', await page.evaluate(() => !!document.querySelector('.welcome-signal')));
  const heroBox = await page.locator('.welcome-hero').boundingBox();
  const hwBox = await page.locator('.welcome-hardware').boundingBox();
  step('hero & hardware visible', { hero: !!heroBox, hardware: !!hwBox });
  step('hero centered', heroBox ? Math.abs(heroBox.x + heroBox.width / 2 - 720) < 60 : 'n/a');

  await page.screenshot({ path: shot('new-01-welcome.png') });

  await page.locator('.welcome-enter').click();
  await sleep(2000);

  // Workbench layout
  step('topbar height', await page.evaluate(() => {
    const t = document.querySelector('.topbar');
    return t ? t.getBoundingClientRect().height : 'missing';
  }));
  step('sidebar width', await page.evaluate(() => {
    const s = document.querySelector('.sidebar');
    return s ? s.getBoundingClientRect().width : 'missing';
  }));
  step('right panel width', await page.evaluate(() => {
    const r = document.querySelector('.right-panel');
    return r ? r.getBoundingClientRect().width : 'missing';
  }));
  const cb = await page.locator('.central').boundingBox();
  step('central area', cb);
  step('scope corners', await page.evaluate(() => {
    const h = document.querySelector('.central');
    if (!h) return 'missing';
    const before = getComputedStyle(h, '::before');
    const after = getComputedStyle(h, '::after');
    return JSON.stringify({
      corners: before.backgroundImage !== 'none' ? 'present' : 'none',
      scanline: after.backgroundImage !== 'none' ? 'present' : 'none',
    });
  }));
  step('canvas visible', await page.evaluate(() => {
    const c = document.querySelector('.central-canvas');
    if (!c) return 'missing';
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, hidden: r.width === 0 || r.height === 0 };
  }));

  // activate first plugin, check panel + slider styling
  await page.locator('.plugin-item').first().click();
  await sleep(900);
  step('plugin items', await page.locator('.plugin-item').count());
  step('param value mono color', await page.evaluate(() => {
    const v = document.querySelector('.param-value');
    return v ? getComputedStyle(v).fontFamily.slice(0, 12) + ' / ' + getComputedStyle(v).color : 'missing';
  }));

  await page.screenshot({ path: shot('new-02-workbench.png') });

  // Open plugin dialog screenshot
  await page.locator('.sidebar-group .btn').first().click();
  await sleep(400);
  await page.screenshot({ path: shot('new-03-dialog.png') });
  await page.keyboard.press('Escape');
  await sleep(300);

  await page.goto(`${server.url}/#/settings`, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  await page.screenshot({ path: shot('new-04-settings.png') });

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
} catch (err) {
  console.error('VERIFY FAILED:', err);
  console.error('errors so far:', errors.join('\n'));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}