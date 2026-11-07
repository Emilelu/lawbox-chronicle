/**
 * 法则补丁注册表 —— 「字符串 id → 补丁效果」的所有权归 core。
 * ---------------------------------------------------------------------------
 * 数据层（gacha-engine 的 lawCards/characterCards）只声明 id + 数值；
 * puzzle-engine 的 rules.ts 与 combat-engine 消费本注册表产出 RuleSet。
 * UI 与数据永远不直接摸引擎内部，杜绝散落各处的魔法字符串。
 *
 * applyPatch 为纯函数：输入 RuleSet + 合法 patch id，输出新 RuleSet。
 */

import { z } from 'zod';
import type { Rarity, RuleSet } from './types';

/* ============================ 合法补丁 id 枚举 ============================ */

export const LAW_PATCH_IDS = [
  // ---- core 战斗/通用补丁（M0 契约） ----
  'wider-push', // 推程延长：推动距离 +1
  'feather-chest', // 羽箱：箱子质量 -1（最低 1）
  'lead-chest', // 铅箱：箱子质量 +1（可叠加，上限 9）
  'berserk', // 狂化：玩家攻击 ×1.5
  'iron-will', // 铁壁：敌方攻击 ×0.75
  'light-step', // 轻步：步数消耗 -（moveCost 0.5）
  'gravity-well', // 重力井：允许推挤出界坠落（combat 斩杀）
  'plane-shift', // 位面通行：解锁 F 位面切换
  'second-chance', // 再临：战败免死一次
  // ---- 谜题侧补丁（已全部注册于此：唯一真相，谜题引擎经 buildPuzzleRuleSet
  //      → applyPatchChain 消费；一补丁一卡，稀有度一致） ----
  'diagonal-push', // 斜向推挤：允许沿对角线推箱
  'chest-off-goal', // 箱可推离：就位箱可推落基座落差
  'mirror-pull', // 镜像拉箱：允许「后退拉箱」
  'phase-walk', // 相位穿行：解锁穿行（消耗充能穿过一格障碍）
  'chest-detonate', // 箱落引爆：箱落时可引爆的次数 +1
  'plane-eye', // 位面之眼：任意位置切位面（否则须站位面锚点）
  'knockback-plus-2', // 击退+2：布阵推挤的击退格数 +2（战斗侧应用点）
  'explode-plus-1', // 爆炸+1：箱落引爆次数 +1
] as const;

export type LawPatchId = (typeof LAW_PATCH_IDS)[number];

/* ============================ 补丁效果 zod schema ========================= */

export const LawPatchEffectSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), field: z.enum(['pushRange', 'chestMass', 'phaseWalkCharges', 'detonationCharges', 'knockbackCells']), value: z.number().int().min(-2).max(2) }),
  z.object({ op: z.literal('mul'), field: z.enum(['playerAttackMul', 'enemyAttackMul', 'moveCost']), value: z.number().min(0.25).max(4) }),
  z.object({ op: z.literal('set'), field: z.enum(['fallFatal', 'planeShiftEnabled', 'secondChance', 'pullEnabled', 'diagonalPushEnabled', 'chestOffGoalEnabled', 'phaseWalkEnabled', 'planeEyeEnabled']), value: z.boolean() }),
]);
export type LawPatchEffect = z.infer<typeof LawPatchEffectSchema>;

export interface LawPatchDef {
  readonly id: LawPatchId;
  readonly name: string;
  readonly description: string;
  readonly rarity: Rarity;
  readonly effect: LawPatchEffect;
}

