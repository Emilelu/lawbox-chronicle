/**
 * levelThemes —— 12 关逐关主题 / 氛围 / 环境装置表（THEME-3）。
 * ---------------------------------------------------------------------------
 * 职责：
 *  1) LEVEL_THEMES：每关的识别色（accent）、雾、天空、双灯（主灯/轮廓灯）、
 *     地面与墙、Sparkles 环境粒子、装饰格（deco）、每关一主角装置（heroProp）、
 *     可选玩家提灯（暗关/阴面暗关）。色值全部为合法 6 位 hex。
 *  2) resolveLevelTheme(levelId, planeShifted)：以 theme.ts 的阴阳位面基础主题
 *     （YANG/YIN_THEME）为底，mixHex 派生完整 PlaneTheme —— 结果缓存并冻结，
 *     引用稳定（GridArena/WorldCanvas 可安全放进 useMemo deps）。
 *  3) L9 表里回廊 per-plane 分支：spec.yinPlane 字段级覆盖，阴阳两相各自成相
 *     （阳面暖沙回廊 / 阴面冰晶捷径）。
 *
 * 对比度守则：goal 基座/法则之门主体（pillar/portal）与 abyss/phase/spike/
 * crate/actor 一律继承位面基础主题、不随关混色 —— 金色基座与顶冠在全部
 * 12 关里保持全场最高对比；关卡识别色只进入氛围层（雾/天/灯/地面/墙）与
 * 点缀位（gate.rim / player.accent / vfx.spark / vfx.plane）。
 *
 * 本文件纯数据 + 纯函数（零 React / 零 three 运行时依赖），vitest 直测。
 */

import type { Grid } from '../../core/types';
import {
  clampNpcCell,
  hash2,
  mixHex,
  WALL_SHADE_COUNT,
  YANG_THEME,
  YIN_THEME,
  type PlaneTheme,
  type TileField,
  type TileSpec,
  type WorldVec3,
} from './theme';

/* ================================ 规格 ==================================== */

/** 装饰格形态：符纹（贴地发光板）/ 晶簇（小锥）/ 光柱（细圆柱） */
export type DecoKind = 'rune' | 'crystal' | 'pillar';

/** 主角装置形态：每关恰好一座的纯装饰地标（不占格、不参与碰撞） */
export type HeroPropKind =
  | 'obelisk' // 方尖碑（初醒/圣所）
  | 'arch' // 石拱门（双廊/双石门）
  | 'lantern-post' // 提灯柱（阶梯/长廊）
  | 'crystal' // 坠星晶簇（碎星/井底）
  | 'monolith' // 陨石碑（星陨间奏/合宇之厅）
  | 'gate-post' // 位面锚柱（表里回廊）
  | 'throne'; // 星陨王座（终段）

/** 环境粒子（drei Sparkles）参数：demand 下 Sparkles 的 useFrame 只写
 * material.time、不 invalidate，静置即冻结（S18 零渲染约定不破）。 */
export interface LevelSparklesSpec {
  readonly count: number;
  readonly color: string;
  readonly size: number;
  readonly speed: number;
  readonly opacity: number;
  /** 粒子云空间范围（世界单位；相对挂载点扩散） */
  readonly scale: WorldVec3;
  /** 相对竞技场中心的抬升 */
  readonly lift: number;
}

/** 玩家提灯：暗关/阴面暗关的随身 PointLight（WorldCanvas 挂载，随 playerWorld） */
export interface LevelLanternSpec {
  readonly color: string;
  readonly intensity: number;
  /** 光照半径（世界单位；1 格 = 1 单位，验收要求 ≥3 格） */
  readonly distance: number;
}

