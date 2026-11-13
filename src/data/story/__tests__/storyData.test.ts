/**
 * 剧本数据侧单测：
 *  - 全量剧本静态体检（无悬空边/缺入口 —— K15 的数据侧断言）；
 *  - 四天使模板保真（台词顺序差异 + 姐妹锁）；
 *  - 作者谜题（两组答案 / 全角宽容 / 重试提示 / 弱点绑定）；
 *  - BOSS 三幕（秒杀数值 700999314 / 分身封顶 64 / 护盾调参 / 通关成就）；
 *  - 隐藏关全链路（作弊码链 → Base64 → 命运三武装 → 真结局 / 伪结局）；
 *  - 越界四方向规则与跨表引用（卡/武器/敌人 id 与 data 层对齐）。
 */

import { describe, expect, it } from 'vitest';
import {
  IDLE_STORY_RUNTIME,
  advanceStory,
  chooseStory,
  resolveBattleResult,
  startStory,
  submitStoryInput,
  validateScript,
  type StoryEffect,
  type StoryRuntimeState,
  type StoryScriptDef,
} from '../../../engine/story/interpreter';
import {
  classifyPosition,
  queryTrigger,
  GATE_MAKEUP_SCRIPTS,
  type TriggerContext,
  type TriggerRule,
} from '../../../engine/story/triggers';
import { gridToWorld } from '../../../core/store/gameStore';
import {
  ANGEL_HUB_FEATHER_SCRIPTS,
  ANGEL_LIGHTFEATHER_SCRIPTS,
  ANGEL_PARAMS,
  ANGEL_SCRIPTS,
  ANGEL_TRIGGER_RULES,
} from '../angels';
import {
  AUTHOR_PUZZLE_ANSWERS,
  AUTHOR_PUZZLE_SCRIPT,
  AUTHOR_PUZZLE_SOLVER,
  AUTHOR_TRIGGER_RULES,
  BOSS_ATTACK_AFTER_PUZZLE,
  AUTHOR_HINT_SCRIPT,
  normalizePuzzleInput,
  resolveBossWeakness,
} from '../authorPuzzle';
import {
  BOSS_ACTS_SCRIPT,
  BOSS_BATTLE_TUNING,
  BOSS_SLAUGHTER_DAMAGE,
  BOSS_TRIGGER_RULES,
  SHADOW_ECHO_SCRIPT,
  SHADOW_ECHO_TRIGGER,
  SHADOW_PROJECTION_SCRIPT,
  SHADOW_PROJECTION_TRIGGER,
  shadowCount,
} from '../bossActs';
import {
  GARBAGE_KILLER,
  HIDDEN_GAME_SCRIPT,
  HIDDEN_GAME_SOLVERS,
  decodeHiddenHint,
  runMetaTerminalCommand,
} from '../hiddenGame';
import {
  EAST_LANDING_POS,
  OUTSKIRT_CHALLENGE_LAYERS,
  OUTSKIRT_SCRIPTS,
  OUTSKIRT_TRIGGER_RULES,
} from '../outskirts';
import { MOB_SCRIPTS, MOB_TRIGGER_RULES } from '../mobs';
import { CARDS } from '../../gacha';
import { WEAPONS } from '../../weapons';
import { ENEMIES } from '../../enemies';
import { AREA_LEVEL_IDS, findAreaLevel } from '../../levels/areas';

/* ============================ 剧本总注册表 ================================ */

const ALL_SCRIPTS: readonly StoryScriptDef[] = [
  ...ANGEL_SCRIPTS,
  ...ANGEL_LIGHTFEATHER_SCRIPTS,
  ...ANGEL_HUB_FEATHER_SCRIPTS,
  AUTHOR_PUZZLE_SCRIPT,
  AUTHOR_HINT_SCRIPT,
  SHADOW_ECHO_SCRIPT,
  SHADOW_PROJECTION_SCRIPT,
  BOSS_ACTS_SCRIPT,
  HIDDEN_GAME_SCRIPT,
  ...OUTSKIRT_SCRIPTS,
  ...GATE_MAKEUP_SCRIPTS,
  ...MOB_SCRIPTS,
];

const ALL_SCRIPT_IDS = new Set(ALL_SCRIPTS.map((s) => s.id));

function findScript(id: string): StoryScriptDef {
  const found = ALL_SCRIPTS.find((s) => s.id === id);
  expect(found, `剧本 ${id} 应存在`).toBeTruthy();
  return found as StoryScriptDef;
}

/** 连续 advance 直到离开 dialogue 阶段（返回最后一次的效果，供守卫/结局断言） */
function walk(script: StoryScriptDef, runtime: StoryRuntimeState): { state: StoryRuntimeState; effects: StoryEffect[] } {
  let cur = runtime;
  let lastEffects: StoryEffect[] = [];
  for (let i = 0; i < 128; i += 1) {
    if (cur.phase !== 'dialogue') return { state: cur, effects: lastEffects };
    const step = advanceStory([script], cur);
    cur = step.state;
    lastEffects = [...step.effects];
  }
  return { state: cur, effects: lastEffects };
}

/* ============================== 静态体检 ================================== */

describe('剧本数据 —— 静态体检（K15 数据侧断言）', () => {
  it('所有剧本无悬空边、入口存在', () => {
    for (const script of ALL_SCRIPTS) {
      expect(validateScript(script), `${script.id} 应无结构问题`).toEqual([]);
    }
  });

  it('剧本 id 无重复', () => {
    expect(ALL_SCRIPTS.length).toBe(ALL_SCRIPT_IDS.size);
  });

  it('所有触发规则的 scriptId 都能对应到真实剧本（含门槛补发剧本）', () => {
    const rules = [
      ...MOB_TRIGGER_RULES,
      ...ANGEL_TRIGGER_RULES,
      ...AUTHOR_TRIGGER_RULES,
      SHADOW_ECHO_TRIGGER,
      SHADOW_PROJECTION_TRIGGER,
      ...BOSS_TRIGGER_RULES,
      ...OUTSKIRT_TRIGGER_RULES,
    ];
    for (const rule of rules) {
      expect(
        ALL_SCRIPT_IDS.has(rule.scriptId),
        `规则 ${rule.id} 的剧本 ${rule.scriptId} 应存在`,
      ).toBe(true);
    }
  });

  it('剧本引用的武器/敌人/卡 id 与 data 层表对齐（跨表字符串 id 校验）', () => {
    const weaponIds = new Set(WEAPONS.map((w) => w.id));
    const enemyIds = new Set(ENEMIES.map((e) => e.id));
    const cardIds = new Set(CARDS.map((c) => c.id));
    for (const script of ALL_SCRIPTS) {
      for (const node of script.nodes) {
        const effects: readonly StoryEffect[] = node.kind === 'dialogue' ? node.onEnterEffects ?? [] : [];
        for (const eff of effects) {
          if (eff.kind === 'grantWeapon') expect(weaponIds.has(eff.weaponId), eff.weaponId).toBe(true);
          if (eff.kind === 'setEnemyAttack') expect(enemyIds.has(eff.enemyId), eff.enemyId).toBe(true);
          if (eff.kind === 'grantCard') expect(cardIds.has(eff.cardId), eff.cardId).toBe(true);
        }
        if (node.kind === 'battle') expect(enemyIds.has(node.enemyId), node.enemyId).toBe(true);
      }
    }
  });

  it('所有谜题节点都注册了求解器', () => {
    for (const script of ALL_SCRIPTS) {
      for (const node of script.nodes) {
        if (node.kind !== 'puzzle') continue;
        const registered =
          HIDDEN_GAME_SOLVERS[node.puzzleId] !== undefined || node.puzzleId === 'puzzle-author-xyz';
        expect(registered, `谜题 ${node.puzzleId}（剧本 ${script.id}）应有求解器`).toBe(true);
      }
    }
  });
});

