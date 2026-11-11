/**
 * puzzle/move —— 移动/推箱纯函数状态机。
 * ---------------------------------------------------------------------------
 * 边界与占位守卫全项目唯一实现在 core/gridMove.resolvePush/cellAt——本文件
 * 只做组合：在其上叠加高度层（爬升/箱落）、法则语义（拉箱/斜推/穿行/位面）、
 * 记账（步数/推数/充能/历史）。绝不自带第二套边界逻辑（S3 根治）。
 *
 * 高度语义（与 grid.ts/deadlock.ts/solver.ts 共享）：
 *   - 玩家/箱子爬升 Δh > CLIMB_LIMIT → blocked('cliff')；玩家下降不限（跳下无伤）；
 *   - 单箱推被推向落差 ≥ FALL_DROP 的格子 → 箱落：落到底并压碎落点的
 *     敌人/道具（箱落攻击）；连锁推不触发箱落（保守语义，与 solver 一致）；
 *   - 就位箱（旗格上）被「推落」需「箱可推离」法则；平推离旗格永远允许（S4）。
 *
 * 全部函数为 (state, action) => newState 纯函数：不修改入参、无模块级可变量、
 * 演出以数据形式放进 fx 数组由 store 转译到事件总线。
 */

import type { Dir, Grid, GridEntity, PushRules, Vec2 } from '../../core/types';
import { DIR_VECTORS } from '../../core/types';
import { resolvePush, cellAt, isWall } from '../../core/gridMove';
import {
  CLIMB_LIMIT,
  FALL_DROP,
  DIAG_VECTORS,
  canTogglePlane,
  effectiveTerrain,
  goalOrderPrefix,
  heightAt,
  isSolved,
  occupiedBy,
  playerMayEnter,
  playerOnAnchor,
  type DiagDir,
  type LevelGeometry,
} from './grid';
import type { PuzzleRuleSet } from './rules';
import {
  canDiagonalPush,
  canDropSeatedChest,
  canPull,
  canShiftPlaneFreely,
  detonationsOf,
  phaseChargeCost,
  phaseWalkUnlocked,
} from './rules';

/* ================================ 状态 ==================================== */

/** 一次动作前的切片，供 undo 恢复（撤销栈元素） */
export interface PuzzleSnapshot {
  readonly entities: readonly GridEntity[];
  readonly steps: number;
  readonly pushes: number;
  readonly phaseCharges: number;
  readonly detonationsLeft: number;
  readonly planeShifted: boolean;
}

export interface PuzzleState {
  readonly geometry: LevelGeometry;
  readonly entities: readonly GridEntity[];
  readonly steps: number;
  readonly pushes: number;
  readonly phaseCharges: number;
  readonly detonationsLeft: number;
  /** 阴阳位面：false=阳面 true=阴面 */
  readonly planeShifted: boolean;
  /** 已推进的历史（不含当前），undo 直接弹出；上限 HISTORY_LIMIT */
  readonly history: readonly PuzzleSnapshot[];
}

/** 撤销栈上限（防长局内存膨胀；Q 重玩本段即清空） */
export const HISTORY_LIMIT = 200;

/** 「相位穿行」解锁时每段自带的基础充能（解谜评分可经 grantPhaseCharges 追加） */
export const BASE_PHASE_CHARGES = 3;

export function playerEntityOf(entities: readonly GridEntity[]): GridEntity | undefined {
  return entities.find((e) => e.kind === 'player');
}

/** 由几何层 + 规则构建初始状态（纯；实体缺省时按出生点派生） */
export function createPuzzleState(
  geometry: LevelGeometry,
  rules: PuzzleRuleSet,
  entities?: readonly GridEntity[],
): PuzzleState {
  // 穿行充能每段重置（S17）：解锁时给基础充能，另有法则叠加时取较大者
  const baseCharges = rules.phaseWalkEnabled ? Math.max(BASE_PHASE_CHARGES, Math.max(0, rules.phaseWalkCharges)) : Math.max(0, rules.phaseWalkCharges);
  return {
    geometry,
    entities: entities ?? entitiesFromGeometry(geometry),
    steps: 0,
    pushes: 0,
    phaseCharges: baseCharges,
    detonationsLeft: detonationsOf(rules),
    planeShifted: false,
    history: [],
  };
}