export interface LevelThemeSpec {
  /** 关卡识别色：门缘 / 玩家点缀 / vfx 火花 / ambient 染色的派生基点 */
  readonly accent: string;
  readonly fog: { readonly color: string; readonly density: number };
  readonly sky: { readonly top: string; readonly horizon: string };
  readonly keyLight: { readonly color: string; readonly intensity: number };
  readonly rimLight: { readonly color: string; readonly intensity: number };
  readonly floor: { readonly base: string; readonly alt: string };
  readonly wall: { readonly base: string; readonly top: string };
  readonly sparkles: LevelSparklesSpec;
  readonly deco: { readonly kind: DecoKind; readonly color: string; /** hash 取模密度（越大越稀） */ readonly every: number };
  readonly heroProp: {
    readonly kind: HeroPropKind;
    /** 目标格坐标（原始关卡网格；落格由 clampNpcCell 保证为地板） */
    readonly x: number;
    readonly y: number;
    readonly color: string;
    /** 装置主体高度（世界单位） */
    readonly height: number;
  };
  /** 玩家提灯（缺省不启用）；onlyYin = 仅阴面启用（L9 表里回廊） */
  readonly lantern?: Readonly<LevelLanternSpec & { readonly onlyYin?: boolean }>;
  /** 阴面覆盖分支（L9 等位面关）：字段级覆盖，未给出的字段继承阳面值 */
  readonly yinPlane?: Partial<
    Pick<
      LevelThemeSpec,
      'accent' | 'fog' | 'sky' | 'keyLight' | 'rimLight' | 'floor' | 'wall' | 'sparkles' | 'deco'
    >
  >;
}

/* ============================== 12 关主题表 ================================ */

/**
 * 逐关身份（与 areas.ts 命名/叙事对齐）：
 * L1 初醒箱庭（晨曦青）→ L2 双廊回环（琥珀）→ L3 碎星十字（暗夜月光，提灯关）
 * → L4 星陨间奏（星金）→ L5 阶下回音（堇紫）→ L6 双石门（翡翠）
 * → L7 登阶长廊（暖灯橙）→ L8 井底星榻（深井蓝青）→ L9 表里回廊（阳暖沙/阴冰晶）
 * → L10 三阶圣所（圣所薰衣草）→ L11 合宇之厅（大厅蓝白）→ L12 星陨王座（余烬红）。
 * heroProp 坐标均取自对应关卡原始网格的地板格（levelThemes.test.ts 逐关断言）。
 */
