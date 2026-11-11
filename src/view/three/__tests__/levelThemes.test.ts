/**
 * levelThemes —— 12 关逐关主题单测（THEME-3）。
 * 覆盖：表覆盖 AREA_LEVELS 全 id、resolveLevelTheme 产出完整 PlaneTheme 且
 * hex 全部合法（正则断言）、L9 per-plane 双分支、对比度守则（goal/门体不被
 * 关卡混色）、墙皮 14 阶按关重采样、提灯（L3 双位面 / L9 仅阴面且 ≥3 格）、
 * Sparkles 参数、装饰格与主角装置落格（确定性 + 地板子集）。
 */

import { describe, expect, it } from 'vitest';
import { AREA_LEVELS } from '../../../data/levels/areas';
import { deriveTileField, planeTheme, WALL_SHADE_COUNT, type PlaneTheme } from '../theme';
import {
  LEVEL_THEMES,
  levelDeco,
  levelHeroProp,
  levelLantern,
  levelSparkles,
  levelWallShadeColor,
  resolveLevelTheme,
} from '../levelThemes';

/** 递归断言：所有以 # 开头的字符串都是合法 6 位 hex */
function expectHexDeep(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.startsWith('#')) expect(value, `${path} 应为合法 6 位 hex`).toMatch(/^#[0-9a-f]{6}$/);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => expectHexDeep(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) expectHexDeep(v, `${path}.${k}`);
  }
}

/** 收集对象的全部键路径（结构完整性对比：解析结果 vs 基础主题） */
function shapePaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const p = prefix === '' ? k : `${prefix}.${k}`;
    paths.push(p, ...shapePaths(v, p));
  }
  return paths.sort();
}

describe('levelThemes · 表覆盖', () => {
  it('LEVEL_THEMES 恰好覆盖 AREA_LEVELS 全部 12 关 id', () => {
    expect(Object.keys(LEVEL_THEMES).sort()).toEqual(AREA_LEVELS.map((l) => l.id).sort());
    expect(Object.keys(LEVEL_THEMES).length).toBe(12);
  });
});

