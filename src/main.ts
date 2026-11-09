import './style.css';
import { autopilot } from './core/autopilot';
import { ThermalField, type Wind } from './core/field';
import { SCENARIOS, generateField, type Scenario } from './core/generator';
import { Sim } from './core/sim';
import { VarioAudio } from './audio/vario';
import { WorldRenderer } from './render/world';

function $<T extends Element>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el as unknown as T;
}

const canvas = $<HTMLCanvasElement>('#world');
const params = new URLSearchParams(location.search);
const demoMode = params.has('demo');
const warpSeconds = Number(params.get('warp') ?? '0');
const startHidden = params.has('hidden');
const brakeL = $<HTMLInputElement>('#brakeL');
const brakeR = $<HTMLInputElement>('#brakeR');
const altEl = $<HTMLElement>('#alt');
const zoneEl = $<HTMLElement>('#zone');
const clockEl = $<HTMLElement>('#clock');
const varioEl = $<HTMLElement>('#vario');
const windArrow = $<HTMLElement>('#windArrow');
const windText = $<HTMLElement>('#windText');
const ladderFill = $<HTMLElement>('#ladderFill');
const ladderMark = $<HTMLElement>('#ladderMark');
const hintEl = $<HTMLElement>('#hint');
const debugEl = $<HTMLElement>('#debug');
const overlay = $<HTMLElement>('#overlay');
const endOverlay = $<HTMLElement>('#endOverlay');
const endKicker = $<HTMLElement>('#endKicker');
const endTitle = $<HTMLElement>('#endTitle');
const endText = $<HTMLElement>('#endText');
const endStats = $<HTMLElement>('#endStats');
const visBtn = $<HTMLButtonElement>('#btnVis');
const visIcon = $<HTMLElement>('#visIcon');
const visLabel = $<HTMLElement>('#visLabel');
const soundBtn = $<HTMLButtonElement>('#btnSound');
const scenariosEl = $<HTMLElement>('#scenarios');
const soundStatus = $<HTMLElement>('#soundStatus');
const btnSoundTest = $<HTMLButtonElement>('#btnSoundTest');
const rewardOverlay = $<HTMLElement>('#rewardOverlay');
const rewardIntro = $<HTMLElement>('#rewardIntro');
const rewardQr = $<HTMLImageElement>('#rewardQr');
const rewardFallback = $<HTMLElement>('#rewardFallback');
const rewardTabs = $<HTMLElement>('#rewardTabs');
const rewardNote = $<HTMLElement>('#rewardNote');
const rewardShare = $<HTMLButtonElement>('#rewardShare');
const rewardStar = $<HTMLAnchorElement>('#rewardStar');

const REWARD = {
  wechat: `${import.meta.env.BASE_URL}reward/wechat.png`,
  alipay: `${import.meta.env.BASE_URL}reward/alipay.png`,
  repo: 'https://github.com/youngthomas37-beep/ThermalCoreHunt-M1.5',
};
const REWARD_TEXT = {
  tip: 'Thermal Core Hunt 是免费、无广告的个人项目。如果它帮你找到了气流，欢迎请作者喝杯咖啡；不打赏也没关系，玩得开心就好。',
  support: 'Thermal Core Hunt 是免费、无广告的个人项目。如果它帮你找到了气流，欢迎给仓库点个 Star，或把游戏分享给朋友。',
};

const renderer = new WorldRenderer(canvas);
renderer.resize();
const audio = new VarioAudio();
const keys = { left: false, right: false };

let scenario: Scenario = SCENARIOS[1];
let wind: Wind = { speed: 0, dir: 0 };
let sim: Sim | null = null;
let currentSeed = 0;
let phase: 'menu' | 'flying' | 'won' | 'lost' = 'menu';
let hidden = false;
let debug = false;
let lastInput = performance.now();
let idleStage = 0;
let hintTimer = 0;
let acc = 0;
let last = performance.now();

