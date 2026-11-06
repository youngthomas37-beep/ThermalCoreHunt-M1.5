/** 滑翔伞运动学：2D 地面参考系 + 高度积分。 */

export interface GliderParams {
  vTrim: number;
  vMinSink: number;
  sink0: number;
  sinkA: number;
  sinkB: number;
  /** 最大坡度（rad） */
  bankMax: number;
  /** 输入曲线指数：1=线性，>1=小输入更柔和 */
  bankExpo: number;
  /** 刹车死区 0..1 */
  deadzone: number;
  tauBank: number;
  brakeSpeedLoss: number;
  tauSpeed: number;
}

export const DEFAULT_GLIDER: GliderParams = {
  vTrim: 10,
  vMinSink: 9.5,
  sink0: 1.12,
  sinkA: 0.035,
  sinkB: 2.0,
  bankMax: (45 * Math.PI) / 180,
  bankExpo: 1.5,
  deadzone: 0.05,
  tauBank: 0.55,
  brakeSpeedLoss: 2.0,
  tauSpeed: 0.6,
};

export interface GliderState {
  x: number;
  y: number;
  psi: number;
  v: number;
  phi: number;
  z: number;
}

export interface StepResult {
  sink: number;
  vario: number;
  omega: number;
}

const G = 9.80665;

export class Glider {
  readonly p: GliderParams;
  x: number;
  y: number;
  psi: number;
  v: number;
  phi: number;
  z: number;

  constructor(params: Partial<GliderParams> = {}, state?: Partial<GliderState>) {
    this.p = { ...DEFAULT_GLIDER, ...params };
    this.x = state?.x ?? 0;
    this.y = state?.y ?? 0;
    this.psi = state?.psi ?? 0;
    this.v = state?.v ?? this.p.vTrim;
    this.phi = state?.phi ?? 0;
    this.z = state?.z ?? 500;
  }

  /** 在当前空气中推进一步；风为“吹向”速度。 */
  step(dt: number, uL: number, uR: number, wAir: number, windX: number, windY: number): StepResult {
    const p = this.p;

    let diff = Math.max(-1, Math.min(1, uR - uL));
    if (Math.abs(diff) <= p.deadzone) {
      diff = 0;
    } else {
      diff = Math.sign(diff) * ((Math.abs(diff) - p.deadzone) / (1 - p.deadzone));
    }
    const targetPhi = Math.sign(diff) * p.bankMax * Math.min(1, Math.abs(diff)) ** p.bankExpo;
    this.phi += (targetPhi - this.phi) * Math.min(1, dt / p.tauBank);

    const targetV = p.vTrim - p.brakeSpeedLoss * Math.min(1, uL + uR);
    this.v += (targetV - this.v) * Math.min(1, dt / p.tauSpeed);

    const omega = (G * Math.tan(this.phi)) / Math.max(4, this.v);
    this.psi = normalizeAngle(this.psi + omega * dt);

    const sink =
      p.sink0 + p.sinkA * (this.v - p.vMinSink) ** 2 + p.sinkB * (1 / Math.cos(this.phi) - 1);

    const vario = wAir - sink;
    this.z = Math.max(0, this.z + vario * dt);

    this.x += (this.v * Math.sin(this.psi) + windX) * dt;
    this.y += (this.v * Math.cos(this.psi) + windY) * dt;

    return { sink, vario, omega };
  }
}

export function normalizeAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t + Math.PI) % t - Math.PI;
}
