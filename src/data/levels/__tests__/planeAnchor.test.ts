/**
 * 位面锚点数据不变量（C1 回归防线）。
 * ---------------------------------------------------------------------------
 * 老缺陷：lb-09 表里回廊的位面锚点 (5,1) 在阳面 terrain[1][5]=1、阴面
 * shadeTerrain[1][5]=1 —— 两面都是墙格，玩家永远无法站上该锚点（一半锚点
 * 永久失效，北廊中段的位面切换点缺失）。
 *
 * 本文件把「锚点必须可站」钉进回归：
 *  1. 锚点在网格边界内；
 *  2. 锚点在阳面地形上是通路（parse 后 2/4 已归 0）；
 *  3. 锚点在阴面地形上也是通路 —— canTogglePlane 要求切换后所有实体（含
 *     玩家本人）不得嵌进目标位面墙里（move.ts applyPlaneShift → grid.ts
 *     canTogglePlane），只在单面可站的锚点同样永远切不动。
 * 全关卡扫描 + lb-09 逐点断言双保险。
 */

import { describe, expect, it } from 'vitest';
import type { Grid } from '../../../core/types';
import { AREA_LEVELS } from '../areas';
import { parseLevelGeometry } from '../../../engine/puzzle/grid';
import { isWall } from '../../../core/gridMove';

const parsedById = new Map(
  AREA_LEVELS.map((level) => {
    const parsed = parseLevelGeometry(level);
    return [level.id, parsed.ok ? parsed.geometry : null] as const;
  }),
);

/** 可站立：边界内且非墙 —— 直接复用 core/gridMove.isWall（单一真相，不写第二套边界逻辑） */
function walkable(terrain: Grid, x: number, y: number): boolean {
  const cell = terrain[y]?.[x];
  return cell !== undefined && !isWall(cell);
}

describe('planeAnchors · 锚点必须落在玩家可站立格（C1）', () => {
  it('全关卡扫描：每个锚点在边界内，且阳/阴两面都是通路格', () => {
    const checked: string[] = [];
    for (const level of AREA_LEVELS) {
      const geometry = parsedById.get(level.id);
      expect(geometry, `${level.id}: 几何解析失败`).not.toBeNull();
      const geo = geometry!;
      for (const anchor of geo.planeAnchors) {
        // 边界内（solver.test 断言尺寸/边界的同款语义，这里针对锚点再钉一次）
        expect(anchor.x, `${level.id} 锚点 x 越界`).toBeGreaterThanOrEqual(0);
        expect(anchor.x, `${level.id} 锚点 x 越界`).toBeLessThan(geo.width);
        expect(anchor.y, `${level.id} 锚点 y 越界`).toBeGreaterThanOrEqual(0);
        expect(anchor.y, `${level.id} 锚点 y 越界`).toBeLessThan(geo.height);
        // 阳面可站（站上去才有资格按 F）
        expect(
          walkable(geo.terrain, anchor.x, anchor.y),
          `${level.id} 锚点 (${anchor.x},${anchor.y}) 在阳面是墙格/不可站格`,
        ).toBe(true);
        // 阴面也必须非墙（canTogglePlane 的 embedded 拒绝：玩家本人也属于实体）
        if (geo.shadeTerrain !== null) {
          expect(
            walkable(geo.shadeTerrain, anchor.x, anchor.y),
            `${level.id} 锚点 (${anchor.x},${anchor.y}) 在阴面是墙格（F 切位面必被 embedded 拒绝）`,
          ).toBe(true);
        }
        checked.push(`${level.id}:(${anchor.x},${anchor.y})`);
      }
    }
    // 防空转：锚点清单非空（lb-07/lb-09 至少各两处）
    expect(checked.length).toBeGreaterThanOrEqual(4);
  });

  it('lb-09 表里回廊：锚点为 (4,1)/(9,1)，(5,1) 不再入表且确认是两面墙格', () => {
    const geometry = parsedById.get('level-lb-09');
    expect(geometry).not.toBeNull();
    const geo = geometry!;
    expect(geo.planeAnchors).toEqual([{ x: 4, y: 1 }, { x: 9, y: 1 }]);
    // 老缺陷点 (5,1)：阳/阴两面均为墙（数据事实留档，防止未来误改回）
    expect(geo.terrain[1]?.[5]).toBe(1);
    expect(geo.shadeTerrain?.[1]?.[5]).toBe(1);
    // 新锚点两面均为通路
    expect(walkable(geo.terrain, 4, 1)).toBe(true);
    expect(walkable(geo.shadeTerrain!, 4, 1)).toBe(true);
    expect(walkable(geo.terrain, 9, 1)).toBe(true);
    expect(walkable(geo.shadeTerrain!, 9, 1)).toBe(true);
  });

  it('lb-07 登阶长廊：既有锚点 (1,1)/(9,1) 同样两面可站（不变量不回退）', () => {
    const geometry = parsedById.get('level-lb-07');
    expect(geometry).not.toBeNull();
    const geo = geometry!;
    expect(geo.planeAnchors).toEqual([{ x: 1, y: 1 }, { x: 9, y: 1 }]);
    for (const anchor of geo.planeAnchors) {
      expect(walkable(geo.terrain, anchor.x, anchor.y)).toBe(true);
      expect(walkable(geo.shadeTerrain!, anchor.x, anchor.y)).toBe(true);
    }
  });
});
