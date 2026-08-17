// Inspect the Monaco current-line / selection colors as actually rendered.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4181'], {
  cwd: process.cwd(), stdio: 'ignore', detached: true,
});
server.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(3500);

let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:4181/#/', { waitUntil: 'networkidle' });
  await sleep(1000);
  await page.locator('.welcome-enter').click();
  await sleep(1500);
  await page.locator('.mode-switch .cluster-btn', { hasText: '代码' }).click();
  await sleep(3000);
  const surface = page.locator('.code-editor-monaco .view-lines');
  await surface.click();
  await sleep(500);

  const info = await page.evaluate(() => {
    // Collect every Monaco-generated theme rule mentioning common colors to
    // identify which theme is active.
    const want = ['current-line', 'background-color: rgb(30, 136, 229', 'editor-background', 'background-color: #0a0e13', 'background-color: #1E1E1E'];
    const hits = [];
    for (const sheet of document.styleSheets) {
      let rules = [];
      try {
        rules = sheet.cssRules ?? [];
      } catch {
        continue;
      }
      for (const rule of rules) {
        const css = rule.style?.cssText ?? '';
        if (css.includes('background') && (rule.selectorText ?? '').includes('monaco')) {
          hits.push({ sel: rule.selectorText.slice(0, 80), css: css.slice(0, 120) });
        }
      }
    }
    // dedupe by selector+color
    const seen = new Set();
    const uniq = hits.filter((h) => {
      const k = h.sel + '|' + h.css;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ruleCount: uniq.length, rules: uniq.slice(0, 40) };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/line-check.png' });
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}