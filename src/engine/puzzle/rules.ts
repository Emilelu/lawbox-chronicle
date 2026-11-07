/**
 * puzzle/rules —— RuleSet 接口与规则应用点。
 * ---------------------------------------------------------------------------
 * 法则卡补丁的所有权归 core/lawRegistry.ts：本模块**消费**注册表
 * （applyPatch / applyPatchChain），绝不反向向数据层暴露语义。
 *
 * 对接点说明（集成期处理）：core 的 LAW_PATCH_IDS 目前只注册了 9 个
 * 战斗/通用补丁（wider-push、feather-chest、berserk…），尚未收录谜题侧的
 * 12 法则计划卡（镜像拉箱/斜向推挤/箱可推离/相位穿行/箱落引爆/位面之眼/
 * 击退+2/爆炸+1）。本文件以与 core 完全同构的约定（id 枚举 + zod effect
 * 校验 + 纯函数 apply）定义 PUZZLE_LAW_PATCHES 作为补位注册表：
 *   - core 已注册的 id → 走 core applyPatchChain（唯一真相）；
 *   - 仅谜题侧需要的 id → 本表补位；
 *   - 两边都没有的 id → ok:false，拒绝静默忽略。
 * 集成期把 PUZZLE_LAW_IDS 上提进 core 后，本表可整体退役。
 *
 * 规则应用点（move.ts 消费的谓词，全部纯函数）：
 *   拉箱 → canPull            斜推   → canDiagonalPush
 *   箱可推离 → canDropSeatedChest   穿行充能 → phaseWalkOf / phaseChargeCost
 *   击退格数 → knockbackOf（战斗侧应用点，puzzle 不消费）
 *   爆炸次数 → detonationsOf        阴阳位面 → canShiftPlaneFreely
 */

import { z } from 'zod';
import type { RuleSet } from '../../core/types';
import { applyPatchChain, DEFAULT_RULE_SET } from '../../core/lawRegistry';

/* ============================== RuleSet 扩展 ============================== */

/** 谜题侧规则集 = core RuleSet + 谜题扩展字段（对接点，集成期可上提 core） */
export interface PuzzleRuleSet extends RuleSet {
  /** 镜像拉箱：允许「后退拉箱」（玩家后退一格，箱子跟进到玩家原格） */
  readonly pullEnabled: boolean;
  /** 斜向推挤：允许沿对角线推箱（玩家进箱原格） */
  readonly diagonalPushEnabled: boolean;
  /** 箱可推离：允许把已就位（旗格上）的箱子推落基座落差（平推离旗始终允许） */
  readonly chestOffGoalEnabled: boolean;
  /** 相位穿行：解锁穿行（消耗充能穿过一格障碍） */
  readonly phaseWalkEnabled: boolean;
  /** 每段开局自带的穿行充能数 */
  readonly phaseWalkCharges: number;
  /** 箱落引爆：箱落时可引爆的次数（0 = 未解锁；爆炸清除落点四邻的可破坏实体） */
  readonly detonationCharges: number;
  /** 击退格数：战斗布阵推挤的击退距离（combat-engine 消费；puzzle 不用） */
  readonly knockbackCells: number;
  /** 位面之眼：任意位置切位面（否则须站在位面锚点） */
  readonly planeEyeEnabled: boolean;
}

export const DEFAULT_PUZZLE_RULE_SET: PuzzleRuleSet = Object.freeze({
  ...DEFAULT_RULE_SET,
  pullEnabled: false,
  diagonalPushEnabled: false,
  chestOffGoalEnabled: false,
  phaseWalkEnabled: false,
  phaseWalkCharges: 0,
  detonationCharges: 0,
  knockbackCells: 0,
  planeEyeEnabled: false,
});

/* ===================== 谜题侧法则补丁（补位注册表） ======================== */

export const PUZZLE_LAW_IDS = [
  'mirror-pull', // 4★ 镜像拉箱
  'diagonal-push', // 3★ 斜向推挤
  'chest-off-goal', // 3★ 箱可推离
  'phase-walk', // 4★ 相位穿行
  'chest-detonate', // 4★ 箱落引爆
  'plane-eye', // 4★ 位面之眼
  'knockback-plus-2', // 3★ 击退+2
  'explode-plus-1', // 3★ 爆炸+1
] as const;

export type PuzzleLawId = (typeof PUZZLE_LAW_IDS)[number];

/** 与 core LawPatchEffectSchema 同构的 effect 约定（字段换成谜题扩展字段） */
export const PuzzleLawEffectSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), field: z.enum(['pullEnabled', 'diagonalPushEnabled', 'chestOffGoalEnabled', 'phaseWalkEnabled', 'planeEyeEnabled']), value: z.boolean() }),
  z.object({ op: z.literal('add'), field: z.enum(['phaseWalkCharges', 'detonationCharges', 'knockbackCells']), value: z.number().int().min(-3).max(3) }),
]);
export type PuzzleLawEffect = z.infer<typeof PuzzleLawEffectSchema>;

export interface PuzzleLawDef {
  readonly id: PuzzleLawId;
  readonly name: string;
  readonly description: string;
  readonly effect: PuzzleLawEffect;
}

