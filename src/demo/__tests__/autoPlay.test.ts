/**
 * 自动演示（autoplay）纯逻辑单测 —— URL 参数解析、演示角色、重试节拍（F2）。
 */

import { describe, expect, it } from 'vitest';
import {
  DEMO_MAX_LEVEL_RESETS,
  DEMO_STALL_MS,
  demoPlayer,
  levelRetryPlan,
  readAutoPlayConfig,
} from '../autoPlay';

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
