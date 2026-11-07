/**
 * gridMove —— 共享推挤原语单测。
 * 重点：守卫先于索引访问（move.js:21-24 教训的回归测试）。
 */

import { describe, expect, it } from 'vitest';
import { cellAt, entityAt, isInside, occupancyOf, resolvePush } from '../gridMove';
import type { Grid, GridEntity } from '../types';

/** 5×5 空地，四周一圈墙 */
const box: Grid = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
];

const player = (x: number, y: number): GridEntity => ({ id: 'p', kind: 'player', x, y, mass: Infinity, pushable: false });
const chest = (id: string, x: number, y: number): GridEntity => ({ id, kind: 'chest', x, y, mass: 2, pushable: true });

describe('cellAt / isInside —— 守卫先于索引', () => {
  it('界内返回 ok 与格值', () => {
    expect(cellAt(box, 1, 1)).toEqual({ ok: true, value: 0 });
    expect(cellAt(box, 0, 0)).toEqual({ ok: true, value: 1 });
  });

  it('负坐标/超界/非整数一律 ok:false，绝不触索引', () => {
    expect(cellAt(box, -1, 2).ok).toBe(false);
    expect(cellAt(box, 2, -1).ok).toBe(false);
    expect(cellAt(box, 5, 2).ok).toBe(false);
    expect(cellAt(box, 2, 5).ok).toBe(false);
    expect(cellAt(box, 0.5, 2).ok).toBe(false);
    expect(isInside(box, -1, 0)).toBe(false);
  });
});

describe('resolvePush —— move/push/chain/blocked/fall', () => {
  it('空地滑动 → move，纯函数不修改入参', () => {
    const entities = [player(1, 1)];
    const result = resolvePush({ grid: box, entities, origin: 'p', dir: 'right' });
    expect(result.kind).toBe('move');
    if (result.kind === 'move') {
      expect(result.to).toEqual({ x: 2, y: 1 });
      expect(result.entities[0]?.x).toBe(2);
    }
    expect(entities[0]?.x).toBe(1); // 入参未被改动
  });

  it('推动单个箱子 → push（箱子前移、玩家前移）', () => {
    const entities = [player(1, 1), chest('c1', 2, 1)];
    const result = resolvePush({ grid: box, entities, origin: 'p', dir: 'right' });
    expect(result.kind).toBe('push');
    if (result.kind !== 'push') throw new Error('应为 push');
    const c1 = result.entities.find((e) => e.id === 'c1');
    const p = result.entities.find((e) => e.id === 'p');
    expect(c1?.x).toBe(3);
    expect(p?.x).toBe(2);
  });

  it('两连推 → chain（5 格宽内圈，链尾后有净空）', () => {
    // 内圈宽 5：列 1..5 可走，链尾 c2 前方是空地
    const wide: Grid = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ];
    const entities = [player(1, 2), chest('c1', 2, 2), chest('c2', 3, 2)];
    const result = resolvePush({ grid: wide, entities, origin: 'p', dir: 'right' });
    expect(result.kind).toBe('chain');
    if (result.kind !== 'chain') throw new Error('应为 chain');
    const c2 = result.entities.find((e) => e.id === 'c2');
    expect(c2?.x).toBe(4);
  });

  it('撞墙 → blocked(wall)（链尾前方是边界墙）', () => {
    const entities = [player(1, 1), chest('c1', 2, 1), chest('c2', 3, 1)];
    // (4,1) 是墙格 → 链尾撞墙
    const result = resolvePush({ grid: box, entities, origin: 'p', dir: 'right' });
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.reason).toBe('wall');
  });

  it('撞不可推实体 → blocked(immovable)', () => {
    const statue: GridEntity = { id: 'statue', kind: 'prop', x: 2, y: 1, mass: Infinity, pushable: false };
    const result = resolvePush({ grid: box, entities: [player(1, 1), statue], origin: 'p', dir: 'right' });
    expect(result).toEqual({ kind: 'blocked', reason: 'immovable' });
  });

  it('玩家在缺口边缘向负方向移动越界 → blocked(out-of-bounds)（负方向守卫不是死代码）', () => {
    // gapped 顶行 (2,0) 是缺口：玩家站在缺口上再往上走 → 越界（默认不许坠落）
    const gapped: Grid = [
      [1, 1, 0, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const entities = [player(2, 0)];
    const result = resolvePush({ grid: gapped, entities, origin: 'p', dir: 'up' });
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.reason).toBe('out-of-bounds');
  });

  it('origin 不存在 → blocked(no-origin)，不抛异常不逃逸', () => {
    const result = resolvePush({ grid: box, entities: [], origin: 'ghost', dir: 'up' });
    expect(result).toEqual({ kind: 'blocked', reason: 'no-origin' });
  });

  it('fallOffEdge:false 时链尾越界 → blocked；true 时 → fall 且坠出者被移除', () => {
    // 顶行是墙，这里造一个有缺口的地图：缺口在 (2,0)
    const gapped: Grid = [
      [1, 1, 0, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ];
    const entities = [player(2, 1), chest('c1', 2, 0)];
    // 玩家 (2,1) 向上推箱子 (2,0)：箱子目标 (2,-1) 越界
    const blockedResult = resolvePush({ grid: gapped, entities, origin: 'p', dir: 'up' });
    expect(blockedResult.kind).toBe('blocked');

    const fallResult = resolvePush({
      grid: gapped,
      entities,
      origin: 'p',
      dir: 'up',
      rules: { maxChain: 4, fallOffEdge: true },
    });
    expect(fallResult.kind).toBe('fall');
    if (fallResult.kind === 'fall') {
      expect(fallResult.fell.map((e) => e.id)).toEqual(['c1']);
      expect(fallResult.entities.some((e) => e.id === 'c1')).toBe(false);
      const p = fallResult.entities.find((e) => e.id === 'p');
      expect(p?.y).toBe(0); // 玩家前进到缺口格
    }
  });

  it('maxChain 限制：链长超限 → blocked(chain-limit)', () => {
    const entities = [player(1, 1), chest('c1', 2, 1), chest('c2', 3, 1)];
    const result = resolvePush({
      grid: box,
      entities,
      origin: 'p',
      dir: 'right',
      rules: { maxChain: 1, fallOffEdge: false },
    });
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.reason).toBe('chain-limit');
  });

  it('shoveImmune 实体不可被推（combat 免疫契约）', () => {
    const boss: GridEntity = { id: 'boss', kind: 'enemy', x: 2, y: 1, mass: 9, pushable: true, shoveImmune: true };
    const result = resolvePush({ grid: box, entities: [player(1, 1), boss], origin: 'p', dir: 'right' });
    expect(result).toEqual({ kind: 'blocked', reason: 'immovable' });
  });
});

describe('occupancyOf / entityAt —— 派生查询', () => {
  it('占位表以坐标为键现算', () => {
    const entities = [player(1, 2), chest('c1', 3, 3)];
    const occ = occupancyOf(entities);
    expect(occ.get('1,2')?.id).toBe('p');
    expect(occ.get('3,3')?.id).toBe('c1');
    expect(entityAt(entities, 3, 3)?.id).toBe('c1');
    expect(entityAt(entities, 0, 0)).toBeUndefined();
  });
});
