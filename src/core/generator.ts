import { Rng } from './rng';
import type { LobeSpec, ThermalSpec, Wind } from './field';
import { ThermalField } from './field';

export interface Scenario {
  id: string;
  name: string;
  startZ: number;
  cloudbase: number;
  w0: [number, number];
  radius: [number, number];
  count: number;
}

export const SCENARIOS: Scenario[] = [
  { id: 'learn', name: '教学', startZ: 300, cloudbase: 800, w0: [1.6, 2.2], radius: [42, 58], count: 3 },
  { id: 'standard', name: '标准', startZ: 500, cloudbase: 1100, w0: [2.0, 2.9], radius: [38, 55], count: 3 },
  { id: 'strong', name: '强天', startZ: 500, cloudbase: 1500, w0: [2.9, 4.0], radius: [48, 65], count: 3 },
  { id: 'low', name: '低空挑战', startZ: 100, cloudbase: 900, w0: [1.6, 2.2], radius: [34, 46], count: 3 },
];

export const WORLD_W = 800;
export const WORLD_H = 800;
export const START = { x: 400, y: 400 };

export interface GeneratedField {
  seed: number;
  scenario: Scenario;
  thermals: ThermalSpec[];
  wind: Wind;
  start: { x: number; y: number; psi: number };
}

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[1];
}

export function generateField(seed: number, scenario: Scenario, wind: Wind): GeneratedField {
  for (let attempt = 0; attempt < 30; attempt++) {
    const rng = new Rng((seed + attempt * 7919) >>> 0);
    const thermals: ThermalSpec[] = [];

    // 主热气流：离起点 110–180 m，保证开局能看见
    const bearing = rng.next() * Math.PI * 2;
    const dist = 140 + rng.next() * 100;
    thermals.push(
      makeThermal(
        rng,
        1,
        START.x + Math.sin(bearing) * dist,
        START.y + Math.cos(bearing) * dist,
        scenario,
      ),
    );

    let guard = 0;
    while (thermals.length < scenario.count && guard++ < 400) {
      const x = 110 + rng.next() * (WORLD_W - 220);
      const y = 110 + rng.next() * (WORLD_H - 220);
      const rNew = scenario.radius[0] + rng.next() * (scenario.radius[1] - scenario.radius[0]);
      let ok = true;
      for (const t of thermals) {
        const need = 1.15 * (t.radius + rNew);
        if (Math.hypot(t.x - x, t.y - y) < need) {
          ok = false;
          break;
        }
      }
      if (ok) thermals.push(makeThermal(rng, thermals.length + 1, x, y, scenario));
    }
    if (thermals.length < scenario.count) continue;

    const field = new ThermalField(thermals, wind, scenario.startZ);
    const startW = field.w(START.x, START.y, scenario.startZ, 0, true);
    const nearest = field.nearest(START.x, START.y);
    const coverage = coverageAt(field, scenario.startZ);

    if (startW > 0.25) continue;
    if (!nearest || nearest.distance < 100 || nearest.distance > 260) continue;
    if (coverage < 0.08 || coverage > 0.3) continue;

    return {
      seed,
      scenario,
      thermals,
      wind,
      start: { x: START.x, y: START.y, psi: rng.next() * Math.PI * 2 },
    };
  }
  // 兜底：即便约束失败，也给一个可玩的场
  const rng = new Rng(seed);
  const thermals = [
    makeThermal(rng, 1, START.x + 140, START.y, scenario),
    makeThermal(rng, 2, START.x - 180, START.y + 160, scenario),
    makeThermal(rng, 3, START.x + 80, START.y - 220, scenario),
  ];
  return { seed, scenario, thermals, wind, start: { x: START.x, y: START.y, psi: rng.next() * Math.PI * 2 } };
}

function makeThermal(rng: Rng, id: number, x: number, y: number, scen: Scenario): ThermalSpec {
  const radius = lerp(scen.radius[0], scen.radius[1], rng.next());
  const w0 = lerp(scen.w0[0], scen.w0[1], rng.next());
  const roll = rng.next();
  const kind = roll < 0.5 ? 'blob' : roll < 0.85 ? 'ellipse' : 'streak';
  const elongation =
    kind === 'blob' ? 1 + rng.next() * 0.2 : kind === 'ellipse' ? 1.4 + rng.next() * 0.8 : 2.6 + rng.next() * 1.4;

  const lobes: LobeSpec[] = [
    { dx: 0, dy: 0, a: radius * elongation, b: radius, angle: 0, weight: 1 },
  ];
  const sats = kind === 'streak' ? 1 + Math.floor(rng.next() * 2) : Math.floor(rng.next() * 3);
  for (let i = 0; i < sats; i++) {
    const phi = rng.next() * Math.PI * 2;
    const d = radius * (0.35 + rng.next() * 0.35);
    lobes.push({
      dx: Math.sin(phi) * d,
      dy: Math.cos(phi) * d,
      a: radius * (0.4 + rng.next() * 0.25) * elongation * 0.7,
      b: radius * (0.35 + rng.next() * 0.2),
      angle: rng.next() * Math.PI,
      weight: 0.35 + rng.next() * 0.25,
    });
  }

  const base = 40 + rng.next() * 90;
  const top = Math.min(scen.cloudbase + 80, scen.startZ + 250 + rng.next() * 700);

  return {
    id,
    x,
    y,
    base,
    top: Math.max(top, base + 200),
    radius,
    w0,
    angle: rng.next() * Math.PI,
    elongation,
    lobes,
    pulsePeriod: 90 + rng.next() * 80,
    pulsePhase: rng.next() * Math.PI * 2,
  };
}

function coverageAt(field: ThermalField, z: number): number {
  let hit = 0;
  let total = 0;
  const n = 36;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * WORLD_W;
      const y = ((j + 0.5) / n) * WORLD_H;
      if (field.w(x, y, z, 0, true) > 0.4) hit++;
      total++;
    }
  }
  return hit / total;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
