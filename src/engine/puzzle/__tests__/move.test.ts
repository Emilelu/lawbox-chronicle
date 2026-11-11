/**
 * puzzle/move —— 移动/推箱/撤销/死角/法则单测。
 * 重点回归：S3（越界守卫）、S4（旗格可通行可推离）、S1（幻影箱子/不可变状态）、
 * S17（穿行充能每段重置语义）、立体高度层（爬升/箱落）、法则卡应用点、
 * MECH-4 数据过滤器（goalOrder 旗位顺序闸 / oneWay 单向阀：过滤器而非新物理）。
 */

import { describe, expect, it } from 'vitest';
import type { GridEntity, TerrainCell } from '../../../core/types';
import { goalOrderPrefix, isSolved, parseLevelGeometry, playerMayEnter, type Level3D } from '../grid';
import { applyPuzzleMove, createPuzzleState, grantPhaseCharges, HISTORY_LIMIT, type PuzzleState } from '../move';
import { undoPuzzle, canUndo, historyDepth } from '../undo';
import { checkDeadlock, computeDeadSquares } from '../deadlock';
import { buildPuzzleRuleSet, DEFAULT_PUZZLE_RULE_SET } from '../rules';
import { LAW_PATCH_IDS } from '../../../core/lawRegistry';

/* ================================ 工具 ==================================== */

const def = (id: string, rows: number[][], extra: Partial<Level3D> = {}): Level3D => ({
  id,
  area: 'main',
  name: id,
  subtitle: 'test',
  grid: rows.map((r) => r.map((v) => v as TerrainCell)),
  parSteps: [10, 20],
  reward: { starStones: 0 },
  ...extra,
});

function geom(rows: number[][], extra: Partial<Level3D> = {}) {
  const parsed = parseLevelGeometry(def('t', rows, extra));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.geometry;
}

const entity = (id: string, kind: GridEntity['kind'], x: number, y: number, pushable = false): GridEntity => ({
  id,
  kind,
  x,
  y,
  mass: pushable ? 2 : Infinity,
  pushable,
});

const player = (x: number, y: number): GridEntity => entity('player-1', 'player', x, y);
const chest = (id: string, x: number, y: number): GridEntity => entity(id, 'chest', x, y, true);

const expectOk = <T extends { ok: boolean }>(r: T): void => {
  if (!r.ok) throw new Error(`期望成功，实际失败：${JSON.stringify(r)}`);
};

function expectOkOrThrow(r: ReturnType<typeof applyPuzzleMove>): PuzzleState {
  expectOk(r);
  return (r as { ok: true; state: PuzzleState }).state;
}

/* ============================== 守卫与基础语义 ============================= */

describe('move —— 守卫先于索引（S3 回归）', () => {
  const g = geom([
    [1, 1, 1, 1, 1, 1],
    [1, 2, 0, 0, 0, 1],
    [1, 1, 4, 3, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ]);
  const rules = DEFAULT_PUZZLE_RULE_SET;

  it('连走到边界再外撞 → blocked(wall)，全程不抛异常不越界读', () => {
    let s = createPuzzleState(g, rules);
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' }));
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' }));
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' }));
    expect(s.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 4, y: 1 });
    expect(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' })).toMatchObject({ ok: false, reason: 'wall' });
  });

  it('origin 缺失 → no-origin，不逃逸', () => {
    const empty = createPuzzleState(g, rules, []);
    expect(applyPuzzleMove(empty, rules, { type: 'move', dir: 'up' })).toMatchObject({ ok: false, reason: 'no-origin' });
  });
});

describe('move —— 标准 sokoban 语义（S4/S1 回归）', () => {
  // 旗格 (3,1) 在箱子路径上：推上去必须可通行且可再推离
  const g = geom([
    [1, 1, 1, 1, 1, 1],
    [1, 2, 4, 3, 0, 1],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1],
  ]);
  const rules = DEFAULT_PUZZLE_RULE_SET;

  it('S4：箱子可推上旗格并继续推离（旗格可通行，不再是障碍）', () => {
    let s = createPuzzleState(g, rules);
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' })); // 推箱上旗
    expect(s.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 1 });
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' })); // 平推离旗格
    expect(s.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 4, y: 1 });
  });

  it('S1：纯函数不可变——入参实体与历史快照不被后续移动污染', () => {
    const s0 = createPuzzleState(g, rules);
    const entitiesBefore = JSON.stringify(s0.entities);
    const s1 = expectOkOrThrow(applyPuzzleMove(s0, rules, { type: 'move', dir: 'right' }));
    const s2 = expectOkOrThrow(applyPuzzleMove(s1, rules, { type: 'move', dir: 'right' }));
    expect(JSON.stringify(s0.entities)).toBe(entitiesBefore);
    expect(JSON.stringify(s1.entities)).not.toBe(entitiesBefore);
    // s2.history[0] 是 s1 移动前压入的切片（值拷贝），chest 仍在出生位
    const snap = s2.history[0];
    expect(snap?.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 2, y: 1 });
  });

  it('pushRange=2 连锁推两箱；pushRange=1 拒绝连锁（chain-limit）', () => {
    const chainGrid = geom([
      [1, 1, 1, 1, 1, 1, 1],
      [1, 2, 4, 4, 3, 3, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ]);
    const one = createPuzzleState(chainGrid, DEFAULT_PUZZLE_RULE_SET);
    expect(applyPuzzleMove(one, DEFAULT_PUZZLE_RULE_SET, { type: 'move', dir: 'right' })).toMatchObject({
      ok: false,
      reason: 'chain-limit',
    });
    const twoRules = { ...DEFAULT_PUZZLE_RULE_SET, pushRange: 2 };
    const two = createPuzzleState(chainGrid, twoRules);
    const r = applyPuzzleMove(two, twoRules, { type: 'move', dir: 'right' });
    expectOk(r);
    const state = (r as { ok: true; state: PuzzleState }).state;
    expect(state.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 1 });
    expect(state.entities.find((e) => e.id === 'chest-2')).toMatchObject({ x: 4, y: 1 });
  });
});

