/**
 * endless —— 无尽回廊：程序生成关卡 + 内置求解器校验。
 * ---------------------------------------------------------------------------
 * 兑现 mapGenerator.js 文件名从未兑现的承诺（newFeatures「无尽回廊」）：
 *  - 生成法为经典「逆向拉箱」：先把所有箱子放在旗位上，再让玩家做 K 次
 *    合法拉箱把箱子打散——拉箱序列的逆即一组合法推箱解，可解性由构造保证；
 *  - 生成后仍交给 engine/puzzle/solver 离线求解（最短推数）并用
 *    resolvePlayerAction 逐格回放验证，双重闸门（ST6 根治）；
 *  - 全程种子随机（core/rng.ts），同 runSeed + floorIndex 恒产出同一层，
 *    禁 Math.random（引擎层唯一随机来源约束）。
 *
 * 无尽层为平面标准 sokoban（高度层玩法集中在主线 areas）；层级尺寸与
 * 箱数随层数增长，参数在 ENDLESS_TUNING 集中声明。
 */

import type { Dir, TerrainCell, Vec2 } from '../../core/types';
import { DIR_VECTORS } from '../../core/types';
import { createRng, type Rng } from '../../core/rng';
import { parseLevelGeometry, type Level3D } from '../../engine/puzzle/grid';
import { replaySolution, solveGeometry, type SolveStep } from '../../engine/puzzle/solver';

/* ================================ 参数 ==================================== */

export const ENDLESS_TUNING = {
  /** 房间基础边长（奇数）与增长节奏 */
  baseSize: 9,
  growthEvery: 5, // 每 5 层长一圈
  growthStep: 2,
  maxSize: 15,
  /** 箱数曲线 */
  chestsBase: 2,
  chestsEvery: 4, // 每 4 层 +1 箱
  maxChests: 4,
  /** 拉箱步数曲线（打散强度） */
  pullsBase: 10,
  pullsPerFloor: 3,
  maxPulls: 42,
  /** 内部柱墙密度（0 = 空房间） */
  wallDensity: 0.1,
  /** 生成尝试次数（含求解校验失败重试） */
  attempts: 6,
} as const;

export interface EndlessFloor {
  readonly id: string;
  readonly floorIndex: number; // 从 1 起
  readonly runSeed: string;
  /** 图例网格（0 地板/1 墙/2 玩家/3 旗/4 箱），与 LevelDef.grid 同构 */
  readonly grid: readonly (readonly TerrainCell[])[];
  /** 最短推数（optimal=true 时有效；-1 = 求解预算内未证最优，可解性不受影响） */
  readonly minPushes: number;
  /** 是否证明了最短推数 */
  readonly optimal: boolean;
  /** 构造解（拉箱逆序）回放实测总步数（走位+推） */
  readonly solutionMoves: number;
  /** 构造解经实机引擎逐格回放验证通过（可解性的最终闸门） */
  readonly verified: boolean;
  /** 生成期实际完成的拉箱步数 */
  readonly pulls: number;
  /** 使用的尝试序号（可观测性） */
  readonly attempt: number;
}

export type EndlessFloorResult =
  | { readonly ok: true; readonly floor: EndlessFloor }
  | { readonly ok: false; readonly error: string };

/* ================================ 生成 ==================================== */

interface ScrambleState {
  readonly walls: ReadonlySet<string>;
  readonly player: Vec2;
  readonly chests: readonly Vec2[]; // 与 goals 等长；生成结束时即最终箱位
  readonly goals: readonly Vec2[];
  readonly width: number;
  readonly height: number;
}

const key = (p: Vec2): string => `${p.x},${p.y}`;

function inBounds(state: ScrambleState, p: Vec2): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < state.width && p.y < state.height;
}

function passable(state: ScrambleState, p: Vec2): boolean {
  return inBounds(state, p) && !state.walls.has(key(p));
}

function chestAt(state: ScrambleState, p: Vec2): boolean {
  return state.chests.some((c) => c.x === p.x && c.y === p.y);
}

