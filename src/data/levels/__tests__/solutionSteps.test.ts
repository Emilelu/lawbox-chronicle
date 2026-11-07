/**
 * 自动演示预计算解路 —— 逐关回放校验（防止关卡数据改动后解路过期）。
 */

import { describe, expect, it } from 'vitest';
import { AREA_LEVELS } from '../areas';
import { PRECOMPUTED_SOLUTIONS } from '../solutionSteps';
import { parseLevelGeometry } from '../../../engine/puzzle/grid';
import { replaySolution } from '../../../engine/puzzle/solver';

describe('自动演示解路（预计算数据）', () => {
  it('每关都有预计算解路，且逐格回放通过', () => {
    for (const level of AREA_LEVELS) {
      const steps = PRECOMPUTED_SOLUTIONS[level.id];
      expect(steps?.length ?? 0, `${level.id} 缺少预计算解路`).toBeGreaterThan(0);
      if (steps === undefined) continue;
      const parsed = parseLevelGeometry(level);
      expect(parsed.ok, `${level.id} 几何解析`).toBe(true);
      if (!parsed.ok) continue;
      const replay = replaySolution(parsed.geometry, steps);
      expect(replay.ok, `${level.id}: ${replay.error ?? ''}`).toBe(true);
    }
  });

  it('解路里的每一步都指向真实的被推实体（chest/enemy）', () => {
    for (const level of AREA_LEVELS) {
      const steps = PRECOMPUTED_SOLUTIONS[level.id] ?? [];
      for (const step of steps) {
        expect(['chest', 'enemy']).toContain(step.kind);
        expect(Number.isInteger(step.stand.x) && Number.isInteger(step.stand.y)).toBe(true);
        expect(Number.isInteger(step.from.x) && Number.isInteger(step.from.y)).toBe(true);
      }
    }
  });
});
