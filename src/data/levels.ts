/**
 * 关卡数据 —— 聚合出口（集成期改造）。
 * ---------------------------------------------------------------------------
 * 骨架期本文件自带 4 关平面数据；puzzle-engine 交付的 src/data/levels/areas.ts
 * 把它们逐格保真地升格为 3D 高度层版（Level3D：旗格基座化）并新增 8 关，
 * 共 12 关。集成期以 areas.ts 为唯一数据源（ST6：全部关卡经 solver 离线
 * 校验可解），本文件退化为门面 —— 历史 import 点（data/index、GridArena、
 * WorldCanvas、selectors、WelcomeScreen、schema 测试）零改动。
 */

import { AREA_LEVELS } from './levels/areas';
import type { LevelDef } from '../core/types';

/** 主线 12 关（原 4 关 3D 基座化 + 新 8 关，见 levels/areas.ts） */
export const LEVELS: readonly LevelDef[] = AREA_LEVELS;

export function findLevel(levelId: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === levelId);
}