describe('levelThemes · resolveLevelTheme 完整性与 hex 合法性', () => {
  it('12 关 × 双位面产出完整 PlaneTheme（键结构与基础主题逐字段一致），hex 全部合法', () => {
    for (const level of AREA_LEVELS) {
      for (const planeShifted of [false, true]) {
        const theme = resolveLevelTheme(level.id, planeShifted);
        const base = planeTheme(planeShifted);
        expect(shapePaths(theme)).toEqual(shapePaths(base));
        expectHexDeep(theme, level.id);
        expect(theme.fogDensity).toBeGreaterThan(0);
        expect(Number.isFinite(theme.fogDensity)).toBe(true);
        expect(theme.keyLight.intensity).toBeGreaterThan(0);
        expect(theme.rimLight.intensity).toBeGreaterThan(0);
        expect(theme.keyLight.position.length).toBe(3);
        expect(theme.id).toBe(base.id);
      }
    }
  });

  it('同一入参返回同一冻结引用（缓存；可安全放入 useMemo deps）', () => {
    const a = resolveLevelTheme('level-sb-01', false);
    expect(resolveLevelTheme('level-sb-01', false)).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('null/未知关卡 id 退回位面基础主题（标题页兜底）', () => {
    expect(resolveLevelTheme(null, false)).toBe(planeTheme(false));
    expect(resolveLevelTheme(null, true)).toBe(planeTheme(true));
    expect(resolveLevelTheme('level-not-exist', false)).toBe(planeTheme(false));
  });

  it('mixHex 派生有效：3/9/12 雾色两两不同，暗夜关 L3 雾比 L1 浓', () => {
    const fog3 = resolveLevelTheme('level-sb-03', false).fogColor;
    const fog9 = resolveLevelTheme('level-lb-09', false).fogColor;
    const fog12 = resolveLevelTheme('level-lb-12', false).fogColor;
    expect(fog3).not.toBe(fog9);
    expect(fog9).not.toBe(fog12);
    expect(fog3).not.toBe(fog12);
    expect(resolveLevelTheme('level-sb-03', false).fogDensity).toBeGreaterThan(
      resolveLevelTheme('level-sb-01', false).fogDensity,
    );
  });
});

describe('levelThemes · L9 表里回廊 per-plane 双分支', () => {
  it('L9 阴阳两相雾色与识别色（gate.rim）各自成相', () => {
    const yang = resolveLevelTheme('level-lb-09', false);
    const yin = resolveLevelTheme('level-lb-09', true);
    expect(yang.fogColor).not.toBe(yin.fogColor);
    expect(yang.gate.rim).toBe('#ffcf8a'); // 阳面暖沙
    expect(yin.gate.rim).toBe('#8afff2'); // 阴面冰晶（yinPlane 分支生效）
  });

  it('分支是 L9 专属：普通关的识别色跨位面恒定', () => {
    for (const id of ['level-sb-01', 'level-sb-03', 'level-lb-12'] as const) {
      expect(resolveLevelTheme(id, false).gate.rim).toBe(resolveLevelTheme(id, true).gate.rim);
    }
  });

  it('L9 阴面 Sparkles 与墙面随分支换色', () => {
    const yang = levelSparkles('level-lb-09', false);
    const yin = levelSparkles('level-lb-09', true);
    expect(yang?.color).toBe('#ffd9a0');
    expect(yin?.color).toBe('#a8fff2');
    expect(resolveLevelTheme('level-lb-09', false).wall.top).not.toBe(
      resolveLevelTheme('level-lb-09', true).wall.top,
    );
  });
});

describe('levelThemes · 对比度守则（goal 基座/法则之门保持全场最高对比）', () => {
  it('goal/abyss/phase/spike/crate/actor/gate 主体全部继承位面基础主题，不随关混色', () => {
    for (const level of AREA_LEVELS) {
      for (const planeShifted of [false, true]) {
        const base = planeTheme(planeShifted);
        const theme = resolveLevelTheme(level.id, planeShifted);
        expect(theme.goal).toEqual(base.goal); // 金色基座/顶冠
        expect(theme.gate.pillar).toBe(base.gate.pillar);
        expect(theme.gate.portal).toBe(base.gate.portal); // 门体主体高对比
        expect(theme.crate).toEqual(base.crate);
        expect(theme.phase).toEqual(base.phase);
        expect(theme.spike).toEqual(base.spike);
        expect(theme.actor).toEqual(base.actor);
      }
    }
  });

  it('goal 顶冠不与任何关卡识别色同色（点缀色不侵占最高对比位）', () => {
    for (const planeShifted of [false, true]) {
      const caps = new Set<string>();
      for (const level of AREA_LEVELS) {
        const spec = LEVEL_THEMES[level.id];
        const accent = planeShifted ? (spec?.yinPlane?.accent ?? spec?.accent) : spec?.accent;
        if (accent !== undefined) caps.add(accent);
      }
      expect(caps.has(planeTheme(planeShifted).goal.cap)).toBe(false);
    }
  });
});

describe('levelThemes · 墙皮 14 阶按关重采样', () => {
  it('全部 hex 合法、越界回绕稳定，且不同关色的墙皮 ramp 可区分', () => {
    const t1 = resolveLevelTheme('level-sb-01', false);
    const t3 = resolveLevelTheme('level-sb-03', false);
    for (let i = 0; i < WALL_SHADE_COUNT; i++) {
      expect(levelWallShadeColor(t1, i)).toMatch(/^#[0-9a-f]{6}$/);
      expect(levelWallShadeColor(t3, i)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(levelWallShadeColor(t1, -1)).toBe(levelWallShadeColor(t1, WALL_SHADE_COUNT - 1));
    expect(levelWallShadeColor(t1, WALL_SHADE_COUNT)).toBe(levelWallShadeColor(t1, 0));
    expect(levelWallShadeColor(t1, 0)).not.toBe(levelWallShadeColor(t3, 0));
  });

  it('基础位面主题同样可重采样（主区远景/标题页兜底路径）', () => {
    const base: PlaneTheme = planeTheme(true);
    for (let i = 0; i < WALL_SHADE_COUNT; i++) {
      expect(levelWallShadeColor(base, i)).toMatch(/^#[0-9a-f]{6}$/);
    }
    // 与 YIN/YANG 基础 ramp 形状同源：奇偶错位采样的相邻差存在
    expect(levelWallShadeColor(base, 0)).not.toBe(levelWallShadeColor(base, 1));
  });
});

describe('levelThemes · 玩家提灯', () => {
  it('L3 碎星十字双位面点亮，照亮半径 ≥3 格', () => {
    for (const planeShifted of [false, true]) {
      const lantern = levelLantern('level-sb-03', planeShifted);
      expect(lantern).not.toBeNull();
      expect(lantern?.distance).toBeGreaterThanOrEqual(3);
      expect(lantern?.intensity).toBeGreaterThan(0);
    }
  });

  it('L9 仅阴面点亮；其余 10 关不启用', () => {
    expect(levelLantern('level-lb-09', false)).toBeNull();
    expect(levelLantern('level-lb-09', true)).not.toBeNull();
    for (const level of AREA_LEVELS) {
      if (level.id === 'level-sb-03' || level.id === 'level-lb-09') continue;
      for (const planeShifted of [false, true]) {
        expect(levelLantern(level.id, planeShifted)).toBeNull();
      }
    }
  });
});

describe('levelThemes · Sparkles 环境粒子', () => {
  it('12 关全配且参数合法（count>0、opacity∈(0,1]、hex 色、scale 三元）', () => {
    for (const level of AREA_LEVELS) {
      for (const planeShifted of [false, true]) {
        const sparkles = levelSparkles(level.id, planeShifted);
        expect(sparkles).not.toBeNull();
        expect(sparkles?.count).toBeGreaterThan(0);
        expect(sparkles?.opacity).toBeGreaterThan(0);
        expect(sparkles?.opacity).toBeLessThanOrEqual(1);
        expect(sparkles?.scale.length).toBe(3);
        expect(sparkles?.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('同一入参返回同一冻结引用（Sparkles props 稳定，不重掷粒子云）', () => {
    const a = levelSparkles('level-lb-12', false);
    expect(levelSparkles('level-lb-12', false)).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(levelSparkles(null, false)).toBeNull();
  });
});

describe('levelThemes · 装饰格（deco）', () => {
  /** 关卡在指定位面的渲染网格（L9 阴面走 shadeGrid 位面捷径） */
  const levelGrid = (id: string, planeShifted: boolean) => {
    const level = AREA_LEVELS.find((l) => l.id === id);
    if (level === undefined) throw new Error(`关卡数据缺失：${id}`);
    return planeShifted ? (level.shadeGrid ?? level.grid) : level.grid;
  };

  it('每关装饰格落在地板子集内、确定性复现', () => {
    for (const level of AREA_LEVELS) {
      for (const planeShifted of [false, true]) {
        const grid = levelGrid(level.id, planeShifted);
        const field = deriveTileField(grid, level.heights);
        const floorKeys = new Set(field.floors.map((t) => `${t.x},${t.y}`));
        const deco = levelDeco(level.id, planeShifted, field);
        expect(deco).not.toBeNull();
        expect(deco?.tiles.length).toBeGreaterThan(0);
        for (const tile of deco?.tiles ?? []) {
          expect(floorKeys.has(`${tile.x},${tile.y}`)).toBe(true);
        }
        expect(levelDeco(level.id, planeShifted, field)).toEqual(deco);
      }
    }
  });

  it('装饰密度有界（不超过地板数的一半）且 null 关卡不产装饰', () => {
    for (const level of AREA_LEVELS) {
      const field = deriveTileField(level.grid, level.heights);
      const deco = levelDeco(level.id, false, field);
      expect(deco?.tiles.length ?? 0).toBeLessThanOrEqual(field.floors.length / 2);
    }
    expect(levelDeco(null, false, deriveTileField(AREA_LEVELS[0]?.grid ?? []))).toBeNull();
  });
});

describe('levelThemes · 主角装置（heroProp）', () => {
  it('每关恰好一座，落格为原始网格中的地板格且确定性', () => {
    for (const level of AREA_LEVELS) {
      const prop = levelHeroProp(level.id, false, level.grid);
      expect(prop).not.toBeNull();
      const row = level.grid[prop?.cell.y ?? -1];
      expect(row?.[prop?.cell.x ?? -1]).toBe(0); // 地板（非墙/旗/出生点）
      expect(levelHeroProp(level.id, false, level.grid)).toEqual(prop);
    }
  });

  it('null 关卡不产装置；height 为正', () => {
    expect(levelHeroProp(null, false, AREA_LEVELS[0]?.grid ?? [])).toBeNull();
    for (const level of AREA_LEVELS) {
      expect(levelHeroProp(level.id, false, level.grid)?.height).toBeGreaterThan(0);
    }
  });
});
