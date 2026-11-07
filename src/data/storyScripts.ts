/**
 * 剧情剧本聚合出口 —— 解释器（engine/story）与数据层（data/story/*）的装配点。
 * ---------------------------------------------------------------------------
 * 集成期把 story-weaver 的全部剧本/说话者/求解器/触发规则在此汇总：
 *   - ALL_SCRIPTS：四天使 + 残留羽毛 + 作者谜题/提示 + BOSS 三幕 + 隐藏关 +
 *     四方向越界 + 门槛补发（triggers 内联）+ 三小怪遭遇战（mobs.ts）；
 *   - ALL_SPEAKERS：各模块说话者表合并（DialogueBox 的展示名映射）；
 *   - STORY_SOLVERS：作者谜题 + 隐藏关作弊码链（解释器 env.solvers 注入）；
 *   - ALL_TRIGGER_RULES：npc/tile 规则总表（顺序即优先级）；越界四方向规则
 *     也在表内，由 store 以 classifyPosition + isOutskirtsTransition 边沿过滤
 *     后统一走 queryTrigger。
 * 交叉 id 一致性由 validateStoryTables 提供（集成期 vitest + 启动断言）。
 */

import {
  validateScript,
  type PuzzleSolver,
  type StoryScriptDef,
} from '../engine/story/interpreter';
import type { TriggerRule } from '../engine/story/triggers';
import { GATE_MAKEUP_SCRIPTS } from '../engine/story/triggers';
import { ANGEL_FEATHER_SCRIPT, ANGEL_SCRIPTS, ANGEL_SPEAKERS } from './story/angels';
import { AUTHOR_HINT_SCRIPT, AUTHOR_PUZZLE_ID, AUTHOR_PUZZLE_SCRIPT, AUTHOR_PUZZLE_SOLVER, AUTHOR_PUZZLE_SPEAKERS } from './story/authorPuzzle';
import { BOSS_ACTS_SCRIPT, BOSS_SPEAKERS } from './story/bossActs';
import { HIDDEN_GAME_SCRIPT, HIDDEN_GAME_SOLVERS, HIDDEN_SPEAKERS } from './story/hiddenGame';
import { OUTSKIRT_SCRIPTS, OUTSKIRT_SPEAKERS, OUTSKIRT_TRIGGER_RULES } from './story/outskirts';
import { MOB_SCRIPTS, MOB_SPEAKERS, MOB_TRIGGER_RULES } from './story/mobs';
import { ANGEL_TRIGGER_RULES } from './story/angels';
import { AUTHOR_TRIGGER_RULES } from './story/authorPuzzle';
import { BOSS_TRIGGER_RULES } from './story/bossActs';
import { GATE_MAKEUP_SPEAKERS } from '../engine/story/triggers';
import { SPEAKERS as SKELETON_SPEAKERS } from './story';

/* ================================ 剧本总表 ================================ */

export const ALL_SCRIPTS: readonly StoryScriptDef[] = [
  ...ANGEL_SCRIPTS,
  ANGEL_FEATHER_SCRIPT,
  AUTHOR_PUZZLE_SCRIPT,
  AUTHOR_HINT_SCRIPT,
  BOSS_ACTS_SCRIPT,
  HIDDEN_GAME_SCRIPT,
  ...OUTSKIRT_SCRIPTS,
  ...GATE_MAKEUP_SCRIPTS,
  ...MOB_SCRIPTS,
];

export function findScriptById(scriptId: string): StoryScriptDef | undefined {
  return ALL_SCRIPTS.find((s) => s.id === scriptId);
}

/* ============================== 说话者总表 ================================ */

export const ALL_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  ...SKELETON_SPEAKERS,
  ...ANGEL_SPEAKERS,
  ...AUTHOR_PUZZLE_SPEAKERS,
  ...BOSS_SPEAKERS,
  ...HIDDEN_SPEAKERS,
  ...OUTSKIRT_SPEAKERS,
  ...GATE_MAKEUP_SPEAKERS,
  ...MOB_SPEAKERS,
});

/* ============================== 求解器注册表 ============================== */

export const STORY_SOLVERS: Readonly<Record<string, PuzzleSolver>> = Object.freeze({
  ...HIDDEN_GAME_SOLVERS,
  [AUTHOR_PUZZLE_ID]: AUTHOR_PUZZLE_SOLVER,
});

/* ============================== 触发规则总表 ============================== */

/**
 * 顺序即优先级：小怪/天使（遭遇教学）→ 作者（前置谜题）→ BOSS → 越界。
 * 关卡入口（level-entry）补发不在表内 —— startLevel 时单独调
 * checkLevelEntryDeck（triggers.ts）。
 */
export const ALL_TRIGGER_RULES: readonly TriggerRule[] = [
  ...MOB_TRIGGER_RULES,
  ...ANGEL_TRIGGER_RULES,
  ...AUTHOR_TRIGGER_RULES,
  ...BOSS_TRIGGER_RULES,
  ...OUTSKIRT_TRIGGER_RULES,
];

/* ============================ 静态体检（集成期） =========================== */

export interface StoryTableIssues {
  readonly danglingEdges: readonly string[];
  readonly brokenRefs: readonly string[];
}

/**
 * 剧本静态体检：悬空边（K15）+ 跨表字符串 id（武器/敌人/卡与 data 表对齐）。
 * 启动断言与 vitest 共用。
 */
export function validateStoryTables(
  weaponIds: readonly string[],
  enemyIds: readonly string[],
  cardIds: readonly string[],
): StoryTableIssues {
  const danglingEdges: string[] = [];
  for (const script of ALL_SCRIPTS) {
    danglingEdges.push(...validateScript(script).map((issue) => `[${script.id}] ${issue}`));
  }

  const brokenRefs: string[] = [];
  const weaponSet = new Set(weaponIds);
  const enemySet = new Set(enemyIds);
  const cardSet = new Set(cardIds);
  for (const script of ALL_SCRIPTS) {
    for (const node of script.nodes) {
      const effects = [
        ...(node.kind === 'dialogue' || node.kind === 'choice' ? (node.onEnterEffects ?? []) : []),
      ];
      for (const eff of effects) {
        if (eff.kind === 'grantWeapon' && !weaponSet.has(eff.weaponId)) {
          brokenRefs.push(`[${script.id}] grantWeapon ${eff.weaponId} 不在 weapons 表`);
        }
        if (eff.kind === 'grantCard' && !cardSet.has(eff.cardId)) {
          brokenRefs.push(`[${script.id}] grantCard ${eff.cardId} 不在 cards 表`);
        }
      }
      if (node.kind === 'battle' && !enemySet.has(node.enemyId)) {
        brokenRefs.push(`[${script.id}] battle 敌人 ${node.enemyId} 不在 enemies 表`);
      }
    }
  }
  return { danglingEdges, brokenRefs };
}