/* ============================== 3D 高度层 ================================= */

describe('move —— 高度层：爬升与箱落', () => {
  it('箱子爬升 Δh=+1 允许，Δh=+2 拒绝(cliff)', () => {
    const g = geom(
      [
        [1, 1, 1, 1, 1, 1],
        [1, 2, 4, 0, 0, 1],
        [1, 0, 3, 0, 0, 1],
        [1, 1, 1, 1, 1, 1],
      ],
      {
        heights: [
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 1, 3, 0],
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
        ],
      },
    );
    const rules = DEFAULT_PUZZLE_RULE_SET;
    let s = createPuzzleState(g, rules);
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' })); // 推上 h1 台阶
    expect(s.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 1 });
    expect(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' })).toMatchObject({ ok: false, reason: 'cliff' }); // 再推上 h3
  });

  it('箱落：落差 ≥2 坠落到落点；玩家跳下无伤（下降不限）', () => {
    const g = geom(
      [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 2, 4, 0, 1],
        [1, 3, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ],
      {
        heights: [
          [0, 0, 0, 0, 0, 0, 0],
          [0, 2, 2, 2, 2, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
        ],
      },
    );
    const rules = DEFAULT_PUZZLE_RULE_SET;
    // 玩家跳下 h2 悬崖到地面（下降不限）
    const sJump = createPuzzleState(g, rules);
    const jumped = expectOkOrThrow(applyPuzzleMove(sJump, rules, { type: 'move', dir: 'down' }));
    expect(jumped.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 2 });

    // 留在台上把箱子推向 h0 落差 → 箱落
    const s2 = createPuzzleState(g, rules);
    const r = applyPuzzleMove(s2, rules, { type: 'move', dir: 'right' });
    expectOk(r);
    const st = (r as { ok: true; state: PuzzleState }).state;
    expect(st.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 5, y: 1 }); // 坠到 h0
    expect(st.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 4, y: 1 }); // 玩家进箱原格
    const fx = (r as { ok: true; fx: readonly { type: string }[] }).fx;
    expect(fx.some((f) => f.type === 'fall')).toBe(true);
  });

  it('箱落攻击：压碎落点敌人；引爆法则清除落点四邻的可破坏实体', () => {
    const g = geom(
      [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 2, 4, 0, 1],
        [1, 3, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ],
      {
        heights: [
          [0, 0, 0, 0, 0, 0, 0],
          [0, 2, 2, 2, 2, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
        ],
      },
    );
    const rules = DEFAULT_PUZZLE_RULE_SET;
    // 压碎：落点 (5,1) 站敌人
    const s1 = createPuzzleState(g, rules, [player(3, 1), chest('chest-1', 4, 1), entity('enemy-1', 'enemy', 5, 1, true)]);
    const r1 = applyPuzzleMove(s1, rules, { type: 'move', dir: 'right' });
    expectOk(r1);
    const st1 = (r1 as { ok: true; state: PuzzleState }).state;
    expect(st1.entities.some((e) => e.id === 'enemy-1')).toBe(false);

    // 引爆：「箱落引爆」给 1 次爆炸，清除落点四邻 (5,2) 的道具
    const patched = buildPuzzleRuleSet(rules, ['chest-detonate']);
    expectOk(patched);
    const detRules = (patched as { ok: true; ruleSet: typeof rules }).ruleSet;
    const s2 = createPuzzleState(g, detRules, [player(3, 1), chest('chest-1', 4, 1), entity('prop-1', 'prop', 5, 2, true)]);
    const r2 = applyPuzzleMove(s2, detRules, { type: 'move', dir: 'right' });
    expectOk(r2);
    const st2 = (r2 as { ok: true; state: PuzzleState }).state;
    expect(st2.entities.some((e) => e.id === 'prop-1')).toBe(false);
    expect(st2.detonationsLeft).toBe(0); // 1 次引爆用尽
  });

  it('就位箱被推落需「箱可推离」法则；平推离旗格永远允许（S4）', () => {
    const g = geom(
      [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 2, 3, 0, 1],
        [1, 0, 0, 0, 4, 0, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ],
      {
        heights: [
          [0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 2, 2, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
        ],
      },
    );
    const rules = DEFAULT_PUZZLE_RULE_SET;
    // 就位箱：箱子站在旗格 (4,1)（h2 基座），玩家 (3,1) 同高
    const s = createPuzzleState(g, rules, [player(3, 1), chest('chest-1', 4, 1)]);
    expect(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' })).toMatchObject({ ok: false, reason: 'goal-locked' });

    const patched = buildPuzzleRuleSet(rules, ['chest-off-goal']);
    expectOk(patched);
    const offRules = (patched as { ok: true; ruleSet: typeof rules }).ruleSet;
    const r = applyPuzzleMove(s, offRules, { type: 'move', dir: 'right' });
    expectOk(r);
    const st = (r as { ok: true; state: PuzzleState }).state;
    expect(st.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 5, y: 1 });
  });
});

