const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
(async () => {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4175'], { cwd: process.cwd(), stdio: 'ignore', detached: true });
  server.unref();
  await new Promise(r => setTimeout(r, 3500));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await page.goto('http://localhost:4175/#/', { waitUntil: 'networkidle' });
  await new Promise(r => setTimeout(r, 1500));
  const info = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const btn = document.querySelector('.welcome-enter');
    const bg = getComputedStyle(document.querySelector('.welcome')).backgroundColor;
    const card = document.querySelector('.welcome-hardware');
    return JSON.stringify({
      accent: css.getPropertyValue('--color-accent').trim(),
      accentText: css.getPropertyValue('--color-accent-text').trim(),
      pageBg: bg,
      cardBg: card ? getComputedStyle(card).backgroundColor : 'missing',
      cardBorder: card ? getComputedStyle(card).borderColor : 'missing',
      btnBorder: btn ? getComputedStyle(btn).borderColor : 'missing',
      btnText: btn ? getComputedStyle(btn).color : 'missing',
    });
  });
  console.log('DARK:', info);
  await page.locator('.welcome-enter').click();
  await new Promise(r => setTimeout(r, 2000));
  const wb = await page.evaluate(() => {
    const top = getComputedStyle(document.querySelector('.topbar')).backgroundColor;
    const side = getComputedStyle(document.querySelector('.sidebar')).backgroundColor;
    const host = document.querySelector('.central-plugin-host');
    const canv = getComputedStyle(document.querySelector('.central')).backgroundColor;
    const active = document.querySelector('.plugin-item.active');
    return JSON.stringify({
      topbar: top, sidebar: side, central: canv,
      activeBg: active ? getComputedStyle(active).backgroundColor : 'none',
      activeBorder: active ? getComputedStyle(active).borderColor : 'none',
      hostW: host ? host.getBoundingClientRect().width : 'missing',
    });
  });
  console.log('WORKBENCH DARK:', wb);
  await page.screenshot({ path: 'C:/Users/HUAWEI/AppData/Local/Temp/opencode/shots/new-05-dark-workbench.png' });
  await browser.close();
  server.kill();
})();