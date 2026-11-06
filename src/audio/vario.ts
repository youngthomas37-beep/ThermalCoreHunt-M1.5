/**
 * vario 音效：爬升率 → 蜂鸣间隔 + 音高；下沉 → 连续低音。
 * 目标不是“好听”，是“像真的高度表”。
 */
export class VarioAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sinkGain: GainNode | null = null;
  private nextBeep = 0;
  private volume = 0.5;
  enabled = true;
  /** 已调度的蜂鸣数，供自测使用 */
  beeps = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = this.enabled ? this.volume : 0;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(master);
    osc.start();

    this.ctx = ctx;
    this.master = master;
    this.sinkGain = gain;
    this.nextBeep = ctx.currentTime + 0.25;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.03);
    }
  }

  /** 每帧调用；vario 为仪表读数（m/s） */
  update(vario: number): void {
    const ctx = this.ctx;
    const master = this.master;
    const sinkGain = this.sinkGain;
    if (!ctx || !master || !sinkGain) return;

    const now = ctx.currentTime;
    if (!this.enabled) {
      sinkGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const sinkLevel = vario < -0.2 ? Math.min(0.1, (-vario - 0.2) * 0.05) : 0;
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
    const peak = 0.16 + Math.min(0.12, Math.max(0, vario) * 0.03);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);

    osc.connect(g);
    g.connect(master);
    osc.start(at);
    osc.stop(at + 0.07);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}
