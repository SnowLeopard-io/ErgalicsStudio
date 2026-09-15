// ==========================================================================
// Research-modules E2E: experiment tracking → lineage → figure studio →
// supplement packaging → notebook.
// ==========================================================================
//
// Mirrors the other verify-* scripts (playwright-core + shared harness).
// Each stage is recorded; a stage failure is logged and the script moves on,
// so one flaky step does not hide the state of the remaining stages.
//
//   node scripts/verify-research.mjs
//
import { chromium } from 'playwright-core';
import { startPreview, launchOptions, shot, sleep, createReporter } from './_harness.mjs';

const server = await startPreview(4173);
const report = createReporter();
const errors = [];

let browser;
try {
  browser = await chromium.launch({
    ...launchOptions(),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(`${server.url}/#/`, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.locator('.welcome-enter').click().catch(() => {});
  await sleep(1500);
  report.step('workbench reached', await page.evaluate(() => !!document.querySelector('.topbar')));

  // ---- stage 1: research menu + experiment history -------------------------
  try {
    await page.getByRole('button', { name: /科研|Research/ }).first().click();
    await sleep(300);
    await page.getByText(/实验记录|Run history/i).first().click();
    await sleep(500);
    const runsDialog = await page.locator('.modal').count();
    report.step('run-history dialog opens', runsDialog > 0);
    await page.screenshot({ path: shot('research-01-runs.png') });
    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (err) {
    errors.push(`[runs] ${err.message}`);
  }

  // ---- stage 2: lineage dialog ---------------------------------------------
  try {
    await page.getByRole('button', { name: /科研|Research/ }).first().click();
    await sleep(300);
    await page.getByText(/数据血缘|Data Lineage/i).first().click();
    await sleep(500);
    const lineage = await page.evaluate(() =>
      !!document.querySelector('.lineage-svg') || !!document.querySelector('.lineage-empty'),
    );
    report.step('lineage dialog renders', lineage);
    await page.screenshot({ path: shot('research-02-lineage.png') });
    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (err) {
    errors.push(`[lineage] ${err.message}`);
  }

  // ---- stage 3: figure studio ----------------------------------------------
  try {
    await page.goto(`${server.url}/#/figures`, { waitUntil: 'domcontentloaded' });
    await sleep(800);
    await page.getByRole('button', { name: /新建图表|New figure/i }).first().click();
    await sleep(400);
    await page.getByRole('button', { name: /添加面板|Add panel/i }).first().click();
    await sleep(300);
    await page.locator('#panel-data').fill('0,1\n1,3\n2,2\n3,5');
    await page.getByRole('button', { name: /确定|OK/i }).click();
    await sleep(500);
    const panels = await page.locator('.figures-panel-item').count();
    report.step('figure panel added', panels);
    const svg = await page.evaluate(() => !!document.querySelector('.figures-preview-svg svg'));
    report.step('composed svg preview', svg);
    // Export SVG → expect a download event.
    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await page.getByRole('button', { name: 'SVG', exact: true }).click();
    const download = await downloadPromise;
    report.step('svg download', download.suggestedFilename());
    await page.screenshot({ path: shot('research-03-figures.png') });
  } catch (err) {
    errors.push(`[figures] ${err.message}`);
  }

  // ---- stage 4: supplement packaging ---------------------------------------
  try {
    await page.goto(`${server.url}/#/workbench`, { waitUntil: 'domcontentloaded' });
    await sleep(800);
    await page.getByRole('button', { name: /科研|Research/ }).first().click();
    await sleep(300);
    await page.getByText(/补充材料|Supplementary/i).first().click();
    await sleep(500);
    const formOpen = await page.evaluate(() => !!document.querySelector('.supplement-form'));
    report.step('supplement dialog opens', formOpen);
    await page.locator('#supplement-author').fill('E2E Bot');
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /打包并下载|Package & download/i }).click();
    const download = await downloadPromise;
    report.step('supplement zip download', download.suggestedFilename());
  } catch (err) {
    errors.push(`[supplement] ${err.message}`);
  }

  // ---- stage 5: notebook -----------------------------------------------------
  try {
    await page.goto(`${server.url}/#/notebook`, { waitUntil: 'domcontentloaded' });
    await sleep(800);
    await page.getByRole('button', { name: '+ PY', exact: true }).first().click();
    await sleep(300);
    await page.locator('.nb-source-code').fill("print('hello notebook')");
    await page.getByRole('button', { name: /运行|Run/i }).first().click();
    // Pyodide boots from CDN on first run — generous budget.
    const stdout = await page
      .locator('.nb-out-stdout')
      .filter({ hasText: 'hello notebook' })
      .waitFor({ timeout: 120_000 });
    report.step('notebook cell output', stdout ? 'hello notebook' : null);
    await page.screenshot({ path: shot('research-04-notebook.png') });
  } catch (err) {
    errors.push(`[notebook] ${err.message}`);
  }

  const failed = report.finish(errors);
  process.exitCode = failed > 0 ? 1 : 0;
} catch (err) {
  console.error('VERIFY FAILED:', err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.stop();
}