export const LEVEL_THEMES: Readonly<Record<string, LevelThemeSpec>> = Object.freeze({
  'level-sb-01': {
    accent: '#7ef0ff',
    fog: { color: '#1c163e', density: 0.024 },
    sky: { top: '#101a3a', horizon: '#3d2f66' },
    keyLight: { color: '#e8eeff', intensity: 1.3 },
    rimLight: { color: '#6ee7ff', intensity: 0.85 },
    floor: { base: '#2c3563', alt: '#242b56' },
    wall: { base: '#2b3266', top: '#4c58a4' },
    sparkles: { count: 70, color: '#9fe8ff', size: 2.6, speed: 0.3, opacity: 0.45, scale: [16, 5, 14], lift: 2.2 },
    deco: { kind: 'rune', color: '#3fd4ff', every: 9 },
    heroProp: { kind: 'obelisk', x: 11, y: 4, color: '#8fa2ff', height: 2.2 },
  },
  'level-sb-02': {
    accent: '#ffb35c',
    fog: { color: '#241732', density: 0.026 },
    sky: { top: '#140f2e', horizon: '#4a2a46' },
    keyLight: { color: '#ffe9d0', intensity: 1.2 },
    rimLight: { color: '#ff9d5c', intensity: 0.8 },
    floor: { base: '#3a2f56', alt: '#2f2547' },
    wall: { base: '#4a3055', top: '#96607a' },
    sparkles: { count: 50, color: '#ffd9a0', size: 2.2, speed: 0.35, opacity: 0.4, scale: [16, 4, 14], lift: 1.8 },
    deco: { kind: 'rune', color: '#ffcf8a', every: 8 },
    heroProp: { kind: 'arch', x: 3, y: 2, color: '#d8a678', height: 2.0 },
  },
  'level-sb-03': {
    // 暗夜关：全场景压暗（灯减半、雾浓一倍），玩家提灯成为主光源
    accent: '#a8c4ff',
    fog: { color: '#060a16', density: 0.042 },
    sky: { top: '#03060d', horizon: '#0b1224' },
    keyLight: { color: '#cfe0ff', intensity: 0.5 },
    rimLight: { color: '#7fa0ff', intensity: 0.4 },
    floor: { base: '#1a2138', alt: '#151a2e' },
    wall: { base: '#1d2540', top: '#3a4a78' },
    sparkles: { count: 90, color: '#cfe0ff', size: 2.4, speed: 0.22, opacity: 0.55, scale: [16, 5, 14], lift: 2.4 },
    deco: { kind: 'crystal', color: '#9fc0ff', every: 7 },
    heroProp: { kind: 'crystal', x: 4, y: 2, color: '#b8d0ff', height: 1.4 },
    lantern: { color: '#cfe0ff', intensity: 9, distance: 3.6 },
  },
  'level-sb-04': {
    accent: '#ffe27a',
    fog: { color: '#221a3a', density: 0.028 },
    sky: { top: '#120e2c', horizon: '#443262' },
    keyLight: { color: '#fff2cf', intensity: 1.2 },
    rimLight: { color: '#ffcf5c', intensity: 0.85 },
    floor: { base: '#38305c', alt: '#2c2549' },
    wall: { base: '#443768', top: '#7a63a4' },
    sparkles: { count: 80, color: '#ffe27a', size: 2.8, speed: 0.4, opacity: 0.5, scale: [16, 4, 14], lift: 2.0 },
    deco: { kind: 'crystal', color: '#ffe27a', every: 8 },
    heroProp: { kind: 'monolith', x: 9, y: 4, color: '#b8a8e0', height: 2.4 },
  },
  'level-lb-05': {
    accent: '#9d8cff',
    fog: { color: '#1e1740', density: 0.026 },
    sky: { top: '#0e0c2e', horizon: '#372a5e' },
    keyLight: { color: '#e6e0ff', intensity: 1.25 },
    rimLight: { color: '#9d8cff', intensity: 0.8 },
    floor: { base: '#302a5e', alt: '#272150' },
    wall: { base: '#322a68', top: '#5c50a8' },
    sparkles: { count: 36, color: '#c9bfff', size: 2.2, speed: 0.3, opacity: 0.4, scale: [10, 4, 8], lift: 1.8 },
    deco: { kind: 'rune', color: '#a99bff', every: 7 },
    heroProp: { kind: 'lantern-post', x: 2, y: 3, color: '#c9bfff', height: 1.8 },
  },
  'level-lb-06': {
    accent: '#7cffd4',
    fog: { color: '#12332e', density: 0.026 },
    sky: { top: '#0a1f26', horizon: '#1f4a44' },
    keyLight: { color: '#dcfff2', intensity: 1.25 },
    rimLight: { color: '#5ce8c0', intensity: 0.8 },
    floor: { base: '#24443e', alt: '#1c3833' },
    wall: { base: '#28514a', top: '#48907e' },
    sparkles: { count: 36, color: '#a8ffdf', size: 2.2, speed: 0.3, opacity: 0.4, scale: [9, 4, 8], lift: 1.8 },
    deco: { kind: 'rune', color: '#66e8c2', every: 7 },
    heroProp: { kind: 'arch', x: 2, y: 5, color: '#8fe8c8', height: 2.0 },
  },
  'level-lb-07': {
    accent: '#ffbf66',
    fog: { color: '#2e1d18', density: 0.028 },
    sky: { top: '#1c0f0d', horizon: '#4e2a1c' },
    keyLight: { color: '#ffe2c0', intensity: 1.2 },
    rimLight: { color: '#ff9d4a', intensity: 0.75 },
    floor: { base: '#46312a', alt: '#382622' },
    wall: { base: '#54342a', top: '#96604a' },
    sparkles: { count: 44, color: '#ffd0a0', size: 2.0, speed: 0.28, opacity: 0.38, scale: [12, 4, 10], lift: 1.8 },
    deco: { kind: 'pillar', color: '#ffb87a', every: 8 },
    heroProp: { kind: 'lantern-post', x: 8, y: 2, color: '#ffd0a0', height: 1.8 },
  },
  'level-lb-08': {
    accent: '#66d9ff',
    fog: { color: '#0c2230', density: 0.034 },
    sky: { top: '#061420', horizon: '#123a4a' },
    keyLight: { color: '#cfeeff', intensity: 1.05 },
    rimLight: { color: '#4ac8e8', intensity: 0.8 },
    floor: { base: '#1e3a4a', alt: '#17303e' },
    wall: { base: '#224a5c', top: '#3e8aa4' },
    sparkles: { count: 60, color: '#a8ecff', size: 2.4, speed: 0.35, opacity: 0.5, scale: [10, 5, 10], lift: 1.6 },
    deco: { kind: 'crystal', color: '#7ce4ff', every: 7 },
    heroProp: { kind: 'crystal', x: 7, y: 2, color: '#a8ecff', height: 1.3 },
  },
  'level-lb-09': {
    // L9 表里回廊 per-plane 分支：阳面暖沙回廊，阴面（yinPlane 覆盖）冰晶捷径
    accent: '#ffcf8a',
    fog: { color: '#33220e', density: 0.03 },
    sky: { top: '#1a1008', horizon: '#543618' },
    keyLight: { color: '#ffe8c0', intensity: 1.2 },
    rimLight: { color: '#ffab5c', intensity: 0.8 },
    floor: { base: '#463522', alt: '#382a1c' },
    wall: { base: '#55402a', top: '#9a7848' },
    sparkles: { count: 40, color: '#ffd9a0', size: 2.0, speed: 0.3, opacity: 0.4, scale: [12, 4, 10], lift: 1.8 },
    deco: { kind: 'rune', color: '#ffbf7a', every: 8 },
    heroProp: { kind: 'gate-post', x: 2, y: 6, color: '#d8c8a0', height: 2.2 },
    lantern: { color: '#bff2ff', intensity: 7, distance: 3.2, onlyYin: true },
    yinPlane: {
      accent: '#8afff2',
      fog: { color: '#082026', density: 0.038 },
      sky: { top: '#041018', horizon: '#0e3a46' },
      keyLight: { color: '#c8f2ff', intensity: 0.9 },
      rimLight: { color: '#5ce8ff', intensity: 0.85 },
      floor: { base: '#1e3c44', alt: '#173038' },
      wall: { base: '#235058', top: '#3e96a0' },
      sparkles: { count: 60, color: '#a8fff2', size: 2.4, speed: 0.35, opacity: 0.5, scale: [12, 5, 10], lift: 2.0 },
      deco: { kind: 'crystal', color: '#7cf0e0', every: 7 },
    },
  },
  'level-lb-10': {
    accent: '#c9b8ff',
    fog: { color: '#221c3e', density: 0.03 },
    sky: { top: '#100c28', horizon: '#382a60' },
    keyLight: { color: '#f0eaff', intensity: 1.25 },
    rimLight: { color: '#b0a0ff', intensity: 0.85 },
    floor: { base: '#342e60', alt: '#2a244e' },
    wall: { base: '#3a3272', top: '#685ab8' },
    sparkles: { count: 50, color: '#d8ccff', size: 2.4, speed: 0.3, opacity: 0.45, scale: [12, 4, 10], lift: 2.0 },
    deco: { kind: 'pillar', color: '#b8a8ff', every: 8 },
    heroProp: { kind: 'obelisk', x: 8, y: 3, color: '#c9b8ff', height: 2.0 },
  },
  'level-lb-11': {
    accent: '#7fb2ff',
    fog: { color: '#18223e', density: 0.03 },
    sky: { top: '#0c122e', horizon: '#2c3c6a' },
    keyLight: { color: '#eaf2ff', intensity: 1.3 },
    rimLight: { color: '#6aa0ff', intensity: 0.85 },
    floor: { base: '#2c3a64', alt: '#243054' },
    wall: { base: '#303e70', top: '#5870b0' },
    sparkles: { count: 60, color: '#a8c8ff', size: 2.6, speed: 0.3, opacity: 0.45, scale: [14, 5, 10], lift: 2.2 },
    deco: { kind: 'pillar', color: '#8fb2ff', every: 8 },
    heroProp: { kind: 'monolith', x: 2, y: 7, color: '#a8c0f0', height: 2.4 },
  },
  'level-lb-12': {
    // 终段 BOSS 关：余烬红氛围；金色基座仍为全场最高对比（对比度守则）
    accent: '#ff5c5c',
    fog: { color: '#2a0c14', density: 0.034 },
    sky: { top: '#160408', horizon: '#48101a' },
    keyLight: { color: '#ffd0c0', intensity: 1.15 },
    rimLight: { color: '#ff5c5c', intensity: 0.9 },
    floor: { base: '#40202a', alt: '#331a24' },
    wall: { base: '#4e2230', top: '#8a3a4a' },
    sparkles: { count: 70, color: '#ff9f8a', size: 2.6, speed: 0.4, opacity: 0.5, scale: [14, 4, 12], lift: 1.8 },
    deco: { kind: 'crystal', color: '#ff7a6a', every: 8 },
    heroProp: { kind: 'throne', x: 6, y: 3, color: '#8a3a4a', height: 2.0 },
  },
});