/* ============================== 法则应用点 ================================ */

describe('move —— 法则卡应用点', () => {
  const pullGrid = geom([
    [1, 1, 1, 1, 1, 1],
    [1, 0, 2, 4, 0, 1],
    [1, 0, 0, 0, 3, 1],
    [1, 1, 1, 1, 1, 1],
  ]);

  it('镜像拉箱：未解锁 → law-locked；解锁后玩家退、箱跟进并计入推数', () => {
    const rules = DEFAULT_PUZZLE_RULE_SET;
    const s = createPuzzleState(pullGrid, rules);
    expect(applyPuzzleMove(s, rules, { type: 'pull', dir: 'right' })).toMatchObject({ ok: false, reason: 'law-locked' });

    const patched = buildPuzzleRuleSet(rules, ['mirror-pull']);
    expectOk(patched);
    const pullRules = (patched as { ok: true; ruleSet: typeof rules }).ruleSet;
    const r = applyPuzzleMove(s, pullRules, { type: 'pull', dir: 'right' });
    expectOk(r);
    const st = (r as { ok: true; state: PuzzleState }).state;
    expect(st.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 1, y: 1 });
    expect(st.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 2, y: 1 });
    expect(st.pushes).toBe(1);
  });

  const diagGrid = geom([
    [1, 1, 1, 1, 1, 1],
    [1, 2, 0, 0, 0, 1],
    [1, 0, 4, 0, 0, 1],
    [1, 3, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1],
  ]);

  it('斜向推挤：未解锁拒绝；解锁后对角推箱（玩家进箱原格）', () => {
    const rules = DEFAULT_PUZZLE_RULE_SET;
    const s = createPuzzleState(diagGrid, rules);
    expect(applyPuzzleMove(s, rules, { type: 'diagonal', diag: 'downright' })).toMatchObject({ ok: false, reason: 'law-locked' });

    const patched = buildPuzzleRuleSet(rules, ['diagonal-push']);
    expectOk(patched);
    const diagRules = (patched as { ok: true; ruleSet: typeof rules }).ruleSet;
    const r = applyPuzzleMove(s, diagRules, { type: 'diagonal', diag: 'downright' });
    expectOk(r);
    const st = (r as { ok: true; state: PuzzleState }).state;
    expect(st.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 3 });
    expect(st.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 2, y: 2 });
  });

  it('斜推防挤角：两个正交邻格同为墙 → wall', () => {
    const g = geom([
      [1, 1, 1, 1, 1, 1],
      [1, 2, 1, 0, 0, 1],
      [1, 1, 4, 0, 0, 1],
      [1, 0, 0, 0, 3, 1],
      [1, 1, 1, 1, 1, 1],
    ]);
    const patched = buildPuzzleRuleSet(DEFAULT_PUZZLE_RULE_SET, ['diagonal-push']);
    expectOk(patched);
    const diagRules = (patched as { ok: true; ruleSet: typeof DEFAULT_PUZZLE_RULE_SET }).ruleSet;
    const s = createPuzzleState(g, diagRules);
    expect(applyPuzzleMove(s, diagRules, { type: 'diagonal', diag: 'downright' })).toMatchObject({ ok: false, reason: 'wall' });
  });

  it('相位穿行：未解锁/无充能拒绝；穿墙消耗 1 充能；前方可走时不消耗', () => {
    const phaseGrid = geom([
      [1, 1, 1, 1, 1, 1, 1],
      [1, 2, 1, 0, 3, 4, 1],
      [1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ]);
    const rules = DEFAULT_PUZZLE_RULE_SET;
    const s0 = createPuzzleState(phaseGrid, rules);
    expect(applyPuzzleMove(s0, rules, { type: 'phase', dir: 'right' })).toMatchObject({ ok: false, reason: 'law-locked' });

    const patched = buildPuzzleRuleSet(rules, ['phase-walk']);
    expectOk(patched);
    const phaseRules = (patched as { ok: true; ruleSet: typeof rules }).ruleSet;
    const s1 = createPuzzleState(phaseGrid, phaseRules);
    expect(s1.phaseCharges).toBe(3); // 相位穿行自带基础充能
    expect(applyPuzzleMove(s1, phaseRules, { type: 'shiftPlane' })).toMatchObject({ ok: false, reason: 'plane-locked' });

    const drained = { ...s1, phaseCharges: 0 };
    expect(applyPuzzleMove(drained, phaseRules, { type: 'phase', dir: 'right' })).toMatchObject({ ok: false, reason: 'no-charge' });

    // 穿墙：玩家 (1,1) → (3,1)，充能 -1
    const r = applyPuzzleMove(s1, phaseRules, { type: 'phase', dir: 'right' });
    expectOk(r);
    const st = (r as { ok: true; state: PuzzleState }).state;
    expect(st.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 1 });
    expect(st.phaseCharges).toBe(2);

    // 前方可走 → 退化为普通移动，不耗充能
    const openGrid = geom([
      [1, 1, 1, 1, 1, 1],
      [1, 2, 0, 3, 4, 1],
      [1, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1],
    ]);
    const s2 = createPuzzleState(openGrid, phaseRules);
    const r2 = applyPuzzleMove(s2, phaseRules, { type: 'phase', dir: 'right' });
    expectOk(r2);
    const st2 = (r2 as { ok: true; state: PuzzleState }).state;
    expect(st2.phaseCharges).toBe(3);
    expect(st2.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 2, y: 1 });
  });

  it('grantPhaseCharges：评分追加充能；createPuzzleState 每段重置（S17）', () => {
    const g = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 3, 4, 1],
      [1, 1, 1, 1, 1],
    ]);
    const patched = buildPuzzleRuleSet(DEFAULT_PUZZLE_RULE_SET, ['phase-walk']);
    expectOk(patched);
    const rules = (patched as { ok: true; ruleSet: typeof DEFAULT_PUZZLE_RULE_SET }).ruleSet;
    const s = grantPhaseCharges(createPuzzleState(g, rules), 2);
    expect(s.phaseCharges).toBe(5);
    expect(createPuzzleState(g, rules).phaseCharges).toBe(3); // 新段重置
  });
});

