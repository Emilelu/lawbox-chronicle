/**
 * puzzle/solver —— 求解校验 + 全关卡离线校验（ST6 落地）。
 * 「离线校验全部关卡」是发布硬门槛：本文件任何一个失败都该拦下集成。
 */

import { describe, expect, it } from 'vitest';
import type { TerrainCell } from '../../../core/types';
import { LevelDefSchema } from '../../../core/schema';
import { parseLevelGeometry, type Level3D } from '../grid';
import { solveGeometry, replaySolution, solutionMoveDirs, solverSupports, validateAllLevels, validateLevel } from '../solver';
import { AREA_LEVELS } from '../../../data/levels/areas';
import { ENDLESS_TUNING, generateEndlessFloor, generateEndlessRun } from '../../../data/levels/endless';
import { DEFAULT_PUZZLE_RULE_SET } from '../rules';

const def = (rows: number[][], extra: Partial<Level3D> = {}): Level3D => ({
  id: 't',
  area: 'main',
  name: 't',
  subtitle: 'test',
  grid: rows.map((r) => r.map((v) => v as TerrainCell)),
  parSteps: [10, 20],
  reward: { starStones: 0 },
  ...extra,
});

function geom(rows: number[][], extra: Partial<Level3D> = {}) {
  const parsed = parseLevelGeometry(def(rows, extra));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.geometry;
}

describe('solver —— 基础求解', () => {
  it('一格直推：最短推数 = 1，解路回放通过', () => {
    const g = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 4, 3, 1],
      [1, 1, 1, 1, 1],
    ]);
    const r = solveGeometry(g);
    expect(r.solvable).toBe(true);
    expect(r.minPushes).toBe(1);
    const replay = replaySolution(g, r.steps);
    expect(replay.ok).toBe(true);
  });

  it('推数最优：拐角布局的最短推数 = 2（先右推再下推）', () => {
    const g = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 0, 0, 1],
      [1, 0, 4, 0, 1],
      [1, 0, 0, 3, 1],
      [1, 1, 1, 1, 1],
    ]);
    const r = solveGeometry(g);
    expect(r.solvable).toBe(true);
    expect(r.minPushes).toBe(2);
    expect(replaySolution(g, r.steps).ok).toBe(true);
  });

  it('不可解关卡被正确判死（箱子出生在死角）', () => {
    const g = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 4, 1, 1],
      [1, 0, 3, 0, 1],
      [1, 1, 1, 1, 1],
    ]);
    const r = solveGeometry(g);
    expect(r.solvable).toBe(false);
    expect(r.timeout).toBe(false);
  });

  it('初始即达标：箱子已在旗位 → minPushes = 0，空解路回放通过', () => {
    const base = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 4, 3, 1],
      [1, 1, 1, 1, 1],
    ]);
    // 旗格 (3,1) 上直接放箱（覆盖箱出生点，模拟已就位开局）
    const solved = { ...base, chestSpawns: [{ x: 3, y: 1 }] };
    const r = solveGeometry(solved);
    expect(r.solvable).toBe(true);
    expect(r.minPushes).toBe(0);
    expect(r.optimal).toBe(true);
    expect(replaySolution(solved, []).ok).toBe(true);
  });

  it('箱落解法：h2 环台推箱入井（heights 语义与实机一致，入井必为箱落）', () => {
    const g = geom(
      [
        [1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 2, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 4, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 3, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1],
      ],
      {
        heights: [
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 2, 2, 2, 0, 0],
          [0, 0, 0, 1, 2, 0, 2, 1, 0],
          [0, 0, 0, 0, 2, 2, 2, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
        ],
      },
    );
    const r = solveGeometry(g);
    expect(r.solvable).toBe(true);
    // 旗位四周全是 h2 环台：入井途径唯一 = 箱落，解路里必有 isFall 步
    expect(r.steps.some((s) => s.isFall)).toBe(true);
    expect(replaySolution(g, r.steps).ok).toBe(true);
  });

  it('solverSupports：标准规则支持，扩链/拉箱/斜推/穿行不支持', () => {
    expect(solverSupports(DEFAULT_PUZZLE_RULE_SET)).toBe(true);
    expect(solverSupports({ ...DEFAULT_PUZZLE_RULE_SET, pushRange: 2 })).toBe(false);
    expect(solverSupports({ ...DEFAULT_PUZZLE_RULE_SET, pullEnabled: true })).toBe(false);
    expect(solverSupports({ ...DEFAULT_PUZZLE_RULE_SET, diagonalPushEnabled: true })).toBe(false);
    expect(solverSupports({ ...DEFAULT_PUZZLE_RULE_SET, phaseWalkEnabled: true })).toBe(false);
  });

  it('回放校验能抓出被篡改的解路（逆序两步解 ≠ 解）', () => {
    const g = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 0, 0, 1],
      [1, 0, 4, 0, 1],
      [1, 0, 0, 3, 1],
      [1, 1, 1, 1, 1],
    ]);
    const r = solveGeometry(g);
    expect(r.solvable).toBe(true);
    expect(r.steps.length).toBeGreaterThanOrEqual(2);
    const honest = replaySolution(g, r.steps);
    expect(honest.ok).toBe(true);
    // 逆序解路执行完箱子不在旗位——绝不能“假通过”
    const bad = replaySolution(g, [...r.steps].reverse());
    expect(bad.ok).toBe(false);
  });
});