const ZONES = ['内环', '中环', '外环'] as const;
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const;

function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

function newRun(): void {
  const seed = randomSeed();
  currentSeed = seed;
  const gen = generateField(seed, scenario, wind);
  const field = new ThermalField(gen.thermals, gen.wind, scenario.startZ);
  sim = new Sim({
    field,
    start: { x: gen.start.x, y: gen.start.y, psi: gen.start.psi, z: scenario.startZ },
    cloudbase: scenario.cloudbase,
    mode: 'fixed',
    seed,
  });
  renderer.resetCamera();
  renderer.prepare(sim);

  phase = 'flying';
  hidden = startHidden;
  idleStage = 0;
  lastInput = performance.now();
  acc = 0;
  last = performance.now();
  overlay.classList.add('hidden');
  endOverlay.classList.add('hidden');
  hint(null);
  updateVis();

  if (demoMode && warpSeconds > 0) {
    const steps = Math.round(warpSeconds / sim.dt);
    for (let i = 0; i < steps && sim.state === 'flying'; i++) {
      const u = autopilot(sim);
      sim.step(u.uL, u.uR);
    }
  }
}

function updateVis(): void {
  visBtn.setAttribute('aria-pressed', String(!hidden));
  visIcon.textContent = hidden ? '🙈' : '👁';
  visLabel.textContent = hidden ? '气流图 关' : '气流图 开';
}

function hint(text: string | null): void {
  if (!text) {
    hintEl.classList.add('hidden');
    return;
  }
  hintEl.textContent = text;
  hintEl.classList.remove('hidden');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hintEl.classList.add('hidden'), 5000);
}

function readInput(): { uL: number; uR: number } {
  let uL = Number(brakeL.value);
  let uR = Number(brakeR.value);
  if (keys.left) uL = 1;
  if (keys.right) uR = 1;
  return { uL, uR };
}

/**
 * 按住转弯、松开回中。
 * 原生 range 只负责显示；指针事件绑在外层容器上，
 * 这样按住轨道任意深度都能转弯，松手立刻归零。
 */
