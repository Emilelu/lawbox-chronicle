/**
 * 触发器单测：越界分类（阈值 ±7 与 Game.java:121/127/134/139 实测一致，
 * 缓冲带 |6|~|7|）、规则表查询（once/require/unless）、关卡入口卡组校验
 * （缺卡 → 补发剧本 100% 必发）。
 */

import { describe, expect, it } from 'vitest';
import {
  GATE_MAKEUP_SCRIPTS,
  LAW_GATES,
  OUTSKIRT_THRESHOLD,
  MAIN_MAP_HALF_EXTENT,
  checkLevelEntryDeck,
  classifyPosition,
  findInteractableRule,
  isOutskirtsTransition,
  positionalRuleLevelId,
  queryTrigger,
  type TriggerContext,
  type TriggerRule,
} from '../triggers';
import { ALL_TRIGGER_RULES } from '../../../data/storyScripts';

const baseCtx: TriggerContext = {
  x: 0,
  y: 0,
  flags: {},
  seenEventIds: [],
};

describe('classifyPosition —— 越界阈值与代码实测一致（±7）', () => {
  it('常量与 KichikuAdventure/Game.java:91/:121 一致', () => {
    expect(MAIN_MAP_HALF_EXTENT).toBe(5);
    expect(OUTSKIRT_THRESHOLD).toBe(7);
  });

  it('主地图内 |x|,|y| ≤ 5 → inside', () => {
    expect(classifyPosition(0, 0)).toEqual({ kind: 'inside' });
    expect(classifyPosition(5, -5)).toEqual({ kind: 'inside' });
    expect(classifyPosition(-5, 5)).toEqual({ kind: 'inside' });
  });

  it('缓冲带 |6|~|7| → buffer（深度 1~2）', () => {
    expect(classifyPosition(0, 6)).toEqual({ kind: 'buffer', dir: 'north', depth: 1 });
    expect(classifyPosition(0, -7)).toEqual({ kind: 'buffer', dir: 'south', depth: 2 });
    expect(classifyPosition(6, 0)).toEqual({ kind: 'buffer', dir: 'east', depth: 1 });
    expect(classifyPosition(-7, 0)).toEqual({ kind: 'buffer', dir: 'west', depth: 2 });
    expect(classifyPosition(7, 5)).toEqual({ kind: 'buffer', dir: 'east', depth: 2 });
  });

  it('越过 ±7（即 ≥|8|）→ beyond（深度从 1 起算）', () => {
    expect(classifyPosition(0, 8)).toEqual({ kind: 'beyond', dir: 'north', depth: 1 });
    expect(classifyPosition(0, -9)).toEqual({ kind: 'beyond', dir: 'south', depth: 2 });
    expect(classifyPosition(8, 0)).toEqual({ kind: 'beyond', dir: 'east', depth: 1 });
    expect(classifyPosition(-12, 0)).toEqual({ kind: 'beyond', dir: 'west', depth: 5 });
  });

  it('双轴同时越界 → y 轴优先（原版 if 顺序 Game.java:121 先于 :134）', () => {
    expect(classifyPosition(8, 8)).toEqual({ kind: 'beyond', dir: 'north', depth: 1 });
    expect(classifyPosition(-8, -8)).toEqual({ kind: 'beyond', dir: 'south', depth: 1 });
    // y 未越缓冲、x 越界时才轮到 x 轴
    expect(classifyPosition(8, 5)).toEqual({ kind: 'beyond', dir: 'east', depth: 1 });
    expect(classifyPosition(-8, 3)).toEqual({ kind: 'beyond', dir: 'west', depth: 1 });
  });
});

