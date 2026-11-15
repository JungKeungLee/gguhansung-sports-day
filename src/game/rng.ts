// 시드 기반 난수 (mulberry32) — 같은 시드면 같은 경기 재현
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  weighted<T>(items: readonly T[], weight: (x: T) => number): T {
    const total = items.reduce((s, x) => s + weight(x), 0);
    let r = this.next() * total;
    for (const x of items) {
      r -= weight(x);
      if (r < 0) return x;
    }
    return items[items.length - 1];
  }
  /** dt 동안 rate(초당) 확률로 발생 */
  chance(rate: number, dt: number): boolean {
    return this.next() < 1 - Math.exp(-rate * dt);
  }
}

export function randomSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}
