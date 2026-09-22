// Full-R (webR) runtime verification: enter workbench → code mode → R
// language → engine badge must flip to the full-R label (webR booted), then a
// real R program must print to the console. On fallback it captures the raw
// import error behind the fallback notice.
// Usage: node scripts/verify-r-runtime.mjs [port]
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, shot, sleep } from './_harness.mjs';

const server = await startPreview(Number(process.argv[2] ?? 0) || 0, 'dev');
console.log('[verify-r] dev server at', server.url);

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...launchOptions(),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(`${server.url}/#/`, { waitUntil: 'networkidle' });
  await sleep(1000);

  await page.locator('.welcome-enter').click();
  await sleep(1500);
  for (let i = 0; i < 5; i += 1) {
    const skip = page.locator('.tour-tip-actions .btn', { hasText: '跳过' });
    if (await skip.count()) {
      await skip.first().click();
      break;
    }
    await sleep(300);
  }

  await page.locator('.mode-switch .mode-btn', { hasText: '代码' }).click();
  await sleep(2000);
  await page.locator('.code-editor-lang-toggle button', { hasText: /^R$/ }).click();

  // webR boot: first run vendors ~20 MB locally (fast) but init can still take
  // tens of seconds in a headless browser. Wait for the badge, or time out.
  const badge = page.locator('.be-code-lang');
  let booted = false;
  for (let i = 0; i < 180 && !booted; i += 1) {
    const t = (await badge.textContent().catch(() => '')) ?? '';
    if (/完整 R|full r/i.test(t)) booted = true;
    else await sleep(1000);
  }
  const badgeText = ((await badge.textContent().catch(() => '')) ?? '').trim();
  console.log('[verify-r] engine badge:', JSON.stringify(badgeText), '| webr booted:', booted);

  if (!booted) {
    // Capture the underlying import failure the fallback notice hid.
    const probe = await page.evaluate(async () => {
      const u = new URL('webr/webr.js', document.baseURI).href;
      try {
        const m = await import(/* @vite-ignore */ u);
        return 'import ok, exports: ' + Object.keys(m).slice(0, 8).join(',');
      } catch (err) {
        return 'import failed: ' + String(err?.message ?? err);
      }
    });
    console.log('[verify-r] direct import probe →', probe);
  }

  await page.locator('.code-editor-monaco .view-lines').click();
  await sleep(300);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('print("hello from webr")\nx <- c(1, 2, 3, 4, 5)\nprint(mean(x))');
  await sleep(800);
  const editorText = (await page.locator('.code-editor-monaco .view-lines').allTextContents().catch(() => [])).join('\n');
  console.log('[verify-r] editor text:', JSON.stringify(editorText.slice(0, 200)));

  const runBtn = page.locator('.block-editor-toolbar .be-run-btn');
  for (let i = 0; i < 60; i += 1) {
    if (!(await runBtn.isDisabled().catch(() => true))) break;
    await sleep(1000);
  }
  await runBtn.click();
  // mean(1..5) prints "[1] 3" — a marker that cannot appear in echoed source,
  // so a parse-error echo cannot fake a pass.
  let sawOutput = false;
  for (let i = 0; i < 60 && !sawOutput; i += 1) {
    const lines = await page.locator('.editor-console-text').allTextContents().catch(() => []);
    sawOutput = (lines ?? []).some((t) => /\[1\]\s*3\b/.test(t));
    if (!sawOutput) await sleep(1000);
  }
  const consoleText = await page.locator('.editor-console-text').allTextContents().catch(() => []);
  const errorText = (await page.locator('.block-editor-error').textContent().catch(() => '')) ?? '';
  console.log('[verify-r] console lines:', JSON.stringify(consoleText));
  console.log('[verify-r] error panel:', JSON.stringify(errorText.slice(0, 400)));
  console.log('[verify-r] R output received:', sawOutput);

  await page.screenshot({ path: shot('r-runtime.png') });

  const pass = booted && sawOutput;
  console.log(`[verify-r] ${pass ? 'PASS — full R runtime verified end-to-end' : 'FAIL'}`);
  console.log('=== ERRORS ===');
  console.log(errors.length ? errors.slice(0, 8).join('\n') : '(none)');
  if (!pass) process.exit(1);
} catch (err) {
  console.error('SMOKE FAILED:', err);
  console.error('errors so far:', errors.join('\n'));
  process.exit(1);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