/* ==================== STORY-5 剧情分布 —— 数据静态断言 ==================== */

/**
 * STORY-5 新增的 level-scoped 规则全量（16 条）：三怪 ×3 + 天使 npc/光羽 ×8 +
 * 作者 npc/躺椅 hint ×2 + 残影/投影 ×2 + BOSS ×1。主城残留羽毛（既有规则，
 * 世界坐标缺省 levelId）不入本集合，另有逐格豁免断言。
 */
const LEVEL_SCOPED_RULES: readonly TriggerRule[] = [
  ...MOB_TRIGGER_RULES,
  ...ANGEL_TRIGGER_RULES.filter((r) => r.when.kind === 'npc' || (r.when.kind === 'tile' && r.when.levelId !== undefined)),
  ...AUTHOR_TRIGGER_RULES,
  SHADOW_ECHO_TRIGGER,
  SHADOW_PROJECTION_TRIGGER,
  ...BOSS_TRIGGER_RULES,
];

describe('STORY-5 剧情分布 —— 数据静态断言', () => {
  it('level-scoped 规则共 16 条，每条都声明 levelId 且对应关卡真实存在', () => {
    expect(LEVEL_SCOPED_RULES).toHaveLength(16);
    for (const rule of LEVEL_SCOPED_RULES) {
      const levelId = rule.when.kind === 'npc' || rule.when.kind === 'tile' ? rule.when.levelId : undefined;
      expect(levelId, `规则 ${rule.id} 必须声明 levelId`).toBeDefined();
      expect(AREA_LEVEL_IDS, `规则 ${rule.id} 的关卡 ${levelId} 应存在`).toContain(levelId);
    }
  });

  it('新增 level-scoped 坐标在对应关卡原始网格为 0（可站/可落格触发）', () => {
    for (const rule of LEVEL_SCOPED_RULES) {
      if (rule.when.kind !== 'npc' && rule.when.kind !== 'tile') continue;
      const { x, y, levelId } = rule.when;
      if (levelId === undefined) continue;
      const raw = findAreaLevel(levelId)?.grid[y]?.[x];
      if (rule.id === 'trigger-boss-ylzz') {
        // 豁免（逐格复核）：BOSS (6,5) 即 L12 王座 2×2 圣坛旗格本体（原始格值 3，
        // 不可站）—— npc 触发无需玩家可站，其覆盖性由下方「goal 邻格 ⊆ r3 覆盖集」
        // 断言单列承担
        expect(raw, 'BOSS (6,5) 应落在王座旗格').toBe(3);
        continue;
      }
      expect(raw, `规则 ${rule.id} @ (${x},${y}) @ ${levelId}`).toBe(0);
    }
  });

  it('主城残留羽毛（既有规则）：①③④ 重化网格为 0；羽毛② hub(6,6) 原始格值 4=箱子出生点（评审⑨豁免）', () => {
    const hub = findAreaLevel('level-sb-01');
    // 世界 (1,0)/(0,1)/(0,-1) → 重化网格 (8,6)/(7,7)/(7,5)，均为可落格地板
    expect(hub?.grid[6]?.[8]).toBe(0);
    expect(hub?.grid[7]?.[7]).toBe(0);
    expect(hub?.grid[5]?.[7]).toBe(0);
    // 羽毛② hub(6,6)：原始格值 4=箱子出生点，属既有行为豁免本断言 ——
    // 箱移开后 tile 才可落格触发（评审⑨；autoPlay 巡游由解路顺路覆盖，不设站）
    expect(hub?.grid[6]?.[6]).toBe(4);
  });

  it('作者谜题：requireFlags 三旗（三怪全灭才现身），npc 与躺椅 hint 同格 L9(5,4)', () => {
    expect(AUTHOR_TRIGGER_RULES).toHaveLength(2);
    const quiz = AUTHOR_TRIGGER_RULES.find((r) => r.id === 'trigger-author-quiz');
    const hint = AUTHOR_TRIGGER_RULES.find((r) => r.id === 'trigger-author-hint');
    expect(quiz?.requireFlags).toEqual([
      'story:defeated:enemy-caixukun',
      'story:defeated:enemy-guolaoshi',
      'story:defeated:enemy-dygg',
    ]);
    expect(quiz?.when).toMatchObject({ kind: 'npc', x: 5, y: 4, levelId: 'level-lb-09' });
    expect(hint?.when).toMatchObject({ kind: 'tile', x: 5, y: 4, levelId: 'level-lb-09' });
  });

  it('天使双旗（评审⑤）：per-angel unlessFlag + 全局旗双写；光羽/主城羽毛拾取统一置 feather-<seq>', () => {
    for (const p of ANGEL_PARAMS) {
      const npcRule = ANGEL_TRIGGER_RULES.find((r) => r.id === `trigger-angel-${p.seq}`);
      expect(npcRule?.unlessFlag).toBe(`story:angel-met-${p.seq}`);
      const entry = ANGEL_SCRIPTS.find((s) => s.id === `script-angel-${p.seq}`)?.nodes[0];
      if (entry === undefined || entry.kind !== 'dialogue') throw new Error(`script-angel-${p.seq} 入口节点缺失`);
      expect(entry.onEnterEffects).toContainEqual({ kind: 'setFlag', key: `story:angel-met-${p.seq}`, value: true });
      expect(entry.onEnterEffects).toContainEqual({ kind: 'setFlag', key: 'story:angels-met', value: `angel-${p.seq}` });
      // 光羽拾取置 per-seq 羽毛旗（L12 彩蛋消费）
      const lightEntry = ANGEL_LIGHTFEATHER_SCRIPTS.find(
        (s) => s.id === `script-angel-lightfeather-${p.seq}`,
      )?.nodes[0];
      if (lightEntry === undefined || lightEntry.kind !== 'dialogue') {
        throw new Error(`script-angel-lightfeather-${p.seq} 入口节点缺失`);
      }
      expect(lightEntry.onEnterEffects).toContainEqual({ kind: 'setFlag', key: `story:feather-${p.seq}`, value: true });
    }
    // 主城羽毛拾取同样置 per-seq 羽毛旗；requireFlag 用全局旗（「至少遇见一位」不失效）
    for (const rule of ANGEL_TRIGGER_RULES.filter((r) => r.id.endsWith('-feather'))) {
      expect(rule.requireFlag).toBe('story:angels-met');
      const seq = rule.id.replace('trigger-angel-', '').replace('-feather', '');
      const entry = ANGEL_HUB_FEATHER_SCRIPTS.find((s) => s.id === rule.scriptId)?.nodes[0];
      if (entry === undefined || entry.kind !== 'dialogue') throw new Error(`${rule.scriptId} 入口节点缺失`);
      expect(entry.onEnterEffects).toContainEqual({ kind: 'setFlag', key: `story:feather-${seq}`, value: true });
    }
  });

  it('L12 断言：goal 4-邻格 ⊆ BOSS npc(6,5) r3 覆盖集（评审④ 修法的可测形式）', () => {
    const level = findAreaLevel('level-lb-12');
    if (level === undefined) throw new Error('level-lb-12 缺失');
    // goal 集合（2×2 圣坛）
    const goals: { x: number; y: number }[] = [];
    level.grid.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell === 3) goals.push({ x, y });
      });
    });
    expect(goals).toContainEqual({ x: 6, y: 5 }); // BOSS 坐标即王座旗格
    // goal 的 4-邻格全集（完成最后一次推箱时玩家必然站在其中之一）
    const neighbors: { x: number; y: number }[] = [];
    for (const g of goals) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = g.x + dx;
        const ny = g.y + dy;
        if (goals.some((o) => o.x === nx && o.y === ny)) continue; // 圣坛内部互邻
        if (!neighbors.some((n) => n.x === nx && n.y === ny)) neighbors.push({ x: nx, y: ny });
      }
    }
    expect(neighbors.length).toBeGreaterThan(0);
    for (const n of neighbors) {
      const dist = Math.abs(n.x - 6) + Math.abs(n.y - 5);
      expect(dist, `goal 邻格 (${n.x},${n.y}) 到 BOSS (6,5) 曼哈顿距离`).toBeLessThanOrEqual(3);
    }
    // 出生点 (1,1) 距 (6,5) 曼哈顿 9 —— 进场不误触
    expect(Math.abs(1 - 6) + Math.abs(1 - 5)).toBe(9);
  });
});

