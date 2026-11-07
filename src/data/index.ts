/**
 * 数据层聚合出口 —— 世界表唯一组装点。
 * validateWorld()（core/schema.ts）在此表上做集成期一致性校验。
 *
 * 集成期装配说明：
 *  - LEVELS ← levels/areas.ts 的 12 关（经 data/levels.ts 门面，Level3D 扩展
 *    字段对 LevelDefSchema 透明，validateWorld 直接可跑）；
 *  - CARDS/GACHA_CONFIG ← data/gacha.ts 门面（正式表 ALL_GACHA_CARDS /
 *    FORMAL_GACHA_CONFIG，双真相源已消除）；
 *  - 剧本解释器的剧本/触发/求解器总表在 storyScripts.ts（与 STORY_EVENTS
 *    骨架表并行：后者仍是 schema 校验的世界表成员）。
 */

import type { WorldTables } from '../core/schema';
import { LEVELS } from './levels';
import { ENEMIES } from './enemies';
import { WEAPONS } from './weapons';
import { GACHA_CONFIG, CARDS } from './gacha';
import { STORY_EVENTS } from './story';
import { AUDIO_MANIFEST } from './audio';

export { LEVELS, findLevel } from './levels';
export { ENEMIES, findEnemy } from './enemies';
export { WEAPONS, findWeapon, createWeaponInstance, WEAPON_TRAITS, type WeaponInstance } from './weapons';
export { GACHA_CONFIG, GACHA_FLAVOR, CARDS } from './gacha';
export { STORY_EVENTS, SPEAKERS } from './story';
export { AUDIO_MANIFEST, findBgm } from './audio';
export { I18N_PACKS, LOCALE_NAMES, t } from './i18n';
export { ALL_SCRIPTS, ALL_SPEAKERS, ALL_TRIGGER_RULES, STORY_SOLVERS, findScriptById, validateStoryTables } from './storyScripts';

export const WORLD_TABLES: WorldTables = {
  levels: LEVELS,
  enemies: ENEMIES,
  weapons: WEAPONS,
  gachaConfig: GACHA_CONFIG,
  cards: CARDS,
  storyEvents: STORY_EVENTS,
  audio: AUDIO_MANIFEST,
};
