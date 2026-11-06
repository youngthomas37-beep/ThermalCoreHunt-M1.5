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
    zone = ratio > 0.65 ? 0 : ratio > 0.3 ? 1 : 2;
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
  void audio.start();
  newRun();
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
});

$<HTMLButtonElement>('#btnDebug').addEventListener('click', () => {
  debug = !debug;
  debugEl.classList.toggle('hidden', !debug);
});

brakeL.addEventListener('input', () => {
  lastInput = performance.now();
});
brakeR.addEventListener('input', () => {
  lastInput = performance.now();
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
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
});

window.addEventListener('pointerdown', () => {
  lastInput = performance.now();
  idleStage = 0;
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
