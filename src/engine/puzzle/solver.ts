/**
 * puzzle/solver —— BFS/A* 求解校验 + 最短推数。
 * ---------------------------------------------------------------------------
 * 兑现 mapGenerator.js 文件名从未兑现的承诺（ST6：关卡可解性未验证）：
 *   - 两阶段搜索：先按「推数」跑 A*（启发式 = 各箱到最近旗位的推距下界之和，
 *     可采纳且一致 ⇒ 推数最优）；预算内无解时降级为加权贪心（f = g + 5h），
 *     只求「找到一条可回放的解」并如实标注 optimal:false；
 *   - 宏移动建模：玩家可达域泛化（同一连通分量内的站位等价），
 *     状态 = 箱位集合 + 玩家连通分量最小格；可达域在生成期算一次并缓存，
 *     展开期直接复用；
 *   - 高度语义与 move.ts 完全一致（爬升 ≤1、落差 ≥2 箱落）；
 *   - 剪枝数据与 deadlock.ts 同源（推距图：∞ 格 = 静态死角；2×2 冻结块）；
 *   - 求出的解路用 move.resolvePlayerAction 逐格回放验证——solver 与实机
 *     引擎若不一致，离线校验当场爆掉，不会静默放行坏关卡。
 *
 * 范围：solver 只支持标准规则（pushRange=1、无拉箱/斜推/穿行），
 * 并完整建模关卡数据过滤器（MECH-4）：goalOrder 旗位顺序闸（箱子入清单旗格
 * 必须按「已就位前缀」依次落座，乱序后继直接剪枝）与 oneWay 单向阀
 * （玩家可达域按阀向有向化、推完落格同样过闸；箱子不受限）——机制进引擎
 * 解路自动合法，同一 solver 供给 genSolutionSteps 预计算。
 * 主线关卡的硬门槛是「零法则可解」；法则卡只做评分加成（fusionPlan 约定）。
 * Date.now 仅用于离线求解预算（本模块是工具函数，不进游戏状态机）。
 */

import type { Dir, GridEntity, Vec2 } from '../../core/types';
import { DIR_VECTORS } from '../../core/types';
import { cellAt, isWall } from '../../core/gridMove';
import { CLIMB_LIMIT, FALL_DROP, isSolved, parseLevelGeometry, playerMayEnter, type Level3D, type LevelGeometry } from './grid';
import { DEFAULT_PUZZLE_RULE_SET, type PuzzleRuleSet } from './rules';
import { computePushDistanceMap } from './deadlock';
import { resolvePlayerAction, type TurnContext } from './move';

/* ================================ 结果类型 ================================ */

export interface SolveStep {
  readonly dir: Dir;
  /** 玩家发力站位（推之前所在格） */
  readonly stand: Vec2;
  /** 被推实体类型：箱（可推落压碎敌人）/ 敌（可推、质量 1） */
  readonly kind: 'chest' | 'enemy';
  readonly from: Vec2;
  readonly to: Vec2;
  readonly isFall: boolean;
}

export interface SolveResult {
  readonly solvable: boolean;
  readonly timeout: boolean;
  /** 规则超出 solver 支持范围（如 pushRange>1） */
  readonly unsupported: boolean;
  /** 最短推数（仅 optimal 时有值；否则 -1） */
  readonly minPushes: number;
  /** 是否证明了推数最优 */
  readonly optimal: boolean;
  /** 解路总步数（走位+推；回放解路的上界，非全局最短步数） */
  readonly solutionMoves: number;
  readonly steps: readonly SolveStep[];
  readonly statesExplored: number;
  readonly error?: string;
}

export interface SolveOptions {
  /** 最优阶段状态展开上限（默认 900k） */
  readonly maxStates?: number;
  /** 最优阶段预算毫秒（默认 30000） */
  readonly maxMs?: number;
  /** 离线工具旋钮：跳过最优阶段直接贪心（仅用于超大关卡的探测，勿在游戏内使用） */
  readonly skipOptimalPhase?: boolean;
}

const EMPTY_SOLVE: SolveResult = Object.freeze({
  solvable: false,
  timeout: false,
  unsupported: false,
  minPushes: -1,
  optimal: false,
  solutionMoves: -1,
  steps: [],
  statesExplored: 0,
});

/** solver 是否支持该规则集（只支持标准推箱语义） */
export function solverSupports(rules: PuzzleRuleSet): boolean {
  return (
    Math.round(rules.pushRange) === 1 &&
    !rules.pullEnabled &&
    !rules.diagonalPushEnabled &&
    !rules.phaseWalkEnabled
  );
}

/* ============================ A* 求解（推数最优） ========================== */

const DIR_ORDER: readonly Dir[] = ['up', 'down', 'left', 'right'];

interface HeapNode {
  readonly f: number;
  readonly g: number;
  readonly key: string;
}