function entitiesFromGeometry(geometry: LevelGeometry): readonly GridEntity[] {
  const list: GridEntity[] = [
    {
      id: 'player-1',
      kind: 'player',
      x: geometry.playerSpawn.x,
      y: geometry.playerSpawn.y,
      mass: Infinity,
      pushable: false,
    },
  ];
  geometry.chestSpawns.forEach((pos, i) => {
    list.push({ id: `chest-${i + 1}`, kind: 'chest', x: pos.x, y: pos.y, mass: 2, pushable: true });
  });
  // 敌人实体（M7）：可推、质量 1 —— 箱落压碎目标的谜题侧真相（与 grid.initialEntities 同参）
  geometry.enemySpawns.forEach((pos, i) => {
    list.push({ id: `enemy-${i + 1}`, kind: 'enemy', x: pos.x, y: pos.y, mass: 1, pushable: true });
  });
  // 祭坛实体（不可推建筑）：占位障碍，供 E 键交互与对话运镜对准（与 grid.initialEntities 同参）
  geometry.altarSpawns.forEach((pos, i) => {
    list.push({ id: `altar-${i + 1}`, kind: 'altar', x: pos.x, y: pos.y, mass: 0, pushable: false });
  });
  return list;
}

/* ================================ 动作 ==================================== */

export type PuzzleAction =
  | { readonly type: 'move'; readonly dir: Dir }
  | { readonly type: 'pull'; readonly dir: Dir }
  | { readonly type: 'diagonal'; readonly diag: DiagDir }
  | { readonly type: 'phase'; readonly dir: Dir }
  | { readonly type: 'shiftPlane' };

/** 演出数据（store 转译为 core/events/bus 的 FxEvent，引擎自身零副作用） */
export type PuzzleFx =
  | { readonly type: 'slide'; readonly entityId: string; readonly from: Vec2; readonly to: Vec2 }
  | { readonly type: 'pull'; readonly chestId: string; readonly from: Vec2; readonly to: Vec2 }
  | { readonly type: 'fall'; readonly entityId: string; readonly from: Vec2; readonly to: Vec2; readonly crushed: readonly string[] }
  | { readonly type: 'phase'; readonly from: Vec2; readonly to: Vec2 }
  | { readonly type: 'detonation'; readonly at: Vec2; readonly destroyed: readonly string[] }
  | { readonly type: 'planeShift'; readonly shifted: boolean }
  | { readonly type: 'solved' };

/** core BlockReason 之外，谜题层补充的拒绝原因 */
export type PuzzleBlockReason =
  | 'no-origin'
  | 'out-of-bounds'
  | 'wall'
  | 'immovable'
  | 'chain-limit'
  | 'cliff' // 高度差超出爬升上限
  | 'no-chest' // 拉/斜推方向上没有箱子
  | 'law-locked' // 对应法则未解锁
  | 'no-charge' // 穿行充能不足
  | 'goal-locked' // 就位箱不可推落（未持「箱可推离」）
  | 'landed-occupied' // 箱落点/穿行落点被不可压碎实体占据
  | 'plane-locked' // 位面未解锁（缺 plane-shift 补丁）
  | 'no-anchor' // 不在位面锚点（无位面之眼）
  | 'embedded' // 切位面会使实体嵌入墙
  | 'one-way' // 单向阀：玩家逆向进入被拒（箱子不受限）
  | 'order-locked'; // 旗位顺序闸：箱子乱序推入清单旗格被拒

export type PuzzleMoveResult =
  | { readonly ok: true; readonly state: PuzzleState; readonly fx: readonly PuzzleFx[] }
  | { readonly ok: false; readonly reason: PuzzleBlockReason; readonly state: PuzzleState };

/* ============================ 主入口（纯） ================================ */

