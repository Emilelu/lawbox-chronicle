/**
 * puzzle/grid —— 网格与实体占位派生（3D 高度层扩展的对接点）。
 * ---------------------------------------------------------------------------
 * 职责边界：
 *  - 边界/占位守卫唯一实现在 core/gridMove.ts（cellAt/isWall/entityAt），
 *    本文件只在其上做「派生」，绝不自己写第二套边界逻辑（S3/S15 根治）。
 *  - core/types.ts 的 LevelDef 是平面关卡契约，尚无高度层/阴阳位面字段；
 *    本文件定义 Level3D 扩展作为对接点，集成期可将字段上提进 core。
 *  - 实体是唯一动态真相源，占位一律由 entityAt 现算（S1 幻影箱子根治）。
 *
 * 3D 语义（全引擎统一，move/deadlock/solver 共用）：
 *  - 高度差 |Δh| ≤ CLIMB_LIMIT 时玩家/箱子可正常走/推上；
 *  - 箱子被推向 Δh ≤ -FALL_DROP 的落差格时发生「箱落」：直接落到底、
 *    压碎落点上的敌人/道具 —— 地形本身成为武器（立体推箱新玩法）；
 *  - 玩家下落无伤（可跳下任意落差，但爬不上 >1 的台阶）。
 */

import type { Dir, Grid, GridEntity, LevelDef, TerrainCell, Vec2 } from '../../core/types';
import { DIR_VECTORS } from '../../core/types';
import { cellAt, entityAt, isWall } from '../../core/gridMove';

/* ============================== 类型对接点 ================================= */

/** 海拔层：与 grid 同尺寸的二维数组，格值 = 该格地面的相对高度（0 = 地面层） */
export type HeightMap = readonly (readonly number[])[];

/**
 * 3D 关卡定义 = core LevelDef + 高度层/阴阳位面扩展（对接点，可上提 core）。
 *  - heights 缺省时视为全 0（纯平面关）；
 *  - shadeGrid 为阴面地形（0/1/3），缺省时阴阳两面地形相同；
 *  - planeAnchors 为「位面锚点」：未持「位面之眼」法则时，仅站在锚点上可切位面。
 */
export interface Level3D extends LevelDef {
  readonly heights?: HeightMap;
  readonly shadeGrid?: Grid;
  readonly planeAnchors?: readonly Vec2[];
  /**
   * 敌人出生点（箱落压碎目标 / 战斗杂兵的数据来源）。
   * 不走 TerrainCell 图例：敌人需要与旗位等静态地形共存（如压在旗格上
   * 等待箱落的敌人），单值网格表达不了叠加，故作为数据扩展字段声明。
   */
  readonly enemySpawns?: readonly Vec2[];
  /**
   * 祭坛出生点（主城星愿祭坛等不可推静态实体）。与敌人同为数据扩展字段：
   * 祭坛是「建筑」，不可推、不可压碎，谜题引擎与 solver 都视作障碍占位。
   */
  readonly altarSpawns?: readonly Vec2[];
  /**
   * 旗位落座顺序（MECH-4 顺序谜题过滤器）：箱子进入清单内旗格必须按序——
   * 只允许落入「下一个未就位」的清单格，乱序推入被拒（order-locked）。
   * 过滤器而非新物理：推/滑/坠结算零改动，只是给「箱入旗格」加一道资格闸；
   * 缺席（undefined）时零影响。清单外旗格不受理序约束。
   */
  readonly goalOrder?: readonly Vec2[];
  /**
   * 单向阀（MECH-4 位移过滤器）：玩家进入 cell 只允许沿 allow 方向，
   * 逆向/侧向进入被拒（one-way）；箱子不受限（推过、停在阀格均自由）。
   * 过滤器而非新物理：位移结算零改动，只给「玩家进格」加一道资格闸；
   * 缺席（undefined）时零影响。
   */
  readonly oneWay?: readonly OneWayGate[];
}

/** 单向阀声明：cell 格仅允许玩家以 allow 方向进入 */
export interface OneWayGate {
  readonly cell: Vec2;
  readonly allow: Dir;
}

