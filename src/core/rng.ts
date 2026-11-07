/**
 * 可复现随机数 —— 引擎层唯一允许的随机来源。
 * ---------------------------------------------------------------------------
 * 老项目用裸 Math.random()（Lottery.java:42、Game.java:941），导致概率逻辑
 * 不可测。这里用 mulberry32 种子流替代：同种子 ⇒ 同序列，vitest 可断言。
 * 禁止引擎层直接调用 Math.random。
 */

export interface Rng {
  /** [0, 1) 均匀分布 */
  next(): number;
  /** [min, max] 闭区间整数 */
  int(min: number, max: number): number;
  /** 以概率 p 返回 true */
  chance(p: number): boolean;
  /** 从数组均匀取一（空数组抛错，由调用方保证前置条件） */
  pick<T>(items: readonly T[]): T;
  /** 派生独立子流（同种子可复现整棵流树） */
  fork(label: string): Rng;
  readonly seedLabel: string;
}

/** FNV-1a 字符串散列：字符串种子 → 32 位数字种子 */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  const numericSeed = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  let s = numericSeed || 0x9e3779b9; // 拒绝全零状态

  const rng: Rng = {
    seedLabel: typeof seed === 'string' ? seed : `num:${seed}`,
    next() {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      if (max < min) throw new RangeError(`rng.int: max(${max}) < min(${min})`);
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    chance(p) {
      if (p < 0 || p > 1) throw new RangeError(`rng.chance: p(${p}) 越界`);
      return rng.next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('rng.pick: 空数组');
      const idx = rng.int(0, items.length - 1);
      const item = items[idx];
      if (item === undefined) throw new RangeError(`rng.pick: index ${idx} 越界`);
      return item;
    },
    fork(label) {
      return createRng(`${rng.seedLabel}/${label}/${Math.floor(rng.next() * 0xffffffff)}`);
    },
  };
  return rng;
}

/** 确定性 uid（引擎层生成实体/卡实例时使用，避免依赖 Date.now 破坏纯度） */
export function stableUid(prefix: string, rng: Rng, seq: number): string {
  return `${prefix}-${(hashSeed(rng.seedLabel) ^ seq) >>> 0}-${seq}`;
}