export const LAW_PATCHES: Readonly<Record<LawPatchId, LawPatchDef>> = Object.freeze({
  'wider-push': {
    id: 'wider-push',
    name: '长臂法则',
    description: '推挤距离 +1（本段有效）',
    rarity: 3,
    effect: { op: 'add', field: 'pushRange', value: 1 },
  },
  'feather-chest': {
    id: 'feather-chest',
    name: '羽化法则',
    description: '箱子质量 -1，更容易推动连锁',
    rarity: 2,
    effect: { op: 'add', field: 'chestMass', value: -1 },
  },
  'lead-chest': {
    id: 'lead-chest',
    name: '铅封法则',
    description: '箱子质量 +1，战斗推挤伤害提高',
    rarity: 2,
    effect: { op: 'add', field: 'chestMass', value: 1 },
  },
  berserk: {
    id: 'berserk',
    name: '狂化法则',
    description: '玩家攻击 ×1.5',
    rarity: 3,
    effect: { op: 'mul', field: 'playerAttackMul', value: 1.5 },
  },
  'iron-will': {
    id: 'iron-will',
    name: '铁壁法则',
    description: '敌方攻击 ×0.75',
    rarity: 3,
    effect: { op: 'mul', field: 'enemyAttackMul', value: 0.75 },
  },
  'light-step': {
    id: 'light-step',
    name: '轻步法则',
    description: '步数消耗 ×0.5，星级评定更从容',
    rarity: 4,
    effect: { op: 'mul', field: 'moveCost', value: 0.5 },
  },
  'gravity-well': {
    id: 'gravity-well',
    name: '重力井法则',
    description: '允许把敌人推挤出界（坠落即败退）',
    rarity: 4,
    effect: { op: 'set', field: 'fallFatal', value: true },
  },
  'plane-shift': {
    id: 'plane-shift',
    name: '位面通行',
    description: '解锁 F 位面切换，抵达表里世界的另一侧',
    rarity: 4,
    effect: { op: 'set', field: 'planeShiftEnabled', value: true },
  },
  'second-chance': {
    id: 'second-chance',
    name: '再临法则',
    description: '战败免死一次，HP 回到 1',
    rarity: 4,
    effect: { op: 'set', field: 'secondChance', value: true },
  },
  // ---- 谜题侧补丁（唯一真相：谜题引擎经 buildPuzzleRuleSet → applyPatchChain
  //      消费本表；卡牌引用校验与 UI 展示同源） ----
  'diagonal-push': {
    id: 'diagonal-push',
    name: '斜向推挤',
    description: '解锁对角线推箱，斜角也逃不出掌心。',
    rarity: 3,
    effect: { op: 'set', field: 'diagonalPushEnabled', value: true },
  },
  'chest-off-goal': {
    id: 'chest-off-goal',
    name: '箱可推离',
    description: '就位的箱子也能被推下基座落差（平推离旗始终可行）。',
    rarity: 3,
    effect: { op: 'set', field: 'chestOffGoalEnabled', value: true },
  },
  // ---- 谜题侧补丁（曾由 engine/puzzle/rules.ts 的副本表补位；现已收拢到本注册表
  //      作为唯一真相，谜题引擎经 buildPuzzleRuleSet → applyPatchChain 消费） ----
  'mirror-pull': {
    id: 'mirror-pull',
    name: '镜像拉箱',
    description: '箱子如镜像随行：后退即拉箱。',
    rarity: 4,
    effect: { op: 'set', field: 'pullEnabled', value: true },
  },
  'phase-walk': {
    id: 'phase-walk',
    name: '相位穿行',
    description: '解锁穿行充能：消耗 1 充能穿过一格障碍。',
    rarity: 4,
    effect: { op: 'set', field: 'phaseWalkEnabled', value: true },
  },
  'chest-detonate': {
    id: 'chest-detonate',
    name: '箱落引爆',
    description: '箱落可引爆一次，清除落点四邻的可破坏实体。',
    rarity: 4,
    effect: { op: 'add', field: 'detonationCharges', value: 1 },
  },
  'plane-eye': {
    id: 'plane-eye',
    name: '位面之眼',
    description: '阴阳两面尽收眼底：任意位置皆可切位面。',
    rarity: 4,
    effect: { op: 'set', field: 'planeEyeEnabled', value: true },
  },
  'knockback-plus-2': {
    id: 'knockback-plus-2',
    name: '击退+2',
    description: '布阵推挤的击退格数 +2（战斗侧应用）。',
    rarity: 3,
    effect: { op: 'add', field: 'knockbackCells', value: 2 },
  },
  'explode-plus-1': {
    id: 'explode-plus-1',
    name: '爆炸+1',
    description: '箱落引爆次数 +1。',
    rarity: 3,
    effect: { op: 'add', field: 'detonationCharges', value: 1 },
  },
});

/* ============================== 应用补丁（纯） ============================= */