export function applyPuzzleMove(
  state: PuzzleState,
  rules: PuzzleRuleSet,
  action: PuzzleAction,
): PuzzleMoveResult {
  const player = playerEntityOf(state.entities);
  if (player === undefined) return { ok: false, reason: 'no-origin', state };

  if (action.type === 'shiftPlane') {
    return applyPlaneShift(state, rules, player);
  }

  const ctx: TurnContext = {
    geometry: state.geometry,
    planeShifted: state.planeShifted,
    rules,
    phaseCharges: state.phaseCharges,
    detonationsLeft: state.detonationsLeft,
  };
  const turn = resolvePlayerAction(ctx, state.entities, { x: player.x, y: player.y }, action);
  if (!turn.ok) return { ok: false, reason: turn.reason, state };

  // 记账：当前切片进撤销栈 → 步数/推数/充能 → 演出
  const snapshot: PuzzleSnapshot = {
    entities: state.entities,
    steps: state.steps,
    pushes: state.pushes,
    phaseCharges: state.phaseCharges,
    detonationsLeft: state.detonationsLeft,
    planeShifted: state.planeShifted,
  };
  const history =
    state.history.length >= HISTORY_LIMIT
      ? [...state.history.slice(1), snapshot]
      : [...state.history, snapshot];

  const wasSolved = isSolved(state.geometry, state.entities);
  const nowSolved = isSolved(state.geometry, turn.entities);
  const fx: PuzzleFx[] = [...turn.fx];
  if (nowSolved && !wasSolved) fx.push({ type: 'solved' });

  const nextState: PuzzleState = {
    ...state,
    entities: turn.entities,
    steps: state.steps + rules.moveCost,
    pushes: state.pushes + turn.pushes,
    phaseCharges: turn.phaseCharges,
    detonationsLeft: turn.detonationsLeft,
    history,
  };
  return { ok: true, state: nextState, fx };
}

/* ====================== 单动作解析（solver 复用核心） ====================== */

export interface TurnContext {
  readonly geometry: LevelGeometry;
  readonly planeShifted: boolean;
  readonly rules: PuzzleRuleSet;
  readonly phaseCharges: number;
  readonly detonationsLeft: number;
}

interface TurnSuccess {
  readonly ok: true;
  readonly entities: readonly GridEntity[];
  readonly fx: readonly PuzzleFx[];
  readonly pushes: number;
  readonly phaseCharges: number;
  readonly detonationsLeft: number;
}
interface TurnFailure {
  readonly ok: false;
  readonly reason: PuzzleBlockReason;
}

export type TurnResult = TurnSuccess | TurnFailure;

/**
 * 解析玩家在 playerPos 处发起的一次动作。
 * 不含记账/历史（applyPuzzleMove 负责）；solver 直接调用本函数枚举宏移动，
 * 保证与实机完全同一套规则。playerPos 允许是「虚位」（solver 的可达格枚举），
 * 此时玩家实体以该位置参与占位与高度判断。
 */
export function resolvePlayerAction(
  ctx: TurnContext,
  entities: readonly GridEntity[],
  playerPos: Vec2,
  action: Exclude<PuzzleAction, { type: 'shiftPlane' }>,
): TurnResult {
  const player = playerEntityOf(entities);
  if (player === undefined) return { ok: false, reason: 'no-origin' };

  // 玩家以外的实体参与占位；玩家本体以 playerPos 虚位参与
  const others = entities.filter((e) => e.id !== player.id);
  const terrain = effectiveTerrain(ctx.geometry, ctx.planeShifted);

  switch (action.type) {
    case 'move':
      return resolveMoveOrPush(ctx, terrain, others, player, playerPos, action.dir);
    case 'phase':
      return resolvePhase(ctx, terrain, others, player, playerPos, action.dir);
    case 'pull':
      return resolvePull(ctx, terrain, others, player, playerPos, action.dir);
    case 'diagonal':
      return resolveDiagonal(ctx, terrain, others, player, playerPos, action.diag);
  }
}

