import type { Sim } from '../core/sim';

const TEX_N = 768;
const TEX_SPAN = 1200;
const TEX_X0 = 400 - TEX_SPAN / 2;
const TEX_Y0 = 400 - TEX_SPAN / 2;

const STOPS: Array<[number, number, number, number]> = [
  [-2.5, 10, 24, 44],
  [-1.4, 20, 62, 104],
  [-0.5, 26, 110, 138],
  [0.0, 52, 148, 118],
  [0.5, 128, 190, 104],
  [1.2, 208, 198, 88],
  [2.0, 238, 160, 62],
  [3.0, 232, 96, 48],
  [4.0, 198, 38, 38],
  [5.0, 148, 16, 32],
];

function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const wMin = STOPS[0][0];
  const wMax = STOPS[STOPS.length - 1][0];
  for (let i = 0; i < 256; i++) {
    const w = wMin + ((wMax - wMin) * i) / 255;
    let a = STOPS[0];
    let b = STOPS[STOPS.length - 1];
    for (let k = 0; k < STOPS.length - 1; k++) {
      if (w >= STOPS[k][0] && w <= STOPS[k + 1][0]) {
        a = STOPS[k];
        b = STOPS[k + 1];
        break;
      }
    }
    const f = b[0] === a[0] ? 0 : (w - a[0]) / (b[0] - a[0]);
    lut[i * 3] = a[1] + (b[1] - a[1]) * f;
    lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * f;
    lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * f;
  }
  return lut;
}

const LUT = buildLut();
const W_MIN = STOPS[0][0];
const W_MAX = STOPS[STOPS.length - 1][0];

export interface RenderOptions {
  hidden: boolean;
  debug: boolean;
}