export const DEFAULT_RULE_SET: RuleSet = Object.freeze({
  pushRange: 1,
  chestMass: 2,
  playerAttackMul: 1,
  enemyAttackMul: 1,
  moveCost: 1,
  fallFatal: false,
  planeShiftEnabled: false,
  secondChance: false,
  // 谜题侧扩展字段默认全关（对应 mirror-pull/diagonal-push/... 补丁组）
  pullEnabled: false,
  diagonalPushEnabled: false,
  chestOffGoalEnabled: false,
  phaseWalkEnabled: false,
  phaseWalkCharges: 0,
  detonationCharges: 0,
  knockbackCells: 0,
  planeEyeEnabled: false,
});

export type PatchResult =
  | { readonly ok: true; readonly ruleSet: RuleSet }
  | { readonly ok: false; readonly error: string };

/** 应用一个法则补丁，返回新 RuleSet（不修改入参）。未知 id / 非法数值 → ok:false */
export function applyPatch(ruleSet: RuleSet, patchId: string): PatchResult {
  if (!(LAW_PATCH_IDS as readonly string[]).includes(patchId)) {
    return { ok: false, error: `未知法则补丁 id：${patchId}` };
  }
  const def = LAW_PATCHES[patchId as LawPatchId];
  const parsed = LawPatchEffectSchema.safeParse(def.effect);
  if (!parsed.success) {
    return { ok: false, error: `补丁 ${patchId} 的 effect 未通过 schema：${parsed.error.message}` };
  }
  const effect = parsed.data;

  switch (effect.op) {
    case 'add': {
      const next = { ...ruleSet, [effect.field]: clampField(effect.field, ruleSet[effect.field] + effect.value) };
      return { ok: true, ruleSet: next };
    }
    case 'mul': {
      const next = { ...ruleSet, [effect.field]: clampField(effect.field, ruleSet[effect.field] * effect.value) };
      return { ok: true, ruleSet: next };
    }
    case 'set': {
      return { ok: true, ruleSet: { ...ruleSet, [effect.field]: effect.value } };
    }
  }
}

function clampField(field: keyof RuleSet, value: number): number {
  if (field === 'chestMass') return Math.max(1, Math.min(9, Math.round(value)));
  if (field === 'moveCost') return Math.max(0.25, Math.round(value * 100) / 100);
  if (field === 'pushRange') return Math.max(1, Math.min(3, Math.round(value)));
  // 谜题侧数值字段（充能/引爆/击退格数）：0..9，与谜题引擎的应用表一致
  if (field === 'phaseWalkCharges' || field === 'detonationCharges' || field === 'knockbackCells') {
    return Math.max(0, Math.min(9, Math.round(value)));
  }
  return value;
}

/** 级联应用一串补丁（首个失败即停） */
export function applyPatchChain(ruleSet: RuleSet, patchIds: readonly string[]): PatchResult {
  let current = ruleSet;
  for (const id of patchIds) {
    const r = applyPatch(current, id);
    if (!r.ok) return r;
    current = r.ruleSet;
  }
  return { ok: true, ruleSet: current };
}

/* ======================== 角色卡 BuffId 枚举与校验 ========================== */

export const BUFF_IDS = ['attackUp', 'defenseUp', 'hpUp', 'firstStrike', 'regenerate'] as const;
export type BuffId = (typeof BUFF_IDS)[number];

/** Buff 数值范围（越界即坏档/外挂数据，schema 直接拒绝） */
export const BUFF_RANGES: Readonly<Record<BuffId, { readonly min: number; readonly max: number }>> = Object.freeze({
  attackUp: { min: 5, max: 120 },
  defenseUp: { min: 1, max: 60 },
  hpUp: { min: 10, max: 300 },
  firstStrike: { min: 0, max: 1 },
  regenerate: { min: 1, max: 20 },
});

export const BuffSchema = z
  .object({
    buffId: z.enum(BUFF_IDS),
    value: z.number(),
  })
  .refine((b) => {
    const range = BUFF_RANGES[b.buffId as BuffId];
    return range !== undefined && b.value >= range.min && b.value <= range.max;
  }, 'Buff 数值超出注册表范围');

export type Buff = z.infer<typeof BuffSchema>;

export function validateBuff(input: unknown): { ok: true; buff: Buff } | { ok: false; error: string } {
  const parsed = BuffSchema.safeParse(input);
  return parsed.success ? { ok: true, buff: parsed.data } : { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
}