/** 小顶二叉堆（确定性序：f → g（贪心阶段同分优先深层）→ key） */
class MinHeap {
  private a: HeapNode[] = [];
  private readonly preferDeeper: boolean;

  constructor(preferDeeper = false) {
    this.preferDeeper = preferDeeper;
  }

  get size(): number {
    return this.a.length;
  }

  push(node: HeapNode): void {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const parent = a[p];
      const cur = a[i];
      if (parent === undefined || cur === undefined) break;
      if (this.less(cur, parent)) {
        a[p] = cur;
        a[i] = parent;
        i = p;
      } else break;
    }
  }

  pop(): HeapNode | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length) {
          const lm = a[l];
          const mm = a[m];
          if (lm !== undefined && mm !== undefined && this.less(lm, mm)) m = l;
        }
        if (r < a.length) {
          const rm = a[r];
          const mm = a[m];
          if (rm !== undefined && mm !== undefined && this.less(rm, mm)) m = r;
        }
        if (m === i) break;
        const mi = a[m];
        const ii = a[i];
        if (mi === undefined || ii === undefined) break;
        a[m] = ii;
        a[i] = mi;
        i = m;
      }
    }
    return top;
  }

  private less(x: HeapNode, y: HeapNode): boolean {
    if (x.f !== y.f) return x.f < y.f;
    if (x.g !== y.g) return this.preferDeeper ? x.g > y.g : x.g < y.g;
    return x.key < y.key;
  }
}

interface StateRec {
  readonly chests: readonly number[]; // 升序格索引
  readonly enemies: readonly number[]; // 升序格索引（可推、可被箱落压碎）
  readonly root: number; // 玩家连通分量最小格索引
}

interface ParentRec {
  readonly prevKey: string;
  readonly step: SolveStep;
}

interface SearchOutcome {
  readonly found: boolean;
  readonly timeout: boolean;
  readonly goalKey: string | null;
  readonly startKey: string;
  readonly explored: number;
}