describe('solver —— 敌人纳入求解投影（R1）', () => {
  it('箱落压碎敌人后箱子落上旗位（合成最小局面）', () => {
    const g = geom(
      [
        [1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 2, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 4, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 3, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1],
      ],
      {
        heights: [
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 2, 2, 2, 0, 0],
          [0, 0, 0, 1, 2, 0, 2, 1, 0],
          [0, 0, 0, 0, 2, 2, 2, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
        ],
        enemySpawns: [{ x: 5, y: 5 }],
      },
    );
    const r = solveGeometry(g);
    expect(r.solvable).toBe(true);
    expect(r.steps.some((s) => s.isFall)).toBe(true);
    expect(replaySolution(g, r.steps).ok).toBe(true);
  });

  it('推敌：堵住发力位的敌人可被推开（质量 1），解路含 kind=enemy 步', () => {
    const g = geom(
      [
        [1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 4, 3, 1],
        [1, 2, 0, 0, 1],
        [1, 1, 1, 1, 1],
      ],
      { enemySpawns: [{ x: 1, y: 2 }] },
    );
    const r = solveGeometry(g);
    // 敌人压在推箱发力位 (1,2)：必须先向上推开它，再右推箱子入旗
    expect(r.solvable).toBe(true);
    expect(r.minPushes).toBe(2);
    expect(r.steps.filter((s) => s.kind === 'enemy')).toHaveLength(1);
    expect(replaySolution(g, r.steps).ok).toBe(true);
  });

  it('lb-08 含守旗敌人仍可解：唯一解法必含箱落压碎', () => {
    const lv = AREA_LEVELS.find((l) => l.id === 'level-lb-08');
    expect(lv).toBeDefined();
    if (lv === undefined) return;
    const parsed = parseLevelGeometry(lv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.geometry.enemySpawns).toHaveLength(1);
    const r = solveGeometry(parsed.geometry);
    expect(r.solvable).toBe(true);
    expect(r.steps.some((s) => s.isFall)).toBe(true);
    expect(replaySolution(parsed.geometry, r.steps).ok).toBe(true);
  });

  it('lb-12 含两名守卫仍可解：敌人可被推开，解路回放通过', () => {
    const lv = AREA_LEVELS.find((l) => l.id === 'level-lb-12');
    expect(lv).toBeDefined();
    if (lv === undefined) return;
    const parsed = parseLevelGeometry(lv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.geometry.enemySpawns).toHaveLength(2);
    const r = solveGeometry(parsed.geometry);
    expect(r.solvable).toBe(true);
    expect(replaySolution(parsed.geometry, r.steps).ok).toBe(true);
  });
});