/** 爬升上限：玩家/箱子单步可上的最大高度差 */
export const CLIMB_LIMIT = 1;
/** 箱落触发落差：被推向高度差 ≥ 此值的格子时坠落 */
export const FALL_DROP = 2;

/* ============================ 关卡几何解析（纯） =========================== */

export interface ParsedGeometry {
  readonly ok: true;
  readonly geometry: LevelGeometry;
}

export interface ParseError {
  readonly ok: false;
  readonly error: string;
}

export interface LevelGeometry {
  readonly levelId: string;
  readonly width: number;
  readonly height: number;
  /** 静态地形（阳面）：出生点 2/4 已归 0，只余 0/1/3/5（5 = 尖刺格） */
  readonly terrain: Grid;
  readonly heights: HeightMap;
  /** 阴面地形（无阴阳设定时为 null） */
  readonly shadeTerrain: Grid | null;
  readonly planeAnchors: readonly Vec2[];
  readonly goals: readonly Vec2[];
  readonly shadeGoals: readonly Vec2[];
  readonly playerSpawn: Vec2;
  readonly chestSpawns: readonly Vec2[];
  /** 敌人出生点（Level3D.enemySpawns 透传；缺省空表 —— 谜题引擎与 solver 按需消费） */
  readonly enemySpawns: readonly Vec2[];
  /** 祭坛出生点（Level3D.altarSpawns 透传；不可推静态障碍，谜题引擎与 solver 按需消费） */
  readonly altarSpawns: readonly Vec2[];
  /** 旗位落座顺序（Level3D.goalOrder 透传；缺席 = 无顺序约束） */
  readonly goalOrder: readonly Vec2[];
  /** 单向阀清单（Level3D.oneWay 透传；缺席 = 空表，玩家位移无方向限制） */
  readonly oneWay: readonly OneWayGate[];
}

/**
 * 把图例网格解析为「地形 + 高度 + 出生点 + 终点」几何层（纯函数，不产实体）。
 * 出生点 2/4 归 0：实体坐标是唯一真相，地形层不留第二份（S1/S12 根治）。
 */
export function parseLevelGeometry(def: Level3D): ParsedGeometry | ParseError {
  const grid = def.grid;
  if (grid.length === 0) return { ok: false, error: `${def.id}: 空网格` };
  const width = grid[0]?.length ?? 0;
  if (width === 0) return { ok: false, error: `${def.id}: 首行为空` };

  const terrainRows: TerrainCell[][] = [];
  const heightRows: number[][] = [];
  const goals: Vec2[] = [];
  const shadeGoals: Vec2[] = [];
  let playerSpawn: Vec2 | undefined;
  const chestSpawns: Vec2[] = [];

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    if (row === undefined || row.length !== width) {
      return { ok: false, error: `${def.id}: 第 ${y} 行宽度与首行不一致` };
    }
    const terrainRow: TerrainCell[] = [];
    const heightRow: number[] = [];
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell === undefined) return { ok: false, error: `${def.id}: (${x},${y}) 缺格` };
      switch (cell) {
        case 2:
          if (playerSpawn !== undefined) {
            return { ok: false, error: `${def.id}: 出现多个玩家出生点(2)` };
          }
          playerSpawn = { x, y };
          terrainRow.push(0);
          break;
        case 4:
          chestSpawns.push({ x, y });
          terrainRow.push(0);
          break;
        case 3:
          goals.push({ x, y });
          terrainRow.push(3);
          break;
        default:
          terrainRow.push(cell);
          break;
      }
      heightRow.push(heightAtRaw(def.heights, x, y) ?? 0);
    }
    terrainRows.push(terrainRow);
    heightRows.push(heightRow);
  }

  if (playerSpawn === undefined) return { ok: false, error: `${def.id}: 缺少玩家出生点(2)` };
  if (chestSpawns.length === 0) return { ok: false, error: `${def.id}: 缺少箱子出生点(4)` };
  if (goals.length !== chestSpawns.length) {
    return {
      ok: false,
      error: `${def.id}: 箱子数(${chestSpawns.length}) ≠ 终点旗数(${goals.length})`,
    };
  }

  // 阴面地形：同样解析出生点归 0 与阴面旗位
  let shadeTerrain: Grid | null = null;
  if (def.shadeGrid !== undefined) {
    const shadeRows: TerrainCell[][] = [];
    if (def.shadeGrid.length !== grid.length) {
      return { ok: false, error: `${def.id}: 阴面行数与阳面不一致` };
    }
    for (let y = 0; y < def.shadeGrid.length; y++) {
      const sRow = def.shadeGrid[y];
      if (sRow === undefined || sRow.length !== width) {
        return { ok: false, error: `${def.id}: 阴面第 ${y} 行宽度不一致` };
      }
      const out: TerrainCell[] = [];
      for (let x = 0; x < sRow.length; x++) {
        const cell = sRow[x];
        if (cell === undefined) return { ok: false, error: `${def.id}: 阴面 (${x},${y}) 缺格` };
        if (cell === 3) shadeGoals.push({ x, y });
        // 阴面不携带出生点语义，2/4 一律归 0
        out.push(cell === 2 || cell === 4 ? 0 : cell);
      }
      shadeRows.push(out);
    }
    shadeTerrain = shadeRows;
  }

  return {
    ok: true,
    geometry: {
      levelId: def.id,
      width,
      height: grid.length,
      terrain: terrainRows,
      heights: heightRows,
      shadeTerrain,
      planeAnchors: def.planeAnchors ?? [],
      goals,
      shadeGoals,
      playerSpawn,
      chestSpawns,
      enemySpawns: def.enemySpawns ?? [],
      altarSpawns: def.altarSpawns ?? [],
      goalOrder: def.goalOrder ?? [],
      oneWay: def.oneWay ?? [],
    },
  };
}