export function solveGeometry(
  geometry: LevelGeometry,
  options: SolveOptions = {},
): SolveResult {
  const maxStates = options.maxStates ?? 900_000;
  const maxMs = options.maxMs ?? 30_000;

  if (!solverSupports(DEFAULT_PUZZLE_RULE_SET)) {
    return { ...EMPTY_SOLVE, unsupported: true, error: 'solver 基准规则集不被支持（不应发生）' };
  }

  const W = geometry.width;
  const H = geometry.height;
  const N = W * H;
  const idx = (x: number, y: number): number => y * W + x;
  const xy = (i: number): Vec2 => ({ x: i % W, y: Math.floor(i / W) });

  // 静态层预计算（阳面基准；阴面是捷径/挑战层，不入 solver）
  const passable = new Uint8Array(N);
  const heightArr = new Int16Array(N);
  const goalSet = new Set<number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const cell = cellAt(geometry.terrain, x, y);
      heightArr[i] = geometry.heights[y]?.[x] ?? 0;
      if (cell.ok && !isWall(cell.value)) {
        passable[i] = 1;
        if (cell.value === 3) goalSet.add(i);
      }
    }
  }
  for (const g of geometry.goals) goalSet.add(idx(g.x, g.y));

  // 非可推静态实体（祭坛）视作不可通行：与实机占位一致（solver 投影不得漏掉建筑障碍）
  for (const a of geometry.altarSpawns) {
    const ai = idx(a.x, a.y);
    if (ai >= 0 && ai < N) passable[ai] = 0;
  }

  // ---- MECH-4 数据过滤器预计算（与 move.ts 同一语义）----
  // 单向阀：格索引 → 允许进入的方向；玩家可达域与推完落格都过此闸（箱不受限）
  const oneWayAllow = new Map<number, Dir>();
  for (const gate of geometry.oneWay) {
    if (gate.cell.x < 0 || gate.cell.y < 0 || gate.cell.x >= W || gate.cell.y >= H) continue;
    oneWayAllow.set(idx(gate.cell.x, gate.cell.y), gate.allow);
  }
  // 旗位顺序闸：清单旗格的格索引；箱子入格必须与「已就位前缀」对位（乱序后继剪枝）
  const orderCells = geometry.goalOrder.map((c) => idx(c.x, c.y));

  // 推距图（与 deadlock 同源）：∞ = 死角格；同时充当 A* 启发式
  const distMap = computePushDistanceMap(geometry);

  const chests0 = geometry.chestSpawns.map((c) => idx(c.x, c.y)).sort((a, b) => a - b);
  const enemies0 = geometry.enemySpawns.map((c) => idx(c.x, c.y)).sort((a, b) => a - b);
  const player0 = idx(geometry.playerSpawn.x, geometry.playerSpawn.y);

  // ---- 零分配热路径缓冲（时间戳代际复用，消灭每状态数组分配的 GC 压力）----
  const reachStamp = new Int32Array(N);
  const blockStamp = new Int32Array(N);
  const chestMark = new Int32Array(N);
  const enemyMark = new Int32Array(N);
  const curVisited = new Uint8Array(N);
  const bfsQueue = new Int32Array(N + 1);
  let stampGen = 0;

  /**
   * 玩家可达域：箱子/敌人视为障碍；走位高度语义与实机一致（爬升 ≤1，下降不限）；
   * 进入邻格受单向阀约束（MECH-4：阀格只允许 allow 方向进入，有向边）。
   * 返回本次代际号——reachStamp[i] === gen 即格 i 可达。
   */
  const reach = (blocked: readonly number[], from: number): { gen: number; root: number } => {
    stampGen += 1;
    const gen = stampGen;
    for (const c of blocked) blockStamp[c] = gen;
    let head = 0;
    let tail = 0;
    bfsQueue[tail++] = from;
    reachStamp[from] = gen;
    let root = from;
    while (head < tail) {
      const cur = bfsQueue[head++] ?? 0;
      if (cur < root) root = cur;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const dir of DIR_ORDER) {
        const d = DIR_VECTORS[dir];
        const nx = cx + d.x;
        const ny = cy + d.y;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny);
        if (reachStamp[ni] === gen || blockStamp[ni] === gen || passable[ni] === 0) continue;
        const allow = oneWayAllow.get(ni);
        if (allow !== undefined && allow !== dir) continue; // 单向阀逆向/侧向进入被拒
        if ((heightArr[ni] ?? 0) - (heightArr[cur] ?? 0) > CLIMB_LIMIT) continue;
        reachStamp[ni] = gen;
        bfsQueue[tail++] = ni;
      }
    }
    return { gen, root };
  };

  /** 状态键：root + 升序箱位 + 分隔符 0 + 升序敌位，打包为 UTF-16 串（格索引 < 65535 恒成立） */
  const stateKey = (root: number, chests: readonly number[], enemies: readonly number[]): string =>
    String.fromCharCode(root + 1, ...chests.map((c) => c + 1), 0, ...enemies.map((e) => e + 1));

  const chestsOnGoal = (chests: readonly number[]): number => chests.reduce((n, c) => n + (goalSet.has(c) ? 1 : 0), 0);
  const heuristic = (chests: readonly number[]): number => {
    let sum = 0;
    for (const c of chests) {
      const d = distMap[c] ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(d)) return Number.POSITIVE_INFINITY;
      sum += d;
    }
    return sum;
  };

  /**
   * 冻结剪枝：推到 t 后，若某 2×2 块被墙/箱填满且有未就位箱 → 死局。
   * 箱子成员资格由展开期 chestMark 盖戳（gen）判定，但需排除刚腾空的 ci
   * （其戳来自当前局）并单独纳入刚推入的 t（尚无戳）。
   */
  const frozenAfterPush = (t: number, vacated: number, gen: number): boolean => {
    const isBlocking = (i: number): boolean =>
      passable[i] === 0 || i === t || (chestMark[i] === gen && i !== vacated);
    const tx = t % W;
    const ty = (t - tx) / W;
    const offs: readonly Vec2[] = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: -1 },
    ];
    for (const off of offs) {
      const ox = tx + off.x;
      const oy = ty + off.y;
      if (ox < 0 || oy < 0 || ox + 1 >= W || oy + 1 >= H) continue;
      const c0 = idx(ox, oy);
      const c1 = idx(ox + 1, oy);
      const c2 = idx(ox, oy + 1);
      const c3 = idx(ox + 1, oy + 1);
      if (!(isBlocking(c0) && isBlocking(c1) && isBlocking(c2) && isBlocking(c3))) continue;
      const offGoalOffGoal =
        ((chestMark[c0] === gen || c0 === t) && c0 !== vacated && !goalSet.has(c0)) ||
        ((chestMark[c1] === gen || c1 === t) && c1 !== vacated && !goalSet.has(c1)) ||
        ((chestMark[c2] === gen || c2 === t) && c2 !== vacated && !goalSet.has(c2)) ||
        ((chestMark[c3] === gen || c3 === t) && c3 !== vacated && !goalSet.has(c3));
      if (offGoalOffGoal) return true;
    }
    return false;
  };

  const h0 = heuristic(chests0);
  if (!Number.isFinite(h0)) {
    return { ...EMPTY_SOLVE, error: '存在出生即死角（推距 ∞）的箱子，无可解路径' };
  }

  /**
   * 统一搜索核心。f = gWeight·g + hWeight·h：
   *   (1,1) = 最优 A*；(0,1) + preferDeeper = 纯贪心最佳优先（不保证最优，但极快找到解）。
   * skipOptimalPhase 为离线工具旋钮：已证明最优无望的大关卡可直接进贪心。
   */
  const search = (
    gWeight: number,
    hWeight: number,
    preferDeeper: boolean,
    budgetStates: number,
    budgetMs: number,
  ): { outcome: SearchOutcome; bestG: Map<string, number>; parents: Map<string, ParentRec> } => {
    const start = reach([...chests0, ...enemies0], player0);
    const startKey = stateKey(start.root, chests0, enemies0);
    const bestG = new Map<string, number>([[startKey, 0]]);
    const parents = new Map<string, ParentRec>();
    const recs = new Map<string, StateRec>([[startKey, { chests: chests0, enemies: enemies0, root: start.root }]]);
    const open = new MinHeap(preferDeeper);
    open.push({ f: hWeight * h0, g: 0, key: startKey });

    let explored = 0;
    const deadline = Date.now() + budgetMs;
    while (open.size > 0) {
      const node = open.pop();
      if (node === undefined) break;
      const g = bestG.get(node.key);
      if (g === undefined || node.g > g) continue; // 过期堆项
      const rec = recs.get(node.key);
      if (rec === undefined) continue;
      explored++;
      if (explored > budgetStates || Date.now() > deadline) {
        return { outcome: { found: false, timeout: true, goalKey: null, startKey, explored }, bestG, parents };
      }

      if (chestsOnGoal(rec.chests) === rec.chests.length) {
        return { outcome: { found: true, timeout: false, goalKey: node.key, startKey, explored }, bestG, parents };
      }

      // 展开期重算可达域：先把结果快照进普通数组（后继的 reach 会推进代际号，
      // 不能直接引用时戳），再给本局箱子/敌人盖成员戳供占位与冻结检查复用
      const { gen: curGen } = reach([...rec.chests, ...rec.enemies], rec.root);
      for (let i = 0; i < N; i++) curVisited[i] = reachStamp[i] === curGen ? 1 : 0;
      for (const ci of rec.chests) chestMark[ci] = curGen;
      for (const ei of rec.enemies) enemyMark[ei] = curGen;

      // ---- 推箱：落箱可压碎落点敌人 ----
      for (const ci of rec.chests) {
        const cx = ci % W;
        const cy = (ci - cx) / W;
        for (const dir of DIR_ORDER) {
          const d = DIR_VECTORS[dir];
          const sx = cx - d.x;
          const sy = cy - d.y;
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          const si = idx(sx, sy);
          if (curVisited[si] === 0) continue; // 玩家够不到发力位
          const landAllow = oneWayAllow.get(ci);
          if (landAllow !== undefined && landAllow !== dir) continue; // 推完玩家落箱原格，须过单向阀
          const tx = cx + d.x;
          const ty = cy + d.y;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const ti = idx(tx, ty);
          if (passable[ti] === 0 || chestMark[ti] === curGen) continue; // 墙/箱子（箱子不可被压碎）

          const hC = heightArr[ci] ?? 0;
          const hT = heightArr[ti] ?? 0;
          const hS = heightArr[si] ?? 0;
          if (hT - hC > CLIMB_LIMIT) continue; // 推不上
          if (hC - hS > CLIMB_LIMIT) continue; // 玩家上不了发力邻格（与实机一致）
          const isFall = hC - hT >= FALL_DROP;
          const targetEnemy = enemyMark[ti] === curGen;
          // 平推入敌人 → 链超限（pushRange=1，箱后不能再跟敌）；箱落则压碎移除敌人
          if (!isFall && targetEnemy) continue;
          if (!Number.isFinite(distMap[ti] ?? Number.POSITIVE_INFINITY) && !goalSet.has(ti)) continue; // 静态死角

          // 旗位顺序闸（MECH-4）：入清单旗格必须对位「已就位前缀」——
          // 前缀由动作前箱位派生（含被推箱 ci：沿序推进亦合法），乱序后继直接剪枝
          if (orderCells.length > 0) {
            const at = orderCells.indexOf(ti);
            if (at !== -1) {
              let prefix = 0;
              for (;;) {
                const oc = orderCells[prefix];
                if (oc === undefined || !rec.chests.includes(oc)) break;
                prefix += 1;
              }
              if (at !== prefix) continue;
            }
          }

          const nextEnemies = isFall && targetEnemy ? rec.enemies.filter((e) => e !== ti) : rec.enemies;
          const nextChests = rec.chests.filter((c) => c !== ci).concat(ti).sort((a, b) => a - b);
          if (frozenAfterPush(ti, ci, curGen)) continue;

          const nextReach = reach([...nextChests, ...nextEnemies], ci); // 推完玩家站在箱子原格 ci
          const nextKey = stateKey(nextReach.root, nextChests, nextEnemies);
          const ng = g + 1;
          const known = bestG.get(nextKey);
          if (known !== undefined && known <= ng) continue;
          bestG.set(nextKey, ng);
          recs.set(nextKey, { chests: nextChests, enemies: nextEnemies, root: nextReach.root });
          parents.set(nextKey, {
            prevKey: node.key,
            step: { dir, stand: xy(si), kind: 'chest', from: xy(ci), to: xy(ti), isFall },
          });
          const nh = heuristic(nextChests);
          const hSafe = Number.isFinite(nh) ? nh : 64;
          open.push({ f: gWeight * ng + hWeight * hSafe, g: ng, key: nextKey });
        }
      }

      // ---- 推敌：敌人可被推开（质量 1，不可落箱、不进目标判定） ----
      for (const ei of rec.enemies) {
        const ex = ei % W;
        const ey = (ei - ex) / W;
        for (const dir of DIR_ORDER) {
          const d = DIR_VECTORS[dir];
          const sx = ex - d.x;
          const sy = ey - d.y;
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          const si = idx(sx, sy);
          if (curVisited[si] === 0) continue;
          const landAllow = oneWayAllow.get(ei);
          if (landAllow !== undefined && landAllow !== dir) continue; // 推完玩家落敌原格，须过单向阀
          const tx = ex + d.x;
          const ty = ey + d.y;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const ti = idx(tx, ty);
          if (passable[ti] === 0 || chestMark[ti] === curGen || enemyMark[ti] === curGen) continue;

          const hE = heightArr[ei] ?? 0;
          const hT = heightArr[ti] ?? 0;
          const hS = heightArr[si] ?? 0;
          if (hT - hE > CLIMB_LIMIT) continue; // 推不上
          if (hE - hS > CLIMB_LIMIT) continue; // 玩家上不了发力邻格

          const nextEnemies = rec.enemies.filter((e) => e !== ei).concat(ti).sort((a, b) => a - b);
          const nextReach = reach([...rec.chests, ...nextEnemies], ei); // 推完玩家站在敌人原格 ei
          const nextKey = stateKey(nextReach.root, rec.chests, nextEnemies);
          const ng = g + 1;
          const known = bestG.get(nextKey);
          if (known !== undefined && known <= ng) continue;
          bestG.set(nextKey, ng);
          recs.set(nextKey, { chests: rec.chests, enemies: nextEnemies, root: nextReach.root });
          parents.set(nextKey, {
            prevKey: node.key,
            step: { dir, stand: xy(si), kind: 'enemy', from: xy(ei), to: xy(ti), isFall: false },
          });
          const nh = heuristic(rec.chests);
          const hSafe = Number.isFinite(nh) ? nh : 64;
          open.push({ f: gWeight * ng + hWeight * hSafe, g: ng, key: nextKey });
        }
      }
    }
    return { outcome: { found: false, timeout: false, goalKey: null, startKey, explored }, bestG, parents };
  };

  // 阶段一：最优 A*（可经 skipOptimalPhase 跳过——离线工具旋钮）
  const skipOptimal = options.skipOptimalPhase === true;
  const phase1 = skipOptimal
    ? { outcome: { found: false, timeout: false, goalKey: null, startKey: '', explored: 0 }, bestG: new Map<string, number>(), parents: new Map<string, ParentRec>() }
    : search(1, 1, false, maxStates, maxMs);
  if (phase1.outcome.found && phase1.outcome.goalKey !== null) {
    const steps = reconstruct(phase1.parents, phase1.outcome.goalKey, phase1.outcome.startKey);
    return {
      solvable: true,
      timeout: false,
      unsupported: false,
      minPushes: phase1.bestG.get(phase1.outcome.goalKey) ?? -1,
      optimal: true,
      solutionMoves: estimateSolutionMoves(geometry, steps),
      steps,
      statesExplored: phase1.outcome.explored,
    };
  }

  // 阶段二：纯贪心最佳优先兜底（只求数据真实性：能解但不再号称最优）
  const phase2 = search(0, 1, true, maxStates * 2, maxMs * 2);
  if (phase2.outcome.found && phase2.outcome.goalKey !== null) {
    const steps = reconstruct(phase2.parents, phase2.outcome.goalKey, phase2.outcome.startKey);
    return {
      solvable: true,
      timeout: false,
      unsupported: false,
      minPushes: -1,
      optimal: false,
      solutionMoves: estimateSolutionMoves(geometry, steps),
      steps,
      statesExplored: phase1.outcome.explored + phase2.outcome.explored,
    };
  }

  return {
    ...EMPTY_SOLVE,
    timeout: phase1.outcome.timeout || phase2.outcome.timeout,
    statesExplored: phase1.outcome.explored + phase2.outcome.explored,
    error: phase1.outcome.timeout || phase2.outcome.timeout ? '求解预算超时' : '搜索空间耗尽，无可解路径',
  };
}

