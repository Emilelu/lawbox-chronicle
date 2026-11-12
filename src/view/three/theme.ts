/**
 * 三维世界舞台 —— 主题与派生规则唯一出处。
 * ---------------------------------------------------------------------------
 * 1) 一切实体尺寸由格子尺寸（CELL）派生 —— 根治 SanBPushChest 50px 硬编码
 *    双轨（视图 px 与逻辑格各说各话）；改 CELL 即缩放整个世界。
 * 2) 阴阳位面双主题：阳面（深空霓虹）/ 阴面（反转雾紫）。位面切换由 store 的
 *    segment.planeShifted 状态驱动，按需换肤 —— 根治 S18 常驻 50ms 定时器，
 *    14 张墙皮资产重铸为 14 色阶的确定性挑选（无定时器、无纹理常驻）。
 * 3) 本文件是纯数据 + 纯函数（零 React / 零 three 依赖），渲染组件的全部
 *    无渲染逻辑集中于此，可在 vitest 中直接断言。
 */

import {
  DIAG_VECTORS,
  DIR_VECTORS,
  type AreaId,
  type DiagDir,
  type Dir,
  type Grid,
  type TerrainCell,
  type Vec2,
} from '../../core/types';
import type { HeightMap } from '../../engine/puzzle/grid';

/* ============================== 基础尺度（格子派生） ======================= */

/** 世界单位：1 格 = 1。所有实体尺寸都用 CELL 的倍数表达（禁止 px 双轨） */
export const CELL = 1;

/** 地板厚度 / 高度层（墙的层高单位） */
export const FLOOR_THICKNESS = 0.3 * CELL;

/**
 * 高度层步进：引擎海拔（HeightMap 格值 0/1/2…）换算成世界 Y 的每级高度。
 * 由 CLIMB_LIMIT=1 / FALL_DROP=2（engine/puzzle/grid.ts）驱动的可见落差：
 * 一级台阶 0.6、箱落深井 1.2 世界单位，肉眼可辨且不喧宾夺主。
 */
export const HEIGHT_STEP = 0.6 * CELL;

/** 海拔查询：越界/缺省归 0（渲染层守卫式读取，与引擎 heightAt 同源语义） */
export function heightOf(heights: HeightMap | undefined, x: number, y: number): number {
  return heights?.[y]?.[x] ?? 0;
}
export const WALL_UNIT = 0.62 * CELL;
/** 墙体高度层：确定性 hash 取 1~3 层，形成体素高低起伏 */
export const WALL_TIER_SCALES = [1, 1.4, 1.8] as const;

/** 深渊（外圈虚空） */
export const ABYSS_THICKNESS = 0.5 * CELL;
export const ABYSS_TOP_DROP = 0.42 * CELL;
export const ABYSS_PAD = 2;

/** 终点基座（旗位升格为「法则基座」） */
export const PEDESTAL_INSET = 0.86;
export const PEDESTAL_HEIGHT = 0.2 * CELL;
export const PEDESTAL_CAP_RADIUS = 0.3 * CELL;
export const PEDESTAL_CAP_HEIGHT = 0.05 * CELL;

/** 阴面浮空石板（仅阴面存在的装饰格） */
export const PHASE_TILE_HEIGHT = 0.06 * CELL;
export const PHASE_TILE_LIFT = 0.16 * CELL;

/** 尖刺（地形武器，hazardCells 就绪后接入） */
export const SPIKE_HEIGHT = 0.55 * CELL;
export const SPIKE_RADIUS = 0.16 * CELL;

/** 实体尺寸（全部由 CELL 派生） */
export const CRATE_SIZE = 0.72 * CELL;
export const CRATE_HEIGHT = 0.64 * CELL;
export const PLAYER_SKIN_CELL = 0.15 * CELL;
export const ACTOR_SKIN_CELL = 0.14 * CELL;
export const BOSS_SCALE = 1.55;

/** 门体（法则之门） */
export const GATE_WIDTH = 1.9 * CELL;
export const GATE_HEIGHT = 1.7 * CELL;
export const GATE_PILLAR = 0.22 * CELL;
export const GATE_DISSOLVE_SECONDS = 0.9;

/* ============================ 坐标换算（纯函数） =========================== */

/** 各区域在世界中的锚点偏移（格）：主区原点，外域按方向散布，由雾自然遮蔽 */
export const AREA_WORLD_OFFSETS: Readonly<Record<AreaId, Vec2>> = Object.freeze({
  main: { x: 0, y: 0 },
  'domain-1': { x: 26, y: 0 }, // 东域
  'domain-2': { x: 0, y: -26 }, // 北域
  'domain-3': { x: -26, y: 6 }, // 西域
});

export type WorldVec3 = readonly [number, number, number];

/** 格坐标 → 世界坐标（网格以中心对齐区域锚点；gridY 映射到 +Z；height = 海拔层数） */
export function cellWorldCenter(
  x: number,
  y: number,
  rows: number,
  cols: number,
  area: AreaId,
  height = 0,
): WorldVec3 {
  const offset = AREA_WORLD_OFFSETS[area];
  const wx = (x - (cols - 1) / 2) * CELL + offset.x;
  const wz = (y - (rows - 1) / 2) * CELL + offset.y;
  return [wx, height * HEIGHT_STEP, wz];
}