/* ============================== 阴阳位面 ================================== */

describe('move —— 阴阳位面', () => {
  // 阳面：右侧厢房被 x=3 的墙隔开；阴面：(3,1)(3,2) 两格变通路（位面捷径）
  const g = geom(
    [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 2, 0, 1, 0, 0, 1],
      [1, 3, 0, 1, 0, 4, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
    {
      shadeGrid: [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 1],
        [1, 3, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ] as TerrainCell[][],
      planeAnchors: [{ x: 1, y: 1 }],
    },
  );

  it('未解锁 plane-shift → plane-locked；锚点门槛 → no-anchor；嵌入墙 → embedded', () => {
    const s = createPuzzleState(g, DEFAULT_PUZZLE_RULE_SET);
    expect(applyPuzzleMove(s, DEFAULT_PUZZLE_RULE_SET, { type: 'shiftPlane' })).toMatchObject({ ok: false, reason: 'plane-locked' });

    const withPlane = { ...DEFAULT_PUZZLE_RULE_SET, planeShiftEnabled: true };
    // 玩家先走离锚点 (1,1) → 切位面被拒（no-anchor）
    const offAnchor = expectOkOrThrow(applyPuzzleMove(s, withPlane, { type: 'move', dir: 'right' }));
    expect(applyPuzzleMove(offAnchor, withPlane, { type: 'shiftPlane' })).toMatchObject({ ok: false, reason: 'no-anchor' });

    // 回到锚点 → 可切
    const backAtAnchor = expectOkOrThrow(applyPuzzleMove(offAnchor, withPlane, { type: 'move', dir: 'left' }));
    const r = applyPuzzleMove(backAtAnchor, withPlane, { type: 'shiftPlane' });
    expectOk(r);
    const st = (r as { ok: true; state: PuzzleState }).state;
    expect(st.planeShifted).toBe(true);

    // 阴面绕到阳面墙格 (3,2) → 切回被拒（embedded）
    const moved = expectOkOrThrow(applyPuzzleMove(st, withPlane, { type: 'move', dir: 'right' }));
    const down = expectOkOrThrow(applyPuzzleMove(moved, withPlane, { type: 'move', dir: 'down' }));
    const corridor = expectOkOrThrow(applyPuzzleMove(down, withPlane, { type: 'move', dir: 'right' }));
    expect(corridor.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 2 });
    // 无位面之眼时先被锚点门槛拦下（(3,2) 非锚点）；换位面之眼规则验证嵌入墙检查
    expect(applyPuzzleMove(corridor, withPlane, { type: 'shiftPlane' })).toMatchObject({ ok: false, reason: 'no-anchor' });
    const eye = buildPuzzleRuleSet(DEFAULT_PUZZLE_RULE_SET, ['plane-shift', 'plane-eye']);
    expectOk(eye);
    const eyeRules = (eye as { ok: true; ruleSet: typeof DEFAULT_PUZZLE_RULE_SET }).ruleSet;
    expect(applyPuzzleMove(corridor, eyeRules, { type: 'shiftPlane' })).toMatchObject({ ok: false, reason: 'embedded' });

    // 走回两面共通格 (2,2) → 位面之眼下可切回
    const backToCommon = expectOkOrThrow(applyPuzzleMove(corridor, eyeRules, { type: 'move', dir: 'left' }));
    const back = applyPuzzleMove(backToCommon, eyeRules, { type: 'shiftPlane' });
    expectOk(back);
    expect((back as { ok: true; state: PuzzleState }).state.planeShifted).toBe(false);

    // 位面切换与移动一样计入撤销栈（8 次成功动作 = 8 个切片）
    expect(historyDepth((back as { ok: true; state: PuzzleState }).state)).toBe(8);
  });

  it('位面之眼：任意位置可切，无需锚点', () => {
    const patched = buildPuzzleRuleSet(DEFAULT_PUZZLE_RULE_SET, ['plane-shift', 'plane-eye']);
    expectOk(patched);
    const rules = (patched as { ok: true; ruleSet: typeof DEFAULT_PUZZLE_RULE_SET }).ruleSet;
    let s = createPuzzleState(g, rules);
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'right' })); // (2,1) 非锚点
    const r = applyPuzzleMove(s, rules, { type: 'shiftPlane' });
    expectOk(r);
    expect((r as { ok: true; state: PuzzleState }).state.planeShifted).toBe(true);
  });

  it('阴阳旗位并集判定：阴面走廊拉箱归位阳面旗 → 达标', () => {
    const patched = buildPuzzleRuleSet(DEFAULT_PUZZLE_RULE_SET, ['plane-shift', 'plane-eye', 'mirror-pull']);
    expectOk(patched);
    const rules = (patched as { ok: true; ruleSet: typeof DEFAULT_PUZZLE_RULE_SET }).ruleSet;
    let s = createPuzzleState(g, rules);
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'shiftPlane' })); // 切阴面
    // 绕到箱子西侧 (4,2)
    for (const dir of ['right', 'down', 'right', 'right'] as const) {
      s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir }));
    }
    expect(s.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 4, y: 2 });
    // 镜像拉箱 ×3：箱 (5,2)→(4,2)→(3,2)→(2,2)，玩家随退
    for (let i = 0; i < 3; i++) {
      s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'pull', dir: 'right' }));
    }
    expect(s.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 2, y: 2 });
    expect(isSolved(s.geometry, s.entities)).toBe(false);
    // 玩家绕到箱子东侧 (3,2)，平推左一格上旗
    for (const dir of ['up', 'right', 'right', 'down'] as const) {
      s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir }));
    }
    expect(s.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 2 });
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'left' }));
    expect(s.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 1, y: 2 });
    expect(isSolved(s.geometry, s.entities)).toBe(true);
  });
});