/** 回溯堆中父指针，得到从起点到 goalKey 的推箱/推敌序列 */
function reconstruct(parents: Map<string, ParentRec>, goalKey: string, startKey: string): SolveStep[] {
  const steps: SolveStep[] = [];
  let k: string | undefined = goalKey;
  while (k !== undefined && k !== startKey) {
    const p = parents.get(k);
    if (p === undefined) break;
    steps.push(p.step);
    k = p.prevKey;
  }
  return steps.reverse();
}

/* ============================ 解路步数估算 ================================= */

/** 解路总步数估算：走位（BFS 最短路）+ 推（各 1 步） */
function estimateSolutionMoves(geometry: LevelGeometry, steps: readonly SolveStep[]): number {
  const W = geometry.width;
  const H = geometry.height;
  let player = { ...geometry.playerSpawn };
  const chests = geometry.chestSpawns.map((c) => ({ ...c }));
  const enemies = geometry.enemySpawns.map((c) => ({ ...c }));
  const altarKeys = new Set(geometry.altarSpawns.map((a) => `${a.x},${a.y}`));
  let moves = 0;

  const blockedAt = (x: number, y: number): boolean =>
    chests.some((c) => c.x === x && c.y === y) ||
    enemies.some((e) => e.x === x && e.y === y) ||
    altarKeys.has(`${x},${y}`) ||
    (() => {
      const cell = cellAt(geometry.terrain, x, y);
      return !cell.ok || isWall(cell.value);
    })();

  for (const step of steps) {
    const path = walkPath(geometry, blockedAt, player, step.stand, W, H);
    if (path === undefined) return -1;
    moves += path.length;
    if (step.kind === 'chest') {
      const chest = chests.find((c) => c.x === step.from.x && c.y === step.from.y);
      if (chest === undefined) return -1;
      chest.x = step.to.x;
      chest.y = step.to.y;
      if (step.isFall) {
        // 箱落压碎落点敌人（与实机 resolveFallPush 的 crushed 语义一致）
        const crushedIdx = enemies.findIndex((e) => e.x === step.to.x && e.y === step.to.y);
        if (crushedIdx >= 0) enemies.splice(crushedIdx, 1);
      }
    } else {
      const enemy = enemies.find((e) => e.x === step.from.x && e.y === step.from.y);
      if (enemy === undefined) return -1;
      enemy.x = step.to.x;
      enemy.y = step.to.y;
    }
    player = { ...step.from };
    moves += 1;
  }
  return moves;
}