/* ------------------------------ 普通移动/推箱 ----------------------------- */

function resolveMoveOrPush(
  ctx: TurnContext,
  terrain: Grid,
  others: readonly GridEntity[],
  player: GridEntity,
  playerPos: Vec2,
  dir: Dir,
): TurnResult {
  const geometry = ctx.geometry;
  const step = DIR_VECTORS[dir];
  const target: Vec2 = { x: playerPos.x + step.x, y: playerPos.y + step.y };

  const targetCell = cellAt(terrain, target.x, target.y);
  if (!targetCell.ok) return { ok: false, reason: 'out-of-bounds' };

  // 单向阀资格闸（MECH-4）：玩家进格按阀向过滤（普通移动与推箱跟进同闸；
  // 箱子的落格不在本闸范围——箱不受限）
  if (!playerMayEnter(geometry, target, dir)) return { ok: false, reason: 'one-way' };

  const hPlayer = heightAt(geometry.heights, playerPos.x, playerPos.y) ?? 0;
  const hTarget = heightAt(geometry.heights, target.x, target.y) ?? 0;
  if (hTarget - hPlayer > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };

  const occupant = occupiedBy(others, target.x, target.y);

  // ---- 箱落预检：目标是箱子且其前方是 ≥ FALL_DROP 的落差 ----
  if (occupant !== undefined && occupant.kind === 'chest' && occupant.pushable) {
    const landing: Vec2 = { x: target.x + step.x, y: target.y + step.y };
    const landingCell = cellAt(terrain, landing.x, landing.y);
    if (landingCell.ok && !isWall(landingCell.value)) {
      const hLanding = heightAt(geometry.heights, landing.x, landing.y) ?? 0;
      if (hTarget - hLanding >= FALL_DROP) {
        const landOccupant = occupiedBy(others, landing.x, landing.y);
        if (landOccupant !== undefined && !isCrushable(landOccupant)) {
          return { ok: false, reason: 'landed-occupied' };
        }
        return resolveFallPush(ctx, others, player, playerPos, occupant, target, landing, landOccupant);
      }
    }
    // 落差不足 / 落点是墙 / 落点越界 → 走 resolvePush 常规路径（撞墙/越界由它拒绝）
  }

  // ---- 常规路径：交给 core 原语（唯一守卫实现） ----
  const pushRules: PushRules = { maxChain: Math.max(1, Math.round(ctx.rules.pushRange)), fallOffEdge: false };
  const before = [playerAt(player, playerPos), ...others];
  const result = resolvePush({ grid: terrain, entities: before, origin: player.id, dir, rules: pushRules });
  if (result.kind === 'blocked') return { ok: false, reason: result.reason };

  // 旗位顺序闸（MECH-4）：本推中有箱子落入清单旗格时按链序逐个校验资格
  // （动作前箱位派生已就位前缀；连锁时按 moved 序即最近箱先入格结算）
  const movedEntities = result.kind === 'move' ? [] : result.moved;
  if (firstOrderViolation(geometry, others, movedEntities)) return { ok: false, reason: 'order-locked' };

  // 高度后验：位移实体爬升不得超过 CLIMB_LIMIT；箱体下降不得超过 1 格
  //（单箱大落差已在上面分流为箱落；连锁推不触发箱落——保守语义）
  const beforePos = new Map(before.map((e) => [e.id, e] as const));
  for (const after of result.entities) {
    const old = beforePos.get(after.id);
    if (old === undefined) continue;
    const hOld = heightAt(geometry.heights, old.x, old.y) ?? 0;
    const hNew = heightAt(geometry.heights, after.x, after.y) ?? 0;
    const climb = hNew - hOld;
    if (climb > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };
    if (after.kind === 'chest' && -climb > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };
  }

  return {
    ok: true,
    entities: result.entities,
    fx: slideFx(before, result.entities),
    pushes: result.kind === 'move' ? 0 : 1,
    phaseCharges: ctx.phaseCharges,
    detonationsLeft: ctx.detonationsLeft,
  };
}