/* ============================== 四天使 ==================================== */

describe('angels —— 同一模板 × 4（Game.java:509-808 数据化 + STORY-5 迁关分布）', () => {
  it('四位天使分布（STORY-5）：①留主城 L1(8,6)、②L4(7,4)、③L5(7,3)、④L10(2,7)', () => {
    expect(ANGEL_PARAMS.map((p) => [p.levelId, p.x, p.y])).toEqual([
      ['level-sb-01', 8, 6],
      ['level-sb-04', 7, 4],
      ['level-lb-05', 7, 3],
      ['level-lb-10', 2, 7],
    ]);
    // 原版出生地（Game.java:48-51）作为「主城残留羽毛」tile 保留（世界坐标）
    expect(ANGEL_TRIGGER_RULES.filter((r) => r.id.endsWith('-feather')).map((r) =>
      r.when.kind === 'tile' ? [r.when.x, r.when.y] : [],
    )).toEqual([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]);
  });

  it('台词顺序保真：①②「难度」在「劝告」前，③④把劝告提前（:540-545 vs :711-716）', () => {
    const orderOf = (script: StoryScriptDef): number[] => {
      const entry = script.nodes[0];
      if (entry === undefined || entry.kind !== 'dialogue') return [];
      const angelLines = entry.lines.filter((l) => l.speakerId.startsWith('npc-angel'));
      return [angelLines.findIndex((l) => l.text.includes('难易度')), angelLines.findIndex((l) => l.text.includes('听我一句劝'))];
    };
    const s1 = orderOf(findScript('script-angel-1'));
    const s3 = orderOf(findScript('script-angel-3'));
    const q1 = s1[0];
    const b1 = s1[1];
    const q3 = s3[0];
    const b3 = s3[1];
    expect(q1 !== undefined && b1 !== undefined && q1 < b1).toBe(true); // ①：难度 → 劝告
    expect(q3 !== undefined && b3 !== undefined && b3 < q3).toBe(true); // ③：劝告 → 难度
  });

  it('每位天使发匕首 + 临别角色卡 + 姐妹锁 flag', () => {
    for (const script of ANGEL_SCRIPTS) {
      const entry = script.nodes[0];
      expect(entry?.kind).toBe('dialogue');
      if (entry === undefined || entry.kind !== 'dialogue') continue;
      expect(entry.onEnterEffects).toContainEqual({ kind: 'grantWeapon', weaponId: 'weapon-dagger' });
      // 集成期：临别赠礼按天使编号发对应角色卡（card-chr-angel-1..4，与卡表对齐）
      const seq = Number(script.id.replace('script-angel-', ''));
      expect(entry.onEnterEffects).toContainEqual({
        kind: 'grantCard',
        cardId: `card-chr-angel-${seq}`,
        source: 'angel-farewell',
      });
      expect(entry.onEnterEffects).toContainEqual({
        kind: 'setFlag',
        key: 'story:angels-met',
        value: expect.any(String),
      });
    }
  });

  it('触发锁（STORY-5）：per-angel 旗只锁本人规则；主城羽毛门槛用全局旗', () => {
    // 遇见天使①后，她本人的 npc 规则被 per-angel 旗封锁 —— 同格 (8,6) 先命中光羽①
    const met1: TriggerContext = {
      x: 8,
      y: 6,
      flags: { 'story:angel-met-1': true, 'story:angels-met': 'angel-1' },
      seenEventIds: [],
    };
    expect(queryTrigger(ANGEL_TRIGGER_RULES, met1)?.scriptId).toBe('script-angel-lightfeather-1');
    // 其余天使规则互不牵连（各居一关）：per-angel 旗①不影响天使③的命中
    //（(6,3) 是天使③ (7,3) r1 的独占邻格，不在天使② (7,4) r1 内）
    const met1AtAngel3 = queryTrigger(ANGEL_TRIGGER_RULES, {
      x: 6,
      y: 3,
      flags: { 'story:angel-met-1': true },
      seenEventIds: [],
    });
    expect(met1AtAngel3?.scriptId).toBe('script-angel-3');
    // 一位都没遇见 → 主城残留羽毛门槛（全局旗）锁死
    expect(queryTrigger(ANGEL_TRIGGER_RULES, { x: 1, y: 0, flags: {}, seenEventIds: [] })).toBeNull();
    // 全局旗置位（「至少遇见一位」语义）→ 主城残留羽毛可拾取（per-seq 脚本）
    const metAny = queryTrigger(ANGEL_TRIGGER_RULES, {
      x: 1,
      y: 0,
      flags: { 'story:angels-met': 'angel-2' },
      seenEventIds: [],
    });
    expect(metAny?.scriptId).toBe('script-angel-feather-1');
  });

  it('未遇到天使①时，天使①规则可命中（半径 1 内，主城网格坐标）', () => {
    const hit = queryTrigger(ANGEL_TRIGGER_RULES, { x: 8, y: 6, flags: {}, seenEventIds: [] });
    expect(hit?.scriptId).toBe('script-angel-1');
  });
});