/* ============================ 规格解析（内部） ============================= */

type LevelThemeCore = Omit<LevelThemeSpec, 'yinPlane'>;

/** 阴面分支展开：yinPlane 字段级覆盖（未给出的字段继承阳面值） */
function effectiveSpec(spec: LevelThemeSpec, planeShifted: boolean): LevelThemeCore {
  if (!planeShifted || spec.yinPlane === undefined) return spec;
  return { ...spec, ...spec.yinPlane };
}

function levelSpec(levelId: string | null | undefined): LevelThemeSpec | undefined {
  return levelId !== null && levelId !== undefined ? LEVEL_THEMES[levelId] : undefined;
}

/* ========================== 主题派生（mixHex） ============================= */

/** 关卡身份对氛围层的混色强度：0.6 = 关卡色主导，位面底色保留四成（阴阳可辨） */
const LEVEL_MIX = 0.6;
/** 关卡识别色对点缀位（vfx 火花/位面环）的混色强度 */
const ACCENT_MIX = 0.5;
/** 关卡识别色对环境光的染色强度（保持位面明暗基调） */
const AMBIENT_MIX = 0.35;

function deriveTheme(spec: LevelThemeSpec | undefined, planeShifted: boolean): PlaneTheme {
  const base = planeShifted ? YIN_THEME : YANG_THEME;
  if (spec === undefined) return base;
  const s = effectiveSpec(spec, planeShifted);
  const lerp = (a: number, b: number): number => a + (b - a) * LEVEL_MIX;
  return Object.freeze({
    id: base.id,
    sky: {
      top: mixHex(base.sky.top, s.sky.top, LEVEL_MIX),
      horizon: mixHex(base.sky.horizon, s.sky.horizon, LEVEL_MIX),
    },
    fogColor: mixHex(base.fogColor, s.fog.color, LEVEL_MIX),
    fogDensity: lerp(base.fogDensity, s.fog.density),
    ambient: { color: mixHex(base.ambient.color, s.accent, AMBIENT_MIX), intensity: base.ambient.intensity },
    keyLight: {
      color: mixHex(base.keyLight.color, s.keyLight.color, LEVEL_MIX),
      intensity: lerp(base.keyLight.intensity, s.keyLight.intensity),
      position: base.keyLight.position,
    },
    rimLight: {
      color: mixHex(base.rimLight.color, s.rimLight.color, LEVEL_MIX),
      intensity: lerp(base.rimLight.intensity, s.rimLight.intensity),
      position: base.rimLight.position,
    },
    floor: {
      base: mixHex(base.floor.base, s.floor.base, LEVEL_MIX),
      alt: mixHex(base.floor.alt, s.floor.alt, LEVEL_MIX),
    },
    wall: {
      base: mixHex(base.wall.base, s.wall.base, LEVEL_MIX),
      top: mixHex(base.wall.top, s.wall.top, LEVEL_MIX),
    },
    // 以下为对比度守则与实体识别色：继承位面基础主题，不随关混色
    abyss: base.abyss,
    goal: base.goal,
    phase: base.phase,
    spike: base.spike,
    gate: { pillar: base.gate.pillar, portal: base.gate.portal, rim: s.accent },
    crate: base.crate,
    player: { primary: base.player.primary, secondary: base.player.secondary, accent: s.accent },
    actor: base.actor,
    vfx: {
      ...base.vfx,
      spark: mixHex(base.vfx.spark, s.accent, ACCENT_MIX),
      plane: mixHex(base.vfx.plane, s.accent, ACCENT_MIX),
    },
  });
}