function heightAtRaw(heights: HeightMap | undefined, x: number, y: number): number | undefined {
  const row = heights?.[y];
  if (row === undefined) return undefined;
  return row[x];
}

/* ============================== 实体派生（纯） ============================= */

/** 由几何层派生初始实体（id 约定与 core/store 的 importLevel 一致：player-1 / chest-N / enemy-N） */
export function initialEntities(geometry: LevelGeometry, chestMass = 2): GridEntity[] {
  const entities: GridEntity[] = [
    { id: 'player-1', kind: 'player', x: geometry.playerSpawn.x, y: geometry.playerSpawn.y, mass: Infinity, pushable: false },
  ];
  geometry.chestSpawns.forEach((pos, i) => {
    entities.push({ id: `chest-${i + 1}`, kind: 'chest', x: pos.x, y: pos.y, mass: chestMass, pushable: true });
  });
  // 敌人实体（M7 箱落压碎目标）：可推、质量 1 —— 与 combat 侧杂兵同参数
  geometry.enemySpawns.forEach((pos, i) => {
    entities.push({ id: `enemy-${i + 1}`, kind: 'enemy', x: pos.x, y: pos.y, mass: 1, pushable: true });
  });
  // 祭坛实体（不可推建筑）：占位障碍，E 键交互与对话运镜的目标（id 约定 altar-N）
  geometry.altarSpawns.forEach((pos, i) => {
    entities.push({ id: `altar-${i + 1}`, kind: 'altar', x: pos.x, y: pos.y, mass: 0, pushable: false });
  });
  return entities;
}

/* ============================ 高度查询（守卫式） =========================== */

/** 海拔查询：越界返回 undefined（绝不直接索引，守卫先于访问） */
export function heightAt(heights: HeightMap, x: number, y: number): number | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
  const row = heights[y];
  if (row === undefined) return undefined;
  const value = row[x];
  return value;
}

/* ============================ 位面语义（阴阳） ============================= */

/** 当前生效地形：阳面 / 阴面（无阴面设定时两面同形） */
export function effectiveTerrain(geometry: LevelGeometry, planeShifted: boolean): Grid {
  return planeShifted && geometry.shadeTerrain !== null ? geometry.shadeTerrain : geometry.terrain;
}

