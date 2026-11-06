/**
 * 热气流场：多个热气流，每个由若干各向异性 lobe 组成，可椭圆、可条带。
 * 支持高度切片（fixed=false 时按 z 取剖面），支持随风部分漂移。
 */

export interface LobeSpec {
  dx: number;
  dy: number;
  a: number;
  b: number;
  angle: number;
  weight: number;
}

export interface ThermalSpec {
  id: number;
  x: number;
  y: number;
  /** 底部高度 m AGL */
  base: number;
  /** 顶部高度 m AGL */
  top: number;
  /** 参考半径 m */
  radius: number;
  /** 参考峰值 m/s */
  w0: number;
  angle: number;
  elongation: number;
  lobes: LobeSpec[];
  pulsePeriod: number;
  pulsePhase: number;
}

/** 风向：dir 为“吹向”的方向，0=北，顺时针，弧度。 */
export interface Wind {
  speed: number;
  dir: number;
}

export const W_MAX = 6;

export class ThermalField {
  thermals: ThermalSpec[];
  wind: Wind;
  driftX = 0;
  driftY = 0;
  /** 热气流随风漂移的比例：0=锚定，1=完全随风 */
  driftK = 0.35;
  /** 全域补偿，使净通量接近 0 */
  private bias = 0;
  /** 渲染纹理时忽略脉冲，避免颜色与实际强度错位 */
  renderSteady = false;

  constructor(thermals: ThermalSpec[], wind: Wind, refZ = 600) {
    this.thermals = thermals;
    this.wind = wind;
    this.bias = -this.meanRaw(refZ);
  }

  /** 未加补偿前的域平均 */
  private meanRaw(z: number): number {
    let sum = 0;
    let n = 0;
    const span = 1600;
    const x0 = 400 - span / 2;
    const y0 = 400 - span / 2;
    const step = span / 40;
    for (let y = y0; y < y0 + span; y += step) {
      for (let x = x0; x < x0 + span; x += step) {
        sum += this.raw(x, y, z, 0, true);
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  }

  advance(dt: number): void {
    const k = this.wind.speed * this.driftK * dt;
    this.driftX += Math.sin(this.wind.dir) * k;
    this.driftY += Math.cos(this.wind.dir) * k;
  }

  center(th: ThermalSpec): { x: number; y: number } {
    return { x: th.x + this.driftX, y: th.y + this.driftY };
  }

  radiusAt(th: ThermalSpec, z: number, fixed: boolean): number {
    if (fixed) return th.radius;
    const u = clamp01((z - th.base) / Math.max(1, th.top - th.base));
    return th.radius * (1 + 0.35 * u);
  }

  /** 当前高度的峰值（不含脉冲） */
  peakAt(th: ThermalSpec, z: number, fixed: boolean): number {
    if (fixed) return th.w0;
    if (z <= th.base || z >= th.top) return 0;
    const u = clamp01((z - th.base) / Math.max(1, th.top - th.base));
    const rz = th.radius * (1 + 0.35 * u);
    const shape = Math.exp(-(((u - 0.4) / 0.5) ** 2));
    return th.w0 * (th.radius / rz) ** 2 * shape;
  }

  pulse(th: ThermalSpec, t: number): number {
    return 0.92 + 0.08 * Math.sin((2 * Math.PI * t) / th.pulsePeriod + th.pulsePhase);
  }

  w(x: number, y: number, z: number, t: number, fixed: boolean): number {
    return this.raw(x, y, z, t, fixed) + this.bias;
  }

  private raw(x: number, y: number, z: number, t: number, fixed: boolean): number {
    let sum = 0;
    for (const th of this.thermals) {
      sum += this.thermalW(th, x, y, z, t, fixed);
    }
    return W_MAX * Math.tanh(sum / W_MAX);
  }

  private thermalW(th: ThermalSpec, x: number, y: number, z: number, t: number, fixed: boolean): number {
    const peak = this.peakAt(th, z, fixed);
    if (peak <= 0) return 0;

    const c = this.center(th);
    const dx = x - c.x;
    const dy = y - c.y;
    const rz = this.radiusAt(th, z, fixed);

    let core = 0;
    for (const lobe of th.lobes) {
      const ang = th.angle + lobe.angle;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const u = ca * dx + sa * dy;
      const v = -sa * dx + ca * dy;
      const q = (u / lobe.a) ** 2 + (v / lobe.b) ** 2;
      core += lobe.weight * Math.exp(-q * q);
    }

    const r = Math.hypot(dx, dy);
    const ring = -0.3 * Math.exp(-(((r - 1.8 * rz) / (0.9 * rz)) ** 2));

    const p = this.renderSteady ? 1 : this.pulse(th, t);
    return p * peak * (core + ring);
  }
  nearest(x: number, y: number): { thermal: ThermalSpec; distance: number } | null {
    let best: ThermalSpec | null = null;
    let bestD = Infinity;
    for (const th of this.thermals) {
      const c = this.center(th);
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < bestD) {
        bestD = d;
        best = th;
      }
    }
    return best ? { thermal: best, distance: bestD } : null;
  }

  /** 域内质量守恒自检：|∫w| / ∫|w| */
  massImbalance(z: number, fixed: boolean, size = 1600, n = 160): number {
    let sum = 0;
    let abs = 0;
    const d = size / n;
    const x0 = 400 - size / 2;
    const y0 = 400 - size / 2;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = this.w(x0 + (i + 0.5) * d, y0 + (j + 0.5) * d, z, 0, fixed);
        sum += v;
        abs += Math.abs(v);
      }
    }
    return abs > 0 ? Math.abs(sum) / abs : 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
