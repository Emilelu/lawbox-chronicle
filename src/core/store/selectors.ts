/**
 * selectors —— 派生数据的唯一出口。
 * ---------------------------------------------------------------------------
 * 「实体→网格占位」等一切派生一律在此现算，store 永不保存第二份地图
 * （SanBPushChest 幻影箱子 S1、悬挂引用 S2、重复 id S12 的双真相源根治）。
 * 视图层只读 selector、只 dispatch action。
 */

import type { GameState, GridEntity, LevelDef, Rarity, CardDef } from '../types';
import { occupancyOf } from '../gridMove';
import { findLevelAny } from './gameStore';
import { findWeapon } from '../../data/weapons';
import { GACHA_CONFIG, CARDS } from '../../data/gacha';
import { LAW_PATCHES, type LawPatchDef } from '../lawRegistry';
import { levelName as levelNameI18n, levelSubtitle as levelSubtitleI18n, weaponName as weaponNameI18n } from '../../data/i18n/uiText';

/** 实体占位表（id→entity），每调用现算 */
export function selectOccupancy(state: GameState): Map<string, GridEntity> {
  if (state.segment === null) return new Map();
  return occupancyOf(state.segment.entities);
}

export function selectPlayerEntity(state: GameState): GridEntity | undefined {
  return state.segment?.entities.find((e) => e.kind === 'player');
}

export function selectChests(state: GameState): readonly GridEntity[] {
  return state.segment?.entities.filter((e) => e.kind === 'chest') ?? [];
}

/** 箱子是否全部落在旗位（terrain 3）——关卡完成判定 */
export function selectLevelComplete(state: GameState): boolean {
  if (state.segment === null) return false;
  // B3-3：改走 findLevelAny（静态表 + 会话注册表）——挑战层等会话关卡的
  // 箱落旗判定此前查静态表落空，恒 false
  const level = findLevelAny(state.segment.levelId);
  if (level === undefined) return false;
  const chests = selectChests(state);
  return (
    chests.length > 0 &&
    chests.every((c) => {
      const row = level.grid[c.y];
      return row !== undefined && row[c.x] === 3;
    })
  );
}

export interface HudModel {
  readonly levelId: string | null;
  readonly levelName: string;
  readonly areaName: string;
  readonly steps: number;
  readonly starStones: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly weaponName: string | null;
}

/** HUD 胶囊数据模型（左上角） */
export function selectHudModel(state: GameState): HudModel {
  // B3-3：改走 findLevelAny —— 会话生成关卡（挑战层/无尽回廊）此前查静态表
  // 落空，HUD 关卡名/副标题恒显示 '—'
  const level: LevelDef | undefined = state.segment !== null ? findLevelAny(state.segment.levelId) : undefined;
  const weapon = state.player.weaponId !== null ? findWeapon(state.player.weaponId) : undefined;
  const weaponBonus = weapon?.attack ?? 0;
  return {
    levelId: state.segment?.levelId ?? null,
    // F4：关卡名/副标题按当前语种解析（未收录 levelId 回落关卡数据原文）
    levelName: level !== undefined ? levelNameI18n(state.locale, level) : '—',
    areaName: level !== undefined ? levelSubtitleI18n(state.locale, level) : '—',
    steps: state.segment !== null ? Math.ceil(state.segment.steps) : 0,
    starStones: state.gacha.starStones,
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    attack: Math.round((state.player.baseAttack + weaponBonus) * state.ruleSet.playerAttackMul),
    // C4：武器名按语种解析（与上方 levelName/areaName 的 F4 同款——非中文语种
    // 下 HUD「ATK 60 · 篮球」此前恒显示数据层中文武器名）
    weaponName: weapon !== undefined ? weaponNameI18n(state.locale, weapon) : null,
  };
}

export interface LawChip {
  readonly cardId: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rarity: Rarity;
}

/** 右侧「法则快捷栏」的规则芯片（由激活卡牌 → lawRegistry 现算） */
export function selectActiveLawChips(state: GameState): readonly LawChip[] {
  const mapped: readonly (LawChip | undefined)[] = state.gacha.activeLaws.map(
    (cardId): LawChip | undefined => {
      const card = CARDS.find((c: CardDef) => c.id === cardId);
      if (card === undefined || card.lawPatchId === undefined) return undefined;
      const patch: LawPatchDef | undefined = LAW_PATCHES[card.lawPatchId as keyof typeof LAW_PATCHES];
      if (patch === undefined) return undefined;
      return { cardId, id: patch.id, name: patch.name, description: patch.description, rarity: card.rarity };
    },
  );
  return mapped.filter((chip): chip is LawChip => chip !== undefined);
}

/** 角色卡 Buff 合计（combat-engine 消费） */
export function selectCharacterBuffTotals(state: GameState): Readonly<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const cardId of state.gacha.activeLaws) {
    const card = CARDS.find((c) => c.id === cardId);
    if (card === undefined || card.kind !== 'character' || card.buff === undefined) continue;
    totals[card.buff.buffId] = (totals[card.buff.buffId] ?? 0) + card.buff.value;
  }
  return totals;
}

/** 抽卡可负担性（星石 ≥ 单价 × 次数） */
export function selectCanAfford(state: GameState, times: 1 | 10): boolean {
  return state.gacha.starStones >= GACHA_CONFIG.costPerPull * times;
}
