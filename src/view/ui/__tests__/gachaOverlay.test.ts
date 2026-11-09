/**
 * 帷幕界面层 · GachaOverlay 纯逻辑单测。
 * ---------------------------------------------------------------------------
 * 覆盖：flipDelays（Lottery.java:36 注释 sleep(500) 的真演出节奏表，落在
 * 融合计划的 300-800ms 区间）、pityProgress（层2硬保底可视化）、canPull、
 * rarityStars（Lottery.java:30 stars 数组的新渲染）。
 * 组件渲染不在此测（无 @testing-library；集成期统一验证）。
 */

import { describe, expect, it } from 'vitest';
import { canPull, flipDelays, pityProgress, rarityColor, rarityStars, shouldEnterReveal } from '../GachaOverlay';
import type { GachaPullResult } from '../../../core/types';

/** 构造最小合法的抽卡结果（pityTriggered 仅占位） */
function sampleResult(pullCount: number): GachaPullResult {
  return {
    pulls: Array.from({ length: pullCount }, (_, i) => ({
      uid: `uid-${i}`,
      cardId: 'card-law-feather-chest',
      rarity: 2,
      isNew: false,
    })),
    boostedTenPull: false,
    pityTriggered: 'none',
  };
}

describe('flipDelays · 翻牌演出节奏表', () => {
  it('十连：10 拍，首拍 420ms，相邻间隔 340ms，全部落在 300-800ms 演出区间', () => {
    const beats = flipDelays(10);
    expect(beats).toHaveLength(10);
    expect(beats[0]).toBe(420);
    expect(beats[0]).toBeGreaterThanOrEqual(300);
    expect(beats[0]).toBeLessThanOrEqual(800);
    for (let i = 1; i < beats.length; i++) {
      const gap = (beats[i] as number) - (beats[i - 1] as number);
      expect(gap).toBe(340); // 张间节奏恒定，且在 300-800ms 内
      expect(gap).toBeGreaterThanOrEqual(300);
      expect(gap).toBeLessThanOrEqual(800);
    }
    // 「全部落在 300-800ms 演出区间」指节奏参数本身（首拍 + 张间间隔）；
    // 累积时刻必然随张数线性增长，不应按时刻断言
    const rhythm = [beats[0] as number, ...beats.slice(1).map((b, i) => (b as number) - (beats[i] as number))];
    expect(rhythm.every((d) => d >= 300 && d <= 800)).toBe(true);
  });

  it('节拍严格递增（后一张绝不早于前一张翻开）', () => {
    const beats = flipDelays(10);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i] as number).toBeGreaterThan(beats[i - 1] as number);
    }
  });

  it('单抽：单拍 420ms；0 张：空表', () => {
    expect(flipDelays(1)).toEqual([420]);
    expect(flipDelays(0)).toEqual([]);
  });
});

describe('pityProgress · 层2硬保底进度', () => {
  it('线性映射并 clamp 到 [0,1]', () => {
    expect(pityProgress(0, 90)).toBe(0);
    expect(pityProgress(45, 90)).toBe(0.5);
    expect(pityProgress(90, 90)).toBe(1);
    expect(pityProgress(120, 90)).toBe(1); // 超界截断
    expect(pityProgress(-5, 90)).toBe(0); // 坏档负数防御
  });

  it('阈值非正时不产生 NaN', () => {
    expect(pityProgress(10, 0)).toBe(0);
  });
});

describe('canPull · 星石可负担性（BT6 真实经济）', () => {
  it('单抽边界', () => {
    expect(canPull(100, 1, 100)).toBe(true);
    expect(canPull(99, 1, 100)).toBe(false);
    expect(canPull(0, 1, 100)).toBe(false);
  });

  it('十连边界（900◈）', () => {
    expect(canPull(900, 10, 100)).toBe(true);
    expect(canPull(899, 10, 100)).toBe(false);
  });
});

describe('rarity 展示', () => {
  it('rarityStars 按稀有度重复实星（Lottery.java:30 的 HTML 时代重排版）', () => {
    expect(rarityStars(2)).toBe('★★');
    expect(rarityStars(3)).toBe('★★★');
    expect(rarityStars(4)).toBe('★★★★');
  });

  it('rarityColor 三档配色（4★金 / 3★紫 / 2★灰）', () => {
    expect(rarityColor(4)).not.toBe(rarityColor(3));
    expect(rarityColor(3)).not.toBe(rarityColor(2));
  });
});

describe('shouldEnterReveal · F1 翻牌面准入（重开面板可回到投币主页）', () => {
  it('新结果进翻牌面；看过的结果重开不再进翻牌面', () => {
    const result = sampleResult(1);
    expect(shouldEnterReveal(result, false)).toBe(true);
    expect(shouldEnterReveal(result, true)).toBe(false);
  });

  it('lastResult 为 null（未抽过 / 持久化空）永远走投币主页', () => {
    expect(shouldEnterReveal(null, false)).toBe(false);
    expect(shouldEnterReveal(null, true)).toBe(false);
  });

  it('十连结果同样只展示一次', () => {
    const result = sampleResult(10);
    expect(shouldEnterReveal(result, false)).toBe(true);
    expect(shouldEnterReveal(result, true)).toBe(false);
  });
});
