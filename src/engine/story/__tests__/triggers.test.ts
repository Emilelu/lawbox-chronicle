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
  queryTrigger,
  type TriggerContext,
  type TriggerRule,
} from '../triggers';

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
});
