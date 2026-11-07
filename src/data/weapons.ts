/**
 * 武器数据 —— 唯一数据源。
 * ---------------------------------------------------------------------------
 * 数值与文案逐字搬自 KichikuAdventure Game.java:61-65（原为 main() 内
 * 硬编码 new Weapons(...)，游戏期只按 bag 下标回查全局 weasum 表）。
 *
 * 修复映射：
 *  - K8（Game.java:934 weasum.get(atglsR - 1) 下标错位）：战斗期唯一被引用的
 *    形态是 WeaponInstance——实例创建时自带 stats 副本，永不回查全局表，
 *    「包内第 N 个名字 ↔ 全局第 N 个武器」的错位从结构上消失。
 *  - KT2（迷吼tiao 介绍词「可以多次使用」从未落地）：参数化为爆炸耐久
 *    charges = 3，每攻/每掷消耗 1，耗尽即 spent。
 *  - KT3（拐杖介绍词「可以击退敌人 ? 米」的问号）：参数化为击退格数
 *    knockbackSteps = 2，由 engine/combat/effects.ts 的击退位移消费。
 */

import { z } from 'zod';
import type { WeaponDef } from '../core/types';

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'weapon-dagger',
    name: '匕首',
    attack: 20,
    description: '一把普普通通的匕首，可以让攻击力提升 20！',
    source: 'angel-gift',
  },
  {
    id: 'weapon-basketball',
    name: '篮球',
    attack: 50,
    description: '看起来是一个普通的篮球，但是可以让攻击力提升 50！',
    source: 'monster-drop',
    droppedBy: 'enemy-caixukun',
  },
  {
    id: 'weapon-mihotel',
    name: '迷吼tiao',
    attack: 80,
    description: '外观酷似猕猴桃的炸弹，可以多次使用，可以让攻击力提升 80！',
    source: 'monster-drop',
    droppedBy: 'enemy-guolaoshi',
  },
  {
    id: 'weapon-bigsword',
    name: '张牙舞爪大宝剑',
    attack: 188,
    description: '外形像狼牙的大宝剑！可以让攻击力提升 188！',
    source: 'monster-drop',
    droppedBy: 'enemy-dygg',
  },
  {
    id: 'weapon-gfsStick',
    name: '爷爷的拐杖',
    attack: 233,
    description: '爷爷祖传下来的拐杖！可以击退敌人 2 格，可以让攻击力提升 233！',
    source: 'story-reward',
  },
];

export function findWeapon(weaponId: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === weaponId);
}

/** 剧情发放的初始武器（导航天使①教学事件，Game.java:547） */
export const STARTER_WEAPON_ID = 'weapon-dagger';

/* ============================ 武器静态特性表 ============================== */

/**
 * 武器的特殊机制参数（数据驱动，与数值表同源同审）。
 * 未列出的武器 = 纯攻击力加成，无特殊机制。
 */
export interface WeaponTrait {
  /** 爆炸耐久：可主动引爆的次数（迷吼tiao = 3，KT2） */
  readonly charges?: number;
  /** 击退格数：攻击命中后把敌人推退的格数（拐杖 = 2，KT3） */
  readonly knockbackSteps?: number;
}

export const WEAPON_TRAITS: Readonly<Record<string, WeaponTrait>> = Object.freeze({
  'weapon-mihotel': Object.freeze({ charges: 3 }),
  'weapon-gfsStick': Object.freeze({ knockbackSteps: 2 }),
});

/* ============================ 武器实例（自带 stats） ======================= */

/**
 * 武器实例 —— 战斗期唯一被引用的武器形态。
 * attack/name 在创建时复制进实例（K8 根治：战斗结算不查全局表）。
 */
export interface WeaponInstance {
  readonly uid: string;
  /** 指向 WEAPONS 的定义 id（仅展示/图鉴用，结算不依赖） */
  readonly defId: string;
  readonly name: string;
  /** 自带 stats 副本 */
  readonly attack: number;
  /** 爆炸耐久上限；null = 无耐久概念 */
  readonly maxCharges: number | null;
  /** 剩余爆炸次数；0 = 已耗尽（spent）；null = 无耐久概念 */
  readonly remainingCharges: number | null;
  /** 攻击命中后的击退格数（0 = 无击退） */
  readonly knockbackSteps: number;
}

export const WeaponInstanceSchema = z
  .object({
    uid: z.string().min(1),
    defId: z.string().min(1),
    name: z.string().min(1),
    attack: z.number().int().min(0).max(9999),
    maxCharges: z.number().int().min(1).max(9).nullable(),
    remainingCharges: z.number().int().min(0).max(9).nullable(),
    knockbackSteps: z.number().int().min(0).max(9),
  })
  .refine((w) => (w.maxCharges === null) === (w.remainingCharges === null), '耐久字段必须成对出现')
  .refine(
    (w) => w.maxCharges === null || w.remainingCharges === null || w.remainingCharges <= w.maxCharges,
    '剩余耐久不得超过耐久上限',
  );

/** 实例形状校验（存档回灌 / 跨表引用时使用） */
export function validateWeaponInstance(input: unknown): { ok: true; weapon: WeaponInstance } | { ok: false; error: string } {
  const parsed = WeaponInstanceSchema.safeParse(input);
  return parsed.success
    ? { ok: true, weapon: parsed.data as WeaponInstance }
    : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

/**
 * 由定义 id 生成自带 stats 的武器实例。
 * 未知 defId → undefined（调用方显式处理，绝不静默造出 0 攻武器）。
 */
export function createWeaponInstance(defId: string, uid: string): WeaponInstance | undefined {
  const def = findWeapon(defId);
  if (def === undefined) return undefined;
  const trait = WEAPON_TRAITS[defId] ?? {};
  const charges = trait.charges ?? null;
  return {
    uid,
    defId: def.id,
    name: def.name,
    attack: def.attack,
    maxCharges: charges,
    remainingCharges: charges,
    knockbackSteps: trait.knockbackSteps ?? 0,
  };
}

/** 耐久武器是否已耗尽（迷吼tiao 爆完 3 次） */
export function isWeaponSpent(weapon: WeaponInstance): boolean {
  return weapon.maxCharges !== null && weapon.remainingCharges === 0;
}
