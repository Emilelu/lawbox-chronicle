/**
 * puzzle/undo —— 撤销栈。
 * ---------------------------------------------------------------------------
 * SanBPushChest 没有任何撤销能力（ST2：0.4.0 计划中的 undo 从未兑现）；
 * 本文件以纯函数实现撤销栈：每次成功动作前由 move.ts 压入切片，
 * undo 直接弹出恢复——实体/步数/充能/位面一体回滚，无悬停引用（S2 根治：
 * 快照是值的拷贝，不共享可变结构）。
 */

import type { GridEntity } from '../../core/types';
import type { PuzzleState } from './move';

export function canUndo(state: PuzzleState): boolean {
  return state.history.length > 0;
}

/** 撤销栈深度（UI 可视化用） */
export function historyDepth(state: PuzzleState): number {
  return state.history.length;
}

/**
 * 撤销一步：弹出最后一个切片并整体恢复。
 * 栈空时原样返回（不抛错、不逃逸——引擎层禁一切异常路径）。
 */
export function undoPuzzle(state: PuzzleState): PuzzleState {
  if (state.history.length === 0) return state;
  const last = state.history[state.history.length - 1];
  if (last === undefined) return state;
  const entities: readonly GridEntity[] = last.entities;
  return {
    ...state,
    entities,
    steps: last.steps,
    pushes: last.pushes,
    phaseCharges: last.phaseCharges,
    detonationsLeft: last.detonationsLeft,
    planeShifted: last.planeShifted,
    history: state.history.slice(0, -1),
  };
}

/** 清空撤销栈（Q 重玩本段 / 载入新段时调用） */
export function clearHistory(state: PuzzleState): PuzzleState {
  return { ...state, history: [] };
}