export const PUZZLE_LAW_PATCHES: Readonly<Record<PuzzleLawId, PuzzleLawDef>> = Object.freeze({
  'mirror-pull': {
    id: 'mirror-pull',
    name: '镜像拉箱',
    description: '箱子如镜像随行：后退即拉箱。',
    effect: { op: 'set', field: 'pullEnabled', value: true },
  },
  'diagonal-push': {
    id: 'diagonal-push',
    name: '斜向推挤',
    description: '解锁对角线推箱，斜角也逃不出掌心。',
    effect: { op: 'set', field: 'diagonalPushEnabled', value: true },
  },
  'chest-off-goal': {
    id: 'chest-off-goal',
    name: '箱可推离',
    description: '就位的箱子也能被推下基座落差（平推离旗始终可行）。',
    effect: { op: 'set', field: 'chestOffGoalEnabled', value: true },
  },
  'phase-walk': {
    id: 'phase-walk',
    name: '相位穿行',
    description: '解锁穿行充能：消耗 1 充能穿过一格障碍。',
    effect: { op: 'set', field: 'phaseWalkEnabled', value: true },
  },
  'chest-detonate': {
    id: 'chest-detonate',
    name: '箱落引爆',
    description: '箱落可引爆一次，清除落点四邻的可破坏实体。',
    effect: { op: 'add', field: 'detonationCharges', value: 1 },
  },
  'plane-eye': {
    id: 'plane-eye',
    name: '位面之眼',
    description: '阴阳两面尽收眼底：任意位置皆可切位面。',
    effect: { op: 'set', field: 'planeEyeEnabled', value: true },
  },
  'knockback-plus-2': {
    id: 'knockback-plus-2',
    name: '击退+2',
    description: '布阵推挤的击退格数 +2（战斗侧应用）。',
    effect: { op: 'add', field: 'knockbackCells', value: 2 },
  },
  'explode-plus-1': {
    id: 'explode-plus-1',
    name: '爆炸+1',
    description: '箱落引爆次数 +1。',
    effect: { op: 'add', field: 'detonationCharges', value: 1 },
  },
});

/* ============================ 应用补丁（纯） =============================== */

export type PuzzlePatchResult =
  | { readonly ok: true; readonly ruleSet: PuzzleRuleSet }
  | { readonly ok: false; readonly error: string };

/** 应用单个谜题侧法则补丁（zod 校验 + 字段钳制，纯函数） */
export function applyPuzzlePatch(ruleSet: PuzzleRuleSet, patchId: string): PuzzlePatchResult {
  if (!(PUZZLE_LAW_IDS as readonly string[]).includes(patchId)) {
    return { ok: false, error: `未知谜题法则 id：${patchId}` };
  }
  const def = PUZZLE_LAW_PATCHES[patchId as PuzzleLawId];
  const parsed = PuzzleLawEffectSchema.safeParse(def.effect);
  if (!parsed.success) {
    return { ok: false, error: `补丁 ${patchId} effect 未通过 schema：${parsed.error.message}` };
  }
  const effect = parsed.data;
  if (effect.op === 'set') {
    return { ok: true, ruleSet: { ...ruleSet, [effect.field]: effect.value } };
  }
  const raw = ruleSet[effect.field] + effect.value;
  const clamped = Math.max(0, Math.min(9, raw));
  return { ok: true, ruleSet: { ...ruleSet, [effect.field]: clamped } };
}

/**
 * 把一串法则卡补丁 id 注入基础 RuleSet，产出谜题规则集（纯函数）。
 * core 注册过的 id 交给 core applyPatchChain（消费注册表）；谜题侧 id 走补位表。
 */
export function buildPuzzleRuleSet(base: RuleSet, patchIds: readonly string[]): PuzzlePatchResult {
  const coreOwned: string[] = [];
  const puzzleOwned: string[] = [];
  for (const id of patchIds) {
    if ((PUZZLE_LAW_IDS as readonly string[]).includes(id)) puzzleOwned.push(id);
    else coreOwned.push(id);
  }
  const viaCore = applyPatchChain(base, coreOwned);
  if (!viaCore.ok) return viaCore;
  let current: PuzzleRuleSet = { ...DEFAULT_PUZZLE_RULE_SET, ...viaCore.ruleSet };
  for (const id of puzzleOwned) {
    const r = applyPuzzlePatch(current, id);
    if (!r.ok) return r;
    current = r.ruleSet;
  }
  return { ok: true, ruleSet: current };
}

/* ============================ 规则应用点（纯谓词） ========================= */

/** 拉箱是否解锁 */
export function canPull(rules: PuzzleRuleSet): boolean {
  return rules.pullEnabled;
}

/** 斜推是否解锁 */
export function canDiagonalPush(rules: PuzzleRuleSet): boolean {
  return rules.diagonalPushEnabled;
}

/** 就位箱（旗格上）是否可被推落基座落差；平推离旗格永远允许（S4 标准语义） */
export function canDropSeatedChest(rules: PuzzleRuleSet): boolean {
  return rules.chestOffGoalEnabled;
}

/** 穿行是否解锁 */
export function phaseWalkUnlocked(rules: PuzzleRuleSet): boolean {
  return rules.phaseWalkEnabled;
}

/** 一次穿行消耗的充能（恒 1；留字段便于后续法则改写） */
export function phaseChargeCost(_rules: PuzzleRuleSet): number {
  return 1;
}

/** 箱落引爆次数（0 = 未解锁） */
export function detonationsOf(rules: PuzzleRuleSet): number {
  return Math.max(0, rules.detonationCharges);
}

/** 击退格数（combat-engine 布阵推挤的应用点；puzzle 引擎本身不消费） */
export function knockbackOf(rules: PuzzleRuleSet): number {
  return Math.max(0, rules.knockbackCells);
}

/** 是否可在任意位置切位面（位面之眼）；否则须站位面锚点 */
export function canShiftPlaneFreely(rules: PuzzleRuleSet): boolean {
  return rules.planeEyeEnabled;
}
