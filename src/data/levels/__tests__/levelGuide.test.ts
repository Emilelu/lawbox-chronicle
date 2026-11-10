/**
 * 关卡攻略数据单测 —— 面板与文档 HTML 共用的 buildLevelGuide。
 */

import { describe, expect, it } from 'vitest';
import { AREA_LEVELS } from '../areas';
import { PRECOMPUTED_SOLUTIONS } from '../solutionSteps';
import { buildLevelGuide } from '../levelGuide';

describe('levelGuide —— 主线关攻略', () => {
  it('主线 12 关每关都有攻略，推法数与预计算解路一致', () => {
    for (const level of AREA_LEVELS) {
      const guide = buildLevelGuide(level.id);
      expect(guide.known, `${level.id} 应为已知主线关`).toBe(true);
      expect(guide.name).toBe(level.name);
      expect(guide.pushes.length).toBe(PRECOMPUTED_SOLUTIONS[level.id]?.length ?? -1);
      expect(guide.stars.three).toBe(level.parSteps[0]);
      expect(guide.stars.two).toBe(level.parSteps[1]);
      expect(guide.mechanics.length).toBeGreaterThan(0);
    }
  });

  it('机制提示按关卡数据推导', () => {
    const hub = buildLevelGuide('level-sb-01');
    expect(hub.mechanics.some((m) => m.includes('星愿祭坛'))).toBe(true);
    expect(hub.mechanics.some((m) => m.includes('尖刺'))).toBe(true);

    const yin = buildLevelGuide('level-lb-09');
    expect(yin.mechanics.some((m) => m.includes('阴阳位面'))).toBe(true);

    const guards = buildLevelGuide('level-lb-08');
    expect(guards.mechanics.some((m) => m.includes('守卫'))).toBe(true);

    const height = buildLevelGuide('level-lb-08');
    expect(height.mechanics.some((m) => m.includes('立体高度层'))).toBe(true);
  });

  it('法则门提示与 LAW_GATES 一致（sb-02 需羽箱）', () => {
    const guide = buildLevelGuide('level-sb-02');
    expect(guide.gateHint).not.toBeNull();
    expect(guide.gateHint).toContain('羽箱');
  });

  it('推法描述含方向箭头与坐标', () => {
    const guide = buildLevelGuide('level-sb-01');
    expect(guide.pushes.length).toBeGreaterThan(0);
    const first = guide.pushes[0];
    expect(first?.arrow).toMatch(/^[↑↓←→]$/);
    expect(first?.label).toContain('(');
  });

  it('未知关卡（会话生成）返回无固定攻略的占位', () => {
    const guide = buildLevelGuide('endless-some-seed-1');
    expect(guide.known).toBe(false);
    expect(guide.pushes).toHaveLength(0);
    expect(guide.mechanics[0]).toContain('程序生成');
  });
});