/** 玩家最短走位路径（BFS；返回方向序列，不可达返回 undefined） */
function walkPath(
  geometry: LevelGeometry,
  blockedAt: (x: number, y: number) => boolean,
  from: Vec2,
  to: Vec2,
  W: number,
  H: number,
): readonly Dir[] | undefined {
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x: number, y: number): number => y * W + x;
  const prev = new Map<number, { readonly from: number; readonly dir: Dir }>();
  const queue: number[] = [key(from.x, from.y)];
  const seen = new Set<number>(queue);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    if (cx === to.x && cy === to.y) {
      const dirs: Dir[] = [];
      let k: number | undefined = cur;
      while (k !== undefined && k !== key(from.x, from.y)) {
        const p = prev.get(k);
        if (p === undefined) break;
        dirs.push(p.dir);
        k = p.from;
      }
      return dirs.reverse();
    }
    for (const dir of DIR_ORDER) {
      const d = DIR_VECTORS[dir];
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nk = key(nx, ny);
      if (seen.has(nk) || blockedAt(nx, ny)) continue;
      // 单向阀与实机同闸：阀格只允许 allow 方向进入（回放/演示走位不会规划出逆行步）
      if (!playerMayEnter(geometry, { x: nx, y: ny }, dir)) continue;
      const curH = geometry.heights[cy]?.[cx] ?? 0;
      const nextH = geometry.heights[ny]?.[nx] ?? 0;
      if (nextH - curH > CLIMB_LIMIT) continue;
      seen.add(nk);
      prev.set(nk, { from: cur, dir });
      queue.push(nk);
    }
  }
  return undefined;
}

