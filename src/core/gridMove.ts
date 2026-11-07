/**
 * 共享网格推动原语 —— 全项目唯一一处「边界与占位守卫先于一切索引访问」的实现。
 * ---------------------------------------------------------------------------
 * 固化 SanBPushChest move.js:21-24 的教训：
 *   原版 `arr[role.rRow + t][role.rCol + l]` 先索引后守卫，靠 JS 越界返回
 *   undefined 的隐式行为兜底；负方向守卫（offSetXY）在 up()/left() 错位调用
 *   下沦为死代码。此处所有网格访问都经过 cellAt()/isInside() 的 Result 式
 *   守卫，越界是显式的 `{ ok: false }`，不存在 undefined 泄漏。
 *
 * 两个消费方：
 *   - puzzle-engine move.ts  （+ 撤销 / 死角 / 求解）
 *   - combat-engine shove.ts （+ 重量 / 地形 / 免疫）
 * 推箱与推挤的行为一致性由本原语 + 各自单测共同保证。
 *
 * 纯函数：不修改任何入参，返回全新 entities 数组。
 */

import type {
  BlockReason,
  Dir,
  Grid,
  GridEntity,
  PushResult,
  PushRules,
  TerrainCell,
  Vec2,
} from './types';
import { DIR_VECTORS } from './types';

export const DEFAULT_PUSH_RULES: PushRules = Object.freeze({
  maxChain: 4,
  fallOffEdge: false,
});

/* ======================= 守卫式网格访问（唯一索引点） ====================== */

export interface CellLookup {
  readonly ok: boolean;
  readonly reason?: 'out-of-bounds';
  readonly value?: TerrainCell;
}

/** 守卫先于索引：越界返回 { ok:false }，绝不触碰 grid[y][x] */
export function cellAt(grid: Grid, x: number, y: number): CellLookup {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  if (y < 0 || y >= grid.length) return { ok: false, reason: 'out-of-bounds' };
  const row = grid[y];
  if (row === undefined) return { ok: false, reason: 'out-of-bounds' };
  if (x < 0 || x >= row.length) return { ok: false, reason: 'out-of-bounds' };
  const value = row[x];
  if (value === undefined) return { ok: false, reason: 'out-of-bounds' };
  return { ok: true, value };
}

export function isInside(grid: Grid, x: number, y: number): boolean {
  return cellAt(grid, x, y).ok;
}

/** 地形是否为墙（唯一的地形语义点；2/4 出生点格在导入期已归 0） */
export function isWall(cell: TerrainCell | undefined): boolean {
  return cell === 1;
}

/* ============================ 主原语：resolvePush ========================== */

export interface ResolvePushArgs {
  /** 静态地形层（墙/地板/终点），不含动态实体 */
  readonly grid: Grid;
  /** 动态实体层（单一真相源） */
  readonly entities: readonly GridEntity[];
  /** 发起者的实体 id */
  readonly origin: string;
  readonly dir: Dir;
  readonly rules?: PushRules;
}

/**
 * 让 origin 沿 dir 移动/推动一格。
 * 行为约定（puzzle 与 combat 共享）：
 *  - 目标格为空地 → kind:'move'
 *  - 目标格有 1 个可推实体且其后为空地 → kind:'push'
 *  - 连续 ≥2 个实体依次让位 → kind:'chain'（超过 maxChain → blocked）
 *  - 最后一个被推实体后面越界且 rules.fallOffEdge → kind:'fall'（坠出者移除）
 *  - 撞墙 / 撞不可推实体 / 越界且不允许坠落 / 起点实体不存在 → kind:'blocked'
 */