/* ============================== 作者谜题 ================================== */

describe('authorPuzzle —— x-y=(D-1)-z（Game.java:481-491）', () => {
  it('两组答案与 Game.java:483-484 注释一致', () => {
    expect([...AUTHOR_PUZZLE_ANSWERS]).toEqual(['5,5,1', '1,5,5']);
  });

  it('两组答案（含全角/空格变体）都判对', () => {
    for (const raw of ['5,5,1', '1,5,5', '５，５，１', ' 1, 5, 5 ']) {
      expect(AUTHOR_PUZZLE_SOLVER(raw, { flags: {}, retries: 0, ownedCardIds: [] }).ok).toBe(true);
    }
  });

  it('答错 → 非致命 + 阶梯提示（原版 System.exit 的改写）', () => {
    const first = AUTHOR_PUZZLE_SOLVER('9,9,9', { flags: {}, retries: 0, ownedCardIds: [] });
    expect(first.ok).toBe(false);
    expect(first.fatal).toBe(false);
    expect(first.hint).toContain('尤拉公式');

    const second = AUTHOR_PUZZLE_SOLVER('9,9,9', { flags: {}, retries: 1, ownedCardIds: [] });
    expect(second.hint).toContain('互换');

    const third = AUTHOR_PUZZLE_SOLVER('9,9,9', { flags: {}, retries: 2, ownedCardIds: [] });
    expect(third.hint).toContain('蒙');
  });

  it('答对效果：BOSS 攻击归零（:495）+ 真实卸装（K13）+ 祖传拐杖（:500）+ 钥匙 flag', () => {
    const owned = ['card-a', 'card-b', 'card-c', 'card-d', 'card-e', 'card-f', 'card-g'];
    const r = AUTHOR_PUZZLE_SOLVER('5,5,1', { flags: {}, retries: 0, ownedCardIds: owned });
    expect(r.ok).toBe(true);
    const effects = r.effects ?? [];
    expect(effects).toContainEqual({ kind: 'setEnemyAttack', enemyId: 'enemy-ylzz', value: BOSS_ATTACK_AFTER_PUZZLE });
    expect(effects).toContainEqual({ kind: 'unequipWeapon' });
    expect(effects).toContainEqual({ kind: 'grantWeapon', weaponId: 'weapon-gfsStick' });
    expect(effects).toContainEqual({ kind: 'setFlag', key: 'story:key-boss', value: 'card-e' });
    expect(BOSS_ATTACK_AFTER_PUZZLE).toBe(0);
  });

  it('弱点绑定：答案首位数字 = 卡池编号（1-based，循环取模），空池回退作者卡', () => {
    const owned = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    expect(resolveBossWeakness('5,5,1', owned).cardId).toBe('c5');
    expect(resolveBossWeakness('1,5,5', owned).cardId).toBe('c1');
    expect(resolveBossWeakness('5,5,1', ['only']).cardId).toBe('only'); // (5-1)%1=0
    expect(resolveBossWeakness('1,5,5', []).cardId).toBe('card-chr-author');
    expect(resolveBossWeakness('5,5,1', []).multiplier).toBe(2);
  });

  it('输入归一化：全角逗号/数字/空白 → 判定仍严格', () => {
    expect(normalizePuzzleInput('５， ５，１')).toBe('5,5,1');
    expect(normalizePuzzleInput('5、5、1')).toBe('5,5,1');
    expect(AUTHOR_PUZZLE_SOLVER('5,5,2', { flags: {}, retries: 0, ownedCardIds: [] }).ok).toBe(false);
  });

  it('作者触发：三怪全灭才现身（Game.java:328-329 的 requireFlags 化，L9 网格 (5,4)）', () => {
    const atAuthor: TriggerContext = { x: 5, y: 4, flags: {}, seenEventIds: [] };
    expect(queryTrigger(AUTHOR_TRIGGER_RULES, atAuthor)?.scriptId).toBe('script-author-hint');
    const cleared: TriggerContext = {
      x: 5,
      y: 4,
      flags: {
        'story:defeated:enemy-caixukun': true,
        'story:defeated:enemy-guolaoshi': true,
        'story:defeated:enemy-dygg': true,
      },
      seenEventIds: [],
    };
    expect(queryTrigger(AUTHOR_TRIGGER_RULES, cleared)?.scriptId).toBe('script-author-puzzle');
  });
});

/* ============================== BOSS 三幕 ================================= */