/* ====================== MECH-4 数据过滤器（过滤器而非新物理） ================= */

describe('move —— 旗位顺序闸（MECH-4 goalOrder）', () => {
  // 三龛一字排开：goalOrder 要求 (1,3)→(3,3)→(5,3) 西→中→东依次落座
  const g = geom(
    [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 2, 0, 0, 0, 0, 1],
      [1, 4, 0, 4, 0, 4, 1],
      [1, 3, 0, 3, 0, 3, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
    { goalOrder: [{ x: 1, y: 3 }, { x: 3, y: 3 }, { x: 5, y: 3 }] },
  );
  const rules = DEFAULT_PUZZLE_RULE_SET;

  it('乱序拒：首推直入清单第 2 龛 → order-locked，局面原样', () => {
    const s = createPuzzleState(g, rules);
    // 玩家走到中龛上方 (3,1)，向下推箱：落格 (3,3) 是 goalOrder[1]，前缀 0 → 拒
    let moved = s;
    for (const dir of ['right', 'right'] as const) {
      moved = expectOkOrThrow(applyPuzzleMove(moved, rules, { type: 'move', dir }));
    }
    const r = applyPuzzleMove(moved, rules, { type: 'move', dir: 'down' });
    expect(r).toMatchObject({ ok: false, reason: 'order-locked' });
    // 纯函数：被拒动作不产生任何位移
    expect((r as { ok: false; state: PuzzleState }).state.entities).toEqual(moved.entities);
    expect(goalOrderPrefix(g, moved.entities)).toBe(0);
  });

  it('顺序过：西→中→东依次落座；前缀随落座推进，终局达标', () => {
    let s = createPuzzleState(g, rules);
    // 西龛：玩家 (1,1) 下推，箱 (1,2)→(1,3)
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'down' }));
    expect(goalOrderPrefix(g, s.entities)).toBe(1);
    // 中龛：绕回 (3,1) 下推，箱 (3,2)→(3,3)
    for (const dir of ['up', 'right', 'right'] as const) {
      s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir }));
    }
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'down' }));
    expect(goalOrderPrefix(g, s.entities)).toBe(2);
    // 东龛：绕到 (5,1) 下推，箱 (5,2)→(5,3) → 三龛齐座
    for (const dir of ['up', 'right', 'right'] as const) {
      s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir }));
    }
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'down' }));
    expect(goalOrderPrefix(g, s.entities)).toBe(3);
    expect(isSolved(g, s.entities)).toBe(true);
  });

  it('清单外旗格不受理序约束；撤销后语义由箱位自然回滚（无状态残留）', () => {
    // goalOrder 只约束 (1,3)；(3,3) 在清单外 → 前缀 0 时也可自由落座
    const gFree = geom(
      [
        [1, 1, 1, 1, 1],
        [1, 2, 0, 0, 1],
        [1, 4, 0, 4, 1],
        [1, 3, 0, 3, 1],
        [1, 1, 1, 1, 1],
      ],
      { goalOrder: [{ x: 1, y: 3 }] },
    );
    let s = createPuzzleState(gFree, rules);
    // 先落清单外龛 (3,3)
    for (const dir of ['right', 'right'] as const) {
      s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir }));
    }
    s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir: 'down' }));
    expect(s.entities.find((e) => e.id === 'chest-2')).toMatchObject({ x: 3, y: 3 });
    // 撤销把箱位原样回滚；前缀由箱位派生 → 顺序语义无残留（不用 Z 也改不坏）
    const undone = undoPuzzle(s);
    expect(undone.entities.find((e) => e.id === 'chest-2')).toMatchObject({ x: 3, y: 2 });
    // 落清单内龛 (1,3)，再绕回 (3,1) 把 chest-2 下推回清单外龛 → 达标
    let back = undone;
    for (const dir of ['left', 'left'] as const) {
      back = expectOkOrThrow(applyPuzzleMove(back, rules, { type: 'move', dir }));
    }
    back = expectOkOrThrow(applyPuzzleMove(back, rules, { type: 'move', dir: 'down' }));
    expect(back.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 1, y: 3 });
    for (const dir of ['up', 'right', 'right', 'down'] as const) {
      back = expectOkOrThrow(applyPuzzleMove(back, rules, { type: 'move', dir }));
    }
    expect(back.entities.find((e) => e.id === 'chest-2')).toMatchObject({ x: 3, y: 3 });
    expect(isSolved(gFree, back.entities)).toBe(true);
  });

  it('拉箱/箱落/斜推入清单旗格同样过闸（法则卡绕不开顺序谜题）', () => {
    // 拉箱：箱 (1,1)、玩家 (2,1)，pull left → 箱入玩家原格 (2,1)=goalOrder[1] → 拒
    const pullRows = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 4, 2, 0, 3, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ];
    const pullGrid = geom(pullRows, { goalOrder: [{ x: 4, y: 1 }, { x: 2, y: 1 }] });
    const pullPatched = buildPuzzleRuleSet(rules, ['mirror-pull']);
    expectOk(pullPatched);
    const pullRules = (pullPatched as { ok: true; ruleSet: typeof rules }).ruleSet;
    const sPull = createPuzzleState(pullGrid, pullRules);
    expect(applyPuzzleMove(sPull, pullRules, { type: 'pull', dir: 'left' })).toMatchObject({
      ok: false,
      reason: 'order-locked',
    });
    // 同一局面去掉 goalOrder：拉箱自由（过滤器只随数据生效）
    const pullPlainParsed = parseLevelGeometry(def('t-pull-plain', pullRows));
    expectOk(pullPlainParsed);
    if (!pullPlainParsed.ok) return;
    const rPull = applyPuzzleMove(createPuzzleState(pullPlainParsed.geometry, pullRules), pullRules, { type: 'pull', dir: 'left' });
    expectOk(rPull);
    expect((rPull as { ok: true; state: PuzzleState }).state.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 2, y: 1 });

    // 箱落：箱 (3,1) 从 h2 推向 h0 旗位 (4,1)=goalOrder[1]（前缀 0）→ 拒
    const fallRows = [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 0, 2, 4, 3, 0, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ];
    const fallHeights = [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 2, 2, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ];
    const fallGrid = geom(fallRows, {
      heights: fallHeights,
      goalOrder: [{ x: 5, y: 1 }, { x: 4, y: 1 }],
    });
    const sFall = createPuzzleState(fallGrid, rules);
    expect(applyPuzzleMove(sFall, rules, { type: 'move', dir: 'right' })).toMatchObject({
      ok: false,
      reason: 'order-locked',
    });
    const fallPlainParsed = parseLevelGeometry(def('t-fall-plain', fallRows, { heights: fallHeights }));
    expectOk(fallPlainParsed);
    if (!fallPlainParsed.ok) return;
    const rFall = applyPuzzleMove(createPuzzleState(fallPlainParsed.geometry, rules), rules, { type: 'move', dir: 'right' });
    expectOk(rFall);
    expect((rFall as { ok: true; state: PuzzleState }).state.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 4, y: 1 });

    // 斜推：箱 (2,2) 斜推入 (3,3)=goalOrder[1]（前缀 0）→ 拒
    const diagRows = [
      [1, 1, 1, 1, 1, 1],
      [1, 2, 0, 0, 0, 1],
      [1, 0, 4, 0, 0, 1],
      [1, 0, 0, 3, 0, 1],
      [1, 1, 1, 1, 1, 1],
    ];
    const diagPatched = buildPuzzleRuleSet(rules, ['diagonal-push']);
    expectOk(diagPatched);
    const diagRules = (diagPatched as { ok: true; ruleSet: typeof rules }).ruleSet;
    const diagGrid = geom(diagRows, { goalOrder: [{ x: 1, y: 3 }, { x: 3, y: 3 }] });
    const sDiag = createPuzzleState(diagGrid, diagRules);
    expect(applyPuzzleMove(sDiag, diagRules, { type: 'diagonal', diag: 'downright' })).toMatchObject({
      ok: false,
      reason: 'order-locked',
    });
    const diagPlainParsed = parseLevelGeometry(def('t-diag-plain', diagRows));
    expectOk(diagPlainParsed);
    if (!diagPlainParsed.ok) return;
    const rDiag = applyPuzzleMove(createPuzzleState(diagPlainParsed.geometry, diagRules), diagRules, { type: 'diagonal', diag: 'downright' });
    expectOk(rDiag);
    expect((rDiag as { ok: true; state: PuzzleState }).state.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 3 });
  });
});