/**
 * 解路 → 完整按键方向序列（先走到发力位，再推）。
 * 与 replaySolution 同一套走位/实体模拟，供自动演示（autoplay）逐格驱动 store.move。
 * 纯函数；返回的 dirs 从关卡出生点开始回放。
 */
export function solutionMoveDirs(
  geometry: LevelGeometry,
  steps: readonly SolveStep[],
): { readonly ok: true; readonly dirs: readonly Dir[] } | { readonly ok: false; readonly error: string } {
  const rules = DEFAULT_PUZZLE_RULE_SET;
  let player = { ...geometry.playerSpawn };
  let chests = geometry.chestSpawns.map((c) => ({ ...c }));
  let enemies = geometry.enemySpawns.map((c) => ({ ...c }));
  const altarKeys = new Set(geometry.altarSpawns.map((a) => `${a.x},${a.y}`));
  const dirs: Dir[] = [];

  const chestAt = (x: number, y: number): boolean => chests.some((c) => c.x === x && c.y === y);
  const enemyAt = (x: number, y: number): boolean => enemies.some((e) => e.x === x && e.y === y);
  const blockedAt = (x: number, y: number): boolean =>
    chestAt(x, y) ||
    enemyAt(x, y) ||
    altarKeys.has(`${x},${y}`) ||
    (() => {
      const t = geometry.terrain[y]?.[x];
      return t === undefined || t === 1;
    })();

  const ctx: TurnContext = {
    geometry,
    planeShifted: false,
    rules,
    phaseCharges: 0,
    detonationsLeft: 0,
  };

  for (const step of steps) {
    const path = walkPath(geometry, blockedAt, player, step.stand, geometry.width, geometry.height);
    if (path === undefined) return { ok: false, error: `玩家无法走到发力位 (${step.stand.x},${step.stand.y})` };
    for (const dir of path) {
      const r = resolvePlayerAction(ctx, buildEntities(player, chests, enemies, geometry.altarSpawns), player, { type: 'move', dir });
      if (!r.ok) return { ok: false, error: `走位失败：${dir} @ (${player.x},${player.y}) → ${r.reason}` };
      const p = r.entities.find((e) => e.kind === 'player');
      if (p === undefined) return { ok: false, error: '走位后玩家丢失' };
      player = { x: p.x, y: p.y };
      chests = r.entities.filter((e) => e.kind === 'chest').map((e) => ({ x: e.x, y: e.y }));
      enemies = r.entities.filter((e) => e.kind === 'enemy').map((e) => ({ x: e.x, y: e.y }));
      dirs.push(dir);
    }
    const r2 = resolvePlayerAction(ctx, buildEntities(player, chests, enemies, geometry.altarSpawns), player, { type: 'move', dir: step.dir });
    if (!r2.ok) return { ok: false, error: `推动失败：${step.dir} @ (${player.x},${player.y}) → ${r2.reason}` };
    const p2 = r2.entities.find((e) => e.kind === 'player');
    if (p2 === undefined) return { ok: false, error: '推动后玩家丢失' };
    player = { x: p2.x, y: p2.y };
    chests = r2.entities.filter((e) => e.kind === 'chest').map((e) => ({ x: e.x, y: e.y }));
    enemies = r2.entities.filter((e) => e.kind === 'enemy').map((e) => ({ x: e.x, y: e.y }));
    dirs.push(step.dir);
  }

  return { ok: true, dirs };
}