/**
 * 切换位面前置校验：切换后任何实体不得嵌进阴面墙里
 * （阴面走廊是「借道」语义——走完必须回到两面共通的地面上）。
 */
export function canTogglePlane(
  geometry: LevelGeometry,
  entities: readonly GridEntity[],
  currentlyShifted: boolean,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'embedded' } {
  const target = effectiveTerrain(geometry, !currentlyShifted);
  for (const e of entities) {
    const cell = cellAt(target, e.x, e.y);
    if (!cell.ok || isWall(cell.value)) return { ok: false, reason: 'embedded' };
  }
  return { ok: true };
}

/** 玩家是否站在位面锚点上（无位面之眼时的 F 键门槛） */
export function playerOnAnchor(geometry: LevelGeometry, player: Vec2): boolean {
  return geometry.planeAnchors.some((a) => a.x === player.x && a.y === player.y);
}

/* ======================== 机制过滤器查询（MECH-4） ========================= */

/**
 * 单向阀资格闸：玩家以 moveDir 进入 cell 是否放行。
 * 只过滤「玩家位移」——箱子被推过/停在阀格均不受限（箱不受限语义）；
 * 未设阀的格恒放行（缺席即零影响）。纯谓词，move/solver 共用同一实现。
 */
export function playerMayEnter(geometry: LevelGeometry, cell: Vec2, moveDir: Dir): boolean {
  const gate = geometry.oneWay.find((gt) => gt.cell.x === cell.x && gt.cell.y === cell.y);
  return gate === undefined || gate.allow === moveDir;
}

/**
 * 旗位顺序闸的「已就位前缀」：goalOrder 头部连续有箱的格数。
 * 由当前箱位派生（不进状态机字段）——撤销/纯函数语义天然一致：
 * 箱子只允许落入清单第 prefix 格（下一个未就位者），乱序推入被拒。
 */
export function goalOrderPrefix(geometry: LevelGeometry, entities: readonly GridEntity[]): number {
  if (geometry.goalOrder.length === 0) return 0;
  let prefix = 0;
  for (;;) {
    const cell = geometry.goalOrder[prefix];
    if (cell === undefined) break;
    const seated = entities.some((e) => e.kind === 'chest' && e.x === cell.x && e.y === cell.y);
    if (!seated) break;
    prefix += 1;
  }
  return prefix;
}

/* ============================== 达标判定（纯） ============================= */

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** 旗位键集合（按位面） */
export function goalKeys(geometry: LevelGeometry, planeShifted: boolean): Set<string> {
  const source = planeShifted && geometry.shadeTerrain !== null ? geometry.shadeGoals : geometry.goals;
  return new Set(source.map((g) => cellKey(g.x, g.y)));
}

/**
 * 解谜达标判定：所有箱子都站在旗位上（阳面或阴面任一即可）。
 * 阴阳位面的旗位取两面的并集——箱子实体不分位面，站上哪面的旗都算就位。
 */
export function isSolved(geometry: LevelGeometry, entities: readonly GridEntity[]): boolean {
  const anyGoal = new Set<string>([...geometry.goals, ...geometry.shadeGoals].map((g) => cellKey(g.x, g.y)));
  const chests = entities.filter((e) => e.kind === 'chest');
  return chests.length > 0 && chests.every((c) => anyGoal.has(cellKey(c.x, c.y)));
}

/* ============================== 步进工具（导出） =========================== */

/** dir 的步进向量（重新导出，模块内统一入口） */
export function dirStep(dir: Dir): Vec2 {
  return DIR_VECTORS[dir];
}

/** 格上是否有任何实体（占位现算，不维护第二份地图） */
export function occupiedBy(entities: readonly GridEntity[], x: number, y: number): GridEntity | undefined {
  return entityAt(entities, x, y);
}

/** 斜向方向（「斜向推挤」法则专用）：唯一定义在 core/types，此处再导出兼容历史 import 点 */
export type { DiagDir } from '../../core/types';
export { DIAG_VECTORS } from '../../core/types';