/** 网格几何中心（镜头拉远/战斗舞台的注视点） */
export function gridCenterWorld(rows: number, cols: number, area: AreaId): WorldVec3 {
  return cellWorldCenter((cols - 1) / 2, (rows - 1) / 2, rows, cols, area);
}

/* ============================== 确定性 hash =============================== */

/** 稳定整数 hash（渲染装饰用；同一格永远得到同一装饰，无随机抖动） */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/* ============================ 朝向（S5 根治） ============================== */

/**
 * 朝向表与皮肤表彻底分离：skin 决定「长什么样」，facing 只决定绕 Y 旋转。
 * 根治 S5（changeRole 旋转错位）——换肤不改朝向，转向不改皮肤。
 * 网格 +Y 是「下」方向（南），映射到世界 +Z；模型正面默认朝 +Z。
 */
export const FACING_YAW: Readonly<Record<Dir, number>> = Object.freeze({
  down: 0,
  up: Math.PI,
  left: -Math.PI / 2, // 面朝 -X
  right: Math.PI / 2, // 面朝 +X
});

/** 玩家皮肤号（对应 SanBPushChest roles/role1..role5 的重铸色板） */
export const PLAYER_SKIN_COUNT = 5;

/**
 * 侧视 3/4 收敛角（I4 根治）：角色/玩家体素模型由 ASCII 掩码拉伸而来，
 * 朝向 left/right 按语义转满 ±90° 时正面只剩一列侧棱，角色渲染成近 1px
 * 竖条。渲染层把左右朝向收敛到 ±60° 的 3/4 视角（部件化重制后取更饱满的
 * 侧转，剪影保留 cos60°=50% 的正面宽度且四肢/围巾部件方向可辨）；up/down
 * 不受影响（背/正视）。FACING_YAW 保持方向语义真值，仅绘制走本函数。
 */
export const FACING_RENDER_YAW_LIMIT = Math.PI / 3;

/** 渲染用朝向角：FACING_YAW 的 3/4 收敛版，PlayerAvatar/ActorMesh 专用 */
export function facingRenderYaw(dir: Dir): number {
  if (dir === 'left') return -FACING_RENDER_YAW_LIMIT;
  if (dir === 'right') return FACING_RENDER_YAW_LIMIT;
  return FACING_YAW[dir];
}

/* =============================== 滑动 lerp ================================ */

/** 推箱滑动时长（uiRedesign 动效规格：0.15s） */
export const SLIDE_SECONDS = 0.15;
export const SLIDE_EPSILON = 0.0015;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

/**
 * 回弹缓动（easeOutBack，c1=1.70158 标准过冲系数）：落定瞬间越过目标约 10%
 * 再弹回，角色部件滑动落地的「顿一下」手感。纯函数，charModels 动画消费。
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * 滑动插值：返回 from→to 在 elapsed/SLIDE_SECONDS 处的显示位置。
 * 纯函数，CrateMesh/PlayerAvatar 共用（同一套位移手感）。
 */
export function slidePosition(
  from: number,
  to: number,
  elapsedSeconds: number,
): number {
  const t = clamp01(elapsedSeconds / SLIDE_SECONDS);
  return from + (to - from) * easeOutCubic(t);
}

/* ============================ 阴阳位面双主题 =============================== */

export interface PlaneTheme {
  readonly id: 'yang' | 'yin';
  readonly sky: { readonly top: string; readonly horizon: string };
  readonly fogColor: string;
  readonly fogDensity: number;
  readonly ambient: { readonly color: string; readonly intensity: number };
  readonly keyLight: {
    readonly color: string;
    readonly intensity: number;
    readonly position: WorldVec3;
  };
  readonly rimLight: {
    readonly color: string;
    readonly intensity: number;
    readonly position: WorldVec3;
  };
  readonly floor: { readonly base: string; readonly alt: string };
  readonly wall: { readonly base: string; readonly top: string };
  readonly abyss: { readonly base: string; readonly deep: string };
  readonly goal: {
    readonly pedestal: string;
    readonly cap: string;
    readonly halo: string;
  };
  readonly phase: { readonly tile: string; readonly opacity: number };
  readonly spike: { readonly base: string };
  readonly gate: { readonly pillar: string; readonly portal: string; readonly rim: string };
  readonly crate: { readonly body: string; readonly top: string };
  readonly player: { readonly primary: string; readonly secondary: string; readonly accent: string };
  readonly actor: { readonly npc: string; readonly enemy: string; readonly boss: string };
  readonly vfx: {
    readonly spark: string;
    readonly block: string;
    readonly star4: string;
    readonly star3: string;
    readonly star2: string;
    readonly plane: string;
  };
}

/** 阴面墙皮：SanBPushChest 14 张墙皮资产的重铸色阶（确定性挑选，无常驻定时器） */
export const WALL_SHADE_COUNT = 14;