describe('move —— 单向阀（MECH-4 oneWay：玩家位移过滤、箱不受限）', () => {
  // 阀格 (3,1) 仅允许自西向东（right）进入；箱子放在 (2,2) 不挡阀下格
  const g = geom(
    [
      [1, 1, 1, 1, 1, 1, 1],
      [1, 2, 0, 0, 0, 0, 1],
      [1, 0, 4, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 3, 1],
      [1, 1, 1, 1, 1, 1, 1],
    ],
    { oneWay: [{ cell: { x: 3, y: 1 }, allow: 'right' }] },
  );
  const rules = DEFAULT_PUZZLE_RULE_SET;

  it('顺过：沿箭头方向穿行阀格放行', () => {
    const s = createPuzzleState(g, rules);
    let moved = s;
    for (const dir of ['right', 'right', 'right'] as const) {
      moved = expectOkOrThrow(applyPuzzleMove(moved, rules, { type: 'move', dir }));
    }
    expect(moved.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 4, y: 1 });
    expect(playerMayEnter(g, { x: 3, y: 1 }, 'right')).toBe(true);
  });

  it('逆拒/侧拒：逆向与垂直方向进入阀格 → one-way，位置不变', () => {
    let s = createPuzzleState(g, rules);
    for (const dir of ['right', 'right', 'right'] as const) {
      s = expectOkOrThrow(applyPuzzleMove(s, rules, { type: 'move', dir }));
    }
    // 逆向：自东向西再进阀格被拒
    const back = applyPuzzleMove(s, rules, { type: 'move', dir: 'left' });
    expect(back).toMatchObject({ ok: false, reason: 'one-way' });
    // 侧拒：从 (3,2) 向上进入阀格同样被拒
    let side = s;
    for (const dir of ['down', 'left'] as const) {
      side = expectOkOrThrow(applyPuzzleMove(side, rules, { type: 'move', dir }));
    }
    expect(side.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 2 });
    const up = applyPuzzleMove(side, rules, { type: 'move', dir: 'up' });
    expect(up).toMatchObject({ ok: false, reason: 'one-way' });
    expect(playerMayEnter(g, { x: 3, y: 1 }, 'up')).toBe(false);
    expect(playerMayEnter(g, { x: 3, y: 1 }, 'left')).toBe(false);
  });

  it('箱不受限：箱可被推上/推离/停在阀格；玩家跟进才按阀向过滤', () => {
    // 箱 (3,2) 在阀格正下方：玩家绕到 (3,3) 向上把箱「逆行」推上阀格 → 自由
    const gChest = geom(
      [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 2, 0, 0, 0, 0, 1],
        [1, 0, 0, 4, 0, 0, 1],
        [1, 0, 0, 0, 0, 3, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ],
      { oneWay: [{ cell: { x: 3, y: 1 }, allow: 'right' }] },
    );
    let moved = createPuzzleState(gChest, rules);
    for (const dir of ['down', 'down', 'right', 'right'] as const) {
      moved = expectOkOrThrow(applyPuzzleMove(moved, rules, { type: 'move', dir }));
    }
    expect(moved.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 3 });
    moved = expectOkOrThrow(applyPuzzleMove(moved, rules, { type: 'move', dir: 'up' }));
    expect(moved.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 1 }); // 箱停在阀格
    expect(moved.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 2 });
    // 玩家绕到阀格西侧沿箭头推箱离阀：箱出阀自由，玩家跟进方向与阀向一致
    for (const dir of ['down', 'left', 'up', 'up'] as const) {
      moved = expectOkOrThrow(applyPuzzleMove(moved, rules, { type: 'move', dir }));
    }
    expect(moved.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 2, y: 1 });
    moved = expectOkOrThrow(applyPuzzleMove(moved, rules, { type: 'move', dir: 'right' }));
    expect(moved.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 4, y: 1 });
    expect(moved.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 1 }); // 玩家自西向东进阀格 ✓
  });
});

