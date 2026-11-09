/**
 * vario 音效：爬升率 → 蜂鸣间隔 + 音高；下沉 → 连续低音。
 * 目标不是“好听”，是“像真的高度表”。
 *
 * 移动端注意：
 * - AudioContext 必须在用户手势里创建/恢复；
 * - iOS 的静音拨片会静音 WebAudio，能用 audioSession 时切到 playback；
 * - 第一次手势里播一个 1 帧静音 buffer，是老 Safari 的解锁方式。
 */
type AudioContextCtor = typeof AudioContext;

export class VarioAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sinkGain: GainNode | null = null;
  private nextBeep = 0;
  private volume = 0.85;
  enabled = true;
  /** 已调度的蜂鸣数，供自测使用 */
  beeps = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** 同步创建音频图；必须在用户手势中调用才有意义。 */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const w = window as unknown as {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = this.enabled ? this.volume : 0;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 320;
    const sink = ctx.createGain();
    sink.gain.value = 0;
    osc.connect(sink);
    sink.connect(master);
    osc.start();

    this.ctx = ctx;
    this.master = master;
    this.sinkGain = sink;
    this.nextBeep = ctx.currentTime + 0.1;
    return ctx;
  }

  /** iOS 16.4+：让 WebAudio 走 playback 通道，忽略静音拨片。 */
  private configureSession(): void {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (!nav.audioSession) return;
    try {
      nav.audioSession.type = 'playback';
    } catch {
      /* 忽略不支持的类型 */
    }
  }

  /** 在用户手势里播一个 1 帧静音 buffer，解锁旧版 Safari。 */
  private unlock(ctx: AudioContext): void {
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* 忽略 */
    }
  }

  async start(): Promise<void> {
    const ctx = this.ensure();
    if (!ctx) return;
    this.configureSession();
    this.unlock(ctx);
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* 浏览器拒绝时保持 suspended，等下一次手势 */
      }
    }
    this.nextBeep = Math.max(this.nextBeep, ctx.currentTime + 0.08);
  }

  /** 试听：返回是否真的在 running。 */
  async test(): Promise<boolean> {
    await this.start();
    this.beepNow(1.5);
    return this.running;
  }

  /** 立即播一声，用于“试听声音”按钮和开局确认。 */
  beepNow(vario = 1.5): void {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    this.beep(ctx.currentTime + 0.02, vario);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.03);
    }
    if (on) void this.start();
  }

  /** 每帧调用；vario 为仪表读数（m/s） */
  update(vario: number): void {
    const ctx = this.ctx;
    const master = this.master;
    const sinkGain = this.sinkGain;
    if (!ctx || !master || !sinkGain) return;
    if (ctx.state !== 'running') return;

    const now = ctx.currentTime;
    if (!this.enabled) {
      sinkGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const sinkLevel = vario < -0.2 ? Math.min(0.16, (-vario - 0.2) * 0.07) : 0;
    sinkGain.gain.setTargetAtTime(sinkLevel, now, 0.12);

    if (vario <= -0.15) return;

    const interval = Math.max(0.06, Math.min(2.0, 1.2 / (vario + 0.3)));
    if (this.nextBeep < now - 0.5) this.nextBeep = now + 0.02;

    let guard = 0;
    while (this.nextBeep < now + 0.12 && guard++ < 8) {
      this.beep(this.nextBeep, vario);
      this.nextBeep += interval;
    }
  }

  private beep(at: number, vario: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 760 + Math.min(5, Math.max(0, vario)) * 70;
    this.beeps++;

    const g = ctx.createGain();
    const peak = 0.22 + Math.min(0.15, Math.max(0, vario) * 0.04);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);

    osc.connect(g);
    g.connect(master);
    osc.start(at);
    osc.stop(at + 0.075);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.start();
  }
}