describe('isOutskirtsTransition —— 边沿触发', () => {
  const buffer = classifyPosition(0, 6);
  const beyond = classifyPosition(0, 8);
  const inside = classifyPosition(0, 0);

  it('从非目标区跨入目标区 → true', () => {
    expect(isOutskirtsTransition(inside, buffer, 'north', 'buffer')).toBe(true);
    expect(isOutskirtsTransition(buffer, beyond, 'north', 'beyond')).toBe(true);
    expect(isOutskirtsTransition(inside, beyond, 'north', 'beyond')).toBe(true);
  });

  it('已在目标区内移动 / 离开 → false', () => {
    expect(isOutskirtsTransition(buffer, buffer, 'north', 'buffer')).toBe(false);
    expect(isOutskirtsTransition(beyond, beyond, 'north', 'beyond')).toBe(false);
    expect(isOutskirtsTransition(beyond, buffer, 'north', 'beyond')).toBe(false);
  });
});

describe('queryTrigger —— 规则表查询', () => {
  const rules: readonly TriggerRule[] = [
    { id: 'r-npc', scriptId: 's1', when: { kind: 'npc', x: 1, y: 0, radius: 1 } },
    { id: 'r-tile', scriptId: 's2', when: { kind: 'tile', x: 4, y: 2 } },
    { id: 'r-battle', scriptId: 's3', when: { kind: 'battle-end', enemyId: 'enemy-caixukun' } },
    { id: 'r-entry', scriptId: 's4', when: { kind: 'level-entry', levelId: 'level-sb-02' } },
    { id: 'r-out', scriptId: 's5', when: { kind: 'outskirts', dir: 'north', zone: 'beyond' } },
  ];

  it('npc：曼哈顿距离 ≤ radius 命中（含 0）', () => {
    expect(queryTrigger(rules, { ...baseCtx, x: 2, y: 0 })?.id).toBe('r-npc');
    expect(queryTrigger(rules, { ...baseCtx, x: 1, y: 0 })?.id).toBe('r-npc');
    expect(queryTrigger(rules, { ...baseCtx, x: 3, y: 0 })).toBeNull();
  });

  it('tile / battle-end / level-entry / outskirts 各按字段命中', () => {
    expect(queryTrigger(rules, { ...baseCtx, x: 4, y: 2 })?.id).toBe('r-tile');
    // 远离 npc/tile 坐标，避免规则表顺序抢先命中
    expect(
      queryTrigger(rules, { ...baseCtx, x: 50, y: 50, lastBattleEnemyId: 'enemy-caixukun' })?.id,
    ).toBe('r-battle');
    expect(
      queryTrigger(rules, { ...baseCtx, x: 50, y: 50, enteringLevelId: 'level-sb-02' })?.id,
    ).toBe('r-entry');
    expect(queryTrigger(rules, { ...baseCtx, x: 0, y: 9 })?.id).toBe('r-out');
  });

  it('once 规则 seen 后不再命中；once:false 可重复', () => {
    const seen = { ...baseCtx, seenEventIds: ['r-tile'], x: 4, y: 2 };
    expect(queryTrigger(rules, seen)).toBeNull();
  });

  it('requireFlags 全齐 / unlessFlags 任一即封锁', () => {
    const gated: readonly TriggerRule[] = [
      {
        id: 'g',
        scriptId: 's',
        when: { kind: 'tile', x: 0, y: 0 },
        requireFlags: ['a', 'b'],
        unlessFlags: ['z'],
      },
    ];
    expect(queryTrigger(gated, baseCtx)).toBeNull();
    expect(queryTrigger(gated, { ...baseCtx, flags: { a: 1 } })).toBeNull();
    expect(queryTrigger(gated, { ...baseCtx, flags: { a: 1, b: 1 } })?.id).toBe('g');
    expect(queryTrigger(gated, { ...baseCtx, flags: { a: 1, b: 1, z: true } })).toBeNull();
  });

  it('findInteractableRule：只查 npc 规则（E 键交互）', () => {
    expect(findInteractableRule(rules, { ...baseCtx, x: 4, y: 2 })).toBeNull();
    expect(findInteractableRule(rules, { ...baseCtx, x: 1, y: 0 })?.id).toBe('r-npc');
  });
});

