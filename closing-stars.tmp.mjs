import { chromium } from 'playwright-core';

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
} catch { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.locator('section.closing').scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
await page.locator('section.closing').screenshot({ path: `${process.env.TEMP}\\closing-stars.png` });
const errs = await page.evaluate(() => document.querySelector('.closing .bh-fallback')?.getAttribute('data-error') ?? 'ok');
console.log('fallback/error:', errs);
await browser.close();
console.log('done');
