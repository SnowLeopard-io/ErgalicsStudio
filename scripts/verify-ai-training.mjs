// E2E checks for the AI Training plugin (example.ai-training):
// 1. The plugin activates and exposes its hyperparameter panel.
// 2. Samples load from the global sample dialog (Load Sample button was removed).
// 3. "Train" actually runs TF.js in the browser and paints a live loss curve.
// 4. Switching the model resets hyperparameters to that model's defaults
//    (notably MNIST must not inherit a 200+ epoch budget).
// 5. Logistic regression renders a decision boundary.
// 6. MNIST CNN trains and renders a grid of digit thumbnails (not blobs).
// 7. No console errors along the way.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOTS = 'C:/Users/HUAWEI/AppData/Local/Temp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', '4199'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true },
  );
  server.unref();
  await sleep(3500);

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  const out = [];
  const step = (l, v) => out.push(`${l}: ${JSON.stringify(v)}`);

  const canvasStats = () =>
    page.evaluate(() => {
      const c = document.querySelector('.central-canvas');
      if (!c) return { distinct: 0, painted: 0 };
      const g = c.getContext('2d');
      const { width: w, height: h } = c;
      const data = g.getImageData(0, 0, w, h).data;
      const colors = new Set();
      let painted = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        painted++;
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return { distinct: colors.size, painted };
    });

  const paramValue = (label) =>
    page.evaluate((lbl) => {
      const fields = [...document.querySelectorAll('.param-panel .field')];
      const f = fields.find((el) => el.querySelector('.field-label')?.textContent?.trim() === lbl);
      if (!f) return null;
      const input = f.querySelector('input, select');
      return input ? input.value : null;
    }, label);

  const setParam = (label, value) =>
    page.evaluate(
      ({ lbl, val }) => {
        const fields = [...document.querySelectorAll('.param-panel .field')];
        const f = fields.find((el) => el.querySelector('.field-label')?.textContent?.trim() === lbl);
        const input = f?.querySelector('input, select');
        if (!input) return;
        input.value = val;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { lbl: label, val: value },
    );

  const clickBtn = (text) => page.locator('.param-panel .btn', { hasText: text }).click();

  const loadExampleFromDialog = async (title) => {
    await page.locator('.topbar-cluster .cluster-btn', { hasText: '示例' }).click();
    await sleep(500);
    const card = page.locator('.plugin-card', { hasText: title });
    if ((await card.count()) === 0) throw new Error(`sample card not found: ${title}`);
    await card.locator('button', { hasText: '加载' }).click();
    await sleep(2000);
    await page.keyboard.press('Escape');
    await sleep(400);
  };

  // Activate the AI Trainer plugin. It is autoloaded into the sidebar registry
  // on startup (TF.js itself stays lazy until "Train" is clicked).
  const activateAITrainer = async () => {
    await page.locator('.plugin-item[data-plugin-id="example.ai-training"]').click();
    await sleep(1500);
  };

  await page.goto('http://localhost:4199/#/workbench', { waitUntil: 'networkidle' });
  await sleep(1500);

  // ---- 1. plugin activates and shows its panel ----
  await activateAITrainer();
  const labels = await page
    .locator('.param-panel .field-label')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  step('param labels', labels);
  step('has hyperparameter fields', ['模型', '学习率', '迭代次数', '批次大小'].every((l) => labels.includes(l)));
  step('linear default epochs = 200', await paramValue('迭代次数'));

  // ---- 2. load linear sample from the dialog, train ----
  await loadExampleFromDialog('AI 训练 · 线性回归');
  const cols = await paramValue('目标列');
  step('target column auto-filled after sample', cols);
  await setParam('迭代次数', '30');
  await sleep(400);
  await clickBtn('开始训练');
  await sleep(9000);
  let s = await canvasStats();
  step('after linear training', s);
  step('loss curve + fit drawn (many colors)', s.distinct > 5);
  await page.screenshot({ path: `${SHOTS}/ai-training-linear.png` });

  // ---- 3. model switch resets hyperparameters ----
  await setParam('模型', 'mnist');
  await sleep(1200);
  const mnistEpochs = await paramValue('迭代次数');
  const mnistLr = await paramValue('学习率');
  step('mnist epochs default', mnistEpochs);
  step('mnist lr default', mnistLr);
  step('mnist does not inherit dense-model epoch budget', Number(mnistEpochs) <= 20);
  step('target column hidden for mnist', (await paramValue('目标列')) === null);

  // ---- 4. logistic regression -> decision boundary ----
  await setParam('模型', 'logistic');
  await sleep(1000);
  await loadExampleFromDialog('AI 训练 · 逻辑回归');
  await setParam('迭代次数', '30');
  await sleep(300);
  await clickBtn('开始训练');
  await sleep(9000);
  s = await canvasStats();
  step('after logistic training', s);
  step('decision boundary drawn', s.painted > 1000 && s.distinct > 5);
  await page.screenshot({ path: `${SHOTS}/ai-training-logistic.png` });

  // ---- 5. MNIST CNN: load digits, train briefly, render digit grid ----
  await setParam('模型', 'mnist');
  await sleep(1000);
  await loadExampleFromDialog('AI 训练 · MNIST 分类');
  await setParam('迭代次数', '2');
  await sleep(300);
  await clickBtn('开始训练');
  // CNN on 200 28x28 images may fall back to CPU in headless mode: give it time.
  await sleep(45000);
  s = await canvasStats();
  step('after mnist training', s);
  step('mnist grid painted (many grayscale levels)', s.distinct > 20);
  await page.screenshot({ path: `${SHOTS}/ai-training-mnist.png` });

  out.push('=== ERRORS ===');
  out.push(errors.length ? errors.join('\n') : '(none)');
  console.log(out.join('\n'));
  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error('VERIFY AI-TRAINING FAILED:', e);
  process.exit(1);
});
