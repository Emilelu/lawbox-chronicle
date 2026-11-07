/**
 * 战斗与结算公式 —— 纯函数集合。
 * ---------------------------------------------------------------------------
 * 固化 KichikuAdventure Game.java:941-956 的「格挡公式回血」教训：
 *   原版 blocked 时 hp = hp - attack + defense，且 clamp 到 maxHP ——
 *   防御在高攻低防下变成“回血”。本文件的 block 语义改为：
 *   受击方减免，伤害下限 1，永不增加 HP。
 */

import type { Rng } from './rng';

export function clampHp(hp: number, maxHp: number): number {
  return Math.max(0, Math.min(hp, maxHp));
}

export interface StrikeInput {
  readonly attacker: { readonly attack: number };
  readonly defender: { readonly defense: number; readonly hp: number; readonly maxHp: number };
  /** 格挡概率（原版为 random*8 %2==0 = 50%） */
  readonly blockChance?: number;
  /** 暴击概率（新增演出维度） */
  readonly critChance?: number;
  readonly rng: Rng;
}

export interface StrikeResult {
  readonly damage: number;
  readonly blocked: boolean;
  readonly crit: boolean;
  readonly defenderHpAfter: number;
  readonly defenderDefeated: boolean;
}

/**
 * 一次攻击结算。
 * 伤害 = max(1, attack - defense)（格挡时），暴击 ×2。
 * 唯一的 HP 修改点，clamp 后永不超上限 —— 公式层面杜绝“格挡回血”。
 */
export function resolveStrike(input: StrikeInput): StrikeResult {
  const { attacker, defender, rng } = input;
  const blocked = rng.chance(input.blockChance ?? 0.5);
  const crit = !blocked && rng.chance(input.critChance ?? 0.1);

  const base = Math.max(1, attacker.attack - defender.defense);
  const damage = crit ? base * 2 : base;
  const hpAfter = clampHp(defender.hp - damage, defender.maxHp);

  return {
    damage,
    blocked,
    crit,
    defenderHpAfter: hpAfter,
    defenderDefeated: hpAfter <= 0,
  };
}

/** 关卡星级：steps ≤ par[0] → 3★；≤ par[1] → 2★；否则 1★ */
export function starRating(steps: number, par: readonly [number, number]): 1 | 2 | 3 {
  if (steps <= par[0]) return 3;
  if (steps <= par[1]) return 2;
  return 1;
}

/** 星石结算：星级 × 基础奖励 */
export function starStoneReward(stars: 1 | 2 | 3, base: number): number {
  return Math.max(0, Math.round(base * (stars / 3)));
}