function makeWallShades(yang: boolean): readonly string[] {
  const a = yang ? '#242c55' : '#3a2050';
  const b = yang ? '#3d4a8f' : '#5d2f7a';
  const shades: string[] = [];
  for (let i = 0; i < WALL_SHADE_COUNT; i++) {
    const t = i / (WALL_SHADE_COUNT - 1);
    // 奇偶微错位：同一 ramp 上取两轮采样，得到可分辨的 14 阶墙皮
    const k = i % 2 === 0 ? 0.08 + t * 0.8 : 0.16 + t * 0.76;
    shades.push(mixHex(a, b, k));
  }
  return Object.freeze(shades);
}

/** 简单线性插值两个 #rrggbb 颜色（主题生成的唯一工具，避免引入 three） */
export function mixHex(from: string, to: string, t: number): string {
  const k = clamp01(t);
  const pa = parseHex(from);
  const pb = parseHex(to);
  const ch = (i: HexChannel) => Math.round((pa[i] ?? 0) + ((pb[i] ?? 0) - (pa[i] ?? 0)) * k);
  return `#${[0, 1, 2].map((i) => ch(i as HexChannel).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): readonly [number, number, number] {
  const body = hex.startsWith('#') ? hex.slice(1) : hex;
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

type HexChannel = 0 | 1 | 2;

const YANG_WALL_SHADES = makeWallShades(true);
const YIN_WALL_SHADES = makeWallShades(false);

export const YANG_THEME: PlaneTheme = Object.freeze({
  id: 'yang',
  sky: { top: '#0a0f26', horizon: '#2b1f52' },
  fogColor: '#181234',
  fogDensity: 0.026,
  ambient: { color: '#8fa2ff', intensity: 0.55 },
  keyLight: { color: '#dfe6ff', intensity: 1.25, position: [6, 12, 4] as const },
  rimLight: { color: '#7c5cff', intensity: 0.85, position: [-8, 5, -9] as const },
  floor: { base: '#2b335f', alt: '#232a52' },
  wall: { base: '#2a3162', top: '#4a559e' },
  abyss: { base: '#0c0f22', deep: '#05060f' },
  // A2-5：goal.pedestal 提亮一档 —— 旧值 '#3c3f7d' 对 12 关阳面解析地板对比度
  // 仅 1.19~1.50（顶冠 cap 达标、柱身与地板同融，未落箱旗位只剩小顶冠可辨）。
  // '#6064b0' 的柱身对比度实测 ≥2.13（WCAG，esbuild 直算源码复核），色相保持
  // 靛蓝紫一档提亮，与 cap '#ffcf5c' 仍拉开层级。
  goal: { pedestal: '#6064b0', cap: '#ffcf5c', halo: '#ffcf5c' },
  phase: { tile: '#00e5ff', opacity: 0.4 },
  spike: { base: '#8b93b8' },
  gate: { pillar: '#464f96', portal: '#7c5cff', rim: '#00e5ff' },
  crate: { body: '#a4763d', top: '#c99a58' },
  player: { primary: '#eaf0ff', secondary: '#4a559e', accent: '#00e5ff' },
  actor: { npc: '#7ee0ff', enemy: '#ff7a5c', boss: '#ff5c9e' },
  vfx: {
    spark: '#ffe27a',
    block: '#9fd8ff',
    star4: '#ffcf5c',
    star3: '#c99aff',
    star2: '#9fb3d8',
    plane: '#7c5cff',
  },
});

export const YIN_THEME: PlaneTheme = Object.freeze({
  id: 'yin',
  sky: { top: '#2a0f1e', horizon: '#521f3a' },
  fogColor: '#33122a',
  fogDensity: 0.032,
  ambient: { color: '#ff9fd0', intensity: 0.5 },
  keyLight: { color: '#ffd9ec', intensity: 1.1, position: [-6, 12, -4] as const },
  rimLight: { color: '#ff5c9e', intensity: 0.95, position: [8, 5, 9] as const },
  floor: { base: '#41243f', alt: '#331a33' },
  wall: { base: '#3c1f47', top: '#7a3f8f' },
  abyss: { base: '#1a0716', deep: '#0b030a' },
  // A2-5（阴面同批）：goal.pedestal '#5f3c72' 对阴面解析地板对比度 1.36~1.71，
  // 同样不达标 —— 提亮到 '#83589a'（实测 ≥2.20），玫紫色相与阴面基调一致。
  goal: { pedestal: '#83589a', cap: '#7cf5c8', halo: '#7cf5c8' },
  phase: { tile: '#ffcf5c', opacity: 0.5 },
  spike: { base: '#d8a6b8' },
  gate: { pillar: '#6f3560', portal: '#ff5c9e', rim: '#ffcf5c' },
  // A2-3：crate 双提亮 —— 旧 body '#7a4d63' 对 12 关阴面解析地板对比度仅
  // 1.76~2.21（低于 3:1 图形下限），推箱唯一操作对象的侧面几乎融入地板；
  // top '#a86e83' 也只勉强 3.00。定稿 body '#b0778e'（≥3.37）、top '#c98ba0'
  // （≥4.41，esbuild 直算源码复核），body<top 的明暗层级保持，玫灰色相不变。
  crate: { body: '#b0778e', top: '#c98ba0' },
  player: { primary: '#ffe9f4', secondary: '#6f3560', accent: '#ff5c9e' },
  actor: { npc: '#ff9fd0', enemy: '#7cffd4', boss: '#ffcf5c' },
  vfx: {
    spark: '#ffb3e2',
    block: '#7cf5c8',
    star4: '#ffcf5c',
    star3: '#ff9fd0',
    star2: '#b88aa6',
    plane: '#ff5c9e',
  },
});

/** 位面 → 主题（状态驱动，无定时器） */
export function planeTheme(planeShifted: boolean): PlaneTheme {
  return planeShifted ? YIN_THEME : YANG_THEME;
}

/** 墙皮色阶（阴阳各一套 14 阶；确定性挑选 = hash 稳定，非随机闪烁） */
export function wallShadeColor(planeShifted: boolean, shadeIndex: number): string {
  const shades = planeShifted ? YIN_WALL_SHADES : YANG_WALL_SHADES;
  const idx = ((shadeIndex % WALL_SHADE_COUNT) + WALL_SHADE_COUNT) % WALL_SHADE_COUNT;
  const color = shades[idx];
  return color !== undefined ? color : planeShifted ? YIN_THEME.wall.base : YANG_THEME.wall.base;
}

/* ========================== 地形派生（GridArena 消费） ===================== */

export type TileKind = 'floor' | 'wall' | 'goal' | 'abyss';

export interface TileSpec {
  /** 格坐标 */
  readonly x: number;
  readonly y: number;
  /** 高度倍率（墙 1~3 层；地板/深渊恒 1） */
  readonly tier: number;
  /** 墙皮色阶 index（仅墙使用；0..13） */
  readonly shade: number;
  /** 深渊外环深度（仅深渊使用；0=内环） */
  readonly ring: number;
  /** 海拔层数（HeightMap 格值 0/1/2…；世界 Y = height × HEIGHT_STEP） */
  readonly height: number;
}

export interface TileField {
  readonly floors: readonly TileSpec[];
  readonly walls: readonly TileSpec[];
  readonly goals: readonly TileSpec[];
  readonly abyss: readonly TileSpec[];
  /** 阴面浮空石板（阳面隐藏；纯装饰，不改碰撞） */
  readonly phaseTiles: readonly TileSpec[];
  readonly rows: number;
  readonly cols: number;
}

/**
 * 静态地形 → 可渲染瓦片集（纯函数）。
 * 深渊 = 包围盒外扩 ABYSS_PAD 圈内不属于网格的坐标，视觉上把关卡托成浮空岛。
 * heights 为引擎海拔层（HeightMap）：每个瓦片记录自身海拔，渲染层据此抬升。
 */
export function deriveTileField(grid: Grid, heights?: HeightMap): TileField {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const floors: TileSpec[] = [];
  const walls: TileSpec[] = [];
  const goals: TileSpec[] = [];
  const phaseTiles: TileSpec[] = [];

  for (let y = 0; y < rows; y++) {
    const row = grid[y];
    if (row === undefined) continue;
    for (let x = 0; x < cols; x++) {
      const cell: TerrainCell | undefined = row[x];
      if (cell === undefined) continue;
      const height = heightOf(heights, x, y);
      if (cell === 1) {
        walls.push({
          x,
          y,
          tier: hash2(x * 3 + 1, y * 5 + 2) % WALL_TIER_SCALES.length,
          shade: hash2(x * 7 + 3, y * 11 + 1) % WALL_SHADE_COUNT,
          ring: 0,
          height,
        });
      } else if (cell === 3) {
        goals.push({ x, y, tier: 1, shade: 0, ring: 0, height });
      } else if (cell === 0 || cell === 2 || cell === 4) {
        // 0 地板；2/4 出生点：段位导入期会归 0，但区域底景块直接消费原始关卡表，也按地板渲染
        floors.push({ x, y, tier: 1, shade: 0, ring: 0, height });
        if (hash2(x, y) % 9 === 0) phaseTiles.push({ x, y, tier: 1, shade: 0, ring: 0, height });
      }
    }
  }

  const abyss: TileSpec[] = [];
  for (let y = -ABYSS_PAD; y < rows + ABYSS_PAD; y++) {
    for (let x = -ABYSS_PAD; x < cols + ABYSS_PAD; x++) {
      const inside = x >= 0 && x < cols && y >= 0 && y < rows && grid[y]?.[x] !== undefined;
      if (inside) continue;
      const ring = Math.max(
        Math.abs(x + 0.5) < cols / 2 + 0.5 ? 0 : 1,
        Math.abs(y + 0.5) < rows / 2 + 0.5 ? 0 : 1,
      );
      abyss.push({ x, y, tier: 1, shade: hash2(x, y) % WALL_SHADE_COUNT, ring, height: 0 });
    }
  }

  return { floors, walls, goals, abyss, phaseTiles, rows, cols };
}

/* ============================== 法则之门派生 =============================== */

export interface GateSpec {
  /** 门所在边格（世界位置由 GridArena 换算） */
  readonly x: number;
  readonly y: number;
  /** 朝外方向（门面法线） */
  readonly dir: Dir;
  /** 该开口连续格数（跨度） */
  readonly spanCells: number;
}

interface EdgeDef {
  readonly dir: Dir;
  readonly axis: 'row' | 'col';
  readonly index: number;
}

/**
 * 每条地图边取「最长连续非墙段」作为法则之门位（最多 4 座，稳定可测）。
 * 门在关卡完成后溶解开启（selectLevelComplete → open）。
 */
export function deriveGates(grid: Grid): readonly GateSpec[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return [];

  const edges: readonly EdgeDef[] = [
    { dir: 'up', axis: 'row', index: 0 },
    { dir: 'down', axis: 'row', index: rows - 1 },
    { dir: 'left', axis: 'col', index: 0 },
    { dir: 'right', axis: 'col', index: cols - 1 },
  ];

  const gates: GateSpec[] = [];
  for (const edge of edges) {
    const values: number[] = [];
    for (let i = 0; i < (edge.axis === 'row' ? cols : rows); i++) {
      const cell =
        edge.axis === 'row' ? grid[edge.index]?.[i] : grid[i]?.[edge.index];
      values.push(cell === undefined ? 1 : cell === 1 ? 1 : 0);
    }
    let bestStart = -1;
    let bestLen = 0;
    let runStart = -1;
    for (let i = 0; i <= values.length; i++) {
      const open = i < values.length && values[i] === 0;
      if (open && runStart < 0) runStart = i;
      if (!open && runStart >= 0) {
        const len = i - runStart;
        if (len > bestLen) {
          bestLen = len;
          bestStart = runStart;
        }
        runStart = -1;
      }
    }
    if (bestStart >= 0 && bestLen > 0) {
      const mid = bestStart + Math.floor((bestLen - 1) / 2);
      if (edge.axis === 'row') gates.push({ x: mid, y: edge.index, dir: edge.dir, spanCells: bestLen });
      else gates.push({ x: edge.index, y: mid, dir: edge.dir, spanCells: bestLen });
    }
  }
  return gates;
}

/* ============================== NPC 落位（纯） ============================= */

/**
 * 把剧情事件坐标钳进网格内的最近可站格。
 * 数据层部分事件坐标沿用 KichikuAdventure 的 ±5 语义（如作者 {-2,4}），
 * 在 13×15 箱庭网格外 —— 渲染层钳位保证 NPC 永远站在脚手架上（notes 已记录）。
 */
export function clampNpcCell(pos: Vec2, grid: Grid): Vec2 {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return pos;
  const cx = Math.max(0, Math.min(cols - 1, Math.round(pos.x)));
  const cy = Math.max(0, Math.min(rows - 1, Math.round(pos.y)));
  if (grid[cy]?.[cx] === 0) return { x: cx, y: cy };
  // 螺旋外扩找最近地板（确定性顺序：r 从小到大，dx 先行）
  for (let r = 1; r <= Math.max(rows, cols); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        if (grid[ny]?.[nx] === 0) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

/* ============================ 区域分块（挂/卸） ============================ */

/**
 * 分块挂载规则：主区 + 当前外域常驻，其余外域卸载（外域进出时挂/卸）。
 * 远景块以低模 LOD 渲染（GridArena lowDetail 分支）。
 */
export function selectMountedAreas(current: AreaId | null): readonly AreaId[] {
  if (current === null || current === 'main') return ['main'];
  return ['main', current];
}

/* ============================== 战斗舞台位 ================================= */

/** 战斗阶段双方在网格中心的舞台位（布阵/攻击共用） */
export const COMBAT_STAGE = Object.freeze({
  playerOffset: { x: -1.6, y: -1.1 } as Vec2, // 相对网格中心（格单位，可带小数）
  enemyOffset: { x: 1.6, y: 1.1 } as Vec2,
  focusLift: 0.55,
});

/* ================================ 镜头 ==================================== */

export type CameraMode = 'explore' | 'dialogue' | 'combat' | 'victory' | 'boss';

/**
 * 视角档偏好：'first' = 第一人称头位（默认），'third' = 第三人称轨道（现状）。
 * 只影响 explore/dialogue 两族位姿；combat/victory/boss 永远走既定舞台位。
 */
export type ViewPreference = 'first' | 'third';

export interface CameraPose {
  /** 注视点（世界坐标） */
  readonly target: WorldVec3;
  /** 相机距离（世界单位）；null = 保持相机当前距离（该项不收敛） */
  readonly distance: number | null;
  /** 极角（弧度，自 +Y 轴量起）——俯仰 = 90° − 极角；null = 保持当前俯仰 */
  readonly polar: number | null;
  /** 方位角（弧度）；null = 保持用户当前方位 */
  readonly azimuth: number | null;
  /** 视场角（度）；缺省 = 保持相机当前 fov（该项不收敛） */
  readonly fov?: number;
}

export interface PoseContext {
  /** 玩家世界坐标 */
  readonly playerPos: WorldVec3;
  /** 对话/BOSS 注视目标世界坐标 */
  readonly focusPos: WorldVec3;
  /** 当前区域网格中心世界坐标 */
  readonly arenaCenter: WorldVec3;
}

/** 俯仰限制（设计规格：35°~80° 仰角）——换算成 OrbitControls 的极角限制 */
export const PITCH_MIN_DEG = 35;
export const PITCH_MAX_DEG = 80;
export const POLAR_MIN = degToRad(90 - PITCH_MAX_DEG);
export const POLAR_MAX = degToRad(90 - PITCH_MIN_DEG);

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

interface PosePreset {
  readonly distance: number;
  readonly elevationDeg: number;
  readonly azimuth: number | null;
  readonly fov?: number;
}

/** 第三人称基准视场角（WorldCanvas Canvas camera 的初始 fov，fov 收敛回落目标）。
 *  声明先于 POSE_PRESETS：combat/boss 预设直接引用（const 有 TDZ，后置会炸）。 */
export const BASE_CAMERA_FOV = 50;

const POSE_PRESETS: Readonly<Record<CameraMode | 'first', PosePreset>> = {
  explore: { distance: 8.5, elevationDeg: 55, azimuth: null },
  dialogue: { distance: 4.6, elevationDeg: 52, azimuth: null },
  // combat 方位角必须归 0（I1 根治）：此前 π/2 的侧视运镜让布阵期 WASD/方向键
  // 与画面整体相差 90°（W=画面右）。归 0 后相机与谜题期同方位，推挤方向 = 画面方向。
  // N4：combat/boss 显式携带基准 fov —— FP 贴脸 fov 68 进战斗/BOSS 演出后回落
  // 50，与第三人称观感一致（位姿管线按 CameraPose.fov 收敛，缺省字段不收敛）。
  combat: { distance: 8.2, elevationDeg: 40, azimuth: 0, fov: BASE_CAMERA_FOV },
  victory: { distance: 18, elevationDeg: 62, azimuth: null },
  boss: { distance: 6.2, elevationDeg: 50, azimuth: null, fov: BASE_CAMERA_FOV },
  // 第一人称头位档（位姿族新预设）：distance 0.55 = 头位，elevationDeg 12 = 微俯，
  // fov 68 比基准 50 略广（贴脸时保住环境感）；azimuth null = 保留用户头向。
  first: { distance: 0.55, elevationDeg: 12, azimuth: null, fov: 68 },
} as const;

/** 第一人称头位档的弧度化只读快照（POSE_PRESETS.first 派生，CameraRig 消费） */
export const FIRST_PERSON_POSE = Object.freeze({
  distance: POSE_PRESETS.first.distance,
  polar: degToRad(90 - POSE_PRESETS.first.elevationDeg),
  fov: POSE_PRESETS.first.fov ?? BASE_CAMERA_FOV,
});

export const CAMERA_ZOOM_LIMITS = Object.freeze({ min: 3.2, max: 26 });
export const BOSS_ORBIT_SECONDS = 2.6; // BOSS 入场轨道运镜时长（s）
export const BOSS_ORBIT_SPEED = Math.PI / 2.6; // rad/s，BOSS 入场轨道运镜
export const SHAKE_DECAY = 3.2; // 震屏强度衰减（1/s）
export const SHAKE_MAX_OFFSET = 0.16; // 震屏最大位移（世界单位）

/* ============================ 夹紧分档（纯函数） ============================ */

/** 一档夹紧限制：OrbitControls 极角/距离 props 与 useFrame 收敛夹紧同源消费 */
export interface CameraLimits {
  readonly polarMin: number;
  readonly polarMax: number;
  readonly distMin: number;
  readonly distMax: number;
}

/** 全局档：POLAR_MIN/MAX + CAMERA_ZOOM_LIMITS 的聚合单例（分档函数的缺省返回） */
export const GLOBAL_CAMERA_LIMITS: CameraLimits = Object.freeze({
  polarMin: POLAR_MIN,
  polarMax: POLAR_MAX,
  distMin: CAMERA_ZOOM_LIMITS.min,
  distMax: CAMERA_ZOOM_LIMITS.max,
});

/** 第一人称档：极角 70°~84°（俯仰 6°~20° 微俯头位）、距离 0.35~1.2 贴脸范围 */
export const FIRST_PERSON_LIMITS: CameraLimits = Object.freeze({
  polarMin: degToRad(70),
  polarMax: degToRad(84),
  distMin: 0.35,
  distMax: 1.2,
});

/**
 * 按（视角档 × 相机模式 × 是否战术俯瞰）三元分档返回夹紧限制。
 * 仅 first && !peeking && mode∈{explore,dialogue} 收紧到 FP 头位档；其余一切
 * 组合（combat/victory/boss 演出运镜、peeking 俯瞰、third 全档）恒返回全局档
 * —— victory 18 / boss 6.2 / combat 8.2 / dialogue(第三人称) 4.6 与 T 俯瞰
 * 8.5 的既定舞台位全部不受压，worldStage 既有「全模式极角/距离在全局限制内」
 * 不变量天然保持绿。
 */
export function cameraLimitsFor(view: ViewPreference, mode: CameraMode, peeking: boolean): CameraLimits {
  if (view === 'first' && !peeking && (mode === 'explore' || mode === 'dialogue')) {
    return FIRST_PERSON_LIMITS;
  }
  return GLOBAL_CAMERA_LIMITS;
}

/**
 * 两档限制的并集（跨档收敛期专用）：OrbitControls 的 update() 会按 min/max
 * 硬夹紧半径与极角，跨档运镜若直接换档会把相机瞬移夹到边界上 —— 收敛期间
 * 放宽到并集，收敛完成后才把档位切换过去（CameraRig 内部时序）。
 */
export function widerCameraLimits(a: CameraLimits, b: CameraLimits): CameraLimits {
  return {
    polarMin: Math.min(a.polarMin, b.polarMin),
    polarMax: Math.max(a.polarMax, b.polarMax),
    distMin: Math.min(a.distMin, b.distMin),
    distMax: Math.max(a.distMax, b.distMax),
  };
}

/**
 * 由相机模式与上下文计算目标位姿（纯函数；CameraRig 每次位姿请求消费一次）。
 * 'first' 为第一人称头位档（viewPreference 驱动，CameraRig 内部自发请求）。
 */
export function computePose(mode: CameraMode | 'first', ctx: PoseContext): CameraPose {
  const preset = POSE_PRESETS[mode];
  const target: WorldVec3 =
    mode === 'dialogue' || mode === 'boss'
      ? [ctx.focusPos[0], ctx.focusPos[1] + 0.55, ctx.focusPos[2]]
      : mode === 'combat'
        ? [
            (ctx.playerPos[0] + ctx.focusPos[0]) / 2,
            COMBAT_STAGE.focusLift,
            (ctx.playerPos[2] + ctx.focusPos[2]) / 2,
          ]
        : mode === 'victory'
          ? ctx.arenaCenter
          : [ctx.playerPos[0], ctx.playerPos[1] + 0.4, ctx.playerPos[2]];
  return {
    target,
    distance: preset.distance,
    polar: degToRad(90 - preset.elevationDeg),
    azimuth: preset.azimuth,
    fov: preset.fov,
  };
}

/* ====================== 相机相对移动方向（纯函数） ========================= */

/**
 * 网格语义意图向量随相机偏航旋转：θ=0 恒等（相机在 +Z 侧看网格 -Y）。
 * 公式与 OrbitControls 方位角定义对齐（θ 绕 +Y 自 +Z 量起）：
 * forward=(-sinθ,−cosθ)、right=(cosθ,−sinθ)，与 DIR_VECTORS/cellWorldCenter
 * 的网格坐标（+Y=南→世界 +Z）一致。
 */
function rotateGridIntent(v: Vec2, camYaw: number): Vec2 {
  const s = Math.sin(camYaw);
  const c = Math.cos(camYaw);
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c };
}

/** 四向扫描序（固定 + 严格 > ：±45° 平局时先扫描者胜，确定性锁死） */
const DIR_SCAN_ORDER: readonly Dir[] = ['up', 'right', 'down', 'left'];

/**
 * 输入方向 → 网格方向：把输入的「画面方向」按相机偏航旋到网格轴上，取与
 * 四个网格方向点积最大者。camYaw=0 时映射恒等（存档/攻略箭头/预计算解路
 * 零影响）；camYaw=π/2（相机转到 +X 侧）时 W(up)→left。
 */
export function cameraYawToGridDir(inputDir: Dir, camYaw: number): Dir {
  const intent = rotateGridIntent(DIR_VECTORS[inputDir], camYaw);
  let best = DIR_SCAN_ORDER[0] as Dir;
  let bestDot = -Infinity;
  for (const dir of DIR_SCAN_ORDER) {
    const dv = DIR_VECTORS[dir];
    const dot = dv.x * intent.x + dv.y * intent.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = dir;
    }
  }
  return best;
}

/** 斜向扫描序（同上：固定 + 严格 >，平局确定性） */
const DIAG_SCAN_ORDER: readonly DiagDir[] = ['upleft', 'upright', 'downleft', 'downright'];

/**
 * 斜向输入（Y/U/B/N）→ 斜向网格方向：8 向意图向量随相机偏航旋转后再 snap
 * 到最近斜向（动作类型必须仍是 diagonal，故候选取 4 个对角而非 8 向全集）。
 * camYaw=0 恒等。
 */
export function cameraYawToDiagDir(diag: DiagDir, camYaw: number): DiagDir {
  const intent = rotateGridIntent(DIAG_VECTORS[diag], camYaw);
  let best = DIAG_SCAN_ORDER[0] as DiagDir;
  let bestDot = -Infinity;
  for (const candidate of DIAG_SCAN_ORDER) {
    const dv = DIAG_VECTORS[candidate];
    const dot = dv.x * intent.x + dv.y * intent.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }
  return best;
}

/**
 * explore 回正位姿（I2 根治）：combat/dialogue/victory/boss 运镜结束后相位
 * 切回 playing 时，explore 常态不发位姿请求（用户全权），被运镜转走的方位角
 * 会永久残留 —— 按键方向与画面错位到整关。第三人称（缺省）只把方位角收敛
 * 回 0（相机回到 +Z 侧，画面「上」= 网格 -Y，与移动键语义一致），距离与
 * 俯仰传 null = 保留用户当前值，回正不抢用户已调好的缩放/视角。
 * 第一人称（viewPreference='first'）则收敛到 FP 头位档（distance 0.55 /
 * polar 78° / fov 68），方位角传 null = 保留用户头向（不拽头向；combat→
 * explore 的归 0 语义由调用方按前一模式显式传 'third' 决定）。
 * 由 WorldCanvas 在「切回 explore」的那一拍发出，CameraRig 收敛一次后照常
 * 交还用户。第二参带默认值：既有单参调用（worldStage.test.ts）不受影响。
 */
export function computeExploreResetPose(ctx: PoseContext, viewPreference: ViewPreference = 'third'): CameraPose {
  const base = computePose('explore', ctx);
  if (viewPreference === 'first') {
    return {
      ...base,
      distance: FIRST_PERSON_POSE.distance,
      polar: FIRST_PERSON_POSE.polar,
      azimuth: null,
      fov: FIRST_PERSON_POSE.fov,
    };
  }
  return { ...base, distance: null, polar: null, azimuth: 0 };
}

/**
 * 自发位姿回落决策（视角切换/战术俯瞰 effect 的纯函数核心；N2 根治）：
 * CameraRig 在 viewPreference/peeking 变化时按本函数决定「自发位姿请求」的
 * 目标位姿；返回 null = 不发请求（explore 常态交还用户全权，third 现状一致）。
 * 分档规则与 cameraLimitsFor 严格对齐 —— 目标位姿必须落在该次请求的目标夹紧
 * 档内，否则 useFrame 收敛期的每帧 clamp(radius, distMin, distMax) 会把收敛
 * 钉在档位边界上，完成判据 |distDelta|<0.02 永不满足 → poseActive 悬置且每帧
 * invalidate（S18 静置零渲染被打破；N2 实测 first+combat 松开 T 冻结在
 * dist 3.21/polar 55° 800+ 帧，因 FP 头位 0.55 < 全局档 distMin 3.2 不可达）。
 *  - peeking：T 战术俯瞰 → explore 俯瞰预设（8.5/35°），方位角保留、fov 回
 *    基准；全局档下 8.5/35° 均可达。
 *  - first + explore/dialogue（FP 档生效）→ FP 头位（0.55/78°/fov 68），方位
 *    角保留用户头向。
 *  - first + combat/victory/boss（全局档）→ **回落该模式既定舞台位**（combat
 *    8.2/50°/azimuth 0、boss 6.2/40°、victory 18/28°），不再收敛 FP 头位：
 *    0.55 是全局档下的不可达目标（N2 冻结根因），且设计语义为
 *    「combat/victory/boss 永远走既定舞台位」，first 档不参与演出模式。fov 回
 *    基准（与 N4 同语义：FP 贴脸 fov 68 不残留进演出位姿）。
 *  - third 且视角确有切换：explore/dialogue 收敛回 explore 预设（方位角保留、
 *    fov 回基准）；combat/victory/boss 同样回落舞台位 —— 与 first 分支同一
 *    规则，避免 V 往返把战斗取景拽去 explore 俯瞰位。
 */
export function computeSpontaneousPose(
  view: ViewPreference,
  mode: CameraMode,
  peeking: boolean,
  ctx: PoseContext,
  viewChanged: boolean,
): CameraPose | null {
  if (peeking) {
    return { ...computePose('explore', ctx), azimuth: null, fov: BASE_CAMERA_FOV };
  }
  if (view === 'first') {
    if (mode === 'combat' || mode === 'victory' || mode === 'boss') {
      // 全局档：舞台位 distance/polar 均在档内可达（N2 回落语义），fov 回基准
      return { ...computePose(mode, ctx), fov: BASE_CAMERA_FOV };
    }
    return { ...computePose('first', ctx), azimuth: null }; // FP 头位，保留头向
  }
  if (viewChanged) {
    if (mode === 'combat' || mode === 'victory' || mode === 'boss') {
      return { ...computePose(mode, ctx), fov: BASE_CAMERA_FOV }; // 全局档：同 first 分支规则
    }
    return { ...computePose('explore', ctx), azimuth: null, fov: BASE_CAMERA_FOV };
  }
  return null;
}

/* ================================= VFX ==================================== */

/** 粒子预算：槽位 × 每槽粒子数（全部静态分配，运行时零分配） */
export const VFX_SLOTS = 6;
export const VFX_PARTICLES = 26;
export const VFX_DURATIONS: Readonly<Record<string, number>> = Object.freeze({
  spark: 0.55,
  block: 0.6,
  star: 1.35,
  plane: 1.1,
});
export const PLANE_RING_LIFE = 0.85;
export const GOAL_HALO_PULSE = 0.65; // 落座光环扩散时长
export const GOAL_HALO_RADIUS = 0.62 * CELL;
