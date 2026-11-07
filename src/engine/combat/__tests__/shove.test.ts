/**
 * combat-engine · shove 单测。
 * 重点：与 core/gridMove.resolvePush 的几何一致性（共享原语承诺）、
 * 重量∝HP 预算、深渊/尖刺地形、BOSS 免疫、分身上限、箱落攻击联动。
 */

import { describe, expect, it } from 'vitest';
import { resolvePush } from '../../../core/gridMove';
import type { Grid, GridEntity } from '../../../core/types';
import {
  MAX_CLONES,
  buildFormation,
  massFromMaxHp,
  nextCloneCount,
  resolveShove,
  spawnClones,
  type HazardMap,
} from '../shove';

/** 7×5 封闭竞技场 */
const arena: Grid = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

/** 7×5 但顶行 (3,0) 是缺口（测试坠出边界） */
const gapped: Grid = [
  [1, 1, 1, 0, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

function playerEntity(x: number, y: number): GridEntity {
  return { id: 'player-1', kind: 'player', x, y, mass: Infinity, pushable: false };
}
function enemyEntity(id: string, x: number, y: number, mass = 1): GridEntity {
  return { id, kind: 'enemy', x, y, mass, pushable: true };
}
function chestEntity(id: string, x: number, y: number): GridEntity {
  return { id, kind: 'chest', x, y, mass: 2, pushable: true };
}

describe('massFromMaxHp —— 重量 ∝ HP', () => {
  it('蔡徐坤 28→1、郭老师 98→2、冬泳怪鸽 149→3、影流之主 2333→9', () => {
    expect(massFromMaxHp(28)).toBe(1);
    expect(massFromMaxHp(98)).toBe(2);
    expect(massFromMaxHp(149)).toBe(3);
    expect(massFromMaxHp(2333)).toBe(9);
  });

  it('非法输入钳制在 [1,9]', () => {
    expect(massFromMaxHp(0)).toBe(1);
    expect(massFromMaxHp(-100)).toBe(1);
    expect(massFromMaxHp(999999)).toBe(9);
  });
});

describe('buildFormation —— 方块化布阵', () => {
  it('BOSS 实体带 shoveImmune 标记，小怪可推且质量来自 maxHp', () => {
    const built = buildFormation(
      [
        { enemyId: 'boss-1', x: 3, y: 2, maxHp: 2333, boss: true },
        { enemyId: 'mob-1', x: 2, y: 1, maxHp: 28, boss: false },
      ],
      { x: 1, y: 2 },
      100,
      100,
    );
    const boss = built.entities.find((e) => e.id === 'boss-1');
    const mob = built.entities.find((e) => e.id === 'mob-1');
    expect(boss?.shoveImmune).toBe(true);
    expect(boss?.mass).toBe(9);
    expect(mob?.shoveImmune).toBeUndefined();
    expect(mob?.mass).toBe(1);
    expect(built.hpById['boss-1']).toEqual({ hp: 2333, maxHp: 2333 });
    expect(built.hpById['player-1']).toEqual({ hp: 100, maxHp: 100 });
  });
});

describe('几何一致性 —— resolveShove 复用 resolvePush 的位移结果', () => {
  it('move：与共享原语逐格一致', () => {
    const entities = [playerEntity(1, 2)];
    const shoved = resolveShove({
      grid: arena,
      hazards: {},
      entities,
      originId: 'player-1',
      dir: 'right',
      hpById: { 'player-1': { hp: 100, maxHp: 100 } },
    });
    const primitive = resolvePush({ grid: arena, entities, origin: 'player-1', dir: 'right' });
    expect(shoved.kind).toBe('move');
    expect(shoved.entities).toEqual(primitive.kind === 'move' ? primitive.entities : []);
  });

  it('push：推怪位移与推箱推箱位移完全一致', () => {
    const entities = [playerEntity(2, 2), enemyEntity('mob', 3, 2, 1)];
    const hpById = { 'player-1': { hp: 100, maxHp: 100 }, mob: { hp: 28, maxHp: 28 } };
    const shoved = resolveShove({
      grid: arena,
      hazards: {},
      entities,
      originId: 'player-1',
      dir: 'right',
      hpById,
    });
    const primitive = resolvePush({ grid: arena, entities, origin: 'player-1', dir: 'right' });
    expect(primitive.kind).toBe('push');
    expect(shoved.kind).toBe('push');
    expect(shoved.entities).toEqual(primitive.kind === 'push' ? primitive.entities : []);
    // 玩家推进到 (3,2)，怪被推到 (4,2)
    expect(shoved.entities.find((e) => e.id === 'mob')?.x).toBe(4);
    expect(shoved.entities.find((e) => e.id === 'player-1')?.x).toBe(3);
  });

  it('chain：连锁推挤与原语一致', () => {
    const entities = [playerEntity(1, 2), enemyEntity('a', 2, 2, 1), enemyEntity('b', 3, 2, 1)];
    const shoved = resolveShove({
      grid: arena,
      hazards: {},
      entities,
      originId: 'player-1',
      dir: 'right',
      hpById: {
        'player-1': { hp: 100, maxHp: 100 },
        a: { hp: 10, maxHp: 10 },
        b: { hp: 10, maxHp: 10 },
      },
    });
    expect(shoved.kind).toBe('chain');
    expect(shoved.entities.find((e) => e.id === 'b')?.x).toBe(4);
  });
});

describe('推力预算（too-heavy）', () => {
  it('被推者质量总和 5+5 > 9 → blocked(too-heavy)，状态零变化', () => {
    const entities = [playerEntity(1, 2), enemyEntity('a', 2, 2, 5), enemyEntity('b', 3, 2, 5)];
    const hpById = {
      'player-1': { hp: 100, maxHp: 100 },
      a: { hp: 10, maxHp: 10 },
      b: { hp: 10, maxHp: 10 },
    };
    const result = resolveShove({ grid: arena, hazards: {}, entities, originId: 'player-1', dir: 'right', hpById });
    expect(result).toMatchObject({ kind: 'blocked', reason: 'too-heavy' });
    expect(result.entities).toEqual(entities);
  });

  it('shovePower 覆写提高预算后可以推动', () => {
    const entities = [playerEntity(1, 2), enemyEntity('a', 2, 2, 5), enemyEntity('b', 3, 2, 5)];
    const result = resolveShove({
      grid: arena,
      hazards: {},
      entities,
      originId: 'player-1',
      dir: 'right',
      hpById: {
        'player-1': { hp: 100, maxHp: 100 },
        a: { hp: 10, maxHp: 10 },
        b: { hp: 10, maxHp: 10 },
      },
      overlays: { shovePower: 10 },
    });
    expect(result.kind).toBe('chain');
  });
});

describe('BOSS 免疫 / 边界守卫', () => {
  it('shoveImmune 实体 → blocked(immovable)', () => {
    const boss: GridEntity = { id: 'boss', kind: 'enemy', x: 3, y: 2, mass: 9, pushable: true, shoveImmune: true };
    const result = resolveShove({
      grid: arena,
      hazards: {},
      entities: [playerEntity(2, 2), boss],
      originId: 'player-1',
      dir: 'right',
      hpById: { 'player-1': { hp: 100, maxHp: 100 }, boss: { hp: 2333, maxHp: 2333 } },
    });
    expect(result).toMatchObject({ kind: 'blocked', reason: 'immovable' });
  });

  it('origin 目标格是深渊 → blocked(hazard)（玩家不自灭）', () => {
    const hazards: HazardMap = { '3,2': 'abyss' };
    const result = resolveShove({
      grid: arena,
      hazards,
      entities: [playerEntity(2, 2)],
      originId: 'player-1',
      dir: 'right',
      hpById: { 'player-1': { hp: 100, maxHp: 100 } },
    });
    expect(result).toMatchObject({ kind: 'blocked', reason: 'hazard' });
  });

  it('fallOffEdge:false（无重力井）→ 链尾越界被原语挡住', () => {
    const result = resolveShove({
      grid: gapped,
      hazards: {},
      entities: [playerEntity(3, 1), enemyEntity('mob', 3, 0, 1)],
      originId: 'player-1',
      dir: 'up',
      hpById: { 'player-1': { hp: 100, maxHp: 100 }, mob: { hp: 28, maxHp: 28 } },
    });
    expect(result).toMatchObject({ kind: 'blocked', reason: 'out-of-bounds' });
  });

  it('fallOffEdge:true（重力井）→ 坠出战场 + 坠落伤害（小怪直接秒杀）', () => {
    const result = resolveShove({
      grid: gapped,
      hazards: {},
      entities: [playerEntity(3, 1), enemyEntity('mob', 3, 0, 1)],
      originId: 'player-1',
      dir: 'up',
      hpById: { 'player-1': { hp: 100, maxHp: 100 }, mob: { hp: 28, maxHp: 28 } },
      overlays: { fallOffEdge: true },
    });
    expect(result.kind).toBe('fall');
    expect(result.fell.map((e) => e.id)).toEqual(['mob']);
    expect(result.entities.some((e) => e.id === 'mob')).toBe(false);
    const record = result.damages.find((d) => d.entityId === 'mob');
    expect(record?.hpAfter).toBe(0); // 质量 1 小怪 → 直接斩杀
    expect(result.defeatedIds).toEqual(['mob']);
  });
});

describe('深渊 / 尖刺地形伤害', () => {
  it('非小怪坠渊：50% maxHp 伤害 + 从战场移除', () => {
    const hazards: HazardMap = { '4,2': 'abyss' };
    const result = resolveShove({
      grid: arena,
      hazards,
      entities: [playerEntity(2, 2), enemyEntity('big', 3, 2, 3)],
      originId: 'player-1',
      dir: 'right',
      hpById: { 'player-1': { hp: 100, maxHp: 100 }, big: { hp: 149, maxHp: 149 } },
    });
    expect(result.kind).toBe('push');
    expect(result.fellIntoAbyss.map((e) => e.id)).toEqual(['big']);
    expect(result.entities.some((e) => e.id === 'big')).toBe(false);
    const record = result.damages.find((d) => d.entityId === 'big');
    expect(record?.hpAfter).toBe(149 - Math.round(149 * 0.5));
    expect(record?.defeated).toBe(false);
  });

  it('踩尖刺：15% maxHp 伤害（最少 1 点），实体留在原地', () => {
    const hazards: HazardMap = { '4,2': 'spike' }; // 被推一格后的落点
    const result = resolveShove({
      grid: arena,
      hazards,
      entities: [playerEntity(2, 2), enemyEntity('mob', 3, 2, 1)],
      originId: 'player-1',
      dir: 'right',
      hpById: { 'player-1': { hp: 100, maxHp: 100 }, mob: { hp: 149, maxHp: 149 } },
    });
    expect(result.kind).toBe('push');
    const record = result.damages.find((d) => d.entityId === 'mob');
    expect(record?.hpAfter).toBe(149 - Math.max(1, Math.round(149 * 0.15)));
    expect(result.entities.find((e) => e.id === 'mob')?.x).toBe(4); // 留在尖刺格上
  });

  it('玩家踩尖刺同样受伤（记录回传调用方）', () => {
    const hazards: HazardMap = { '2,2': 'spike' };
    const result = resolveShove({
      grid: arena,
      hazards,
      entities: [playerEntity(1, 2)],
      originId: 'player-1',
      dir: 'right',
      hpById: { 'player-1': { hp: 100, maxHp: 100 } },
    });
    expect(result.damages.some((d) => d.entityId === 'player-1' && d.source === 'spike')).toBe(true);
  });
});

describe('箱落攻击联动', () => {
  it('箱子被推入深渊 → 碎裂冲击：正交相邻敌人受 30×箱质量 伤害', () => {
    const hazards: HazardMap = { '4,2': 'abyss' };
    const result = resolveShove({
      grid: arena,
      hazards,
      entities: [playerEntity(2, 2), chestEntity('box', 3, 2), enemyEntity('mob', 4, 1)],
      originId: 'player-1',
      dir: 'right',
      hpById: {
        'player-1': { hp: 100, maxHp: 100 },
        box: { hp: 1, maxHp: 1 },
        mob: { hp: 100, maxHp: 100 },
      },
      overlays: { boxDropDamage: 30 }, // turn 层传 DEFAULT_BOX_DROP_DAMAGE
    });
    expect(result.kind).toBe('push');
    expect(result.boxDrop).toHaveLength(1);
    expect(result.boxDrop[0]?.at).toEqual({ x: 4, y: 2 }); // 箱子被推一格后落入深渊格
    expect(result.boxDrop[0]?.damage).toBe(60); // 30 × 箱质量 2
    expect(result.boxDrop[0]?.hits).toEqual(['mob']); // mob 在 (4,1)，是落点 (4,2) 的上邻
    const record = result.damages.find((d) => d.entityId === 'mob' && d.source === 'box-drop');
    expect(record?.hpAfter).toBe(40);
  });

  it('boxDropDamage:0 关闭联动（箱子坠落仍移除，但无冲击）', () => {
    const hazards: HazardMap = { '4,2': 'abyss' };
    const result = resolveShove({
      grid: arena,
      hazards,
      entities: [playerEntity(2, 2), chestEntity('box', 3, 2), enemyEntity('mob', 4, 1)],
      originId: 'player-1',
      dir: 'right',
      hpById: {
        'player-1': { hp: 100, maxHp: 100 },
        box: { hp: 1, maxHp: 1 },
        mob: { hp: 100, maxHp: 100 },
      },
      overlays: { boxDropDamage: 0 },
    });
    expect(result.boxDrop).toEqual([]);
    expect(result.damages.some((d) => d.source === 'box-drop')).toBe(false);
    expect(result.fellIntoAbyss.some((e) => e.id === 'box')).toBe(true);
  });
});

describe('分身（K10 有界）', () => {
  it('nextCloneCount 恒 ≤ 64 且为安全整数', () => {
    expect(nextCloneCount(0)).toBe(0);
    expect(nextCloneCount(2)).toBe(4);
    expect(nextCloneCount(40)).toBe(64); // 80 → 64
    expect(nextCloneCount(64)).toBe(64);
    expect(nextCloneCount(1_000_000)).toBe(64);
    expect(Number.isSafeInteger(nextCloneCount(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it('spawnClones 只放 ≤ count 且 ≤ 空闲格数，避开墙/占位/地形', () => {
    const hazards: HazardMap = { '1,1': 'abyss', '3,1': 'spike' };
    const spawned = spawnClones(
      arena,
      [playerEntity(1, 3), enemyEntity('boss', 2, 2, 9)],
      { 'player-1': { hp: 100, maxHp: 100 }, boss: { hp: 2333, maxHp: 2333 } },
      'boss',
      4,
      'battle-boss',
      hazards,
    );
    expect(spawned.spawned.length).toBeLessThanOrEqual(4);
    expect(spawned.spawned.length).toBeGreaterThan(0);
    for (const clone of spawned.spawned) {
      expect(clone.mass).toBe(1);
      expect(clone.pushable).toBe(true);
      const cell = hazards[`${clone.x},${clone.y}`];
      expect(cell).toBeUndefined(); // 不站深渊/尖刺
      expect(clone.id === 'player-1' || clone.x !== 1 || clone.y !== 3).toBe(true);
      expect(clone.x !== 2 || clone.y !== 2).toBe(true); // 不与 boss 重叠
    }
    expect(spawned.hpById[spawned.spawned[0]!.id]).toEqual({ hp: 1, maxHp: 1 });
  });

  it('MAX_CLONES 常量 = 64', () => {
    expect(MAX_CLONES).toBe(64);
  });
});