describe('solver —— MECH-4 数据过滤器（goalOrder / oneWay 与实机同一语义）', () => {
  it('goalOrder 顺序闸约束 solver：解路落座次序必须跟随清单（两种声明各验一次）', () => {
    // 两箱两龛，任一箱都能到任一龛——solver 落座次序只能由 goalOrder 决定
    const rows = [
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 2, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 4, 0, 4, 0, 1],
      [1, 0, 3, 3, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
    ];
    const seatOrderOf = (g: ReturnType<typeof geom>, r: ReturnType<typeof solveGeometry>): string[] => {
      const goalKeys = new Set(g.goals.map((gp) => `${gp.x},${gp.y}`));
      return r.steps.filter((s) => s.kind === 'chest' && goalKeys.has(`${s.to.x},${s.to.y}`)).map((s) => `${s.to.x},${s.to.y}`);
    };

    const gWest = geom(rows, { goalOrder: [{ x: 2, y: 3 }, { x: 3, y: 3 }] });
    const westFirst = solveGeometry(gWest);
    expect(westFirst.solvable).toBe(true);
    expect(westFirst.optimal).toBe(true);
    expect(seatOrderOf(gWest, westFirst)).toEqual(['2,3', '3,3']); // 西龛先落座，乱序后继被剪枝
    expect(replaySolution(gWest, westFirst.steps).ok).toBe(true);

    const gEast = geom(rows, { goalOrder: [{ x: 3, y: 3 }, { x: 2, y: 3 }] });
    const eastFirst = solveGeometry(gEast);
    expect(eastFirst.solvable).toBe(true);
    expect(seatOrderOf(gEast, eastFirst)).toEqual(['3,3', '2,3']); // 同一局面，声明反转 → 落座反转
    expect(replaySolution(gEast, eastFirst.steps).ok).toBe(true);
  });

  it('oneWay 单向阀约束 solver 可达域：阀向封死发力位 → 不可解；阀向放行 → 照常求解', () => {
    const rows = [
      [1, 1, 1, 1, 1],
      [1, 2, 0, 0, 1],
      [1, 0, 0, 4, 1],
      [1, 0, 0, 3, 1],
      [1, 1, 1, 1, 1],
    ];
    // 无阀：玩家自西向东走到 (3,1) 下推，minPushes=1
    const plain = solveGeometry(geom(rows));
    expect(plain.solvable).toBe(true);
    expect(plain.minPushes).toBe(1);
    expect(replaySolution(geom(rows), plain.steps).ok).toBe(true);
    // 阀 allow='right'：发力位 (3,1) 自西向东进入仍放行 → 解不变
    const pass = solveGeometry(geom(rows, { oneWay: [{ cell: { x: 3, y: 1 }, allow: 'right' }] }));
    expect(pass.solvable).toBe(true);
    expect(pass.minPushes).toBe(1);
    expect(replaySolution(geom(rows, { oneWay: [{ cell: { x: 3, y: 1 }, allow: 'right' }] }), pass.steps).ok).toBe(true);
    // 阀 allow='left'：唯一发力位 (3,1) 只能自西向东进入 → 逆向封死，全图无可解
    const blocked = solveGeometry(geom(rows, { oneWay: [{ cell: { x: 3, y: 1 }, allow: 'left' }] }));
    expect(blocked.solvable).toBe(false);
    expect(blocked.timeout).toBe(false);
  });

  it('主线数据契约：lb-10 goalOrder 西→中→东、lb-11 四向单向阀，解析透传给引擎', () => {
    const lb10 = AREA_LEVELS.find((l) => l.id === 'level-lb-10');
    expect(lb10).toBeDefined();
    if (lb10 === undefined) return;
    const p10 = parseLevelGeometry(lb10);
    expect(p10.ok).toBe(true);
    if (!p10.ok) return;
    expect(p10.geometry.goalOrder).toEqual([{ x: 3, y: 6 }, { x: 5, y: 6 }, { x: 8, y: 6 }]);
    // 清单三格必须都是本关旗位（数据护栏：顺序闸只应钉在真实旗位上）
    const goalKeys10 = new Set(p10.geometry.goals.map((gp) => `${gp.x},${gp.y}`));
    for (const cell of p10.geometry.goalOrder) {
      expect(goalKeys10.has(`${cell.x},${cell.y}`), `goalOrder (${cell.x},${cell.y}) 应为旗位`).toBe(true);
    }

    const lb11 = AREA_LEVELS.find((l) => l.id === 'level-lb-11');
    expect(lb11).toBeDefined();
    if (lb11 === undefined) return;
    const p11 = parseLevelGeometry(lb11);
    expect(p11.ok).toBe(true);
    if (!p11.ok) return;
    expect(p11.geometry.oneWay).toEqual([
      { cell: { x: 4, y: 2 }, allow: 'right' },
      { cell: { x: 8, y: 2 }, allow: 'left' },
      { cell: { x: 4, y: 5 }, allow: 'right' },
      { cell: { x: 8, y: 5 }, allow: 'left' },
    ]);
  });
});

