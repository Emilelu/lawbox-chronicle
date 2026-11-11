/**
 * 自动演示（autoplay）纯逻辑单测 —— URL 参数解析、演示角色、重试节拍（F2）、
 * 步数预算（N2）、per-level 剧情巡游表完整性（STORY-5 分布同步）与视角接管
 * （CAM-1 viewStore：强制 third，结束恢复前值）。
 */

import { describe, expect, it } from 'vitest';
import {
  DEMO_MAX_LEVEL_RESETS,
  DEMO_STALL_MS,
  DEMO_STEP_BUDGET_MARGIN,
  LEVEL_TOURS,
  demoPlayer,
  demoStepBudget,
  levelRetryPlan,
  planTourPushIn,
  readAutoPlayConfig,
  takeOverViewPreference,
} from '../autoPlay';
import { useViewStore } from '../../view/three/viewStore';
import { HUB_LEVEL_ID } from '../../core/store/gameStore';
import { DIR_VECTORS, type Vec2 } from '../../core/types';
import { LEVELS } from '../../data/levels';
import { PRECOMPUTED_SOLUTIONS } from '../../data/levels/solutionSteps';
import { BOSS_POS, BOSS_TRIGGER_RADIUS } from '../../data/story/bossActs';
import { parseLevelGeometry } from '../../engine/puzzle/grid';
import { replaySolution, walkDirs } from '../../engine/puzzle/solver';

describe('autoplay —— 配置解析', () => {
  it('只有 autoplay=1 才启用', () => {
    expect(readAutoPlayConfig('?autoplay=1').enabled).toBe(true);
    expect(readAutoPlayConfig('?autoplay=0').enabled).toBe(false);
    expect(readAutoPlayConfig('?foo=1').enabled).toBe(false);
    expect(readAutoPlayConfig('').enabled).toBe(false);
  });

  it('速度夹在 0.5~5，非法值回退 1', () => {
    expect(readAutoPlayConfig('?autoplay=1&speed=3').speed).toBe(3);
    expect(readAutoPlayConfig('?autoplay=1&speed=99').speed).toBe(5);
    expect(readAutoPlayConfig('?autoplay=1&speed=0.1').speed).toBe(0.5);
    expect(readAutoPlayConfig('?autoplay=1&speed=abc').speed).toBe(1);
  });
});

describe('autoplay —— 演示角色', () => {
  it('满武器、高攻高血、武器已装备', () => {
    const p = demoPlayer();
    expect(p.weapons?.length ?? 0).toBeGreaterThan(0);
    expect(p.baseAttack).toBeGreaterThan(1000);
    expect(p.hp).toBe(p.maxHp);
    expect(p.weaponId).not.toBeNull();
  });
});

describe('autoplay —— 连败重试决策（F2：不无限重玩、不永久卡死）', () => {
  it('同一关重置次数未超上限 → 原地重试（边界：恰好等于上限仍重试）', () => {
    expect(levelRetryPlan(0, true)).toBe('reset');
    expect(levelRetryPlan(0, false)).toBe('reset');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS, true)).toBe('reset');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS, false)).toBe('reset');
  });

  it('超过重试上限且主线还有下一关 → 跳关恢复（演示继续推进）', () => {
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 1, true)).toBe('skip');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 10, true)).toBe('skip');
  });

  it('超过重试上限且没有下一关 → 有界放弃（而非无限循环）', () => {
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 1, false)).toBe('giveup');
    expect(levelRetryPlan(DEMO_MAX_LEVEL_RESETS + 10, false)).toBe('giveup');
  });

  it('看门狗窗口为 60s（停滞重试节拍），重试上限为 4', () => {
    expect(DEMO_STALL_MS).toBe(60_000);
    expect(DEMO_MAX_LEVEL_RESETS).toBe(4);
  });
});