describe('checkLevelEntryDeck —— 法则卡兜底（100% 必发）', () => {
  it('无门槛关卡直接放行', () => {
    expect(checkLevelEntryDeck('level-sb-01', [])).toEqual({ ok: true, levelId: 'level-sb-01' });
  });

  it('缺卡 → 返回补发剧本 id，且该剧本确实发放所缺的卡', () => {
    for (const gate of LAW_GATES) {
      const result = checkLevelEntryDeck(gate.levelId, []);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.missingCardIds).toEqual(gate.requiredCardIds);
      expect(result.makeUpScriptId).toBe(gate.makeUpScriptId);

      const script = GATE_MAKEUP_SCRIPTS.find((s) => s.id === result.makeUpScriptId);
      expect(script, `补发剧本 ${result.makeUpScriptId} 必须存在`).toBeTruthy();
      const entry = script?.nodes.find((n) => n.id === script?.entryNodeId);
      const grants = (entry?.kind === 'dialogue' ? entry.onEnterEffects ?? [] : []).filter(
        (e) => e.kind === 'grantCard',
      );
      expect(grants).toHaveLength(gate.requiredCardIds.length);
      for (const cardId of gate.requiredCardIds) {
        expect(grants.some((e) => e.kind === 'grantCard' && e.cardId === cardId)).toBe(true);
      }
    }
  });

  it('持卡齐全 → 放行；部分缺卡 → 列出缺口', () => {
    expect(checkLevelEntryDeck('level-sb-02', ['card-law-feather-chest']).ok).toBe(true);
    const partial = checkLevelEntryDeck('level-sb-03', ['card-law-feather-chest']);
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.missingCardIds).toEqual(['card-law-wider-push']);
  });

  it('level-sb-04 变体关门（STORY-5/评审③）：同门槛、复用补发剧本、零新剧本', () => {
    const gate = LAW_GATES.find((g) => g.levelId === 'level-sb-04');
    expect(gate).toBeDefined();
    expect(gate?.requiredCardIds).toEqual(['card-law-wider-push']);
    expect(gate?.makeUpScriptId).toBe('script-gate-wider-push');
    const empty = checkLevelEntryDeck('level-sb-04', []);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.makeUpScriptId).toBe('script-gate-wider-push');
    expect(checkLevelEntryDeck('level-sb-04', ['card-law-wider-push']).ok).toBe(true);
  });
});

/* ==================== STORY-5 触发评估 level 化（三组） ==================== */

/** 与 gameStore.queryPositionalTrigger 同口径的作用域过滤（store 侧另有双坐标求值） */
const rulesScopedTo = (levelId: string): readonly TriggerRule[] =>
  ALL_TRIGGER_RULES.filter((r) => positionalRuleLevelId(r) === levelId);
const hubScopedRules = (): readonly TriggerRule[] =>
  ALL_TRIGGER_RULES.filter((r) => positionalRuleLevelId(r) === undefined);