/**
 * 从当前玩家位置走到目标格的最短方向序列（只走位、不推）。
 * 供自动演示按「当前位置」逐步重规划：剧情/战斗打断后也能自愈。
 */
export function walkDirs(
  geometry: LevelGeometry,
  player: Vec2,
  blockedPoints: readonly Vec2[],
  target: Vec2,
): { readonly ok: true; readonly dirs: readonly Dir[] } | { readonly ok: false; readonly error: string } {
  const blockedKeys = new Set(blockedPoints.map((p) => `${p.x},${p.y}`));
  const blockedAt = (x: number, y: number): boolean => {
    if (blockedKeys.has(`${x},${y}`)) return true;
    const t = geometry.terrain[y]?.[x];
    return t === undefined || t === 1;
  };
  const path = walkPath(geometry, blockedAt, player, target, geometry.width, geometry.height);
  return path === undefined ? { ok: false, error: `无法走到 (${target.x},${target.y})` } : { ok: true, dirs: path };
}

/* ============================== 解路回放验证 =============================== */

/**
 * 用实机引擎（resolvePlayerAction）逐格回放解路：
 * 玩家按最短路走到发力位 → 推。任何一步失败或终局未达标都判失败。
 * 这是离线校验的最后一道闸——solver 与实机不一致立即暴露。
 */
