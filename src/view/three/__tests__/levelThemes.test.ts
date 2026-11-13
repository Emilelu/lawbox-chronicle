/**
 * levelThemes —— 12 关逐关主题单测（THEME-3）。
 * 覆盖：表覆盖 AREA_LEVELS 全 id、resolveLevelTheme 产出完整 PlaneTheme 且
 * hex 全部合法（正则断言）、L9 per-plane 双分支、对比度守则（goal/门体不被
 * 关卡混色）、墙皮 14 阶按关重采样、提灯（L3 双位面 / L9 仅阴面且 ≥3 格）、
 * Sparkles 参数、装饰格与主角装置落格（确定性 + 地板子集）。
 * 另含量化对比度回归（A2-3/A2-4/A2-5：crate/pedestal/heroProp vs 解析地板）
 * 与墙皮重掷 epoch（A2-2）的确定性断言。
 */

import { describe, expect, it } from 'vitest';
import { AREA_LEVELS } from '../../../data/levels/areas';
import { YANG_THEME as YANG, YIN_THEME as YIN, deriveTileField, mixHex, planeTheme, WALL_SHADE_COUNT, type PlaneTheme } from '../theme';
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

describe('levelThemes · 氛围豁免直通（B2-3）', () => {
  it('L3 暗夜关灯强/雾浓直取 spec 绝对值（双位面一致，不被 LEVEL_MIX 稀释）', () => {
    // 注释宣称「灯减半、雾浓一倍」：0.6 混色曾把它稀释成 keyLight 0.80/雾 0.0356
    for (const planeShifted of [false, true] as const) {
      const theme = resolveLevelTheme('level-sb-03', planeShifted);
      expect(theme.keyLight.intensity).toBe(0.5);
      expect(theme.rimLight.intensity).toBe(0.4);
      expect(theme.fogDensity).toBe(0.042);
    }
  });

  it('非豁免关强度/密度仍走 LEVEL_MIX=0.6 混色（其余关行为不变）', () => {
    // L1：keyLight lerp(1.25, 1.3, 0.6)=1.28、fog lerp(0.026, 0.024, 0.6)=0.0248
    const l1 = resolveLevelTheme('level-sb-01', false);
    expect(l1.keyLight.intensity).toBeCloseTo(1.28, 12);
    expect(l1.fogDensity).toBeCloseTo(0.0248, 12);
    // L9 阴面（yinPlane 覆盖、无豁免）走混色：keyLight lerp(1.1, 0.9, 0.6)=0.98
    expect(resolveLevelTheme('level-lb-09', true).keyLight.intensity).toBeCloseTo(0.98, 12);
  });

  it('直通只豁免强度/密度：色值仍随关混色（关卡识别色职责不变）', () => {
    const base = planeTheme(false);
    const spec = LEVEL_THEMES['level-sb-03'];
    expect(spec).toBeDefined();
    const l3 = resolveLevelTheme('level-sb-03', false);
    expect(l3.keyLight.color).toBe(mixHex(base.keyLight.color, spec!.keyLight.color, 0.6));
    expect(l3.fogColor).toBe(mixHex(base.fogColor, spec!.fog.color, 0.6));
    expect(l3.sky.top).toBe(mixHex(base.sky.top, spec!.sky.top, 0.6));
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

/* ==================== WCAG 对比度助手（A2-3/4/5 量化回归） ================== */

/** sRGB 相对亮度（WCAG 2.x 公式；与选色复核脚本同一实现） */
function relativeLuminance(hex: string): number {
  const body = hex.replace('#', '');
  const int = Number.parseInt(body.length === 3 ? body.split('').map((c) => c + c).join('') : body, 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/** WCAG 对比度（1~21） */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('levelThemes · 对比度量化回归（A2-3/A2-4/A2-5）', () => {
  /** 12 关在指定位面的解析地板色（渲染实际消费的 mixHex 派生值） */
  const floorBases = (planeShifted: boolean): readonly string[] =>
    AREA_LEVELS.map((level) => resolveLevelTheme(level.id, planeShifted).floor.base);

  /** min(候选色 vs 全 12 关解析地板) */
  const minContrast = (color: string, floors: readonly string[]): number =>
    Math.min(...floors.map((floor) => contrastRatio(color, floor)));

  it('A2-3：阴面石板侧面/顶面 vs 解析地板 ≥3:1（推箱核心对象任何位面可辨）', () => {
    const yinFloors = floorBases(true);
    expect(minContrast(YIN.crate.body, yinFloors)).toBeGreaterThanOrEqual(3);
    expect(minContrast(YIN.crate.top, yinFloors)).toBeGreaterThanOrEqual(3);
    // body<top 的明暗层级保持（顶面仍比侧面亮）
    expect(relativeLuminance(YIN.crate.top)).toBeGreaterThan(relativeLuminance(YIN.crate.body));
  });

  it('A2-3：阳面石板不低于现状基线（body ≥2.8 / top ≥3.0，回归保护）', () => {
    const yangFloors = floorBases(false);
    expect(minContrast(YANG.crate.body, yangFloors)).toBeGreaterThanOrEqual(2.8);
    expect(minContrast(YANG.crate.top, yangFloors)).toBeGreaterThanOrEqual(3);
  });

  it('A2-5：goal 基座柱身 vs 解析地板 ≥2:1（双位面；顶冠保持全场最高梯队）', () => {
    expect(minContrast(YANG.goal.pedestal, floorBases(false))).toBeGreaterThanOrEqual(2);
    expect(minContrast(YIN.goal.pedestal, floorBases(true))).toBeGreaterThanOrEqual(2);
  });

  it('A2-4：每关主角装置主体 vs 解析地板 ≥3:1（双位面；L12 王座不再隐形）', () => {
    for (const level of AREA_LEVELS) {
      for (const planeShifted of [false, true]) {
        const theme = resolveLevelTheme(level.id, planeShifted);
        const prop = LEVEL_THEMES[level.id]?.heroProp;
        expect(prop).toBeDefined();
        expect(contrastRatio(prop!.color, theme.floor.base)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('A2-4：L12 王座主体不再与墙顶同值（余烬红场景里有轮廓可辨）', () => {
    const spec = LEVEL_THEMES['level-lb-12'];
    expect(spec).toBeDefined();
    expect(spec!.heroProp.color).not.toBe(spec!.wall.top);
  });
});

describe('levelThemes · 墙皮重掷 epoch（A2-2）', () => {
  const theme = resolveLevelTheme('level-sb-01', false);

  it('epoch 缺省 = 基线 ramp：三参缺省与显式 0 逐字节一致（不重掷不改观感）', () => {
    for (let i = 0; i < WALL_SHADE_COUNT; i++) {
      const baseline = mixHex(theme.wall.base, theme.wall.top, i % 2 === 0
        ? 0.08 + (i / (WALL_SHADE_COUNT - 1)) * 0.8
        : 0.16 + (i / (WALL_SHADE_COUNT - 1)) * 0.76);
      expect(levelWallShadeColor(theme, i)).toBe(baseline);
      expect(levelWallShadeColor(theme, i, 0)).toBe(baseline);
    }
  });

  it('epoch 自增即确定性重掷：墙皮真的会变、同 epoch 复现恒定', () => {
    const rolled = Array.from({ length: WALL_SHADE_COUNT }, (_, i) => levelWallShadeColor(theme, i, 1));
    const baseline = Array.from({ length: WALL_SHADE_COUNT }, (_, i) => levelWallShadeColor(theme, i, 0));
    // 重掷生效：至少存在阶位色值变化（非「按了没反应」）
    expect(rolled.some((color, i) => color !== baseline[i])).toBe(true);
    // 确定性：同 epoch 重复调用一致
    for (let i = 0; i < WALL_SHADE_COUNT; i++) {
      expect(levelWallShadeColor(theme, i, 1)).toBe(rolled[i]);
    }
    // 相邻 epoch 各自成相（重掷两次结果不同，作弊可连续重摇）
    expect(rolled.some((color, i) => color !== levelWallShadeColor(theme, i, 2))).toBe(true);
  });

  it('epoch>0 下 hex 合法且越界回绕仍稳定（渲染管线契约不变）', () => {
    for (const epoch of [1, 2, 7]) {
      for (let i = 0; i < WALL_SHADE_COUNT; i++) {
        expect(levelWallShadeColor(theme, i, epoch)).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(levelWallShadeColor(theme, -1, epoch)).toBe(levelWallShadeColor(theme, WALL_SHADE_COUNT - 1, epoch));
      expect(levelWallShadeColor(theme, WALL_SHADE_COUNT, epoch)).toBe(levelWallShadeColor(theme, 0, epoch));
    }
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