/* --------------------------------- 箱落 ----------------------------------- */

/** 可被箱落压碎/爆炸清除的实体类型（敌人被砸、道具被压碎） */
function isCrushable(e: GridEntity): boolean {
  return e.kind === 'enemy' || e.kind === 'prop';
}

function resolveFallPush(
  ctx: TurnContext,
  others: readonly GridEntity[],
  player: GridEntity,
  playerPos: Vec2,
  chest: GridEntity,
  chestPos: Vec2,
  landing: Vec2,
  landOccupant: GridEntity | undefined,
): TurnResult {
  const geometry = ctx.geometry;

  // 就位箱（旗格上）被推落 → 需「箱可推离」法则；平推离旗格不受此限（S4）
  if (isSeatedOnGoal(geometry, chest) && !canDropSeatedChest(ctx.rules)) {
    return { ok: false, reason: 'goal-locked' };
  }

  // 旗位顺序闸：坠落也是「箱入格」，落入清单旗格同样受理序约束
  if (firstOrderViolation(geometry, others, [{ ...chest, x: landing.x, y: landing.y }])) {
    return { ok: false, reason: 'order-locked' };
  }

  const crushed = landOccupant !== undefined ? [landOccupant.id] : [];
  const kept = others.filter((e) => e.id !== chest.id && !crushed.includes(e.id));
  // 玩家进到箱子原格，箱子落到底
  const nextPlayer: GridEntity = { ...player, x: chestPos.x, y: chestPos.y };
  const landedChest: GridEntity = { ...chest, x: landing.x, y: landing.y };
  let entities: readonly GridEntity[] = [nextPlayer, landedChest, ...kept];

  const fx: PuzzleFx[] = [
    { type: 'slide', entityId: player.id, from: playerPos, to: chestPos },
    { type: 'fall', entityId: chest.id, from: chestPos, to: landing, crushed },
  ];

  // 箱落引爆：解锁且本段还有剩余次数 → 清除落点四邻的可破坏实体
  let detonationsLeft = ctx.detonationsLeft;
  if (detonationsOf(ctx.rules) > 0 && detonationsLeft > 0) {
    const det = detonateAt(entities, landing);
    if (det !== undefined) {
      entities = det.entities;
      fx.push(det.fx);
      detonationsLeft -= 1;
    }
  }

  return { ok: true, entities, fx, pushes: 1, phaseCharges: ctx.phaseCharges, detonationsLeft };
}