/* ============================== 撤销栈 ==================================== */

describe('undo —— 撤销栈', () => {
  const g = geom([
    [1, 1, 1, 1, 1, 1],
    [1, 2, 4, 0, 0, 1],
    [1, 0, 0, 0, 3, 1],
    [1, 1, 1, 1, 1, 1],
  ]);
  const rules = DEFAULT_PUZZLE_RULE_SET;

  it('移动后撤销：实体/步数/推数一体回滚；空栈撤销原样返回', () => {
    const s0 = createPuzzleState(g, rules);
    expect(canUndo(s0)).toBe(false);
    expect(undoPuzzle(s0)).toBe(s0); // 空栈原样返回（不抛错）

    const s1 = expectOkOrThrow(applyPuzzleMove(s0, rules, { type: 'move', dir: 'right' })); // 推箱
    const s2 = expectOkOrThrow(applyPuzzleMove(s1, rules, { type: 'move', dir: 'down' }));
    expect(historyDepth(s2)).toBe(2);

    const back1 = undoPuzzle(s2);
    expect(back1.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 2, y: 1 });
    expect(back1.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 3, y: 1 });
    expect(back1.steps).toBe(s1.steps);
    expect(back1.pushes).toBe(s1.pushes);

    const back0 = undoPuzzle(back1);
    expect(back0.entities).toEqual(s0.entities);
    expect(back0.history.length).toBe(0);
  });

  it('撤销栈上限 HISTORY_LIMIT：旧切片滚出，不无限增长', () => {
    const open = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 3, 4, 1],
      [1, 1, 1, 1, 1],
    ]);
    let s = createPuzzleState(open, rules);
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      const dir = i % 2 === 0 ? 'right' : 'left';
      const r = applyPuzzleMove(s, rules, { type: 'move', dir });
      expectOk(r);
      s = (r as { ok: true; state: PuzzleState }).state;
    }
    expect(historyDepth(s)).toBe(HISTORY_LIMIT);
  });
});

