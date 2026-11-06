/**
 * M1.5 物理校验：随机场、质量守恒、自动驾驶爬升、确定性与转弯几何。
 * 用法：pnpm sim
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { autopilot } from '../src/core/autopilot';
import { generateField, SCENARIOS } from '../src/core/generator';
import { ThermalField } from '../src/core/field';
import { Sim } from '../src/core/sim';
import { DEFAULT_GLIDER } from '../src/core/glider';

const scenario = SCENARIOS[1];
const seed = 12345;
const wind = { speed: 0, dir: 0 };
const gen = generateField(seed, scenario, wind);
const field = new ThermalField(gen.thermals, gen.wind, scenario.startZ);

const imbalance = field.massImbalance(scenario.startZ, true, 1600, 120);

function makeSim(): Sim {
  return new Sim({
    field,
    start: { x: gen.start.x, y: gen.start.y, psi: gen.start.psi, z: scenario.startZ },
    cloudbase: scenario.cloudbase,
    mode: 'fixed',
    seed,
  });
}

const sim = makeSim();
const dt = sim.dt;
const steps = Math.round(300 / dt);
let maxZ = sim.glider.z;
let entries = 0;
let was = false;
let liftSteps = 0;
let sumVario = 0;
let turned = 0;
let lastPsi = sim.glider.psi;

for (let i = 0; i < steps; i++) {
  const u = autopilot(sim);
  sim.step(u.uL, u.uR);
  const g = sim.glider;
  maxZ = Math.max(maxZ, g.z);
  if (sim.wHere > 0.6 && !was) {
    entries++;
    was = true;
  } else if (sim.wHere < 0.2) {
    was = false;
  }
  if (sim.wHere > 0.6) {
    liftSteps++;
    sumVario += sim.varioOut;
  }
  let d = g.psi - lastPsi;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  turned += Math.abs(d);
  lastPsi = g.psi;
}

const analytic = [15, 25, 45].map((deg) => {
  const phi = (deg * Math.PI) / 180;
  const v = 10;
  const radius = (v * v) / (9.80665 * Math.tan(phi));
  return {
    bankDeg: deg,
    radiusM: Number(radius.toFixed(1)),
    secondsPer360: Number(((2 * Math.PI * radius) / v).toFixed(1)),
    sink: Number(
      (
        DEFAULT_GLIDER.sink0 +
        DEFAULT_GLIDER.sinkA * (v - DEFAULT_GLIDER.vMinSink) ** 2 +
        DEFAULT_GLIDER.sinkB * (1 / Math.cos(phi) - 1)
      ).toFixed(2),
    ),
  };
});

function fingerprint(): string {
  const s = makeSim();
  for (let i = 0; i < 60 / s.dt; i++) {
    const u = autopilot(s);
    s.step(u.uL, u.uR);
  }
  return [s.glider.x, s.glider.y, s.glider.z, s.varioOut].map((v) => v.toFixed(6)).join('|');
}

const fp1 = fingerprint();
const fp2 = fingerprint();

const summary = {
  scenario: scenario.name,
  startZ: scenario.startZ,
  cloudbase: scenario.cloudbase,
  thermals: field.thermals.length,
  massImbalance: `${(imbalance * 100).toFixed(2)}%`,
  turnGeometry: analytic,
  flight: {
    durationS: 300,
    maxAltitudeM: Number(maxZ.toFixed(0)),
    gainM: Number((maxZ - scenario.startZ).toFixed(0)),
    thermalEntries: entries,
    liftPct: Number(((liftSteps / steps) * 100).toFixed(1)),
    meanVarioInLift: Number((sumVario / Math.max(1, liftSteps)).toFixed(2)),
    circles: Number((turned / (Math.PI * 2)).toFixed(1)),
    endAltitudeM: Number(sim.glider.z.toFixed(0)),
    state: sim.state,
  },
  determinism: { identical: fp1 === fp2, hash: fp1 },
};

mkdirSync('out', { recursive: true });
writeFileSync('out/simcheck.json', JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
