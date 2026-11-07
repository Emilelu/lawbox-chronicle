/**
 * 抽卡配置与卡池 —— 聚合出口（集成期改造）。
 * ---------------------------------------------------------------------------
 * 骨架期本文件自带一份 CARDS/GACHA_CONFIG，与 gacha-engine 的
 * data/gacha/pools.ts + data/cards/*（正式表）构成双真相源（骨架
 * card-law-wider-push 标 4★ 而注册表补丁是 3★）。集成期以正式表为唯一
 * 真相源，本文件退化为门面：CARDS → ALL_GACHA_CARDS、GACHA_CONFIG →
 * FORMAL_GACHA_CONFIG，历史 import 点（store/selectors/GachaOverlay/
 * DeckPanel/SettingsDrawer）零改动。
 *
 * 概率与保底数值的唯一出处：src/data/gacha/pools.ts（FORMAL_POOL）。
 * 怀旧池参数（Lottery.java:40-46 原值）见同文件 NOSTALGIA_PARAMS。
 */

import { ALL_GACHA_CARDS, FORMAL_GACHA_CONFIG } from './gacha/pools';
import type { CardDef, GachaConfig } from '../core/types';

/** 卡池聚合：法则卡 + 角色卡（指向 lawRegistry 补丁 id / BuffId） */
export const CARDS: readonly CardDef[] = ALL_GACHA_CARDS;

/** 正式池「法则箱庭池」的 core 形状配置（数值与 FORMAL_POOL 严格同源） */
export const GACHA_CONFIG: GachaConfig = FORMAL_GACHA_CONFIG;

export const GACHA_FLAVOR = {
  banner: '★KiraKira~★DokiDoki~★', // Lottery.java:26 原文案
  infinityStones: '当前的星石数：∞',
};
