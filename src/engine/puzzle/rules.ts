/**
 * puzzle/rules —— RuleSet 接口与规则应用点。
 * ---------------------------------------------------------------------------
 * 法则卡补丁的所有权归 core/lawRegistry.ts：本模块**消费**注册表
 * （applyPatchChain），绝不反向向数据层暴露语义。
 *
 * 单一真相（收尾修复）：core 的 LAW_PATCH_IDS 已收录全部 17 个补丁
 * （9 个战斗/通用 + 8 个谜题侧），引擎侧不再保留效果副本表——所有 id
 * 一律经 core applyPatchChain 消费；未知 id 由 core 返回 ok:false。
 *
 * 规则应用点（move.ts 消费的谓词，全部纯函数）：
 *   拉箱 → canPull            斜推   → canDiagonalPush
 *   箱可推离 → canDropSeatedChest   穿行充能 → phaseWalkOf / phaseChargeCost
 *   击退格数 → knockbackOf（战斗侧应用点，puzzle 不消费）
 *   爆炸次数 → detonationsOf        阴阳位面 → canShiftPlaneFreely
 */

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

/* ============================ 应用补丁（纯） =============================== */

export type PuzzlePatchResult =
  | { readonly ok: true; readonly ruleSet: PuzzleRuleSet }
  | { readonly ok: false; readonly error: string };

/**
 * 把一串法则卡补丁 id 注入基础 RuleSet，产出谜题规则集（纯函数）。
 * 单一真相：所有补丁 id 一律经 core/lawRegistry 的 applyPatchChain 消费，
 * 谜题侧不维护效果副本表；未知 id 由 core 返回 ok:false（拒绝静默忽略）。
 */
export function buildPuzzleRuleSet(base: RuleSet, patchIds: readonly string[]): PuzzlePatchResult {
  const viaCore = applyPatchChain(base, patchIds);
  if (!viaCore.ok) return viaCore;
  return { ok: true, ruleSet: { ...DEFAULT_PUZZLE_RULE_SET, ...viaCore.ruleSet } };
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
