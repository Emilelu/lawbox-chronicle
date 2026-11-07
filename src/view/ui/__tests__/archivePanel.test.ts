/**
 * 帷幕界面层 · ArchivePanel 纯逻辑单测。
 * ---------------------------------------------------------------------------
 * 覆盖：codexRows（图鉴首获/次数与排序）、achievementRows（secret 遮罩）、
 * latestPulls（最新在前 + limit）、poolComparison（复用 statsCollector 曲线）、
 * pullLabel（怀旧展品/正式卡标签）、curvePolyline（SVG 点串）。
 */

import { describe, expect, it } from 'vitest';
import type { CardDef } from '../../../core/types';
import type { PullRecord, StatsState } from '../../../archive/statsCollector';
import {
  achievementRows,
  codexRows,
  curvePolyline,
  latestPulls,
  poolComparison,
  pullLabel,
} from '../ArchivePanel';

const CARDS: readonly CardDef[] = [
  { id: 'law-a', kind: 'law', name: '法则A', rarity: 4, description: '' },
  { id: 'chr-b', kind: 'character', name: '角色B', rarity: 3, description: '' },
  { id: 'law-c', kind: 'law', name: '法则C', rarity: 2, description: '' },
];

const emptyStats: StatsState = {
  pullHistory: [],
  battleHistory: [],
  combatLogTail: [],
  poolTallies: {},
  counters: { pushBlocked: 0, goalBursts: 0, critShakes: 0, gachaBursts: 0, planeShifts: 0 },
  lastResultFingerprint: null,
  combatLogCursor: 0,
};

describe('codexRows · 图鉴行', () => {
  it('未获得补零；稀有度降序、同稀有度按 id 稳定排序', () => {
    const rows = codexRows(
      { 'law-a': { cardId: 'law-a', firstSeenAt: 100, obtainedCount: 2 } },
      CARDS,
    );
    expect(rows.map((r) => r.card.id)).toEqual(['law-a', 'chr-b', 'law-c']);
    expect(rows[0]).toMatchObject({ obtained: true, firstSeenAt: 100, obtainedCount: 2 });
    expect(rows[1]).toMatchObject({ obtained: false, firstSeenAt: null, obtainedCount: 0 });
  });

  it('空图鉴 → 全表均未获得', () => {
    const rows = codexRows({}, CARDS);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.obtained === false && r.obtainedCount === 0)).toBe(true);
  });
});

describe('achievementRows · 成就行', () => {
  it('secret 未解锁遮罩为「？？？」；非 secret 未解锁显示标题', () => {
    const rows = achievementRows({ 'ach-first-clear': 1234 });
    const first = rows.find((r) => r.def.id === 'ach-first-clear');
    const secret = rows.find((r) => r.def.id === 'ach-eg-fist-boss');
    expect(first?.unlocked).toBe(true);
    expect(first?.displayTitle).toBe('石板归位');
    expect(secret?.unlocked).toBe(false);
    expect(secret?.displayTitle).toBe('？？？');
  });
});

describe('latestPulls · 逐抽记录排序', () => {
  const pulls: readonly PullRecord[] = [1, 2, 3].map((i) => ({
    uid: `u${i}`,
    cardId: 'law-a',
    rarity: 4 as const,
    isNew: false,
    poolId: 'star-wish-altar',
    pullIndex: i,
    at: i,
  }));

  it('最新在前；limit 生效；0/负值返回空表', () => {
    expect(latestPulls(pulls, 2).map((p) => p.uid)).toEqual(['u3', 'u2']);
    expect(latestPulls(pulls, 10).map((p) => p.uid)).toEqual(['u3', 'u2', 'u1']);
    expect(latestPulls(pulls, 0)).toEqual([]);
    expect(latestPulls(pulls, -1)).toEqual([]);
  });
});

describe('poolComparison · 双池对比', () => {
  it('空统计不伪造率值（fourStarRate 为 null，曲线为空）', () => {
    const c = poolComparison(emptyStats);
    expect(c.official.pulls).toBe(0);
    expect(c.official.fourStarRate).toBeNull();
    expect(c.nostalgia.fourStarRate).toBeNull();
    expect(c.officialCurve).toEqual([]);
    expect(c.nostalgiaCurve).toEqual([]);
  });
});

describe('pullLabel · 逐抽标签', () => {
  it('怀旧展品按稀有度标名，正式卡回落卡名，未知 id 回落 id', () => {
    const nostalgia: PullRecord = {
      uid: 'n1',
      cardId: 'nostalgia-star-four',
      rarity: 4,
      isNew: false,
      poolId: 'nostalgia-lottery',
      pullIndex: 1,
      at: 1,
    };
    const official: PullRecord = {
      uid: 'o1',
      cardId: 'law-a',
      rarity: 4,
      isNew: false,
      poolId: 'star-wish-altar',
      pullIndex: 1,
      at: 1,
    };
    const ghost: PullRecord = {
      uid: 'g1',
      cardId: 'ghost',
      rarity: 2,
      isNew: false,
      poolId: 'star-wish-altar',
      pullIndex: 1,
      at: 1,
    };
    expect(pullLabel(nostalgia, CARDS)).toBe('怀旧展品·4★');
    expect(pullLabel(official, CARDS)).toBe('法则A');
    expect(pullLabel(ghost, CARDS)).toBe('ghost');
  });
});

describe('curvePolyline · SVG 点串', () => {
  it('空曲线返回空串；两点输出两个 "x,y" 坐标点', () => {
    expect(curvePolyline([], 100, 50, 5, 1)).toBe('');
    const line = curvePolyline(
      [
        { pulls: 1, fourStarRate: 0 },
        { pulls: 2, fourStarRate: 0.5 },
      ],
      100,
      50,
      5,
      0.5,
    );
    const pairs = line.split(' ');
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair).toMatch(/^\d+(\.\d+)?,\d+(\.\d+)?$/);
    }
  });
});
