import puppeteer from 'puppeteer-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.argv[2] ?? 'http://127.0.0.1:5199/', { waitUntil: 'networkidle0', timeout: 30000 });

await page.screenshot({ path: 'D:/Users/lenovo/Documents/deepseek-harness/default-workspace/docs/m-start-new.png' });

const testSound = await page.evaluate(async () => {
  const before = window.__tch.audio.beeps;
  const ok = await window.__tch.audio.test();
  return { ok, before, after: window.__tch.audio.beeps, state: window.__tch.audio.state };
});

await page.click('#btnStart');
await sleep(1200);
const audio = await page.evaluate(() => ({
  state: window.__tch.audio.state,
  beeps: window.__tch.audio.beeps,
  status: document.querySelector('#soundStatus')?.textContent,
  phase: window.__tch.phase(),
}));

const box = await (await page.$('.brake.right')).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
await page.mouse.down();
await sleep(700);
const held = await page.evaluate(() => ({
  value: document.querySelector('#brakeR').value,
  phi: window.__tch.sim().glider.phi,
  cls: document.querySelector('.brake.right').className,
  zone: document.querySelector('#zone').textContent,
}));
await page.screenshot({ path: 'D:/Users/lenovo/Documents/deepseek-harness/default-workspace/docs/m-brake-hold.png' });
await page.mouse.up();
await sleep(500);
const released = await page.evaluate(() => ({
  value: document.querySelector('#brakeR').value,
  phi: window.__tch.sim().glider.phi,
  cls: document.querySelector('.brake.right').className,
}));

await page.click('#btnReward');
await sleep(500);
const reward = await page.evaluate(() => ({
  open: !document.querySelector('#rewardOverlay').classList.contains('hidden'),
  fallback: !document.querySelector('#rewardFallback').classList.contains('hidden'),
  qrHidden: document.querySelector('#rewardQr').classList.contains('hidden'),
  tabs: document.querySelectorAll('#rewardTabs button').length,
  tabsHidden: document.querySelector('#rewardTabs').classList.contains('hidden'),
  noteHidden: document.querySelector('#rewardNote').classList.contains('hidden'),
  label: document.querySelector('#rewardFallback b').textContent,
  star: document.querySelector('#rewardStar').getAttribute('href'),
}));
await page.screenshot({ path: 'D:/Users/lenovo/Documents/deepseek-harness/default-workspace/docs/m-reward.png' });
await page.click('#btnRewardClose');

console.log(JSON.stringify({ errors, testSound, audio, held, released, reward }, null, 2));
await browser.close();