/* ============================== 死角检测 ================================== */

describe('deadlock —— 死角与冻结', () => {
  it('静态死角：推不回旗位的角落格被标记，旗位与其可达格是活格', () => {
    const g = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 4, 0, 1],
      [1, 3, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ]);
    const dead = computeDeadSquares(g);
    expect(dead.has('1,1')).toBe(true); // 左上角死角
    expect(dead.has('1,2')).toBe(false); // 旗位是活格
    expect(dead.has('2,2')).toBe(false); // 可推到旗旁
  });

  it('运行时判定：死角箱 → dead-square；2×2 墙/箱冻结块 → frozen', () => {
    const g1 = geom([
      [1, 1, 1, 1, 1],
      [1, 2, 4, 0, 1],
      [1, 3, 0, 0, 1],
      [1, 1, 1, 1, 1],
    ]);
    const s1 = createPuzzleState(g1, DEFAULT_PUZZLE_RULE_SET);
    // 玩家绕到箱子东侧 (3,1) 再向左推，把箱子推进死角 (1,1)
    let moved = s1;
    for (const dir of ['down', 'right', 'right', 'up'] as const) {
      moved = expectOkOrThrow(applyPuzzleMove(moved, DEFAULT_PUZZLE_RULE_SET, { type: 'move', dir }));
    }
    expect(moved.entities.find((e) => e.id === 'player-1')).toMatchObject({ x: 3, y: 1 });
    moved = expectOkOrThrow(applyPuzzleMove(moved, DEFAULT_PUZZLE_RULE_SET, { type: 'move', dir: 'left' }));
    expect(moved.entities.find((e) => e.id === 'chest-1')).toMatchObject({ x: 1, y: 1 });
    const report = checkDeadlock(g1, moved.entities);
    expect(report.deadlocked).toBe(true);
    expect(report.reason).toBe('dead-square');

    const g2 = geom([
      [1, 1, 1, 1, 1, 1],
      [1, 2, 1, 1, 0, 1],
      [1, 0, 4, 4, 0, 1],
      [1, 3, 0, 0, 3, 1],
      [1, 1, 1, 1, 1, 1],
    ]);
    const s2 = createPuzzleState(g2, DEFAULT_PUZZLE_RULE_SET);
    const report2 = checkDeadlock(g2, s2.entities);
    expect(report2.deadlocked).toBe(true);
    expect(report2.reason).toBe('frozen');
    expect([...report2.chestIds].sort()).toEqual(['chest-1', 'chest-2']);
  });
});

/* ============================== 补丁注册表 ================================ */

describe('rules —— 谜题法则补丁注册表（单一真相：core/lawRegistry）', () => {
  it('全部 17 个补丁 id 可经 core 注册表应用；未知 id 拒绝；叠加有钳制', () => {
    let rules = DEFAULT_PUZZLE_RULE_SET;
    for (const id of LAW_PATCH_IDS) {
      const r = buildPuzzleRuleSet(rules, [id]);
      expectOk(r);
      rules = (r as { ok: true; ruleSet: typeof rules }).ruleSet;
    }
    expect(rules.pullEnabled).toBe(true);
    expect(rules.detonationCharges).toBe(2); // chest-detonate +1、explode-plus-1 +1
    expect(rules.knockbackCells).toBe(2); // knockback-plus-2（combat 应用点）
    expect(buildPuzzleRuleSet(rules, ['no-such-law'])).toMatchObject({ ok: false });
  });

  it('buildPuzzleRuleSet 单一真相：所有补丁经 core 注册表，未知 id 整体失败', () => {
    expect(buildPuzzleRuleSet(DEFAULT_PUZZLE_RULE_SET, ['wider-push', 'mirror-pull', 'unknown-x'])).toMatchObject({ ok: false });
    const okCase = buildPuzzleRuleSet(DEFAULT_PUZZLE_RULE_SET, ['wider-push', 'mirror-pull']);
    expectOk(okCase);
    const rules = (okCase as { ok: true; ruleSet: typeof DEFAULT_PUZZLE_RULE_SET }).ruleSet;
    expect(rules.pushRange).toBe(2); // core applyPatchChain 产出
    expect(rules.pullEnabled).toBe(true); // 同一注册表产出（无副本表）
    expect(rules.moveCost).toBe(1); // 其余字段保留默认
  });
});