describe('bossActs —— 秒杀演出 / 护盾化 BOSS 战 / 结局（Game.java:1491-1861）', () => {
  it('秒杀伤害 = 233666438 × 3 = 700999314（Game.java:1602 保真）', () => {
    expect(BOSS_SLAUGHTER_DAMAGE).toBe(700999314);
  });

  it('分身序列每回合 ×2 且封顶 64（K10：原 long 无界翻倍的有界化）', () => {
    expect(shadowCount(0)).toBe(1);
    expect(shadowCount(1)).toBe(2);
    expect(shadowCount(5)).toBe(32);
    expect(shadowCount(6)).toBe(64);
    expect(shadowCount(100)).toBe(64);
  });

  it('护盾调参：盾 233（原 defense，launchBattle 真实接线 enemyShield）+ 分身机制（弱点由档案克星武器 ×2 承载，失真字段已删）', () => {
    expect(BOSS_BATTLE_TUNING.shield).toBe(233);
    expect(BOSS_BATTLE_TUNING.shadowCap).toBe(64);
    expect(BOSS_BATTLE_TUNING.weaknessCardFlag).toBeUndefined();
    expect(BOSS_BATTLE_TUNING.weaknessMultiplier).toBeUndefined();
  });

  it('未带钥匙 → 秒杀结局（closable，无 startBattle）', () => {
    const s0 = startStory([BOSS_ACTS_SCRIPT], BOSS_ACTS_SCRIPT.id);
    const stepped = walk(BOSS_ACTS_SCRIPT, s0.state);
    expect(stepped.state.nodeId).toBe('boss-slaughter-end');
    expect(stepped.state.phase).toBe('finished');
    expect(stepped.effects.some((e) => e.kind === 'startBattle')).toBe(false);
    const ending = stepped.effects.find((e) => e.kind === 'showEnding');
    expect(ending).toMatchObject({ kind: 'showEnding', endingId: 'boss-slaughter', closable: true });
  });

  it('带钥匙 → 开战（发 startBattle）→ 胜利 → 结局 + 成就 + META 终端解锁', () => {
    const keyed: StoryRuntimeState = { ...IDLE_STORY_RUNTIME, flags: { 'story:key-boss': 'card-x' } };
    const atBattle = walk(BOSS_ACTS_SCRIPT, startStory([BOSS_ACTS_SCRIPT], BOSS_ACTS_SCRIPT.id, keyed).state);
    expect(atBattle.state.nodeId).toBe('boss-battle');
    expect(atBattle.state.phase).toBe('awaiting-battle');
    expect(atBattle.effects.find((e) => e.kind === 'startBattle')).toMatchObject({
      kind: 'startBattle',
      enemyId: 'enemy-ylzz',
      tuning: BOSS_BATTLE_TUNING,
    });

    const won = resolveBattleResult([BOSS_ACTS_SCRIPT], atBattle.state, true);
    expect(won.state.nodeId).toBe('boss-letter');
    expect(won.state.flags['story:boss-defeated']).toBe(true);

    const epilogue = walk(BOSS_ACTS_SCRIPT, won.state);
    expect(epilogue.state.nodeId).toBe('boss-epilogue');
    expect(epilogue.state.phase).toBe('finished');
    expect(epilogue.effects.find((e) => e.kind === 'showEnding')).toMatchObject({
      kind: 'showEnding',
      endingId: 'world-saved',
      achievementId: 'ach-cane-boss',
      unlocksMetaTerminal: true,
      closable: true,
    });
  });

  it('战败 → 显式 loseNext 结局（closable，不锁控制）', () => {
    const keyed: StoryRuntimeState = { ...IDLE_STORY_RUNTIME, flags: { 'story:key-boss': 'card-x' } };
    const atBattle = walk(BOSS_ACTS_SCRIPT, startStory([BOSS_ACTS_SCRIPT], BOSS_ACTS_SCRIPT.id, keyed).state);
    const lost = resolveBattleResult([BOSS_ACTS_SCRIPT], atBattle.state, false);
    expect(lost.state.nodeId).toBe('boss-defeat');
    const ending = lost.effects.find((e) => e.kind === 'showEnding');
    expect(ending && ending.kind === 'showEnding' && ending.closable).toBe(true);
  });

  it('BOSS 触发规则：L12 王座 (6,5) r3 + once:false + 击败旗封锁（STORY-5 修法）', () => {
    const rule = BOSS_TRIGGER_RULES[0];
    expect(rule?.when).toMatchObject({ kind: 'npc', x: 6, y: 5, radius: 3, levelId: 'level-lb-12' });
    expect(rule?.once).toBe(false);
    expect(rule?.unlessFlag).toBe('story:boss-defeated');
    // 王座邻格 (5,4)（曼哈顿 2）命中
    const hit = queryTrigger(BOSS_TRIGGER_RULES, { x: 5, y: 4, flags: {}, seenEventIds: [] });
    expect(hit?.scriptId).toBe('script-boss-acts');
    // 击败旗只在信结局置位 → 置位后永不再触发（真战斗收尾语义）
    expect(
      queryTrigger(BOSS_TRIGGER_RULES, { x: 5, y: 4, flags: { 'story:boss-defeated': true }, seenEventIds: [] }),
    ).toBeNull();
    // once:false 生效：秒杀演出看过（seenEventIds 已记）但未持击败旗 → 再入王座厅可重复触发
    expect(
      queryTrigger(BOSS_TRIGGER_RULES, { x: 5, y: 4, flags: {}, seenEventIds: ['trigger-boss-ylzz'] })?.id,
    ).toBe('trigger-boss-ylzz');
    // 出生点 (1,1) 距 (6,5) 曼哈顿 9 —— 不误触
    expect(queryTrigger(BOSS_TRIGGER_RULES, { x: 1, y: 1, flags: {}, seenEventIds: [] })).toBeNull();
  });

  it('前置演出触发：残影 L10(7,1) / 投影 L11(6,7)，均 once 且关级作用域', () => {
    expect(SHADOW_ECHO_TRIGGER.when).toMatchObject({ kind: 'npc', x: 7, y: 1, radius: 1, levelId: 'level-lb-10' });
    expect(SHADOW_ECHO_TRIGGER.once).toBe(true);
    expect(SHADOW_PROJECTION_TRIGGER.when).toMatchObject({ kind: 'npc', x: 6, y: 7, radius: 1, levelId: 'level-lb-11' });
    expect(SHADOW_PROJECTION_TRIGGER.once).toBe(true);
    expect(queryTrigger([SHADOW_ECHO_TRIGGER], { x: 7, y: 1, flags: {}, seenEventIds: [] })?.scriptId).toBe('script-shadow-echo');
    expect(queryTrigger([SHADOW_PROJECTION_TRIGGER], { x: 6, y: 7, flags: {}, seenEventIds: [] })?.scriptId).toBe('script-shadow-projection');
    // seen 后不再命中（once 语义）
    expect(queryTrigger([SHADOW_ECHO_TRIGGER], { x: 7, y: 1, flags: {}, seenEventIds: ['trigger-shadow-echo'] })).toBeNull();
  });
});

/* ============================== 隐藏关 ==================================== */

