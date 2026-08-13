const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
(async () => {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4174'], { cwd: process.cwd(), stdio: 'ignore', detached: true });
  server.unref();
  await new Promise(r => setTimeout(r, 3500));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:4174/#/workbench', { waitUntil: 'networkidle' });
  await new Promise(r => setTimeout(r, 2000));
  const info = await page.evaluate(() => {
    const h = document.querySelector('.central-plugin-host');
    if (!h) return 'missing host';
    const b = getComputedStyle(h, '::before');
    return JSON.stringify({
      bgImage: b.backgroundImage,
      bgPos: b.backgroundPosition,
      content: b.content,
      w: b.width, h: b.height, top: b.top, left: b.left
    });
  });
  console.log('BEFORE:', info);
  console.log('ERRORS:', errors.join('\n') || '(none)');
  await browser.close();
  server.kill();
})();