const themeCache = new Map<string, PlaneTheme>();

/**
 * 关卡 → 完整 PlaneTheme（缓存 + 冻结，引用稳定）。
 * levelId 为 null/未知（标题页等）→ 原样退回位面基础主题。
 */
export function resolveLevelTheme(levelId: string | null | undefined, planeShifted: boolean): PlaneTheme {
  const key = `${levelId ?? ''}|${planeShifted ? 1 : 0}`;
  const hit = themeCache.get(key);
  if (hit !== undefined) return hit;
  const theme = deriveTheme(levelSpec(levelId), planeShifted);
  themeCache.set(key, theme);
  return theme;
}

/* ===================== 墙皮色阶（按关 accent 重采样） ====================== */

const shadeCache = new WeakMap<PlaneTheme, readonly string[]>();

/**
 * 14 阶墙皮按关重采样：在「解析后主题」的 wall.base→wall.top 渐变上按
 * theme.makeWallShades 同款奇偶错位采样 —— 墙皮随关卡识别色（accent 经
 * LEVEL_MIX 混入 wall 色）整体重着色，仍保持 14 阶可分辨的确定性 ramp。
 */
export function levelWallShadeColor(theme: PlaneTheme, shadeIndex: number): string {
  let shades = shadeCache.get(theme);
  if (shades === undefined) {
    const built: string[] = [];
    for (let i = 0; i < WALL_SHADE_COUNT; i++) {
      const t = i / (WALL_SHADE_COUNT - 1);
      // 与 theme.makeWallShades 相同的奇偶微错位：同一 ramp 两轮采样
      const k = i % 2 === 0 ? 0.08 + t * 0.8 : 0.16 + t * 0.76;
      built.push(mixHex(theme.wall.base, theme.wall.top, k));
    }
    shades = Object.freeze(built);
    shadeCache.set(theme, shades);
  }
  const idx = ((shadeIndex % WALL_SHADE_COUNT) + WALL_SHADE_COUNT) % WALL_SHADE_COUNT;
  return shades[idx] ?? theme.wall.base;
}