describe('STORY-5 ① level-scoped 命中：声明的关卡内按该关网格坐标求值', () => {
  it('positionalRuleLevelId：npc/tile 读取声明值，非位置类恒 undefined', () => {
    const mob = ALL_TRIGGER_RULES.find((r) => r.id === 'trigger-mob-caixukun');
    expect(mob?.when.kind).toBe('npc');
    expect(positionalRuleLevelId(mob as TriggerRule)).toBe('level-sb-02');
    const outskirt = ALL_TRIGGER_RULES.find((r) => r.when.kind === 'outskirts');
    expect(positionalRuleLevelId(outskirt as TriggerRule)).toBeUndefined();
    const synthetic: TriggerRule = { id: 'x', scriptId: 's', when: { kind: 'battle-end', enemyId: 'e' } };
    expect(positionalRuleLevelId(synthetic)).toBeUndefined();
  });

  it('蔡徐坤 L2 网格 (12,3) radius 1（N1）：踩格/邻格命中，2 格外不命中', () => {
    const scoped = rulesScopedTo('level-sb-02');
    // 语义升级（N1）：遭遇格被 MECH-4 守卫实体同格占位且四向单步推入不可行，
    // r0 的「踩上即遭遇」需两步非显然推箱前置——改 radius 1 邻格即遭遇。
    // 踩格 + 三个邻格全部命中：(13,3)=出生点南行自然接近路径、(11,3)=东廊箱
    // 推箱让位落格（自动演示解路顺路触发）、(12,4)=南侧邻格地板。
    for (const pos of [{ x: 12, y: 3 }, { x: 13, y: 3 }, { x: 11, y: 3 }, { x: 12, y: 4 }]) {
      const hit = queryTrigger(scoped, { x: pos.x, y: pos.y, flags: {}, seenEventIds: [] });
      expect(hit?.id, `(${pos.x},${pos.y}) 应命中`).toBe('trigger-mob-caixukun');
    }
    // 2 格外不命中：出生点 (13,1) 与南行第一格 (13,2) 距遭遇点曼哈顿 3/2，
    // 进关与接近前半程不误触（遭遇在真正走近守卫的那一刻开演）。
    expect(queryTrigger(scoped, { x: 13, y: 2, flags: {}, seenEventIds: [] })).toBeNull();
    expect(queryTrigger(scoped, { x: 13, y: 1, flags: {}, seenEventIds: [] })).toBeNull();
  });

  it('天使① 留主城 L1 (8,6) radius 1：同关作用域内半径内命中', () => {
    const hit = queryTrigger(rulesScopedTo('level-sb-01'), { x: 8, y: 5, flags: {}, seenEventIds: [] });
    expect(hit?.id).toBe('trigger-angel-1');
  });
});

describe('STORY-5 ② 跨关不命中：同坐标在其它关的作用域内无此规则', () => {
  it('L3 作用域不含蔡徐坤规则：同坐标 (12,3) 在 L3 求值不触发（wiring.test 落格路径复核）', () => {
    const l3Scoped = rulesScopedTo('level-sb-03');
    expect(l3Scoped.some((r) => r.id === 'trigger-mob-caixukun')).toBe(false);
    expect(queryTrigger(l3Scoped, { x: 12, y: 3, flags: {}, seenEventIds: [] })).toBeNull();
    // L3 自己的郭老师规则在其作用域内（(7,5) radius 0）
    expect(queryTrigger(l3Scoped, { x: 7, y: 5, flags: {}, seenEventIds: [] })?.id).toBe('trigger-mob-guolaoshi');
  });

  it('hub 作用域不含任何迁关后的剧情规则（三怪/作者/BOSS/残影投影均已声明 levelId）', () => {
    const hub = hubScopedRules();
    for (const id of ['trigger-mob-caixukun', 'trigger-mob-guolaoshi', 'trigger-mob-dygg', 'trigger-author-quiz', 'trigger-boss-ylzz', 'trigger-shadow-echo', 'trigger-shadow-projection']) {
      expect(hub.some((r) => r.id === id), `规则 ${id} 不应在 hub 作用域`).toBe(false);
    }
  });
});

describe('STORY-5 ③ hub 回归：缺省 levelId 的旧规则仍走世界坐标、只属主城', () => {
  it('主城残留羽毛 tile（世界坐标）在 hub 作用域内照常命中', () => {
    const hit = queryTrigger(hubScopedRules(), { x: 1, y: 0, flags: { 'story:angels-met': 'angel-1' }, seenEventIds: [] });
    expect(hit?.id).toBe('trigger-angel-1-feather');
    // 全局旗未置位 → 门槛锁死（既有语义不变）
    expect(queryTrigger(hubScopedRules(), { x: 1, y: 0, flags: {}, seenEventIds: [] })).toBeNull();
  });

  it('outskirts 规则保持缺省 levelId（HUB-only 语义由 store 过滤承担）', () => {
    const outskirts = ALL_TRIGGER_RULES.filter((r) => r.when.kind === 'outskirts');
    expect(outskirts.length).toBe(8); // 四方向 buffer + beyond
    for (const rule of outskirts) {
      expect(positionalRuleLevelId(rule)).toBeUndefined();
    }
  });
});