describe('hiddenGame —— 作弊码链 / Base64 / 反转真结局（EasterEgg.java:71-341）', () => {
  const SOLVERS = HIDDEN_GAME_SOLVERS;

  function submit(state: StoryRuntimeState, raw: string): StoryRuntimeState {
    return submitStoryInput([HIDDEN_GAME_SCRIPT], state, raw, { solvers: SOLVERS }).state;
  }

  function choose(state: StoryRuntimeState, choiceId: string): StoryRuntimeState {
    return chooseStory([HIDDEN_GAME_SCRIPT], state, choiceId).state;
  }

  it('Base64 提示解出原作暗语（EasterEgg.java:188）', () => {
    expect(decodeHiddenHint()).toBe('Use some instructions to save you.');
  });

  it('真结局全链路：作弊码链 → BABA → 命运武装 → 杀死乱码', () => {
    let s = startStory([HIDDEN_GAME_SCRIPT], HIDDEN_GAME_SCRIPT.id).state;
    s = walk(HIDDEN_GAME_SCRIPT, s).state; // 开场白读完 → setname
    expect(s.nodeId).toBe('hg-setname');
    s = submit(s, '/kill--SetName');
    expect(s.nodeId).toBe('hg-setname-ok');

    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-cxk');
    s = choose(s, 'syskill');
    expect(s.nodeId).toBe('hg-cxk-killed');
    expect(s.flags['hg:weapon:gfs']).toBe(true);
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-note');
    s = choose(s, 'open');
    expect(s.nodeId).toBe('hg-note-open');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-go1');
    s = submit(s, 'w');
    expect(s.nodeId).toBe('hg-dygg-intro');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    s = choose(s, 'first-strike');
    expect(s.nodeId).toBe('hg-dygg-win');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-go2');
    s = submit(s, 'w');
    expect(s.nodeId).toBe('hg-fog');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-go3');
    s = submit(s, 's');
    expect(s.nodeId).toBe('hg-dread');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-go4');
    s = submit(s, 's');
    expect(s.nodeId).toBe('hg-guolaoshi-intro');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    s = choose(s, 'swing');
    expect(s.nodeId).toBe('hg-gls-win');
    expect(s.flags['hg:weapon:hotel']).toBe(true);
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-go5');
    s = submit(s, 'adad');
    expect(s.nodeId).toBe('hg-mound');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    expect(s.nodeId).toBe('hg-shout');
    s = submit(s, 'BABA');
    expect(s.nodeId).toBe('hg-boss-intro');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    // walk 一路读完 BOSS 登场与「真实清空背包」两段，停在指令门前
    expect(s.nodeId).toBe('hg-boss-give');

    // 命运三武装三选一（背包已真实清空，指令仍可呼出）
    s = submit(s, '/give--@p--爷爷的拐杖');
    expect(s.nodeId).toBe('hg-win-gfs');
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    // 读完胜利台词与 Horrible Atmosphere，停在反转门前
    expect(s.nodeId).toBe('hg-final-gate');
    expect(s.flags['hg:weapon:gfs']).toBeUndefined(); // K13：背包被真实清空
    expect(s.flags['hg:atmosphere-reached']).toBe(true);

    // 反转：用原作指令语法反过来杀死乱码
    const finalStep = submitStoryInput([HIDDEN_GAME_SCRIPT], s, `/kill--${GARBAGE_KILLER}`, { solvers: SOLVERS });
    s = finalStep.state;
    expect(s.nodeId).toBe('hg-true-end');
    expect(s.phase).toBe('finished');
    expect(finalStep.effects.find((e) => e.kind === 'showEnding')).toMatchObject({
      kind: 'showEnding',
      endingId: 'hidden-true-end',
      achievementId: 'ach-true-end',
      unlocksMetaTerminal: true,
      closable: true,
    });
  });

  it('命运三武装分别路由到三个胜利节点', () => {
    const solver = HIDDEN_GAME_SOLVERS['hg-puzzle-give'];
    expect(solver).toBeDefined();
    for (const [cmd, node] of [
      ['/give--@p--赤手空拳', 'hg-win-fist'],
      ['/give--@p--爷爷的拐杖', 'hg-win-gfs'],
      ['/give--@p--㊙Hotel', 'hg-win-hotel'],
    ] as const) {
      const r = solver?.(cmd, { flags: {}, retries: 0, ownedCardIds: [] });
      expect(r?.ok).toBe(true);
      expect(r?.successNext).toBe(node);
    }
    expect(solver?.('/give--@p--苹果', { flags: {}, retries: 0, ownedCardIds: [] }).ok).toBe(false);
  });

  it('关键岔路答错 → 对应死亡结局（全是 closable，绝不退出）', () => {
    // 开幕雷击：名字输错（原作：被天上掉下来的石头砸死）
    let s = startStory([HIDDEN_GAME_SCRIPT], HIDDEN_GAME_SCRIPT.id).state;
    s = walk(HIDDEN_GAME_SCRIPT, s).state;
    s = submit(s, '张三');
    expect(s.nodeId).toBe('hg-die-stone');

    // BABA 大小写严格（原作 equals("BABA")）
    const baba = HIDDEN_GAME_SOLVERS['hg-puzzle-baba']?.('baba', { flags: {}, retries: 0, ownedCardIds: [] });
    expect(baba?.ok).toBe(false);
    expect(baba?.fatal).toBe(true);

    // 终局乱码门：普通输入 → 伪结局（原版 END 演出）
    const finalWrong = HIDDEN_GAME_SOLVERS['hg-puzzle-final']?.('跑', { flags: {}, retries: 0, ownedCardIds: [] });
    expect(finalWrong?.ok).toBe(false);
    expect(finalWrong?.fatal).toBe(true);
    expect(finalWrong?.echo).toContain('杀死了');
  });

  it('伪结局节点 closable 且带 META 提示（反转入口可见）', () => {
    const node = HIDDEN_GAME_SCRIPT.nodes.find((n) => n.id === 'hg-pseudo-end');
    expect(node?.kind).toBe('ending');
    if (node?.kind === 'ending') {
      expect(node.closable).toBe(true);
      expect(node.endingId).toBe('hidden-pseudo-end');
    }
  });
});

/* ============================== META 终端 ================================= */