function detonateAt(
  entities: readonly GridEntity[],
  at: Vec2,
): { readonly entities: readonly GridEntity[]; readonly fx: PuzzleFx } | undefined {
  const dirs: readonly Vec2[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const destroyed: string[] = [];
  let next = entities;
  for (const d of dirs) {
    const victim = occupiedBy(next, at.x + d.x, at.y + d.y);
    if (victim !== undefined && isCrushable(victim)) {
      destroyed.push(victim.id);
      next = next.filter((e) => e.id !== victim.id);
    }
  }
  if (destroyed.length === 0) return undefined;
  return { entities: next, fx: { type: 'detonation', at, destroyed } };
}

/* --------------------------------- 穿行 ----------------------------------- */

function resolvePhase(
  ctx: TurnContext,
  terrain: Grid,
  others: readonly GridEntity[],
  player: GridEntity,
  playerPos: Vec2,
  dir: Dir,
): TurnResult {
  if (!phaseWalkUnlocked(ctx.rules)) return { ok: false, reason: 'law-locked' };
  const geometry = ctx.geometry;
  const step = DIR_VECTORS[dir];
  const adjacent: Vec2 = { x: playerPos.x + step.x, y: playerPos.y + step.y };
  const adjCell = cellAt(terrain, adjacent.x, adjacent.y);
  const hPlayer = heightAt(geometry.heights, playerPos.x, playerPos.y) ?? 0;
  const hAdj = adjCell.ok ? (heightAt(geometry.heights, adjacent.x, adjacent.y) ?? 0) : Number.POSITIVE_INFINITY;
  const adjFree =
    adjCell.ok &&
    !isWall(adjCell.value) &&
    occupiedBy(others, adjacent.x, adjacent.y) === undefined &&
    hAdj - hPlayer <= CLIMB_LIMIT;

  // 前方本就可走 → 退化为普通移动，不消耗充能（确定性语义）
  if (adjFree) {
    return resolveMoveOrPush(ctx, terrain, others, player, playerPos, dir);
  }

  const cost = phaseChargeCost(ctx.rules);
  if (ctx.phaseCharges < cost) return { ok: false, reason: 'no-charge' };

  const landing: Vec2 = { x: playerPos.x + step.x * 2, y: playerPos.y + step.y * 2 };
  const landingCell = cellAt(terrain, landing.x, landing.y);
  if (!landingCell.ok) return { ok: false, reason: 'out-of-bounds' };
  if (isWall(landingCell.value)) return { ok: false, reason: 'wall' };
  // 单向阀：穿行落格按阀向过滤（玩家位移过滤覆盖一切进格路径）
  if (!playerMayEnter(geometry, landing, dir)) return { ok: false, reason: 'one-way' };
  if (occupiedBy(others, landing.x, landing.y) !== undefined) return { ok: false, reason: 'landed-occupied' };
  const hLanding = heightAt(geometry.heights, landing.x, landing.y) ?? 0;
  if (hLanding - hPlayer > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };

  const nextPlayer: GridEntity = { ...player, x: landing.x, y: landing.y };
  return {
    ok: true,
    entities: [nextPlayer, ...others],
    fx: [{ type: 'phase', from: playerPos, to: landing }],
    pushes: 0,
    phaseCharges: ctx.phaseCharges - cost,
    detonationsLeft: ctx.detonationsLeft,
  };
}

/* --------------------------------- 拉箱 ----------------------------------- */

function resolvePull(
  ctx: TurnContext,
  terrain: Grid,
  others: readonly GridEntity[],
  player: GridEntity,
  playerPos: Vec2,
  dir: Dir,
): TurnResult {
  if (!canPull(ctx.rules)) return { ok: false, reason: 'law-locked' };
  const geometry = ctx.geometry;
  const step = DIR_VECTORS[dir];
  const chestPos: Vec2 = { x: playerPos.x + step.x, y: playerPos.y + step.y };
  const chest = occupiedBy(others, chestPos.x, chestPos.y);
  if (chest === undefined || chest.kind !== 'chest') return { ok: false, reason: 'no-chest' };

  // 玩家向反方向退一格
  const back: Vec2 = { x: playerPos.x - step.x, y: playerPos.y - step.y };
  const backCell = cellAt(terrain, back.x, back.y);
  if (!backCell.ok) return { ok: false, reason: 'out-of-bounds' };
  if (isWall(backCell.value)) return { ok: false, reason: 'wall' };
  // 单向阀：后退位移方向 = pull 方向的反向，进格按阀向过滤
  if (!playerMayEnter(geometry, back, oppositeDir(dir))) return { ok: false, reason: 'one-way' };
  if (occupiedBy(others, back.x, back.y) !== undefined) return { ok: false, reason: 'immovable' };
  const hPlayer = heightAt(geometry.heights, playerPos.x, playerPos.y) ?? 0;
  const hBack = heightAt(geometry.heights, back.x, back.y) ?? 0;
  if (hBack - hPlayer > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };

  // 箱子跟进到玩家原格：拉上/拉下都限 1 格（拉箱不触发箱落）
  const hChest = heightAt(geometry.heights, chestPos.x, chestPos.y) ?? 0;
  if (Math.abs(hPlayer - hChest) > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };

  const nextPlayer: GridEntity = { ...player, x: back.x, y: back.y };
  const nextChest: GridEntity = { ...chest, x: playerPos.x, y: playerPos.y };
  const kept = others.filter((e) => e.id !== chest.id);

  // 旗位顺序闸：拉箱入格同样受理序约束（法则卡不能绕开顺序谜题）
  if (firstOrderViolation(geometry, others, [nextChest])) return { ok: false, reason: 'order-locked' };

  return {
    ok: true,
    entities: [nextPlayer, nextChest, ...kept],
    fx: [
      { type: 'slide', entityId: player.id, from: playerPos, to: back },
      { type: 'pull', chestId: chest.id, from: chestPos, to: playerPos },
    ],
    pushes: 1,
    phaseCharges: ctx.phaseCharges,
    detonationsLeft: ctx.detonationsLeft,
  };
}

/* --------------------------------- 斜推 ----------------------------------- */

function resolveDiagonal(
  ctx: TurnContext,
  terrain: Grid,
  others: readonly GridEntity[],
  player: GridEntity,
  playerPos: Vec2,
  diag: DiagDir,
): TurnResult {
  if (!canDiagonalPush(ctx.rules)) return { ok: false, reason: 'law-locked' };
  const geometry = ctx.geometry;
  const v = DIAG_VECTORS[diag];
  const chestPos: Vec2 = { x: playerPos.x + v.x, y: playerPos.y + v.y };
  const chest = occupiedBy(others, chestPos.x, chestPos.y);
  if (chest === undefined || chest.kind !== 'chest') return { ok: false, reason: 'no-chest' };

  // 箱子沿对角前进一格（斜推不触发箱落）
  const chestTarget: Vec2 = { x: chestPos.x + v.x, y: chestPos.y + v.y };
  const ctCell = cellAt(terrain, chestTarget.x, chestTarget.y);
  if (!ctCell.ok) return { ok: false, reason: 'out-of-bounds' };
  if (isWall(ctCell.value)) return { ok: false, reason: 'wall' };
  if (occupiedBy(others, chestTarget.x, chestTarget.y) !== undefined) return { ok: false, reason: 'landed-occupied' };
  const hPlayer = heightAt(geometry.heights, playerPos.x, playerPos.y) ?? 0;
  const hChest = heightAt(geometry.heights, chestPos.x, chestPos.y) ?? 0;
  const hCT = heightAt(geometry.heights, chestTarget.x, chestTarget.y) ?? 0;
  if (hCT - hChest > CLIMB_LIMIT || hChest - hCT > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };

  // 防挤角：两个正交邻格不得同为墙（至少一侧可借力）
  const sideA = cellAt(terrain, playerPos.x + v.x, playerPos.y);
  const sideB = cellAt(terrain, playerPos.x, playerPos.y + v.y);
  if ((!sideA.ok || isWall(sideA.value)) && (!sideB.ok || isWall(sideB.value))) {
    return { ok: false, reason: 'wall' };
  }

  // 玩家进到箱子原格
  if (hChest - hPlayer > CLIMB_LIMIT) return { ok: false, reason: 'cliff' };

  // 单向阀：阀向皆为正交方向，斜向进入阀格不可能匹配 → 一律拒绝（位移过滤语义）
  if (geometry.oneWay.some((gt) => gt.cell.x === chestPos.x && gt.cell.y === chestPos.y)) {
    return { ok: false, reason: 'one-way' };
  }

  const nextPlayer: GridEntity = { ...player, x: chestPos.x, y: chestPos.y };
  const nextChest: GridEntity = { ...chest, x: chestTarget.x, y: chestTarget.y };
  const kept = others.filter((e) => e.id !== chest.id);

  // 旗位顺序闸：斜推入格同样受理序约束
  if (firstOrderViolation(geometry, others, [nextChest])) return { ok: false, reason: 'order-locked' };

  return {
    ok: true,
    entities: [nextPlayer, nextChest, ...kept],
    fx: [
      { type: 'slide', entityId: player.id, from: playerPos, to: chestPos },
      { type: 'slide', entityId: chest.id, from: chestPos, to: chestTarget },
    ],
    pushes: 1,
    phaseCharges: ctx.phaseCharges,
    detonationsLeft: ctx.detonationsLeft,
  };
}

/* -------------------------------- 位面切换 --------------------------------- */

function applyPlaneShift(state: PuzzleState, rules: PuzzleRuleSet, player: GridEntity): PuzzleMoveResult {
  if (!rules.planeShiftEnabled) return { ok: false, reason: 'plane-locked', state };
  if (!canShiftPlaneFreely(rules) && !playerOnAnchor(state.geometry, { x: player.x, y: player.y })) {
    return { ok: false, reason: 'no-anchor', state };
  }
  const toggle = canTogglePlane(state.geometry, state.entities, state.planeShifted);
  if (!toggle.ok) return { ok: false, reason: toggle.reason, state };

  const snapshot: PuzzleSnapshot = {
    entities: state.entities,
    steps: state.steps,
    pushes: state.pushes,
    phaseCharges: state.phaseCharges,
    detonationsLeft: state.detonationsLeft,
    planeShifted: state.planeShifted,
  };
  const history =
    state.history.length >= HISTORY_LIMIT
      ? [...state.history.slice(1), snapshot]
      : [...state.history, snapshot];
  const shifted = !state.planeShifted;
  return {
    ok: true,
    state: { ...state, planeShifted: shifted, history },
    fx: [{ type: 'planeShift', shifted }],
  };
}

/* ================================ 工具 ==================================== */

/** pull 的后退位移方向 = pull 方向的反向（单向阀按实际位移方向过滤） */
function oppositeDir(dir: Dir): Dir {
  return dir === 'up' ? 'down' : dir === 'down' ? 'up' : dir === 'left' ? 'right' : 'left';
}

/**
 * 旗位顺序闸校验（MECH-4 goalOrder 过滤器）。
 * 动作中被移动的箱子若有落入清单旗格者，按移动序（连锁时最近箱先入格）
 * 逐个对照「动作前箱位派生的已就位前缀」：只允许恰好依次落入 prefix、
 * prefix+1、… 各格，任何越序者判违规（整个动作拒绝，reason='order-locked'）。
 * 前缀由 entitiesBefore 的箱位派生（grid.goalOrderPrefix）——不进状态机字段，
 * 撤销/纯函数语义天然一致；清单外旗格不受理序约束。
 */
function firstOrderViolation(
  geometry: LevelGeometry,
  entitiesBefore: readonly GridEntity[],
  moved: readonly GridEntity[],
): boolean {
  if (geometry.goalOrder.length === 0) return false;
  let prefix = goalOrderPrefix(geometry, entitiesBefore);
  for (const e of moved) {
    if (e.kind !== 'chest') continue;
    const at = geometry.goalOrder.findIndex((c) => c.x === e.x && c.y === e.y);
    if (at === -1) continue;
    if (at !== prefix) return true;
    prefix += 1;
  }
  return false;
}

function playerAt(player: GridEntity, pos: Vec2): GridEntity {
  return { ...player, x: pos.x, y: pos.y };
}

function slideFx(before: readonly GridEntity[], after: readonly GridEntity[]): PuzzleFx[] {
  const fx: PuzzleFx[] = [];
  for (const e of after) {
    const old = before.find((b) => b.id === e.id);
    if (old !== undefined && (old.x !== e.x || old.y !== e.y)) {
      fx.push({ type: 'slide', entityId: e.id, from: { x: old.x, y: old.y }, to: { x: e.x, y: e.y } });
    }
  }
  return fx;
}

/** 箱子是否已就位（站在任意位面的旗格上） */
export function isSeatedOnGoal(geometry: LevelGeometry, chest: GridEntity): boolean {
  const base = geometry.terrain[chest.y]?.[chest.x];
  const shade = geometry.shadeTerrain?.[chest.y]?.[chest.x];
  return base === 3 || shade === 3;
}

/** 解谜评分供给穿行充能（store 在星级结算时调用；纯函数） */
export function grantPhaseCharges(state: PuzzleState, amount: number): PuzzleState {
  return { ...state, phaseCharges: Math.max(0, state.phaseCharges + Math.max(0, Math.floor(amount))) };
}