export class WorldRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: HTMLCanvasElement;
  private texCtx: CanvasRenderingContext2D;
  private scale = 3;
  private camX = Number.NaN;
  private camY = Number.NaN;
  private lastT = 0;
  private texField: unknown = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    this.ctx = ctx;
    this.tex = document.createElement('canvas');
    this.tex.width = TEX_N;
    this.tex.height = TEX_N;
    const tctx = this.tex.getContext('2d');
    if (!tctx) throw new Error('texture 2d unavailable');
    this.texCtx = tctx;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(4.5, Math.max(2.4, w / 140));
  }

  resetCamera(): void {
    this.camX = Number.NaN;
    this.camY = Number.NaN;
    this.lastT = 0;
  }

  /** 场对象变化时重建热力图纹理 */
  prepare(sim: Sim): void {
    if (this.texField === sim.field) return;
    this.texField = sim.field;

    const dx = sim.field.driftX;
    const dy = sim.field.driftY;
    sim.field.driftX = 0;
    sim.field.driftY = 0;
    sim.field.renderSteady = true;

    const z = sim.startZ;
    const img = this.texCtx.createImageData(TEX_N, TEX_N);
    const data = img.data;

    for (let py = 0; py < TEX_N; py++) {
      const y = TEX_Y0 + TEX_SPAN * (py / (TEX_N - 1));
      for (let px = 0; px < TEX_N; px++) {
        const x = TEX_X0 + (TEX_SPAN * px) / (TEX_N - 1);
        const w = sim.field.w(x, y, z, 0, true);
        const idx = Math.max(0, Math.min(255, Math.round(((w - W_MIN) / (W_MAX - W_MIN)) * 255)));
        const o = (py * TEX_N + px) * 4;
        data[o] = LUT[idx * 3];
        data[o + 1] = LUT[idx * 3 + 1];
        data[o + 2] = LUT[idx * 3 + 2];
        data[o + 3] = 255;
      }
    }

    this.texCtx.putImageData(img, 0, 0);

    sim.field.driftX = dx;
    sim.field.driftY = dy;
    sim.field.renderSteady = false;
  }

  /** 调试用：取纹理在世界坐标处的 RGB */
  sampleTex(x: number, y: number): number[] {
    const px = Math.max(0, Math.min(TEX_N - 1, Math.round(((x - TEX_X0) / TEX_SPAN) * (TEX_N - 1))));
    const py = Math.max(0, Math.min(TEX_N - 1, Math.round(((y - TEX_Y0) / TEX_SPAN) * (TEX_N - 1))));
    const d = this.texCtx.getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2], px, py];
  }

  worldToScreen(x: number, y: number): [number, number] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return [w / 2 + (x - this.camX) * this.scale, h * 0.46 - (y - this.camY) * this.scale];
  }

  render(sim: Sim, opts: RenderOptions): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    if (!Number.isFinite(this.camX) || sim.t < this.lastT) {
      this.camX = sim.glider.x;
      this.camY = sim.glider.y;
    }
    const dt = Math.max(0, sim.t - this.lastT);
    this.lastT = sim.t;
    const k = 1 - Math.exp(-Math.max(dt, 1 / 120) * 3.2);
    this.camX += (sim.glider.x - this.camX) * k;
    this.camY += (sim.glider.y - this.camY) * k;

    ctx.fillStyle = '#1a2619';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h * 0.46);
    ctx.scale(this.scale, -this.scale);
    ctx.translate(-this.camX, -this.camY);

    this.drawTerrain();
    if (!opts.hidden) {
      this.prepare(sim);
      ctx.globalAlpha = 1;
      ctx.drawImage(
        this.tex,
        TEX_X0 + sim.field.driftX,
        TEX_Y0 + sim.field.driftY,
        TEX_SPAN,
        TEX_SPAN,
      );
      ctx.globalAlpha = 1;
    }

    this.drawTrack(sim);
    const shake = this.drawGlider(sim);
    if (opts.hidden) this.drawWindStreaks(sim);
    if (opts.debug) this.drawDebug(sim);

    ctx.restore();

    if (opts.hidden && Math.abs(shake) > 0.2) {
      this.drawEdgeGlow(shake);
    }
  }

  private drawTerrain(): void {
    const ctx = this.ctx;
    const cell = 50;
    const halfW = this.canvas.clientWidth / 2 / this.scale + 120;
    const halfH = this.canvas.clientHeight / 2 / this.scale + 120;
    const x0 = Math.floor((this.camX - halfW) / cell) * cell;
    const x1 = this.camX + halfW;
    const y0 = Math.floor((this.camY - halfH) / cell) * cell;
    const y1 = this.camY + halfH;

    for (let y = y0; y < y1; y += cell) {
      for (let x = x0; x < x1; x += cell) {
        const r = hash(x / cell, y / cell);
        const g = 0.16 + r * 0.07;
        const rr = Math.round(28 + r * 26);
        const gg = Math.round(52 + g * 70);
        const bb = Math.round(30 + r * 22);
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.fillRect(x, y, cell + 1, cell + 1);
      }
    }

    ctx.strokeStyle = 'rgba(220,235,210,0.05)';
    ctx.lineWidth = 0.4;
    for (let x = x0; x < x1; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    for (let y = y0; y < y1; y += cell) {
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
  }

  private drawWindStreaks(sim: Sim): void {
    const ctx = this.ctx;
    const t = sim.t;
    const wx = Math.sin(sim.field.wind.dir);
    const wy = Math.cos(sim.field.wind.dir);
    const speed = sim.field.wind.speed;
    if (speed < 0.4) return;

    const halfW = this.canvas.clientWidth / 2 / this.scale + 80;
    const halfH = this.canvas.clientHeight / 2 / this.scale + 80;
    const n = 46;
    ctx.strokeStyle = 'rgba(215,230,210,0.10)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < n; i++) {
      const seedX = hash(i, 7) * 2 - 1;
      const seedY = hash(i, 13) * 2 - 1;
      const span = 220;
      const x = this.camX + (((seedX * span + t * speed * wx + 400) % (2 * span)) - span);
      const y = this.camY + (((seedY * span + t * speed * wy + 400) % (2 * span)) - span);
      if (Math.abs(x - this.camX) > halfW || Math.abs(y - this.camY) > halfH) continue;
      const len = 4 + hash(i, 21) * 6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + wx * len, y + wy * len);
      ctx.stroke();
    }
  }

  private drawTrack(sim: Sim): void {
    const ctx = this.ctx;
    const hist = sim.history;
    if (hist.length < 2) return;
    const tCut = sim.t - 120;
    let start = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].t < tCut) {
        start = i;
        break;
      }
    }

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(6,10,16,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = Math.max(1, start); i < hist.length; i++) {
      const a = hist[i - 1];
      const b = hist[i];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (let i = Math.max(1, start); i < hist.length; i++) {
      const a = hist[i - 1];
      const b = hist[i];
      ctx.strokeStyle = b.vario > 0.3 ? 'rgba(255,222,160,0.95)' : 'rgba(168,212,255,0.8)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  /** 返回翼尖抖动幅度（右正左负），用于隐藏模式的边缘光晕 */
  private drawGlider(sim: Sim): number {
    const ctx = this.ctx;
    const g = sim.glider;
    const psi = g.psi;
    const fx = Math.sin(psi);
    const fy = Math.cos(psi);
    const rx = Math.cos(psi);
    const ry = -Math.sin(psi);

    const span = 20;
    const half = span / 2;
    const N = 20;
    const zEval = sim.mode === 'fixed' ? sim.startZ : g.z;
    const fixed = sim.mode === 'fixed';

    const tipLx = g.x - rx * half;
    const tipLy = g.y - ry * half;
    const tipRx = g.x + rx * half;
    const tipRy = g.y + ry * half;
    const wL = sim.field.w(tipLx, tipLy, zEval, sim.t, fixed);
    const wR = sim.field.w(tipRx, tipRy, zEval, sim.t, fixed);
    const dW = wR - wL;
    const amp = Math.max(0, Math.min(1.4, (Math.abs(dW) - 0.25) * 1.6));
    const shake = Math.sign(dW) * amp * Math.sin(sim.t * Math.PI * 2 * 10);
    const rightShake = dW >= 0 ? shake : 0;
    const leftShake = dW < 0 ? -shake : 0;

    const pt = (u: number, v: number, sh: number): [number, number] => [
      g.x + rx * u + fx * (v + sh),
      g.y + ry * u + fy * (v + sh),
    ];
    const tipWeight = (u: number) => Math.abs(u / half) ** 4;

    const outline = (du: number, dv: number): void => {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = -half + (span * i) / N;
        const kk = u / half;
        const sh = (u < 0 ? leftShake : rightShake) * tipWeight(u);
        const [x, y] = pt(u + du, 4.0 - 3.2 * kk * kk + dv, sh);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = N; i >= 0; i--) {
        const u = -half + (span * i) / N;
        const kk = u / half;
        const sh = (u < 0 ? leftShake : rightShake) * tipWeight(u);
        const [x, y] = pt(u + du, -4.0 + 4.0 * kk * kk + dv, sh);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    outline(0.9, -1.1);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fill();

    outline(0, 0);
    const [gx1, gy1] = pt(-half, 0, 0);
    const [gx2, gy2] = pt(half, 0, 0);
    const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
    grad.addColorStop(0, '#e8b25a');
    grad.addColorStop(0.24, '#f7f3e8');
    grad.addColorStop(0.76, '#f7f3e8');
    grad.addColorStop(1, '#e8b25a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#0a0f18';
    ctx.lineWidth = 0.55;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(10,15,24,0.32)';
    ctx.lineWidth = 0.26;
    for (let i = 1; i < 12; i++) {
      const u = -half + (span * i) / 12;
      const kk = u / half;
      const sh = (u < 0 ? leftShake : rightShake) * tipWeight(u);
      const [x1, y1] = pt(u, 4.0 - 3.2 * kk * kk, sh);
      const [x2, y2] = pt(u, -4.0 + 4.0 * kk * kk, sh);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    const [n1x, n1y] = pt(-1.9, 2.9, 0);
    const [n2x, n2y] = pt(0, 5.4, 0);
    const [n3x, n3y] = pt(1.9, 2.9, 0);
    ctx.beginPath();
    ctx.moveTo(n1x, n1y);
    ctx.lineTo(n2x, n2y);
    ctx.lineTo(n3x, n3y);
    ctx.strokeStyle = 'rgba(214,146,46,0.95)';
    ctx.lineWidth = 0.55;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const [px, py] = pt(0, -5.2, 0);
    ctx.beginPath();
    ctx.arc(px, py, 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#e0a44a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,15,24,0.85)';
    ctx.lineWidth = 0.3;
    ctx.stroke();

    return dW;
  }

  private drawDebug(sim: Sim): void {
    const ctx = this.ctx;
    for (const th of sim.field.thermals) {
      const c = sim.field.center(th);
      ctx.beginPath();
      ctx.moveTo(c.x - 4, c.y);
      ctx.lineTo(c.x + 4, c.y);
      ctx.moveTo(c.x, c.y - 4);
      ctx.lineTo(c.x, c.y + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(sim.glider.x, sim.glider.y, 0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
  }

  private drawEdgeGlow(dW: number): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const alpha = Math.min(0.22, Math.abs(dW) * 0.06);
    const right = dW > 0;
    const grad = ctx.createLinearGradient(right ? w : 0, 0, right ? w - 90 : 90, 0);
    grad.addColorStop(0, `rgba(255,196,120,${alpha})`);
    grad.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(right ? w - 90 : 0, h * 0.18, 90, h * 0.64);
  }
}

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
