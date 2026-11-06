import { Glider, type GliderParams } from './glider';
import { ThermalField } from './field';
import { Rng } from './rng';

export interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  vario: number;
  w: number;
  phi: number;
  v: number;
}

export type SimMode = 'fixed' | 'evolving';
export type SimState = 'flying' | 'won' | 'lost';

export interface SimOptions {
  field: ThermalField;
  start: { x: number; y: number; psi: number; z: number };
  cloudbase: number;
  glider?: Partial<GliderParams>;
  mode?: SimMode;
  seed?: number;
  dt?: number;
  noise?: number;
  avgTau?: number;
  delay?: number;
  holdSeconds?: number;
}

export class Sim {
  readonly field: ThermalField;
  readonly glider: Glider;
  readonly dt: number;
  readonly cloudbase: number;
  readonly mode: SimMode;
  readonly startZ: number;
  t = 0;

  varioOut = 0;
  wHere = 0;
  sink = 0;
  state: SimState = 'flying';
  holdTime = 0;
  maxZ: number;
  thermalEntries = 0;
  history: Sample[] = [];

  private rng: Rng;
  private readonly noise: number;
  private readonly avgTau: number;
  private readonly holdTarget: number;
  private avg = 0;
  private readonly delayBuf: number[];
  private delayIdx = 0;
  private lastSample = -1;
  private wasLift = false;

  constructor(opts: SimOptions) {
    this.field = opts.field;
    this.glider = new Glider(opts.glider ?? {}, opts.start);
    this.cloudbase = opts.cloudbase;
    this.mode = opts.mode ?? 'fixed';
    this.startZ = opts.start.z;
    this.dt = opts.dt ?? 1 / 120;
    this.rng = new Rng(opts.seed ?? 1);
    this.noise = opts.noise ?? 0.08;
    this.avgTau = opts.avgTau ?? 1.5;
    this.holdTarget = opts.holdSeconds ?? 10;
    this.maxZ = opts.start.z;

    const steps = Math.max(1, Math.round((opts.delay ?? 0.08) / this.dt));
    this.delayBuf = new Array<number>(steps).fill(0);
  }

  get altitude(): number {
    return this.glider.z;
  }

  get progress(): number {
    return this.glider.z / this.cloudbase;
  }

  step(uL: number, uR: number): void {
    if (this.state !== 'flying') return;

    const g = this.glider;
    const zEval = this.mode === 'fixed' ? this.startZ : g.z;
    const fixed = this.mode === 'fixed';
    const w = this.field.w(g.x, g.y, zEval, this.t, fixed);

    const wx = Math.sin(this.field.wind.dir) * this.field.wind.speed;
    const wy = Math.cos(this.field.wind.dir) * this.field.wind.speed;
    const res = g.step(this.dt, uL, uR, w, wx, wy);

    this.wHere = w;
    this.sink = res.sink;

    const noisy = w - res.sink + this.rng.gauss() * this.noise;
    const a = 1 - Math.exp(-this.dt / this.avgTau);
    this.avg += (noisy - this.avg) * a;

    this.delayBuf[this.delayIdx] = this.avg;
    this.delayIdx = (this.delayIdx + 1) % this.delayBuf.length;
    this.varioOut = this.delayBuf[this.delayIdx];

    this.field.advance(this.dt);
    this.t += this.dt;
    this.maxZ = Math.max(this.maxZ, g.z);

    if (w > 0.6 && !this.wasLift) {
      this.thermalEntries++;
      this.wasLift = true;
    } else if (w < 0.2) {
      this.wasLift = false;
    }

    if (g.z >= this.cloudbase) {
      this.holdTime += this.dt;
      if (this.holdTime >= this.holdTarget) this.state = 'won';
    } else if (g.z < this.cloudbase - 20) {
      this.holdTime = 0;
    }

    if (g.z <= 0.01) this.state = 'lost';

    if (this.t - this.lastSample >= 0.05) {
      this.lastSample = this.t;
      this.history.push({
        t: this.t,
        x: g.x,
        y: g.y,
        z: g.z,
        vario: this.varioOut,
        w,
        phi: g.phi,
        v: g.v,
      });
      if (this.history.length > 24000) this.history.splice(0, 4000);
    }
  }
}
