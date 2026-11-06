import puppeteer from 'puppeteer-core';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:5199/?demo=1&warp=40';
const out = process.argv[3] ?? 'shot.png';

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));

const info = await page.evaluate(() => {
  const t = window.__tch;
  const s = t?.sim();
  const g = s?.glider;
  return {
    hasHook: Boolean(t),
    phase: t?.phase(),
    audio: t?.audio.state,
    beeps: t?.audio.beeps,
    t: s ? Number(s.t.toFixed(2)) : null,
    vario: s ? Number(s.varioOut.toFixed(2)) : null,
    w: s ? Number(s.wHere.toFixed(2)) : null,
    alt: g ? Number(g.z.toFixed(0)) : null,
    pos: g ? [Number(g.x.toFixed(1)), Number(g.y.toFixed(1))] : null,
    bank: g ? Number(((g.phi * 180) / Math.PI).toFixed(1)) : null,
    thermals: s ? s.field.thermals.length : null,
    texAtPlayer: s && g ? t.renderer.sampleTex(g.x, g.y) : null,
    samples: s?.history.length ?? 0,
    canvas: [document.querySelector('#world')?.clientWidth, document.querySelector('#world')?.clientHeight],
  };
});

await page.screenshot({ path: out });
console.log(JSON.stringify({ errors, info }, null, 2));
await browser.close();
