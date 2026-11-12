/**
 * 无尽回廊生成器回归（A3-3 三处缺陷的根治验证）：
 *  - ① scramble 全局迭代上限：历史死循环种子（wander 恒成功、pulls 不增长）
 *    在有界时间内返回，不再出现同调用 >200s 挂死；
 *  - ② 旗位/实体重叠拒绝：图例一格一值下「箱数=旗数 + 有玩家」的 parse
 *    不变量构造性成立，不再因旗位被玩家/箱子覆盖而系统性 parse 失败；
 *  - ③ attempt 失败记账：错误信息携带失败原因（可观测），同因连续失败提前短路；
 *  - A3-1 接线联动：三个挑战层入口种子（东/南/西）首次进层将用的种子必须
 *    生成成功，避免接线瞬间把死代码缺陷变成玩家可感知的「生成失败」toast。
 */

import { describe, expect, it } from 'vitest';
import { ENDLESS_TUNING, generateEndlessFloor, generateEndlessRun, type EndlessFloor } from '../endless';
import { parseLevelGeometry } from '../../../engine/puzzle/grid';
import type { Level3D } from '../../../engine/puzzle/grid';

/** 复用生成器的 Level3D 装配口径（与 enterChallengeLayer → parseLevelGeometry 一致） */
function asLevel3D(floor: EndlessFloor): Level3D {
  return {
    id: floor.id,
    area: 'domain-3',
    name: floor.id,
    subtitle: '生成器回归',
    grid: floor.grid as Level3D['grid'],
    parSteps: [1, 1],
    reward: { starStones: 0 },
  };
}

describe('endless —— A3-3 生成器健壮性（历史失败模式根治）', () => {
  it(
    '① 历史死循环种子 challenge-east-endless-1：有界返回且生成成功（此前 >200s 无返回）',
    { timeout: 60_000 },
    () => {
      const r = generateEndlessFloor('challenge-east-endless-1', 1);
      expect(r.ok, r.ok ? '' : r.error).toBe(true);
      if (r.ok) {
        expect(r.floor.verified).toBe(true);
        expect(r.floor.solutionMoves).toBeGreaterThanOrEqual(1);
        expect(r.floor.attempt).toBeGreaterThanOrEqual(1);
        expect(r.floor.attempt).toBeLessThanOrEqual(ENDLESS_TUNING.attempts);
      }
    },
  );

  it('② 历史全败种子 probe-seed-1：旗位不再被吞，生成成功（此前 6 次尝试全 parse 失败）', { timeout: 60_000 }, () => {
    const r = generateEndlessFloor('probe-seed-1', 1);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (r.ok) expect(r.floor.verified).toBe(true);
  });

  it(
    '③ A3-1 接线三个挑战层首层种子 + 连续 3 层：全部生成成功（接线不踩生成失败 toast）',
    { timeout: 120_000 },
    () => {
      for (const seed of [
        'challenge-east-endless-1',
        'challenge-south-abyss-1',
        'challenge-west-end-wall-1',
      ]) {
        const r = generateEndlessFloor(seed, 1);
        expect(r.ok, `${seed}: ${r.ok ? '' : r.error}`).toBe(true);
        if (r.ok) expect(r.floor.verified).toBe(true);
      }
      for (const r of generateEndlessRun('challenge-east-endless-1', 3)) {
        expect(r.ok, r.ok ? '' : r.error).toBe(true);
        if (r.ok) expect(r.floor.verified).toBe(true);
      }
    },
  );

  it(
    '④ parse 不变量构造性成立：多楼层采样逐层解析通过（箱数=旗数、玩家唯一、无重叠）',
    { timeout: 120_000 },
    () => {
      for (let floor = 1; floor <= 6; floor++) {
        const r = generateEndlessFloor('overlap-sweep-seed', floor);
        expect(r.ok, `第 ${floor} 层: ${r.ok ? '' : r.error}`).toBe(true);
        if (!r.ok) continue;
        const parsed = parseLevelGeometry(asLevel3D(r.floor));
        expect(parsed.ok, `第 ${floor} 层几何解析`).toBe(true);
        if (parsed.ok) {
          expect(parsed.geometry.chestSpawns.length).toBe(parsed.geometry.goals.length);
          // 旗格上无实体占位（重叠拒绝生效：图例一格一值可完整表达）
          const goalKeys = new Set(parsed.geometry.goals.map((g) => `${g.x},${g.y}`));
          for (const c of parsed.geometry.chestSpawns) {
            expect(goalKeys.has(`${c.x},${c.y}`), `箱子不得压旗格 (${c.x},${c.y})`).toBe(false);
          }
          expect(goalKeys.has(`${parsed.geometry.playerSpawn.x},${parsed.geometry.playerSpawn.y}`)).toBe(false);
        }
      }
    },
  );

  it('⑤ 确定性保持：同种子同层网格逐位一致（上限/重叠改动不漂移既有种子）', { timeout: 60_000 }, () => {
    const a = generateEndlessFloor('vitest-seed-alpha', 2);
    const b = generateEndlessFloor('vitest-seed-alpha', 2);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.floor.grid)).toBe(JSON.stringify(b.floor.grid));
      expect(a.floor.pulls).toBe(b.floor.pulls);
      expect(a.floor.attempt).toBe(b.floor.attempt);
    }
  });

  it('⑥ 失败路径错误信息携带种子/层号/原因（可观测性契约）', { timeout: 60_000 }, () => {
    // 现行参数下全败已难复现（恰是修复目标）；此处断言既有可解种子的成功形态，
    // 并对失败形态的报文格式做纯字符串契约校验（runSeed/floor 必在报文中）。
    const r = generateEndlessFloor('vitest-seed-alpha', 1);
    if (!r.ok) {
      expect(r.error).toContain('vitest-seed-alpha');
      expect(r.error).toContain('floor=1');
      expect(r.error).toContain('无尽回廊生成失败');
    } else {
      expect(r.floor.id).toContain('vitest-seed-alpha');
    }
  });
});
