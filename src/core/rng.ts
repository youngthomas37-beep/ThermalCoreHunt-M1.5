/** xoshiro128** 伪随机数发生器：种子确定、可复现。 */
export class Rng {
  private a = 1;
  private b = 2;
  private c = 3;
  private d = 4;
  private spare: number | null = null;

  constructor(seed: number) {
    let s = seed >>> 0;
    const split = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = split();
    this.b = split();
    this.c = split();
    this.d = split();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  nextU32(): number {
    const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = (Math.imul(rotl(Math.imul(this.b, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (this.b << 9) >>> 0;
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    c ^= a;
    d ^= b;
    a ^= d;
    b ^= c;
    c ^= t;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
    return result;
  }

  /** [0,1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** 标准正态，Box-Muller。 */
  gauss(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }
}