/** 一次合法拉箱：玩家在 P，箱子在 P+d；玩家退到 P−d，箱子跟到 P */
function tryPull(state: ScrambleState, rng: Rng, dirs: readonly Dir[]): ScrambleState | undefined {
  const candidates: { readonly chest: Vec2; readonly dir: Dir }[] = [];
  for (const dir of dirs) {
    const d = DIR_VECTORS[dir];
    const chestPos = { x: state.player.x + d.x, y: state.player.y + d.y };
    const back = { x: state.player.x - d.x, y: state.player.y - d.y };
    if (!chestAt(state, chestPos)) continue;
    if (!passable(state, back) || chestAt(state, back)) continue;
    candidates.push({ chest: chestPos, dir });
  }
  if (candidates.length === 0) return undefined;
  const pick = rng.pick(candidates);
  const d = DIR_VECTORS[pick.dir];
  const nextPlayer = { x: state.player.x - d.x, y: state.player.y - d.y };
  const chests = state.chests.map((c) =>
    c.x === pick.chest.x && c.y === pick.chest.y ? { x: state.player.x, y: state.player.y } : c,
  );
  return { ...state, player: nextPlayer, chests };
}

/** 玩家随机走一步（不推箱），返回新状态；无处可走返回 undefined */
function tryWander(state: ScrambleState, rng: Rng, dirs: readonly Dir[]): ScrambleState | undefined {
  const options: Vec2[] = [];
  for (const dir of dirs) {
    const d = DIR_VECTORS[dir];
    const next = { x: state.player.x + d.x, y: state.player.y + d.y };
    if (passable(state, next) && !chestAt(state, next)) options.push(next);
  }
  if (options.length === 0) return undefined;
  return { ...state, player: rng.pick(options) };
}

/** 一次拉箱的记录：拉箱前玩家位置与方向（箱子在 playerBefore + dir） */
interface PullRecord {
  readonly playerBefore: Vec2;
  readonly dir: Dir;
}

/**
 * 逆向散箱：K 次拉箱（间隙穿插走位），返回散箱后的状态、实际拉箱数与拉箱轨迹。
 * A3-3①：原循环只受「连续 idle < 64」约束——玩家 wander 一直成功时 idle 恒为 0，
 * 而 pulls 又可能长期不增长（拉不动的局面），循环没有全局终点（实测同一种子
 * >200s 不返回）。补全局迭代上限 maxTicks = pullsWanted × 64：达到上限即视作
 * 「本轮打散不足」交由 attempt 循环按 pulls 门槛重试，任何调用都有界返回。
 * A3-3②：停机条件在「拉满 K 次」之上追加「净态」（箱子全部离旗、玩家不在
 * 旗上）——图例网格一格一值，旗格被实体占据就无法在 parse 层表达「旗」与
 * 「实体」，箱=旗不变量必被破坏。净态达成后循环才停；未能达成（ticks 上限）
 * 则由 attempt 循环的旗位重叠拒绝兜底换种子重试。
 */
const SCRAMBLE_MAX_TICK_FACTOR = 64;

function scramble(
  initial: ScrambleState,
  rng: Rng,
  pullsWanted: number,
): { readonly state: ScrambleState; readonly pulls: number; readonly records: readonly PullRecord[] } {
  const dirs: readonly Dir[] = ['up', 'down', 'left', 'right'];
  let state = initial;
  let pulls = 0;
  let idle = 0;
  let ticks = 0;
  const maxTicks = Math.max(pullsWanted, 1) * SCRAMBLE_MAX_TICK_FACTOR;
  const records: PullRecord[] = [];
  const onGoal = (p: Vec2): boolean => state.goals.some((gp) => gp.x === p.x && gp.y === p.y);
  const dirty = (): boolean =>
    pulls < pullsWanted || onGoal(state.player) || state.chests.some(onGoal);
  while (dirty() && idle < 64 && ticks < maxTicks) {
    ticks += 1;
    const pulled = tryPull(state, rng, dirs);
    if (pulled !== undefined) {
      // 记录拉箱前的玩家位；箱子在 playerBefore + dir（dir 由玩家退步方向反推）
      records.push({ playerBefore: state.player, dir: pulledDir(state.player, pulled.player) });
      state = pulled;
      pulls += 1;
      idle = 0;
      continue;
    }
    const wandered = tryWander(state, rng, dirs);
    if (wandered === undefined) {
      idle += 1;
      continue;
    }
    state = wandered;
  }
  return { state, pulls, records };
}

/** 由拉箱前后玩家位推断拉箱方向（玩家向 -dir 退了一步） */
function pulledDir(before: Vec2, after: Vec2): Dir {
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  if (dx === 1) return 'left';
  if (dx === -1) return 'right';
  if (dy === 1) return 'up';
  return 'down';
}

/**
 * 图例网格合成（旗位 = 初始箱位；玩家/箱子取散箱后的位置）。
 * 图例一格一值（0/1/2/3/4），此处互斥赋值的正确性由 attempt 循环的
 * 「旗位/实体重叠拒绝」（A3-3②）保证：进入本函数时玩家/箱子绝不压旗格，
 * 故「箱数 = 旗数」的 parse 不变量恒成立。
 */