function setupBrake(el: HTMLElement, input: HTMLInputElement): void {
  let active: number | null = null;

  const setFromPointer = (e: PointerEvent): void => {
    const r = input.getBoundingClientRect();
    if (r.height < 1) return;
    const v = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    input.value = String(v);
    el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    lastInput = performance.now();
    idleStage = 0;
  };

  const release = (): void => {
    if (active === null) return;
    active = null;
    el.classList.remove('holding');
    input.value = '0';
    el.setAttribute('aria-valuenow', '0');
    lastInput = performance.now();
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 某些浏览器在 pointerdown 外调用会抛错，忽略 */
    }
    el.classList.add('holding');
    setFromPointer(e);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    setFromPointer(e);
    e.preventDefault();
  });

  const end = (e: PointerEvent): void => {
    if (e.pointerId === active) release();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

setupBrake($<HTMLElement>('.brake.left'), brakeL);
setupBrake($<HTMLElement>('.brake.right'), brakeR);

function updateHud(): void {
  if (!sim) return;
  const z = sim.glider.z;
  altEl.textContent = String(Math.round(z));
  const t = Math.floor(sim.t);
  clockEl.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

  const v = sim.varioOut;
  varioEl.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  varioEl.className = v > 0.25 ? 'up' : v < -0.25 ? 'down' : '';

  const near = sim.field.nearest(sim.glider.x, sim.glider.y);
  let zone = 2;
  if (!hidden && near) {
    const peak = sim.field.peakAt(near.thermal, sim.mode === 'fixed' ? sim.startZ : z, sim.mode === 'fixed');
    const ratio = sim.wHere / Math.max(0.2, peak);
    zone = ratio > 0.75 ? 0 : ratio > 0.35 ? 1 : 2;
  }
  if (hidden) {
    zoneEl.textContent = '—';
    zoneEl.className = '';
  } else {
    zoneEl.textContent = ZONES[zone];
    zoneEl.className = `z${zone}`;
  }

  const frac = Math.max(0, Math.min(1, z / sim.cloudbase));
  ladderFill.style.height = `${frac * 100}%`;
  ladderMark.style.bottom = `${frac * 100}%`;

  if (wind.speed < 0.1) {
    windArrow.textContent = '·';
    windArrow.style.transform = 'rotate(0deg)';
    windText.textContent = '无风';
  } else {
    windArrow.textContent = '↑';
    windArrow.style.transform = `rotate(${(wind.dir * 180) / Math.PI}deg)`;
    windText.textContent = `${wind.speed} m/s ${DIRS[Math.round(wind.dir / (Math.PI / 4)) % 8]}`;
  }

  if (debug) {
    const g = sim.glider;
    debugEl.textContent = [
      `seed   ${currentSeed}`,
      `w      ${sim.wHere.toFixed(2)} m/s`,
      `vario  ${sim.varioOut.toFixed(2)} m/s`,
      `bank   ${((g.phi * 180) / Math.PI).toFixed(0)}°`,
      `speed  ${g.v.toFixed(1)} m/s`,
      `drift  ${sim.field.driftX.toFixed(0)}, ${sim.field.driftY.toFixed(0)}`,
      `therm  ${sim.field.thermals.length}`,
      `z/cloud ${z.toFixed(0)}/${sim.cloudbase}`,
    ].join('\n');
  }
}

function endRun(kind: 'won' | 'lost', reason: string): void {
  if (!sim || phase !== 'flying') return;
  phase = kind;
  endOverlay.classList.remove('hidden');
  const secs = Math.round(sim.t);
  const used = sim.thermalEntries;

  if (kind === 'won') {
    endKicker.textContent = '☁ 云底';
    endTitle.textContent = '通关';
    endText.textContent =
      '你在云底停留了 10 秒。彩蛋：一只鹰从云里掠过——现实飞行中，请远离云体、严禁入云。';
  } else {
    endKicker.textContent = reason === '超时' ? '超时' : '触地';
    endTitle.textContent = reason === '超时' ? '本局结束' : '落地了';
    endText.textContent = reason === '超时' ? '两分钟没有操作，本局自动结束。' : '高度归零，下一次记得早点找到气流。';
  }

  endStats.innerHTML = [
    `<div>滞空<b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b></div>`,
    `<div>最高高度<b>${Math.round(sim.maxZ)} m</b></div>`,
    `<div>热气流<b>${used} 个</b></div>`,
    `<div>云底<b>${sim.cloudbase} m</b></div>`,
  ].join('');
}

function setWind(speed: number, dir: number): void {
  wind.speed = speed;
  wind.dir = dir;
  document.querySelectorAll<HTMLButtonElement>('.speeds button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.speed) === speed);
  });
  document.querySelectorAll<HTMLButtonElement>('.wgrid button').forEach((b) => {
    const d = b.dataset.dir;
    b.classList.toggle('active', d === 'calm' ? speed === 0 : speed > 0 && Number(d) === Math.round((dir * 180) / Math.PI) % 360);
  });
}

function selectScenario(s: Scenario): void {
  scenario = s;
  scenariosEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.id === s.id);
  });
}

for (const s of SCENARIOS) {
  const b = document.createElement('button');
  b.dataset.id = s.id;
  b.innerHTML = `${s.name}<small>${s.startZ} → ${s.cloudbase} m</small>`;
  b.addEventListener('click', () => selectScenario(s));
  scenariosEl.appendChild(b);
}
selectScenario(scenario);

document.querySelectorAll<HTMLButtonElement>('.speeds button').forEach((b) => {
  b.addEventListener('click', () => setWind(Number(b.dataset.speed), wind.dir));
});