export function replaySolution(geometry: LevelGeometry, steps: readonly SolveStep[]): { readonly ok: boolean; readonly moves: number; readonly error?: string } {
  const rules = DEFAULT_PUZZLE_RULE_SET;
  let player = { ...geometry.playerSpawn };
  let chests = geometry.chestSpawns.map((c) => ({ ...c }));
  let enemies = geometry.enemySpawns.map((c) => ({ ...c }));
  const altarKeys = new Set(geometry.altarSpawns.map((a) => `${a.x},${a.y}`));
  let moves = 0;

  const chestAt = (x: number, y: number): boolean => chests.some((c) => c.x === x && c.y === y);
  const enemyAt = (x: number, y: number): boolean => enemies.some((e) => e.x === x && e.y === y);
  const blockedAt = (x: number, y: number): boolean =>
    chestAt(x, y) ||
    enemyAt(x, y) ||
    altarKeys.has(`${x},${y}`) ||
    (() => {
      const t = geometry.terrain[y]?.[x];
      return t === undefined || t === 1;
    })();

  const ctx: TurnContext = {
    geometry,
    planeShifted: false,
    rules,
    phaseCharges: 0,
    detonationsLeft: 0,
  };

  for (const step of steps) {
    const path = walkPath(geometry, blockedAt, player, step.stand, geometry.width, geometry.height);
    if (path === undefined) return { ok: false, moves, error: `玩家无法走到发力位 (${step.stand.x},${step.stand.y})` };
    moves += path.length;
    for (const dir of path) {
      const r = resolvePlayerAction(ctx, buildEntities(player, chests, enemies, geometry.altarSpawns), player, { type: 'move', dir });
      if (!r.ok) return { ok: false, moves, error: `走位失败：${dir} @ (${player.x},${player.y}) → ${r.reason}` };
      const p = r.entities.find((e) => e.kind === 'player');
      if (p === undefined) return { ok: false, moves, error: '走位后玩家丢失' };
      player = { x: p.x, y: p.y };
      chests = r.entities.filter((e) => e.kind === 'chest').map((e) => ({ x: e.x, y: e.y }));
      enemies = r.entities.filter((e) => e.kind === 'enemy').map((e) => ({ x: e.x, y: e.y }));
    }
    const r2 = resolvePlayerAction(ctx, buildEntities(player, chests, enemies, geometry.altarSpawns), player, { type: 'move', dir: step.dir });
    if (!r2.ok) return { ok: false, moves, error: `推动失败：${step.dir} @ (${player.x},${player.y}) → ${r2.reason}` };
    const p2 = r2.entities.find((e) => e.kind === 'player');
    if (p2 === undefined) return { ok: false, moves, error: '推动后玩家丢失' };
    player = { x: p2.x, y: p2.y };
    chests = r2.entities.filter((e) => e.kind === 'chest').map((e) => ({ x: e.x, y: e.y }));
    enemies = r2.entities.filter((e) => e.kind === 'enemy').map((e) => ({ x: e.x, y: e.y }));
    moves += 1;
  }

  const entities = buildEntities(player, chests, enemies, geometry.altarSpawns);
  if (!isSolved(geometry, entities)) return { ok: false, moves, error: '解路回放完毕但未达标' };
  return { ok: true, moves };
}

function buildEntities(player: Vec2, chests: readonly Vec2[], enemies: readonly Vec2[], altars: readonly Vec2[]): GridEntity[] {
  const list: GridEntity[] = [
    { id: 'player-1', kind: 'player', x: player.x, y: player.y, mass: Infinity, pushable: false },
  ];
  chests.forEach((c, i) => {
    list.push({ id: `chest-${i + 1}`, kind: 'chest', x: c.x, y: c.y, mass: 2, pushable: true });
  });
  enemies.forEach((e, i) => {
    list.push({ id: `enemy-${i + 1}`, kind: 'enemy', x: e.x, y: e.y, mass: 1, pushable: true });
  });
  altars.forEach((a, i) => {
    list.push({ id: `altar-${i + 1}`, kind: 'altar', x: a.x, y: a.y, mass: 0, pushable: false });
  });
  return list;
}

/* ============================== 离线关卡校验 =============================== */

export interface LevelValidation {
  readonly levelId: string;
  readonly ok: boolean;
  readonly solvable: boolean;
  readonly replayVerified: boolean;
  /** 推数最优时为最短推数；贪心兜底解为 -1（见 optimal） */
  readonly minPushes: number;
  readonly optimal: boolean;
  readonly solutionMoves: number;
  readonly statesExplored: number;
  readonly timeout: boolean;
  readonly error?: string;
}

/** 单关离线校验：解析 → 求解 → 解路回放（全部通过才算 ok） */
export function validateLevel(def: Level3D): LevelValidation {
  const parsed = parseLevelGeometry(def);
  if (!parsed.ok) {
    return {
      levelId: def.id,
      ok: false,
      solvable: false,
      replayVerified: false,
      minPushes: -1,
      optimal: false,
      solutionMoves: -1,
      statesExplored: 0,
      timeout: false,
      error: parsed.error,
    };
  }
  const geometry = parsed.geometry;
  const result = solveGeometry(geometry);
  if (!result.solvable) {
    return {
      levelId: def.id,
      ok: false,
      solvable: false,
      replayVerified: false,
      minPushes: -1,
      optimal: false,
      solutionMoves: -1,
      statesExplored: result.statesExplored,
      timeout: result.timeout,
      error: result.timeout ? '求解预算超时' : (result.error ?? '无可解路径'),
    };
  }
  const replay = replaySolution(geometry, result.steps);
  return {
    levelId: def.id,
    ok: replay.ok,
    solvable: true,
    replayVerified: replay.ok,
    minPushes: result.minPushes,
    optimal: result.optimal,
    solutionMoves: result.solutionMoves,
    statesExplored: result.statesExplored,
    timeout: false,
    error: replay.error,
  };
}

/** 全部关卡离线校验（ST6 落地点：任何 ok:false 都该拦下发布） */
export function validateAllLevels(defs: readonly Level3D[]): readonly LevelValidation[] {
  return defs.map(validateLevel);
}