export function resolvePush(args: ResolvePushArgs): PushResult {
  const { grid, entities, origin, dir, rules = DEFAULT_PUSH_RULES } = args;
  const step = DIR_VECTORS[dir];

  const mover = entities.find((e) => e.id === origin);
  if (mover === undefined) {
    return blocked('no-origin');
  }

  // ---- 沿方向收集“推动链”：mover → entity1 → entity2 → ... ----
  const chain: GridEntity[] = [mover];
  let cursor: Vec2 = { x: mover.x, y: mover.y };

  for (let depth = 0; depth <= rules.maxChain; depth++) {
    const next: Vec2 = { x: cursor.x + step.x, y: cursor.y + step.y };

    // 守卫 1：地图边界（在任何索引访问之前）
    const cell = cellAt(grid, next.x, next.y);
    if (!cell.ok) {
      // 越界：仅当链尾（最后一个被推者）可推且允许坠落时放行为 fall
      const tail = chain[chain.length - 1];
      const canFall = chain.length > 1 && tail !== undefined && tail.pushable && rules.fallOffEdge;
      if (!canFall) return blocked('out-of-bounds');
      const slid = slideChain(entities, chain, step);
      const tailId = tail.id;
      return {
        kind: 'fall',
        fell: slid.filter((e) => e.id === tailId),
        moved: slid.filter((e) => chainIdsBefore(e, chain) && e.id !== tailId),
        entities: slid.filter((e) => e.id !== tailId),
      };
    }

    // 守卫 2：地形墙
    if (isWall(cell.value)) {
      return blocked('wall');
    }

    // 守卫 3：占位实体
    const occupant = entities.find(
      (e) => e !== mover && !chain.includes(e) && e.x === next.x && e.y === next.y,
    );
    if (occupant === undefined) {
      // 链尾后是空地：链整体前移一格
      const slid = slideChain(entities, chain, step);
      if (chain.length === 1) {
        return { kind: 'move', from: { x: mover.x, y: mover.y }, to: next, entities: slid };
      }
      const firstPushed = chain[1];
      if (firstPushed === undefined) return blocked('no-origin'); // 理论不可达
      if (chain.length === 2) {
        return {
          kind: 'push',
          from: { x: firstPushed.x, y: firstPushed.y },
          to: next,
          moved: slid.filter((e) => e.id === firstPushed.id),
          entities: slid,
        };
      }
      return { kind: 'chain', moved: slid.filter((e) => chainIncludesId(chain, e.id)), entities: slid };
    }

    // 守卫 4：不可推 / 免疫
    if (!occupant.pushable || occupant.shoveImmune) {
      return blocked('immovable');
    }

    // 守卫 5：链长上限
    if (chain.length > rules.maxChain) {
      return blocked('chain-limit');
    }

    chain.push(occupant);
    cursor = next;
  }

  return blocked('chain-limit');
}

function blocked(reason: BlockReason): PushResult {
  return { kind: 'blocked', reason };
}

function chainIncludesId(chain: readonly GridEntity[], id: string): boolean {
  return chain.some((e) => e.id === id);
}

function chainIdsBefore(entity: GridEntity, chain: readonly GridEntity[]): boolean {
  return chainIncludesId(chain, entity.id);
}

/** 返回链内实体整体前移一格后的全新数组（链外实体原样保留） */
function slideChain(
  entities: readonly GridEntity[],
  chain: readonly GridEntity[],
  step: Vec2,
): GridEntity[] {
  const ids = new Set(chain.map((e) => e.id));
  return entities.map((e) => (ids.has(e.id) ? { ...e, x: e.x + step.x, y: e.y + step.y } : e));
}

/* ======================= 派生查询（selector 复用的底座） ==================== */

/** 「实体→网格占位」的唯一现算实现（store/selector 调用，绝不手工维护副本） */
export function occupancyOf(entities: readonly GridEntity[]): Map<string, GridEntity> {
  const map = new Map<string, GridEntity>();
  for (const e of entities) map.set(`${e.x},${e.y}`, e);
  return map;
}

export function entityAt(entities: readonly GridEntity[], x: number, y: number): GridEntity | undefined {
  return entities.find((e) => e.x === x && e.y === y);
}