document.querySelectorAll<HTMLButtonElement>('.wgrid button').forEach((b) => {
  b.addEventListener('click', () => {
    const d = b.dataset.dir;
    if (!d) return;
    if (d === 'calm') {
      setWind(0, wind.dir);
    } else {
      const rad = (Number(d) * Math.PI) / 180;
      setWind(wind.speed > 0 ? wind.speed : 2, rad);
    }
  });
});
setWind(0, 0);

$<HTMLButtonElement>('#btnStart').addEventListener('click', () => {
  void audio.start().then(() => {
    soundStatus.textContent = audio.running ? '声音已开启' : '声音被拦截，请再点一次';
  });
  newRun();
  window.setTimeout(() => {
    if (!audio.running) hint('如果听不到声音：请关闭手机静音键，再点一下屏幕');
  }, 700);
});

$<HTMLButtonElement>('#btnAgain').addEventListener('click', () => newRun());

visBtn.addEventListener('click', () => {
  hidden = !hidden;
  updateVis();
});

$<HTMLButtonElement>('#btnReset').addEventListener('click', () => {
  if (phase === 'flying' || phase === 'won' || phase === 'lost') newRun();
});

soundBtn.addEventListener('click', () => {
  audio.setEnabled(!audio.enabled);
  soundBtn.textContent = audio.enabled ? '🔊' : '🔇';
  if (audio.enabled) void audio.start();
});

btnSoundTest.addEventListener('click', async () => {
  soundStatus.textContent = '正在测试…';
  const ok = await audio.test();
  soundStatus.textContent = ok ? '声音已开启' : '被浏览器拦截，请再点一次';
});

$<HTMLButtonElement>('#btnDebug').addEventListener('click', () => {
  debug = !debug;
  debugEl.classList.toggle('hidden', !debug);
});

type RewardChannel = 'wechat' | 'alipay';
const rewardReady: Record<RewardChannel, boolean | null> = { wechat: null, alipay: null };
let rewardProbe: Promise<void> | null = null;

function probeReward(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function setRewardFallback(on: boolean): void {
  rewardFallback.classList.toggle('hidden', !on);
  rewardQr.classList.toggle('hidden', on);
  rewardNote.classList.toggle('hidden', on);
}

function setRewardChannel(ch: RewardChannel): void {
  rewardTabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const c: RewardChannel = b.dataset.channel === 'alipay' ? 'alipay' : 'wechat';
    b.classList.toggle('active', c === ch);
    b.disabled = rewardReady[c] === false;
  });
  rewardQr.classList.remove('hidden');
  rewardFallback.classList.add('hidden');
  rewardNote.classList.remove('hidden');
  rewardQr.src = ch === 'wechat' ? REWARD.wechat : REWARD.alipay;
}

function prepareReward(): Promise<void> {
  if (rewardProbe) return rewardProbe;
  rewardProbe = (async () => {
    const [w, a] = await Promise.all([probeReward(REWARD.wechat), probeReward(REWARD.alipay)]);
    rewardReady.wechat = w;
    rewardReady.alipay = a;
    if (!w && !a) {
      rewardTabs.classList.add('hidden');
      rewardNote.classList.add('hidden');
      rewardIntro.textContent = REWARD_TEXT.support;
      const label = rewardFallback.querySelector('b');
      if (label) label.textContent = '支持这个项目';
      const detail = rewardFallback.querySelector('span');
      if (detail) detail.textContent = '给仓库点个 Star，或把游戏分享给朋友，就是很大的支持。';
      setRewardFallback(true);
      return;
    }
    rewardIntro.textContent = REWARD_TEXT.tip;
    rewardTabs.classList.remove('hidden');
    rewardNote.classList.remove('hidden');
    setRewardChannel(w ? 'wechat' : 'alipay');
  })();
  return rewardProbe;
}