describe('META 终端 —— 真结局剧本侧（未知输入只回显，K3）', () => {
  it('真结局指令：主线通关后触发 meta-true-end + 成就', () => {
    const out = runMetaTerminalCommand({ raw: `/kill--${GARBAGE_KILLER}`, flags: { 'story:boss-defeated': true } });
    expect(out.effects).toContainEqual({
      kind: 'showEnding',
      endingId: 'meta-true-end',
      closable: true,
      achievementId: 'ach-true-end',
    });
  });

  it('未通关/未见乱码 → 终端锁定回显，不发结局', () => {
    const out = runMetaTerminalCommand({ raw: `/kill--${GARBAGE_KILLER}`, flags: {} });
    expect(out.effects).toEqual([]);
    expect(out.echo.join()).toContain('北方');
  });

  it('隐藏关 atmosphere 旗标同样解锁真结局指令', () => {
    const out = runMetaTerminalCommand({ raw: `/kill--${GARBAGE_KILLER}`, flags: { 'hg:atmosphere-reached': true } });
    expect(out.effects.some((e) => e.kind === 'showEnding' && e.endingId === 'meta-true-end')).toBe(true);
  });

  it('原作作弊码回响 + 未知输入纯回显（绝不执行为移动）', () => {
    expect(runMetaTerminalCommand({ raw: '/kill--SetName', flags: {} }).echo.length).toBeGreaterThan(0);
    const baba = runMetaTerminalCommand({ raw: 'BABA', flags: {} });
    expect(baba.effects).toContainEqual({ kind: 'setFlag', key: 'meta:baba-echoed', value: true });

    const unknown = runMetaTerminalCommand({ raw: 'w', flags: {} });
    expect(unknown.effects).toEqual([]);
    expect(unknown.echo.join()).toContain('w');
    expect(unknown.echo.join()).toContain('回显');

    expect(runMetaTerminalCommand({ raw: 'exit', flags: {} }).echo.join()).toContain('不是移动指令');
  });
});

/* ============================== 越界四方向 ================================ */

describe('outskirts —— 四方向越界（Game.java:121-284 的事件表化）', () => {
  it('挑战层元数据三件套齐备（南/东/西），出处可追溯', () => {
    expect(Object.keys(OUTSKIRT_CHALLENGE_LAYERS).sort()).toEqual(['east-endless', 'south-abyss', 'west-end-wall']);
    expect(OUTSKIRT_CHALLENGE_LAYERS['east-endless']?.origin).toContain('Game.java:134');
    expect(OUTSKIRT_CHALLENGE_LAYERS['south-abyss']?.origin).toContain('Game.java:127');
    expect(OUTSKIRT_CHALLENGE_LAYERS['west-end-wall']?.origin).toContain('Game.java:139');
  });

  it('四方向 beyond 规则按坐标命中（阈值 ±7：|8| 起）', () => {
    expect(queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: 0, y: 8, flags: {}, seenEventIds: [] })?.scriptId).toBe('script-outskirt-north');
    expect(queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: 0, y: -8, flags: {}, seenEventIds: [] })?.scriptId).toBe('script-outskirt-south');
    expect(queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: 8, y: 0, flags: {}, seenEventIds: [] })?.scriptId).toBe('script-outskirt-east');
    expect(queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: -8, y: 0, flags: {}, seenEventIds: [] })?.scriptId).toBe('script-outskirt-west');
    expect(queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: 0, y: 0, flags: {}, seenEventIds: [] })).toBeNull();
  });

  it('缓冲带 |6|~|7| 命中警示剧本且 once（原版 Game.java:282 文案保留）', () => {
    const hit = queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: 0, y: 6, flags: {}, seenEventIds: [] });
    expect(hit?.scriptId).toBe('script-outskirt-buffer');
    expect(hit?.once).not.toBe(false);
    // 警示看过后，同坐标不再触发任何越界规则（beyond 未达）
    const seen = queryTrigger(OUTSKIRT_TRIGGER_RULES, {
      x: 0,
      y: 6,
      flags: {},
      seenEventIds: ['trigger-outskirt-buffer-north'],
    });
    expect(seen).toBeNull();
  });

  it('东侧剧本保留原版落点 (-5,3)（Game.java:136-137）', () => {
    expect(EAST_LANDING_POS).toEqual({ x: -5, y: 3 });
  });

  it('北方剧本「进入」分支 → 终局由集成层映射为 enterScript（隐藏关）', () => {
    const script = findScript('script-outskirt-north');
    const s0 = startStory([script], script.id);
    const s1 = walk(script, s0.state).state;
    expect(s1.nodeId).toBe('outskirt-north-choice');
    const s2 = chooseStory([script], s1, 'enter').state;
    const stepped = walk(script, s2);
    expect(stepped.state.phase).toBe('finished');
    // 集成约定：endingId 'outskirt-north-transit' 由 store 映射为 enterScript
    expect(stepped.effects.find((e) => e.kind === 'showEnding')).toMatchObject({
      kind: 'showEnding',
      endingId: 'outskirt-north-transit',
      closable: true,
    });
  });

  it('A3-1 接线：东/南/西「进入」分支经中转节点显式发射 enterChallengeLayer（不再无声返回主城）', () => {
    const cases = [
      { scriptId: 'script-outskirt-east', choice: 'enter', layerId: 'east-endless', transitId: 'outskirt-east-transit' },
      { scriptId: 'script-outskirt-south', choice: 'accept', layerId: 'south-abyss', transitId: 'outskirt-south-transit' },
      { scriptId: 'script-outskirt-west', choice: 'challenge', layerId: 'west-end-wall', transitId: 'outskirt-west-transit' },
    ] as const;
    for (const c of cases) {
      const script = findScript(c.scriptId);
      const s0 = startStory([script], script.id);
      const s1 = walk(script, s0.state).state;
      expect(s1.nodeId, `${c.scriptId} 应停在选项节点`).toBe(
        `${c.scriptId.replace('script-outskirt-', 'outskirt-')}-choice`,
      );
      const stepped = chooseStory([script], s1, c.choice);
      // 中转对话节点进入即发射 enterChallengeLayer（解释器产出 → gameStore 挂账，
      // R-2 起延迟到剧本收尾才入层，中转/收尾对白完整演出）
      expect(stepped.state.nodeId, `${c.scriptId} 应进入中转节点`).toBe(c.transitId);
      expect(stepped.state.phase).toBe('dialogue');
      expect(stepped.effects, `${c.scriptId} 必须发射 enterChallengeLayer`).toContainEqual({
        kind: 'enterChallengeLayer',
        layerId: c.layerId,
      });
      // 中转节点显式连到收尾 ending（生成失败的回退路径），图无悬空边
      const transit = script.nodes.find((n) => n.id === c.transitId);
      expect(transit?.kind).toBe('dialogue');
      if (transit !== undefined && transit.kind === 'dialogue') {
        expect(transit.onEnterEffects).toContainEqual({ kind: 'enterChallengeLayer', layerId: c.layerId });
        expect(script.nodes.some((n) => n.id === transit.next)).toBe(true);
      }
      // 收尾 ending 仍在（closable，失败路径可关闭回到原地）
      const ending = script.nodes.find((n) => n.kind === 'ending' && n.id === `${c.scriptId.replace('script-outskirt-', 'outskirt-')}-enter`);
      expect(ending?.kind).toBe('ending');
    }
  });

  it('A3-1 接线：东「送回」/南「爬回」/西「后退」分支不发射 enterChallengeLayer（留在主线语义不变）', () => {
    const cases = [
      { scriptId: 'script-outskirt-east', choice: 'leave' },
      { scriptId: 'script-outskirt-south', choice: 'climb' },
      { scriptId: 'script-outskirt-west', choice: 'retreat' },
    ] as const;
    for (const c of cases) {
      const script = findScript(c.scriptId);
      const s0 = startStory([script], script.id);
      const s1 = walk(script, s0.state).state;
      const stepped = chooseStory([script], s1, c.choice);
      expect(stepped.effects.some((e) => e.kind === 'enterChallengeLayer'), `${c.scriptId} 撤退分支不得进层`).toBe(false);
    }
  });
});

