/**
 * 3D 高度层 / 阴面地形接线 —— 纯逻辑单测。
 * 覆盖：HEIGHT_STEP 海拔换算、heightOf 守卫式读取、cellWorldCenter 海拔抬升、
 * deriveTileField 读海拔层、阴面 shadeGrid 的地形派生（M6：阳墙阴路）。
 * 全部不依赖 WebGL。
 */

import { describe, expect, it } from 'vitest';
import { HEIGHT_STEP, cellWorldCenter, deriveTileField, heightOf } from '../theme';
import { findAreaLevel } from '../../../data/levels/areas';
import type { HeightMap } from '../../../engine/puzzle/grid';
import type { Grid } from '../../../core/types';

/** lb-09 表里回廊：阳墙 (8,3) 在阴面变通路 */
const LB09 = findAreaLevel('level-lb-09');
/** lb-08 井底星榻：井底 (5,5) 高 0，环台 8 邻高 2，(3,5)/(7,5) 高 1 */
const LB08 = findAreaLevel('level-lb-08');

describe('theme · 海拔换算（M5）', () => {
  it('heightOf 缺省/越界归 0，合法格返回海拔层数', () => {
    const heights: HeightMap = [[0, 1, 2]];
    expect(heightOf(heights, 0, 0)).toBe(0);
    expect(heightOf(heights, 1, 0)).toBe(1);
    expect(heightOf(heights, 2, 0)).toBe(2);
    expect(heightOf(heights, 3, 0)).toBe(0); // 越界
    expect(heightOf(heights, 0, 1)).toBe(0); // 越界
    expect(heightOf(undefined, 0, 0)).toBe(0); // 无海拔层
  });

  it('cellWorldCenter 按海拔抬升 y = height × HEIGHT_STEP，x/z 不变', () => {
    const flat = cellWorldCenter(3, 4, 9, 9, 'main', 0);
    const raised = cellWorldCenter(3, 4, 9, 9, 'main', 2);
    expect(flat[1]).toBe(0);
    expect(raised[0]).toBe(flat[0]);
    expect(raised[2]).toBe(flat[2]);
    expect(raised[1]).toBeCloseTo(2 * HEIGHT_STEP, 10);
    // 缺省参数 = 高度 0（旧调用点零破坏）
    expect(cellWorldCenter(3, 4, 9, 9, 'main')[1]).toBe(0);
  });

  it('lb-08 井底：井底 0、环台 2、阶 1（箱落深井的高度数据真到位）', () => {
    const heights = LB08?.heights;
    expect(heights).toBeDefined();
    if (heights === undefined) return;
    expect(heightOf(heights, 5, 5)).toBe(0); // 井底旗位
    expect(heightOf(heights, 4, 5)).toBe(2); // 环台
    expect(heightOf(heights, 3, 5)).toBe(1); // 台阶
  });
});

describe('theme · deriveTileField 读海拔（M5）', () => {
  it('瓦片记录自身海拔，墙/地板/旗位各归其位', () => {
    // 3×1 图例：地板 0、墙 1、旗位 3；第 2/3 列整体抬到 2 层
    const grid: Grid = [[0, 1, 3]];
    const heights: HeightMap = [[0, 2, 2]];
    const field = deriveTileField(grid, heights);
    expect(field.floors.find((t) => t.x === 0)?.height).toBe(0);
    expect(field.walls.find((t) => t.x === 1)?.height).toBe(2);
    expect(field.goals.find((t) => t.x === 2)?.height).toBe(2);
  });

  it('缺省海拔层时全部瓦片高度为 0（纯平面关零回归）', () => {
    const field = deriveTileField([[0, 3]] as Grid);
    for (const t of [...field.floors, ...field.goals]) {
      expect(t.height).toBe(0);
    }
  });
});

describe('theme · 阴面地形派生（M6）', () => {
  it('lb-09 阳墙 (8,3) 在阴面 shadeGrid 变通路', () => {
    expect(LB09).toBeDefined();
    if (LB09 === undefined) return;
    const yang = LB09.grid;
    const yin = LB09.shadeGrid;
    expect(yin).toBeDefined();
    if (yin === undefined) return;
    expect(yang[3]?.[8]).toBe(1); // 阳面是墙
    expect(yin[3]?.[8]).toBe(0); // 阴面是通路

    const yangField = deriveTileField(yang);
    const yinField = deriveTileField(yin);
    expect(yangField.walls.some((t) => t.x === 8 && t.y === 3)).toBe(true);
    expect(yinField.floors.some((t) => t.x === 8 && t.y === 3)).toBe(true);
    expect(yinField.walls.some((t) => t.x === 8 && t.y === 3)).toBe(false);
  });

  it('阴面浮空石板派生自阴面地板（真实通路），不越出阴面墙', () => {
    if (LB09?.shadeGrid === undefined) return;
    const field = deriveTileField(LB09.shadeGrid);
    const floorKeys = new Set(field.floors.map((t) => `${t.x},${t.y}`));
    for (const tile of field.phaseTiles) {
      expect(floorKeys.has(`${tile.x},${tile.y}`)).toBe(true);
    }
  });
});
