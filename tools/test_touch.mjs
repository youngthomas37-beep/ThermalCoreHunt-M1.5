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
const client = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle0', timeout: 30000 });
const rect = await page.$eval('#btnStart', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] });
await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(1200);
const audio = await page.evaluate(() => ({
  state: window.__tch.audio.state,
  beeps: window.__tch.audio.beeps,
  phase: window.__tch.phase(),
}));

const b = await page.$eval('.brake.right', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, top: r.y, h: r.height };
});
const tx = b.x;
const ty = b.top + b.h * 0.8;
await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
await sleep(700);
const held = await page.evaluate(() => ({
  value: document.querySelector('#brakeR').value,
  phi: window.__tch.sim().glider.phi,
  cls: document.querySelector('.brake.right').className,
}));
await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const released = await page.evaluate(() => ({
  value: document.querySelector('#brakeR').value,
  phi: window.__tch.sim().glider.phi,
  cls: document.querySelector('.brake.right').className,
}));

console.log(JSON.stringify({ errors, audio, held, released }, null, 2));
await browser.close();