/* ==================== A3-2 · HUB 越界几何（缓冲带行） ==================== */
/* 方向约定以 classifyPosition 为准（world y>0 = north，时空裂缝/隐藏关一侧）；
 * 网格底部新增行让该侧真实可达；网格顶部（world −y = 深渊坠道一侧）受网格
 * 非负索引限制无法用数据补行，其 beyond 判定已由 gameStore 的南缘外推路线
 * 实装（A3-2 南向判定：南缘撞墙 → 虚拟位外推直达 beyond south，store 端到端
 * 回归见 core/store/__tests__/wiring.test.ts 的 A3-2 组）。 */

describe('outskirts —— HUB 越界几何（A3-2：缓冲带行让时空裂缝一侧 beyond 真实可达）', () => {
  const hub = findAreaLevel('level-sb-01');
  if (hub === undefined) throw new Error('level-sb-01 缺失');

  it('HUB 网格 15×14：缓冲带行 (row13) 与 row12 开口逐格对齐，heights 同尺寸', () => {
    expect(hub.grid.length).toBe(14);
    expect(hub.heights?.length).toBe(14);
    expect(hub.grid[12]?.slice(11, 14)).toEqual([0, 0, 0]); // 既有开口 (11..13,12)
    expect(hub.grid[13]?.slice(11, 14)).toEqual([0, 0, 0]); // 缓冲带逐格对齐
    expect(hub.grid[13]?.filter((c) => c === 0)).toHaveLength(3); // 不向东西额外开口
  });

  it('时空裂缝侧（world +y）beyond 自此可达：站 (13,13)（world +7 buffer）被拒移动的虚拟位 world +8 命中 beyond north', () => {
    const stand = gridToWorld(13, 13);
    expect(stand).toEqual({ x: 6, y: 7 });
    expect(classifyPosition(stand.x, stand.y)).toMatchObject({ kind: 'buffer', dir: 'north' });
    const virtual = { x: stand.x, y: stand.y + 1 }; // 被拒移动的虚拟位 = prevWorld + 一步
    const zone = classifyPosition(virtual.x, virtual.y);
    expect(zone).toMatchObject({ kind: 'beyond', dir: 'north', depth: 1 });
    const hit = queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: virtual.x, y: virtual.y, flags: {}, seenEventIds: [] });
    expect(hit?.scriptId).toBe('script-outskirt-north');
    expect(hit?.when).toMatchObject({ kind: 'outskirts', dir: 'north', zone: 'beyond' });
  });

  it('既有可达性回归：东 beyond（(14,11) 虚拟位 world +8）与 row12 缓冲进入（世界 +6）不受影响', () => {
    // 东：既有语义（越界 east 实机已验证）
    const eastStand = gridToWorld(14, 11);
    expect(eastStand).toEqual({ x: 7, y: 5 });
    expect(classifyPosition(eastStand.x + 1, eastStand.y)).toMatchObject({ kind: 'beyond', dir: 'east' });
    // 缓冲带进入：row12（世界 +6）即 buffer，警示剧本命中语义不变
    const bufferCell = gridToWorld(13, 12);
    expect(bufferCell).toEqual({ x: 6, y: 6 });
    expect(classifyPosition(bufferCell.x, bufferCell.y)).toMatchObject({ kind: 'buffer', dir: 'north' });
  });

  it('西侧（E N D 之壁）beyond 自此可达：站 (0,11)（world −7 buffer）被拒西移的虚拟位 world −8 命中 beyond west', () => {
    expect(hub.grid[11]?.[0]).toBe(0); // 西缓冲格已开（此前第 0 列全墙）
    const stand = gridToWorld(0, 11);
    expect(stand).toEqual({ x: -7, y: 5 });
    expect(classifyPosition(stand.x, stand.y)).toMatchObject({ kind: 'buffer', dir: 'west' });
    const virtual = { x: stand.x - 1, y: stand.y };
    expect(classifyPosition(virtual.x, virtual.y)).toMatchObject({ kind: 'beyond', dir: 'west', depth: 1 });
    const hit = queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: virtual.x, y: virtual.y, flags: {}, seenEventIds: [] });
    expect(hit?.scriptId).toBe('script-outskirt-west');
    expect(hit?.when).toMatchObject({ kind: 'outskirts', dir: 'west', zone: 'beyond' });
  });

  it('深渊坠道侧（world −y）数据侧保持不可站立（row0 全墙，最深可站 world −5 → 单步虚拟 −6 仅 buffer）——beyond 由 gameStore 南缘外推路线判定（A3-2 已实装）', () => {
    expect(hub.grid[0]?.every((c) => c === 1)).toBe(true); // 该侧首行全墙，无可站格
    const deepStanding = gridToWorld(1, 1); // 该侧最深可站格（世界 (−6,−5)）
    expect(deepStanding).toEqual({ x: -6, y: -5 });
    const virtual = { x: deepStanding.x, y: deepStanding.y - 1 };
    expect(classifyPosition(virtual.x, virtual.y)).toMatchObject({ kind: 'buffer', dir: 'south' });
    const hit = queryTrigger(OUTSKIRT_TRIGGER_RULES, { x: virtual.x, y: virtual.y, flags: {}, seenEventIds: [] });
    expect(hit?.when).toMatchObject({ zone: 'buffer' }); // 只命中警示，不命中坠道
  });
});