function synthesizeGrid(state: ScrambleState): TerrainCell[][] {
  const goalKeys = new Set(state.goals.map(key));
  const rows: TerrainCell[][] = [];
  for (let y = 0; y < state.height; y++) {
    const row: TerrainCell[] = [];
    for (let x = 0; x < state.width; x++) {
      const p = { x, y };
      let cell: TerrainCell = state.walls.has(key(p)) ? 1 : 0;
      if (cell === 0) {
        if (state.player.x === x && state.player.y === y) cell = 2;
        else if (state.chests.some((c) => c.x === x && c.y === y)) cell = 4;
        else if (goalKeys.has(key(p))) cell = 3;
      }
      row.push(cell);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 生成一层无尽回廊：随机布局 → 全箱就位 → 逆向散箱 → solver 求解 + 回放验证。
 * 任一尝试失败（拉箱不足 / 旗位重叠 / 求解超时 / 回放失败）则换派生子种子
 * 重试；attempts 用尽返回 ok:false（绝不静默放行未验证层）。A3-3③：解析/
 * 回放是「理论上不该发生」的系统性失败（净态散箱 + 重叠拒绝之后解析必过），
 * 同因连续 3 次即提前短路——不再空烧剩余尝试；打散/重叠属采样波动，交给
 * 重试机制本身，不做早停（避免把高概率采样失败误判成系统性失败）。
 */
export function generateEndlessFloor(runSeed: string, floorIndex: number): EndlessFloorResult {
  const t = ENDLESS_TUNING;
  const growth = Math.floor(Math.max(0, floorIndex - 1) / t.growthEvery) * t.growthStep;
  const size = Math.min(t.maxSize, t.baseSize + growth);
  const chestCount = Math.min(t.maxChests, t.chestsBase + Math.floor(Math.max(0, floorIndex - 1) / t.chestsEvery));
  const pullsWanted = Math.min(t.maxPulls, t.pullsBase + t.pullsPerFloor * Math.max(0, floorIndex - 1));

  // A3-3③：系统性失败（解析/回放）连续计数，≥3 短路
  let systemicStreak = 0;
  let systemicReason: string | null = null;
  let lastSamplingReason: string | null = null;
  const failSystemic = (reason: string): boolean => {
    if (reason === systemicReason) systemicStreak += 1;
    else {
      systemicReason = reason;
      systemicStreak = 1;
    }
    return systemicStreak >= 3;
  };
  const failSampling = (reason: string): void => {
    lastSamplingReason = reason;
  };

  for (let attempt = 1; attempt <= t.attempts; attempt++) {
    const rng = createRng(`endless:${runSeed}:f${floorIndex}:a${attempt}`);

    // 1. 布局：外圈墙 + 内部稀疏柱墙
    const walls = new Set<string>();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        if (border) walls.add(`${x},${y}`);
        else if (rng.chance(t.wallDensity)) walls.add(`${x},${y}`);
      }
    }
    const freeCells: Vec2[] = [];
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        if (!walls.has(`${x},${y}`)) freeCells.push({ x, y });
      }
    }
    if (freeCells.length < chestCount * 3 + 4) {
      failSampling('布局过挤（可用格不足）');
      continue; // 太挤，重试
    }

    // 2. 全箱就位：随机挑 chestCount 个格作旗位并放箱；玩家另取一格
    const shuffled = [...freeCells];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const a = shuffled[i];
      const b = shuffled[j];
      if (a === undefined || b === undefined) continue;
      shuffled[i] = b;
      shuffled[j] = a;
    }
    const goals = shuffled.slice(0, chestCount);
    const rest = shuffled.slice(chestCount);
    const playerStart = rest[0];
    if (playerStart === undefined) {
      failSampling('无可用出生格');
      continue;
    }
    const initial: ScrambleState = {
      walls,
      player: playerStart,
      chests: goals.map((p) => ({ x: p.x, y: p.y })),
      goals,
      width: size,
      height: size,
    };

    // 3. 逆向散箱（记录拉箱轨迹，其逆序即一组合法推箱解）：停机即净态
    const { state, pulls, records } = scramble(initial, rng, pullsWanted);
    if (pulls < Math.ceil(pullsWanted / 2)) {
      failSampling(`打散不足（${pulls}/${Math.ceil(pullsWanted / 2)} 拉箱）`);
      continue; // 打散不足，重试
    }

    // 3.5 旗位/实体重叠拒绝（A3-3② 兜底闸门）：散箱通常已达成净态（箱子全离
    // 旗、玩家不在旗），此处只在 ticks 上限截断的病态采样下才会命中。图例
    // 一格一值——旗格被实体占据时无法同时表达「旗(3)」与「实体(2/4)」，解析
    // 的「箱数=旗数+有玩家」不变量必被破坏；构造解只要求「拉箱序列的逆」可
    // 回放，换一次采样不损失任何语义，绝不合成不可解析的网格。
    const onGoal = (p: Vec2): boolean => goals.some((gp) => gp.x === p.x && gp.y === p.y);
    const overlap =
      onGoal(state.player) || state.chests.some(onGoal) ||
      state.chests.some((c) => c.x === state.player.x && c.y === state.player.y);
    if (overlap) {
      failSampling('旗位与玩家/箱子重叠');
      continue;
    }

    // 4. 合成图例网格 → 解析 → 构造解回放验证（硬闸门）→ 推数标注（软标注）
    const grid = synthesizeGrid(state);
    const def: Level3D = {
      id: `endless-${runSeed}-f${floorIndex}`,
      area: 'domain-3',
      name: `无尽回廊 · 第 ${floorIndex} 层`,
      subtitle: '程序生成 + 求解器验证的挑战层',
      grid,
      parSteps: [1, 1],
      reward: { starStones: 0 },
    };
    const parsed = parseLevelGeometry(def);
    if (!parsed.ok) {
      if (failSystemic(`网格解析失败：${parsed.error}`)) break;
      continue;
    }

    // 拉箱序列的逆 = 一组合法推箱解（构造性可解）；用实机引擎逐格回放验证
    const pushSteps: readonly SolveStep[] = [...records]
      .reverse()
      .map((rec) => {
        const d = DIR_VECTORS[rec.dir];
        return {
          dir: rec.dir,
          stand: { x: rec.playerBefore.x - d.x, y: rec.playerBefore.y - d.y },
          kind: 'chest',
          from: { x: rec.playerBefore.x, y: rec.playerBefore.y },
          to: { x: rec.playerBefore.x + d.x, y: rec.playerBefore.y + d.y },
          isFall: false,
        } satisfies SolveStep;
      });
    const replay = replaySolution(parsed.geometry, pushSteps);
    if (!replay.ok) {
      if (failSystemic(`构造解回放失败：${replay.error ?? ''}`)) break;
      continue;
    }

    // 最短推数标注：小预算求解，超时则如实标注 optimal=false
    const solved = solveGeometry(parsed.geometry, { maxStates: 150_000, maxMs: 4_000 });

    return {
      ok: true,
      floor: {
        id: def.id,
        floorIndex,
        runSeed,
        grid,
        minPushes: solved.optimal ? solved.minPushes : -1,
        optimal: solved.optimal,
        solutionMoves: replay.moves,
        verified: true,
        pulls,
        attempt,
      },
    };
  }
  const reason =
    systemicReason !== null && systemicStreak >= 3
      ? `同一系统性失败原因连续出现，提前短路：${systemicReason}`
      : `${ENDLESS_TUNING.attempts} 次尝试均未通过校验${lastSamplingReason !== null ? `（末次原因：${lastSamplingReason}）` : ''}`;
  return { ok: false, error: `无尽回廊生成失败：runSeed=${runSeed} floor=${floorIndex}（${reason}）` };
}

/** 一整段无尽回廊（连续 floorCount 层，层层独立验证） */
export function generateEndlessRun(runSeed: string, floorCount: number): readonly EndlessFloorResult[] {
  const results: EndlessFloorResult[] = [];
  for (let i = 1; i <= floorCount; i++) {
    results.push(generateEndlessFloor(runSeed, i));
  }
  return results;
}

/** 转成 store 可直接消费的 Level3D（parSteps 由实测解路标定；area 暂记 domain-3，
 *  集成期可为 core 增设 'endless' AreaId） */
export function floorAsLevel(floor: EndlessFloor): Level3D {
  const par1 = Math.max(1, floor.solutionMoves);
  return {
    id: floor.id,
    area: 'domain-3',
    name: `无尽回廊 · 第 ${floor.floorIndex} 层`,
    subtitle: `${floor.runSeed} 种子 · 最短推数 ${floor.minPushes} · 生成拉箱 ${floor.pulls} 次`,
    grid: floor.grid,
    parSteps: [par1, Math.ceil(par1 * 1.5)],
    reward: { starStones: 60 + floor.floorIndex * 20 },
  };
}