describe('autoplay —— 步数预算（N2：重试路径不得无限累计步数）', () => {
  it('预算 = 该关 2☆ 阈值（parSteps[1]）+ 余量', () => {
    // 初醒箱庭标定：3☆≤148，2☆≤222（src/data/levels/areas.ts）
    expect(demoStepBudget([148, 222])).toBe(222 + DEMO_STEP_BUDGET_MARGIN);
    expect(demoStepBudget([11, 17])).toBe(17 + DEMO_STEP_BUDGET_MARGIN);
  });

  it('无标定数据的关卡不设预算（不触发重置）', () => {
    expect(demoStepBudget(undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('余量钉值为 30（改动需有实测依据，防「余量膨胀」把预算架空）', () => {
    expect(DEMO_STEP_BUDGET_MARGIN).toBe(30);
  });
});

/* ====================== per-level 剧情巡游表（STORY-5） ====================== */

/** 各关期望站点（label + 网格坐标）—— 与 STORY-5 触发分布逐点对齐 */
const EXPECTED_STOPS: Record<string, readonly (readonly [string, number, number])[]> = {
  [HUB_LEVEL_ID]: [
    ['导航天使①', 8, 6],
    ['残留的羽毛·①', 8, 6],
    ['残留的羽毛·③', 7, 7],
    ['残留的羽毛·④', 7, 5],
    ['东侧彩蛋·神秘法阵', 14, 10],
  ],
  'level-sb-02': [['蔡徐坤', 12, 3]],
  'level-sb-03': [['郭老师', 7, 5]],
  'level-sb-04': [['导航天使②', 7, 4]],
  'level-lb-05': [['导航天使③', 7, 3]],
  'level-lb-06': [['冬泳怪鸽', 3, 3]],
  'level-lb-09': [['作者谜题', 5, 4]],
  'level-lb-10': [['导航天使④', 2, 7]],
  'level-lb-11': [['影流之主投影', 6, 7]],
  'level-lb-12': [['王座咽喉', 6, 4]],
};

/** 取巡游表某关的 level 定义（断言存在） */
const levelOf = (id: string): (typeof LEVELS)[number] => {
  const level = LEVELS.find((l) => l.id === id);
  expect(level, `巡游表关卡 ${id} 必须存在于 LEVELS`).toBeDefined();
  return level as (typeof LEVELS)[number];
};

describe('autoplay —— per-level 剧情巡游表（STORY-5 分布同步）', () => {
  it('巡游表关卡集合与 STORY-5 分布一致（10 关有站点，无多余/缺失）', () => {
    expect(Object.keys(LEVEL_TOURS).sort()).toEqual(Object.keys(EXPECTED_STOPS).sort());
    for (const id of Object.keys(LEVEL_TOURS)) {
      levelOf(id); // 关卡 id 真实存在
    }
  });

  it('各关站点（label + 坐标）与 STORY-5 触发分布逐点一致', () => {
    expect(Object.keys(LEVEL_TOURS).length).toBeGreaterThan(0);
    for (const [id, expected] of Object.entries(EXPECTED_STOPS)) {
      const tour = LEVEL_TOURS[id];
      expect(tour, `巡游表缺少 ${id}`).toBeDefined();
      const actual = (tour ?? []).map((s) => [s.label, s.target.x, s.target.y] as const);
      expect(actual, `${id} 站点不符`).toEqual(expected);
    }
  });

  it('每站 target 在对应关原始网格上都是地板(0)——可站立（触发格不可站则剧情断链）', () => {
    for (const [id, tour] of Object.entries(LEVEL_TOURS)) {
      const level = levelOf(id);
      for (const stop of tour) {
        const cell = level.grid[stop.target.y]?.[stop.target.x];
        expect(
          cell,
          `${id}「${stop.label}」站 (${stop.target.x},${stop.target.y}) 应为地板(0)`,
        ).toBe(0);
      }
    }
  });

  it('reEnter/edgePush 只出现在主城关：tile 回踩=羽毛①，越界彩蛋=edgePush right', () => {
    // 出界 beyond 触发只对主城生效（gameStore 越界判定按 HUB_LEVEL_ID 过滤），
    // 非 HUB 关的 edgePush 会静默无效；tile 同格回踩同理只用于主城羽毛。
    for (const [id, tour] of Object.entries(LEVEL_TOURS)) {
      for (const stop of tour) {
        if (stop.reEnter !== undefined) {
          expect(id, 'reEnter 仅限主城关').toBe(HUB_LEVEL_ID);
          expect(stop.label).toBe('残留的羽毛·①');
        }
        if (stop.edgePush !== undefined) {
          expect(id, 'edgePush 仅限主城关（越界 beyond 为 HUB-only）').toBe(HUB_LEVEL_ID);
        }
      }
    }
    const feather1 = LEVEL_TOURS[HUB_LEVEL_ID]?.find((s) => s.label === '残留的羽毛·①');
    expect(feather1?.reEnter).toBe('down'); // 跨出到 (8,7) 再回踩
    const east = LEVEL_TOURS[HUB_LEVEL_ID]?.find((s) => s.label === '东侧彩蛋·神秘法阵');
    expect(east?.edgePush).toBe('right');
  });

  it('reEnter 跨出格在对应关网格内且可走（非墙；跨出失败会退化为普通到站，回踩丢失）', () => {
    for (const [id, tour] of Object.entries(LEVEL_TOURS)) {
      const level = levelOf(id);
      for (const stop of tour) {
        if (stop.reEnter === undefined) continue;
        const step = DIR_VECTORS[stop.reEnter];
        const x = stop.target.x + step.x;
        const y = stop.target.y + step.y;
        const cell = level.grid[y]?.[x];
        // 羽毛①跨出格 (8,7) 是尖刺格(5)：谜题期尖刺不拦移动（战斗侧才结算），
        // 且演示角色防御 999，跨出/回踩无碍 —— 只要求可走（非墙、不越界）。
        expect(cell, `${id}「${stop.label}」reEnter 跨出格 (${x},${y}) 应可走`).not.toBe(1);
        expect(cell, `${id}「${stop.label}」reEnter 跨出格 (${x},${y}) 不越界`).toBeDefined();
      }
    }
  });

  it('剧情顺序：三怪关 < 作者关（三击败旗），作者关 < BOSS 关（谜题之钥防秒杀）', () => {
    const orderOf = (id: string): number => {
      const index = LEVELS.findIndex((l) => l.id === id);
      expect(index, `关卡 ${id} 存在`).toBeGreaterThanOrEqual(0);
      return index;
    };
    const mobs = ['level-sb-02', 'level-sb-03', 'level-lb-06'].map(orderOf);
    const author = orderOf('level-lb-09');
    const boss = orderOf('level-lb-12');
    for (const mob of mobs) expect(author).toBeGreaterThan(mob);
    expect(boss).toBeGreaterThan(author);
  });

  it('L12 王座咽喉 (6,4) 距 BOSS 触发点曼哈顿 1，radius 3 内必触发（与 STORY-5 BOSS_POS 联测）', () => {
    const stop = LEVEL_TOURS['level-lb-12']?.[0];
    expect(stop?.target).toEqual({ x: 6, y: 4 });
    // STORY-5：L12 BOSS npc 触发点 = 王座中心 BOSS_POS(6,5)（2×2 圣坛旗格，不可站）
    expect(BOSS_POS.levelId).toBe('level-lb-12');
    const dist =
      Math.abs((stop?.target.x ?? 0) - BOSS_POS.x) + Math.abs((stop?.target.y ?? 0) - BOSS_POS.y);
    expect(dist).toBe(1);
    expect(dist).toBeLessThanOrEqual(BOSS_TRIGGER_RADIUS);
  });
});

describe('autoplay —— 巡游可达性与步数预算（实测钉值）', () => {
  /**
   * 巡游模拟（与实机 driveTour 同构）：逐站 walkDirs 规划；走不到时按实机
   * 逻辑尝试「推入到站」（planTourPushIn），仍不可行则与 driveTour 一致地
   * 跳过该站（记入 skipped，不计数）。reEnter 计跨出+回踩 2 步；edgePush
   * 出界不位移不计步；推入会使占位实体位移（计入后续占位与解路初态）。
   */
  const simulateTour = (id: string) => {
    const tour = LEVEL_TOURS[id];
    if (tour === undefined) throw new Error(`${id} 无巡游表`);
    const parsed = parseLevelGeometry(levelOf(id));
    if (!parsed.ok) throw new Error(`${id} 网格解析失败：${parsed.error}`);
    const geometry = parsed.geometry;
    const blocked = [...geometry.chestSpawns, ...geometry.enemySpawns, ...geometry.altarSpawns];
    // 站点占位实体可否被推（与 puzzle 引擎一致：箱/敌可推，祭坛建筑不可推）
    const pushableAt = (x: number, y: number): boolean =>
      geometry.chestSpawns.some((c) => c.x === x && c.y === y) ||
      geometry.enemySpawns.some((e) => e.x === x && e.y === y);
    let pos = geometry.playerSpawn;
    let total = 0;
    const skipped: string[] = [];
    for (const stop of tour) {
      const walk = walkDirs(geometry, pos, blocked, stop.target);
      if (walk.ok) {
        total += walk.dirs.length;
        pos = stop.target;
      } else {
        const pushIn = planTourPushIn(
          geometry,
          blocked,
          pos,
          stop.target,
          pushableAt(stop.target.x, stop.target.y),
        );
        const approach =
          pushIn === null ? undefined : walkDirs(geometry, pos, blocked, pushIn.walkTo);
        if (pushIn === null || approach === undefined || !approach.ok) {
          skipped.push(stop.label); // driveTour 同款优雅跳过（剧情断链风险见断言）
          continue;
        }
        total += approach.dirs.length + 1; // 走到推位 + 推进一步落站
        pos = stop.target;
        const v = DIR_VECTORS[pushIn.pushDir];
        const beyond = { x: stop.target.x + v.x, y: stop.target.y + v.y };
        const idx = blocked.findIndex((p) => p.x === stop.target.x && p.y === stop.target.y);
        if (idx >= 0) blocked[idx] = beyond; // 被推实体位移，占位随之更新
      }
      if (stop.reEnter !== undefined) total += 2;
    }
    return { geometry, blocked, steps: total, endPos: pos, skipped };
  };

  const tourSteps = (id: string): number => simulateTour(id).steps;

  /**
   * 演示在「巡游结束位置」开始解路：与 replaySolution（从出生点回放）相比，
   * 唯一差异是第一段走位（后续站间走位与推完全一致，实体初态需计入巡游的
   * 推入位移）。解路实走步数 = 回放步数 − d(出生点→首个发力位)
   * + d(巡游终点→首个发力位)，均为 BFS 最短路，确定性可精确核算。
   */
  const solveMovesFromTourEnd = (id: string): number => {
    const steps = PRECOMPUTED_SOLUTIONS[id];
    expect(steps?.length ?? 0, `${id} 缺少预计算解路（MECH-4 regen 后重跑）`).toBeGreaterThan(0);
    if (steps === undefined || steps.length === 0) return 0;
    const { geometry, blocked, endPos } = simulateTour(id);
    const replay = replaySolution(geometry, steps);
    expect(replay.ok, `${id} 解路回放：${replay.error ?? ''}`).toBe(true);
    const firstStand = steps[0]?.stand;
    if (firstStand === undefined) return 0;
    const fromSpawn = walkDirs(geometry, geometry.playerSpawn, blocked, firstStand);
    const fromTourEnd = walkDirs(geometry, endPos, blocked, firstStand);
    if (!fromSpawn.ok || !fromTourEnd.ok) {
      throw new Error(`${id} 首发力位不可达：${(!fromSpawn.ok && fromSpawn.error) || (!fromTourEnd.ok && fromTourEnd.error)}`);
    }
    return replay.moves - fromSpawn.dirs.length + fromTourEnd.dirs.length;
  };

  it('每站可达或可推入（两者皆否会被 driveTour 静默跳过，剧情断链风险须显式记录）', () => {
    for (const id of Object.keys(LEVEL_TOURS)) {
      const sim = simulateTour(id);
      // 已知缝隙：sb-02 蔡徐坤遭遇点 (12,3) 被 MECH-4 守卫同格占位且四向
      // 不可推（上/下让路格是墙、左是箱、右推位是箱）——遭遇触发依赖
      // STORY-5/MECH-4 的联动语义（踩点/触碰遭遇、regen 敌推），巡游对其
      // 优雅跳过。除该缝隙外不允许出现静默跳过。
      expect(sim.skipped, `${id} 被跳过的巡游站`).toEqual(
        id === 'level-sb-02' ? ['蔡徐坤'] : [],
      );
    }
  });

  it('巡游步数实测钉值（改动巡游表/网格后需重测并复核预算核算）', () => {
    // walkDirs BFS 实测（含箱子/敌人/祭坛占位；reEnter 计跨出+回踩 2 步）。
    // sb-02 记 0：蔡徐坤遭遇点 (12,3) 被 MECH-4 守卫同格占位且四向不可推，
    // 当前数据下该站被优雅跳过（0 步）——遭遇语义合入后须重测。
    // 评审预算式记 L12 最小 7，BFS 实测 8（(1,1)→(6,4) 曼哈顿即 8），以实测为准。
    const measured: Record<string, number> = {
      [HUB_LEVEL_ID]: 54,
      'level-sb-02': 0,
      'level-sb-03': 11,
      'level-sb-04': 10,
      'level-lb-05': 8,
      'level-lb-06': 4,
      'level-lb-09': 7,
      'level-lb-10': 7,
      'level-lb-11': 11,
      'level-lb-12': 8,
    };
    expect(Object.keys(measured).sort()).toEqual(Object.keys(LEVEL_TOURS).sort());
    for (const [id, steps] of Object.entries(measured)) {
      expect(tourSteps(id), `${id} 巡游步数`).toBe(steps);
    }
  });

  it('各巡游关：巡游 + 解路全程 + 余量 不超 2☆ 阈值（预算不因剧情分布扩张而架空）', () => {
    const totals: Record<string, { tour: number; solve: number; par2: number }> = {};
    for (const id of Object.keys(LEVEL_TOURS)) {
      const par2 = levelOf(id).parSteps?.[1];
      expect(par2, `${id} 有 2☆ 标定`).toBeDefined();
      if (par2 === undefined) continue;
      const tour = tourSteps(id);
      const solve = solveMovesFromTourEnd(id);
      totals[id] = { tour, solve, par2 };
    }
    for (const [id, t] of Object.entries(totals)) {
      const total = t.tour + t.solve;
      expect(
        total,
        `${id} 全程（巡游${t.tour}+解路${t.solve}）须在运行时预算（2☆阈值${t.par2}+余量${DEMO_STEP_BUDGET_MARGIN}）内，否则看门狗预算重置 → 跳关`,
      ).toBeLessThanOrEqual(t.par2 + DEMO_STEP_BUDGET_MARGIN);
    }
  });

  it('L1 硬指标（验收②）：巡游 + 解路全程 ≤ 2☆ 阈值 222（不带余量的实打实 2☆）', () => {
    const total = tourSteps(HUB_LEVEL_ID) + solveMovesFromTourEnd(HUB_LEVEL_ID);
    expect(total, `L1 全程 ${total} 步须 ≤ 222`).toBeLessThanOrEqual(222);
  });
});

describe('autoplay —— 推入到站（planTourPushIn：站点被可推实体占位）', () => {
  const geometryOf = (id: string) => {
    const parsed = parseLevelGeometry(levelOf(id));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.geometry;
  };
  const blockersOf = (geometry: ReturnType<typeof geometryOf>): readonly Vec2[] => [
    ...geometry.chestSpawns,
    ...geometry.enemySpawns,
    ...geometry.altarSpawns,
  ];

  it('L12 守卫 (3,5) 可向上推入：推位 (3,6)、让路落点 (3,4) 均可走（正例）', () => {
    const geometry = geometryOf('level-lb-12');
    const plan = planTourPushIn(
      geometry,
      blockersOf(geometry),
      geometry.playerSpawn,
      { x: 3, y: 5 }, // enemySpawns[0]，与箱子 (2,3)/(2,7) 不同排
      true,
    );
    expect(plan).toEqual({ walkTo: { x: 3, y: 6 }, pushDir: 'up' });
    // 推位 = 站点沿推方向的反向邻格（DIR_VECTORS.up=(0,-1) → 反向邻格 y+1）
    expect(plan?.walkTo).toEqual({ x: 3, y: 6 });
  });

  it('sb-02 蔡徐坤遭遇点 (12,3) 被守卫同格占位且四向不可推 → null（实机优雅跳过）', () => {
    const geometry = geometryOf('level-sb-02');
    // 上/下让路格 (12,2)/(12,2 推位) 是墙，左让路格 (11,3) 是箱子，右推位 (11,3) 是箱子
    const plan = planTourPushIn(
      geometry,
      blockersOf(geometry),
      geometry.playerSpawn,
      { x: 12, y: 3 },
      true,
    );
    expect(plan).toBeNull();
  });

  it('不可推占位（祭坛 pushable=false）与墙格站点 → null', () => {
    const hub = geometryOf(HUB_LEVEL_ID);
    // L1 星愿祭坛 (7,11) 是不可推建筑
    expect(
      planTourPushIn(hub, blockersOf(hub), hub.playerSpawn, { x: 7, y: 11 }, false),
    ).toBeNull();
    // L1 (7,6) 是墙格，不可作为落站
    expect(planTourPushIn(hub, blockersOf(hub), hub.playerSpawn, { x: 7, y: 6 }, true)).toBeNull();
  });
});

describe('autoplay —— 视角接管（CAM-1 viewStore：强制 third，结束恢复前值）', () => {
  /** 直接对真实 viewStore 断言（get/set 均经 CAM-1 分片，验收③口径） */
  const setView = (v: 'first' | 'third'): void => {
    useViewStore.setState({ viewPreference: v });
  };
  const readView = (): 'first' | 'third' => useViewStore.getState().viewPreference;

  it('接管时读取前值并置 third；恢复函数写回前值', () => {
    setView('first'); // 玩家此前在第一人称
    const restore = takeOverViewPreference();
    expect(readView()).toBe('third');
    restore();
    expect(readView()).toBe('first');
  });

  it('前值为 third 时接管/恢复后仍是 third（恢复写回的是进入演示前的真实值）', () => {
    setView('third');
    const restore = takeOverViewPreference();
    expect(readView()).toBe('third');
    restore();
    expect(readView()).toBe('third');
  });

  it('恢复幂等：多条退出路径（完成/停止/卸载）重复调用不串值', () => {
    setView('first');
    const restore = takeOverViewPreference();
    restore();
    restore();
    restore();
    expect(readView()).toBe('first');
  });
});