/* ============================== 装饰格（deco） ============================= */

/** FNV-1a 字符串 hash：关卡 id → 稳定采样种子（不同关卡选出不同格） */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface LevelDeco {
  readonly kind: DecoKind;
  readonly color: string;
  /** 关卡装饰格（地板子集；确定性 hash 采样，含海拔） */
  readonly tiles: readonly TileSpec[];
}

/**
 * 关卡装饰格：在当前位面地形的地板集上按「关卡种子 + 密度 every」确定性
 * 采样 —— GridArena 将其并入 instancedMesh 合批（theme.ts:384 的 phaseTiles
 * 通道由此扩为按关 deco 格）。纯装饰，不改碰撞。
 */
export function levelDeco(levelId: string | null | undefined, planeShifted: boolean, field: TileField): LevelDeco | null {
  const spec = levelSpec(levelId);
  if (spec === undefined) return null;
  const s = effectiveSpec(spec, planeShifted);
  const seed = hashString(levelId ?? '');
  const tiles: TileSpec[] = [];
  for (const tile of field.floors) {
    if (hash2(tile.x * 3 + seed, tile.y * 5 - seed) % s.deco.every !== 0) continue;
    tiles.push({ x: tile.x, y: tile.y, tier: 1, shade: 0, ring: 0, height: tile.height });
  }
  return Object.freeze({ kind: s.deco.kind, color: s.deco.color, tiles: Object.freeze(tiles) });
}