function openReward(): void {
  rewardOverlay.classList.remove('hidden');
  rewardTabs.classList.add('hidden');
  rewardNote.classList.add('hidden');
  setRewardFallback(true);
  const label = rewardFallback.querySelector('b');
  if (label) label.textContent = '正在准备…';
  void prepareReward().then(() => {
    if (!rewardReady.wechat && !rewardReady.alipay) {
      const b = rewardFallback.querySelector('b');
      if (b) b.textContent = '支持这个项目';
    }
  });
}

function closeReward(): void {
  rewardOverlay.classList.add('hidden');
}

$<HTMLButtonElement>('#btnReward').addEventListener('click', openReward);
$<HTMLButtonElement>('#btnRewardClose').addEventListener('click', closeReward);
rewardOverlay.addEventListener('click', (e) => {
  if (e.target === rewardOverlay) closeReward();
});
rewardTabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
  b.addEventListener('click', () => {
    setRewardChannel(b.dataset.channel === 'alipay' ? 'alipay' : 'wechat');
  });
});
rewardQr.addEventListener('load', () => setRewardFallback(false));
rewardQr.addEventListener('error', () => setRewardFallback(true));
rewardStar.href = REWARD.repo;

rewardShare.addEventListener('click', async () => {
  const url = location.href.split('?')[0];
  const data = {
    title: 'Thermal Core Hunt',
    text: '听蜂鸣找热气流，盘到云底。',
    url,
  };
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch {
      /* 用户取消，退回复制 */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    rewardShare.textContent = '链接已复制';
  } catch {
    rewardShare.textContent = '复制失败，请手动复制';
  }
  window.setTimeout(() => {
    rewardShare.textContent = '分享给朋友';
  }, 1800);
});


window.addEventListener('keydown', (e) => {
  lastInput = performance.now();
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    keys.left = true;
    e.preventDefault();
  } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    keys.right = true;
    e.preventDefault();
  } else if (e.key === 'h' || e.key === 'H') {
    hidden = !hidden;
    updateVis();
  } else if (e.key === 'r' || e.key === 'R') {
    if (phase !== 'menu') newRun();
  } else if (e.key === 'm' || e.key === 'M') {
    soundBtn.click();
  } else if (e.key === 'Escape') {
    closeReward();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
});

window.addEventListener('pointerdown', () => {
  lastInput = performance.now();
  idleStage = 0;
  if (!audio.running) void audio.start();
});

window.addEventListener('resize', () => {
  renderer.resize();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.suspend();
  } else {
    last = performance.now();
    if (phase === 'flying') audio.resume();
  }
});

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (phase === 'flying' && sim) {
    const idle = now - lastInput;
    if (idle > 120000) {
      endRun('lost', '超时');
    } else if (idle > 45000) {
      if (idleStage < 2) {
        idleStage = 2;
        hint('无操作 45 秒：自动驾驶演示中，任意操作可接管');
      }
    } else if (idle > 20000) {
      if (idleStage < 1) {
        idleStage = 1;
        hint('无操作 20 秒：45 秒后自动演示，2 分钟结束');
      }
    }

    if (phase === 'flying') {
      const auto = demoMode || idleStage === 2;
      acc += dt;
      let guard = 0;
      while (acc >= sim.dt && guard < 16 && sim.state === 'flying') {
        const u = auto ? autopilot(sim) : readInput();
        sim.step(u.uL, u.uR);
        acc -= sim.dt;
        guard++;
      }
      audio.update(sim.varioOut);
      if (sim.state === 'won') endRun('won', '');
      else if (sim.state === 'lost') endRun('lost', '');
    }
  }

  if (sim) {
    renderer.render(sim, { hidden, debug });
    updateHud();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

if (demoMode) {
  overlay.classList.add('hidden');
  newRun();
}

declare global {
  interface Window {
    __tch?: {
      sim: () => Sim | null;
      audio: VarioAudio;
      phase: () => string;
      renderer: WorldRenderer;
    };
  }
}

window.__tch = { sim: () => sim, audio, phase: () => phase, renderer };