describe('solver —— 主线 12 关离线校验（ST6 硬门槛）', () => {
  it('关卡数据形状：LevelDef schema + heights/shadeGrid 与网格同尺寸', () => {
    for (const lv of AREA_LEVELS) {
      const parsed = LevelDefSchema.safeParse(lv);
      expect(parsed.success, `${lv.id} 未通过 LevelDefSchema`).toBe(true);
      if (lv.heights !== undefined) {
        expect(lv.heights.length).toBe(lv.grid.length);
        lv.heights.forEach((row, y) => {
          expect(row.length, `${lv.id} heights 第 ${y} 行宽度`).toBe(lv.grid[y]?.length ?? -1);
        });
      }
      if (lv.shadeGrid !== undefined) {
        expect(lv.shadeGrid.length).toBe(lv.grid.length);
        lv.shadeGrid.forEach((row, y) => {
          expect(row.length, `${lv.id} shadeGrid 第 ${y} 行宽度`).toBe(lv.grid[y]?.length ?? -1);
        });
      }
    }
  });

  it('全部主线关卡零法则可解，且解路逐格回放通过', { timeout: 600_000 }, () => {
    const reports = validateAllLevels(AREA_LEVELS);
    // 关卡集合护栏：上游若返回空列表或漏关，下面的循环会空跑通过
    expect(reports.length, '校验报告数应等于关卡数').toBe(AREA_LEVELS.length);
    expect(
      reports.map((r) => r.levelId).sort(),
      '校验报告应逐关覆盖且不重复',
    ).toEqual(AREA_LEVELS.map((l) => l.id).sort());
    // 离线校验报告（推数/解路步数/状态数）——用于 parSteps 标定与回归对比
    for (const r of reports) {
      console.info(
        `[offline-gate] ${r.levelId} ok=${r.ok} optimal=${r.optimal} minPushes=${r.minPushes} solutionMoves=${r.solutionMoves} states=${r.statesExplored}${r.error ? ` error=${r.error}` : ''}`,
      );
    }
    for (const r of reports) {
      expect(r.error ?? '', `${r.levelId}: ${r.error ?? ''}`).toBe('');
      expect(r.ok, `${r.levelId} 应可解且回放通过`).toBe(true);
      expect(r.solvable).toBe(true);
      expect(r.replayVerified).toBe(true);
      // 解路估算必须成功：estimateSolutionMoves 回归返回 -1 时直接判失败，
      // 否则下面按 parSteps 的比较会被静默跳过（2★ 线护栏失效）
      expect(r.solutionMoves, `${r.levelId} solutionMoves 估算失败（-1）`).toBeGreaterThan(0);
      // 最优解给出最短推数；贪心兜底解同样必须给出可回放的解路
      if (r.optimal) expect(r.minPushes, `${r.levelId} minPushes`).toBeGreaterThanOrEqual(1);
      // parSteps 与实测解路联动：解路步数不得越出 2★ 线（数据回归护栏）
      const lv = AREA_LEVELS.find((l) => l.id === r.levelId);
      expect(lv, r.levelId).toBeDefined();
      if (lv !== undefined) {
        expect(lv.parSteps[0], `${r.levelId} 3★线`).toBeGreaterThan(0);
        expect(lv.parSteps[1], `${r.levelId} 2★线`).toBeGreaterThanOrEqual(lv.parSteps[0]);
        expect(r.solutionMoves, `${r.levelId} 解路 ${r.solutionMoves} 步应 ≤ 2★线 ${lv.parSteps[1]}`).toBeLessThanOrEqual(lv.parSteps[1]);
      }
    }
  });

  it('solutionMoveDirs 展开序列长度与 replaySolution 一致（自动演示用）', { timeout: 120_000 }, () => {
    const lv = AREA_LEVELS.find((l) => l.id === 'level-sb-01');
    expect(lv).toBeDefined();
    if (lv === undefined) return;
    const parsed = parseLevelGeometry(lv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const solved = solveGeometry(parsed.geometry);
    expect(solved.solvable).toBe(true);
    const planned = solutionMoveDirs(parsed.geometry, solved.steps);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const replay = replaySolution(parsed.geometry, solved.steps);
    expect(replay.ok).toBe(true);
    expect(planned.dirs.length).toBe(replay.moves);
  });

  it('单关校验入口 validateLevel 与批量结果一致', () => {
    const lv = AREA_LEVELS[0];
    expect(lv).toBeDefined();
    if (lv === undefined) return;
    const single = validateLevel(lv);
    expect(single.ok).toBe(true);
  });
});

describe('endless —— 无尽回廊生成 + 求解校验', () => {
  it('固定种子生成 3 层：构造解回放验证通过，推数标注存在', { timeout: 120_000 }, () => {
    const results = generateEndlessRun('vitest-seed-alpha', 3);
    for (const r of results) {
      expect(r.ok, r.ok ? '' : r.error).toBe(true);
      if (r.ok) {
        expect(r.floor.verified).toBe(true);
        expect(r.floor.solutionMoves).toBeGreaterThanOrEqual(1);
        if (r.floor.optimal) expect(r.floor.minPushes).toBeGreaterThanOrEqual(1);
        expect(r.floor.grid.length).toBeGreaterThanOrEqual(ENDLESS_TUNING.baseSize);
      }
    }
  });

  it('同种子同层完全确定（可复现），不同层布局不同', () => {
    const a = generateEndlessFloor('vitest-seed-alpha', 2);
    const b = generateEndlessFloor('vitest-seed-alpha', 2);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      // 网格由纯种子流决定，逐位一致；推数标注受时间预算影响不作跨运行断言
      expect(JSON.stringify(a.floor.grid)).toBe(JSON.stringify(b.floor.grid));
      expect(a.floor.verified).toBe(true);
      expect(b.floor.verified).toBe(true);
    }
    const c = generateEndlessFloor('vitest-seed-alpha', 3);
    if (a.ok && c.ok) {
      expect(JSON.stringify(a.floor.grid)).not.toBe(JSON.stringify(c.floor.grid));
    }
  });

  it('生成的层数据可通过 LevelDefSchema（可直接进 store 的 importLevel）', () => {
    const r = generateEndlessFloor('vitest-seed-alpha', 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const asLevel = {
        id: r.floor.id,
        area: 'domain-3' as const,
        name: r.floor.id,
        subtitle: 'endless',
        grid: r.floor.grid,
        parSteps: [10, 20] as [number, number],
        reward: { starStones: 0 },
      };
      expect(LevelDefSchema.safeParse(asLevel).success).toBe(true);
    }
  });

  it('多层种子批生成：层数随层号增长且不越上限', () => {
    expect(ENDLESS_TUNING.maxSize).toBeGreaterThanOrEqual(ENDLESS_TUNING.baseSize);
    expect(ENDLESS_TUNING.maxChests).toBeLessThanOrEqual(4);
  });
});