/* ============================ 主角装置（heroProp） ========================= */

export interface LevelHeroProp {
  readonly kind: HeroPropKind;
  /** 落格：表坐标经 clampNpcCell 钳进网格内地板（装置不立墙里） */
  readonly cell: { readonly x: number; readonly y: number };
  readonly color: string;
  readonly accent: string;
  readonly height: number;
}

/** 每关一主角装置：坐标钳到关卡网格的地板格（确定性；缺关卡返回 null） */
export function levelHeroProp(levelId: string | null | undefined, planeShifted: boolean, grid: Grid): LevelHeroProp | null {
  const spec = levelSpec(levelId);
  if (spec === undefined || grid.length === 0) return null;
  const s = effectiveSpec(spec, planeShifted);
  const cell = clampNpcCell({ x: s.heroProp.x, y: s.heroProp.y }, grid);
  return Object.freeze({
    kind: s.heroProp.kind,
    cell,
    color: s.heroProp.color,
    accent: s.accent,
    height: s.heroProp.height,
  });
}

/* ========================== 环境粒子 / 玩家提灯 ============================ */

const sparklesCache = new Map<string, LevelSparklesSpec | null>();

/** 关卡 Sparkles 参数（缓存 + 冻结；Sparkles 的 props 引用稳定，不重掷粒子） */
export function levelSparkles(levelId: string | null | undefined, planeShifted: boolean): LevelSparklesSpec | null {
  const key = `${levelId ?? ''}|${planeShifted ? 1 : 0}`;
  const hit = sparklesCache.get(key);
  if (hit !== undefined) return hit;
  const spec = levelSpec(levelId);
  const value = spec === undefined ? null : Object.freeze({ ...effectiveSpec(spec, planeShifted).sparkles });
  sparklesCache.set(key, value);
  return value;
}

const lanternCache = new Map<string, LevelLanternSpec | null>();

/**
 * 关卡玩家提灯：L3 碎星十字双位面点亮（暗夜关），L9 表里回廊仅阴面点亮；
 * 其余关返回 null（不挂 pointLight）。distance 即照亮半径（格）。
 */
export function levelLantern(levelId: string | null | undefined, planeShifted: boolean): LevelLanternSpec | null {
  const key = `${levelId ?? ''}|${planeShifted ? 1 : 0}`;
  const hit = lanternCache.get(key);
  if (hit !== undefined) return hit;
  const spec = levelSpec(levelId);
  const l = spec?.lantern;
  const value =
    l === undefined || (l.onlyYin === true && !planeShifted)
      ? null
      : Object.freeze({ color: l.color, intensity: l.intensity, distance: l.distance });
  lanternCache.set(key, value);
  return value;
}
