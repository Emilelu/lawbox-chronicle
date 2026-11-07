/**
 * puzzle/deadlock —— 死角检测。
 * ---------------------------------------------------------------------------
 * 两层检测，全部只做「确定性死锁」判定（宁漏勿误：误判会把活局判死，
 * 漏判只是少剪枝）：
 *  1. 静态死角格：以终点旗为种子做反向可达性（把「推」反过来当「拉」），
 *     推不回任何旗位的地板格即死角格——箱子落进去且不在旗位上即死局。
 *     反向步同时考虑爬升（Δh ≤ 1 可推上）与箱落（落差 ≥ 2 可跳下），
 *     与 move.ts 的高度语义完全一致。
 *  2. 冻结块：任意 2×2 区域被「墙或箱子」填满时，其中的箱子永久冻结
 *    （经典 sokoban 冻结判定）；冻结箱中若有未就位者即死局。
 *
 * SanBPushChest 没有任何死角提示（ST6 的另一半）；本模块为 solver 剪枝
 * 与运行时「死局提示」提供同一份实现。
 */

import type { GridEntity, Vec2 } from '../../core/types';
import { DIR_VECTORS } from '../../core/types';
import { cellAt, isWall } from '../../core/gridMove';
import { CLIMB_LIMIT, FALL_DROP, cellKey, type LevelGeometry } from './grid';

/**
 * 每格「把箱子推回最近旗位所需最少推数」的下界（按格索引；∞ = 死角格）。
 * 以旗位为种子做反向 BFS（把「推」反当「拉」），反向步同时考虑爬升
 * （Δh ≤ 1 可推上）与箱落（落差 ≥ 2 可坠入），与 move.ts 的高度语义一致。
 * 是 solver 的 A* 启发式（可采纳）与静态死角剪枝的同一份数据源。
 * 注意：分析以阳面为基准（solver 同口径），且为「放行向」松弛——
 * 不检查玩家站位的高度可达，宁漏勿误（误标活格为死角会剪掉正解）。
 */
export function computePushDistanceMap(geometry: LevelGeometry): readonly number[] {
  const N = geometry.width * geometry.height;
  const dist = new Array<number>(N).fill(Number.POSITIVE_INFINITY);
  const queue: Vec2[] = [];

  const passable = (x: number, y: number): boolean => {
    const cell = cellAt(geometry.terrain, x, y);
    return cell.ok && !isWall(cell.value);
  };
  const height = (x: number, y: number): number => geometry.heights[y]?.[x] ?? 0;
  const indexOf = (x: number, y: number): number => y * geometry.width + x;

  for (const g of geometry.goals) {
    dist[indexOf(g.x, g.y)] = 0;
    queue.push(g);
  }

  while (queue.length > 0) {
    const b = queue.shift();
    if (b === undefined) break;
    const db = dist[indexOf(b.x, b.y)] ?? Number.POSITIVE_INFINITY;
    for (const dir of Object.keys(DIR_VECTORS) as readonly (keyof typeof DIR_VECTORS)[]) {
      const d = DIR_VECTORS[dir];
      // 反向：箱子从 A 被推进到 B（B 已有距离 db），玩家站在 S=A−d
      const a: Vec2 = { x: b.x - d.x, y: b.y - d.y };
      const s: Vec2 = { x: a.x - d.x, y: a.y - d.y };
      if (!passable(a.x, a.y) || !passable(s.x, s.y)) continue;
      const hA = height(a.x, a.y);
      const hB = height(b.x, b.y);
      const climbable = hB - hA <= CLIMB_LIMIT;
      const fallable = hA - hB >= FALL_DROP; // 箱落：从 A 坠到 B
      if (!climbable && !fallable) continue;
      const ia = indexOf(a.x, a.y);
      const da = dist[ia] ?? Number.POSITIVE_INFINITY;
      if (da > db + 1) {
        dist[ia] = db + 1;
        queue.push(a);
      }
    }
  }
  return dist;
}

/** 静态死角格集合（键 = cellKey）。代价 O(格数×4)，可按关卡缓存后复用 */
export function computeDeadSquares(geometry: LevelGeometry): Set<string> {
  const dist = computePushDistanceMap(geometry);
  const dead = new Set<string>();
  for (let y = 0; y < geometry.height; y++) {
    for (let x = 0; x < geometry.width; x++) {
      const cell = cellAt(geometry.terrain, x, y);
      if (!cell.ok || isWall(cell.value)) continue;
      const value = dist[y * geometry.width + x];
      if (value === undefined || !Number.isFinite(value)) dead.add(cellKey(x, y));
    }
  }
  return dead;
}

/** 箱子是否站在旗位上（任一位面；与 isSolved 同一口径） */
function onAnyGoal(geometry: LevelGeometry, x: number, y: number): boolean {
  const base = geometry.terrain[y]?.[x];
  const shade = geometry.shadeTerrain?.[y]?.[x];
  return base === 3 || shade === 3;
}

/** 冻结箱检测：返回所有被 2×2 墙/箱块冻结的箱子 id */
export function detectFrozenChests(geometry: LevelGeometry, entities: readonly GridEntity[]): readonly string[] {
  const chestAt = new Map<string, GridEntity>();
  for (const e of entities) {
    if (e.kind === 'chest') chestAt.set(cellKey(e.x, e.y), e);
  }
  const isBlocking = (x: number, y: number): boolean => {
    const cell = cellAt(geometry.terrain, x, y);
    if (cell.ok && isWall(cell.value)) return true;
    return chestAt.has(cellKey(x, y));
  };

  const frozen = new Set<string>();
  for (const chest of chestAt.values()) {
    // 以该箱子为 2×2 四角之一，检查四个可能的块
    const offsets: readonly Vec2[] = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: -1 },
    ];
    for (const off of offsets) {
      const ox = chest.x + off.x;
      const oy = chest.y + off.y;
      const cells: readonly Vec2[] = [
        { x: ox, y: oy },
        { x: ox + 1, y: oy },
        { x: ox, y: oy + 1 },
        { x: ox + 1, y: oy + 1 },
      ];
      if (!cells.every((c) => isBlocking(c.x, c.y))) continue;
      for (const c of cells) {
        const e = chestAt.get(cellKey(c.x, c.y));
        if (e !== undefined) frozen.add(e.id);
      }
    }
  }
  return [...frozen];
}

export interface DeadlockReport {
  readonly deadlocked: boolean;
  readonly reason: 'dead-square' | 'frozen' | null;
  readonly chestIds: readonly string[];
}

/**
 * 运行时死局判定：死角格 + 冻结块。
 * deadSquares 可传入按关卡缓存的集合（solver 内复用）。
 */
export function checkDeadlock(
  geometry: LevelGeometry,
  entities: readonly GridEntity[],
  deadSquares?: ReadonlySet<string>,
): DeadlockReport {
  const dead = deadSquares ?? computeDeadSquares(geometry);
  const deadHit: string[] = [];
  for (const e of entities) {
    if (e.kind !== 'chest') continue;
    if (onAnyGoal(geometry, e.x, e.y)) continue;
    // 阳面是墙的格子不参与阳面死角判定（阴面语义，交由位面规则处理）
    const baseCell = cellAt(geometry.terrain, e.x, e.y);
    if (!baseCell.ok || isWall(baseCell.value)) continue;
    if (dead.has(cellKey(e.x, e.y))) deadHit.push(e.id);
  }
  if (deadHit.length > 0) {
    return { deadlocked: true, reason: 'dead-square', chestIds: deadHit };
  }

  const frozen = detectFrozenChests(geometry, entities);
  const frozenOffGoal = frozen.filter((id) => {
    const e = entities.find((x) => x.id === id);
    return e !== undefined && !onAnyGoal(geometry, e.x, e.y);
  });
  if (frozenOffGoal.length > 0) {
    return { deadlocked: true, reason: 'frozen', chestIds: frozenOffGoal };
  }
  return { deadlocked: false, reason: null, chestIds: [] };
}
