/**
 * 帷幕界面层 · DeckPanel 纯逻辑单测 —— buildPullCurve（BT9「抽卡记录即弃」的归宿）。
 * 覆盖：按 obtainedAt 升序累计、未知 cardId 脏数据跳过、空输入、最大值供 SVG 纵轴。
 */

import { describe, expect, it } from 'vitest';
import type { CardDef, CardInstance } from '../../../core/types';
import { buildPullCurve } from '../DeckPanel';

const CARDS: readonly CardDef[] = [
  { id: 'card-a', kind: 'law', name: 'A', rarity: 4, description: '' },
  { id: 'card-b', kind: 'character', name: 'B', rarity: 3, description: '' },
  { id: 'card-c', kind: 'character', name: 'C', rarity: 2, description: '' },
];

const inst = (uid: string, cardId: string, obtainedAt: number): CardInstance => ({ uid, cardId, obtainedAt });

describe('buildPullCurve · 出货统计曲线', () => {
  it('按获得时间升序累计各稀有度张数（与输入顺序无关）', () => {
    const curve = buildPullCurve(
      [inst('u2', 'card-c', 300), inst('u0', 'card-a', 100), inst('u1', 'card-b', 200)],
      CARDS,
    );
    expect(curve.total).toBe(3);
    expect(curve.points.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(curve.points[0]).toMatchObject({ c2: 0, c3: 0, c4: 1, at: 100 });
    expect(curve.points[1]).toMatchObject({ c2: 0, c3: 1, c4: 1, at: 200 });
    expect(curve.points[2]).toMatchObject({ c2: 1, c3: 1, c4: 1, at: 300 });
  });

  it('未知 cardId（坏档/外挂数据）静默跳过，不污染曲线', () => {
    const curve = buildPullCurve([inst('x', 'ghost-card', 1), inst('y', 'card-a', 2)], CARDS);
    expect(curve.total).toBe(1);
    expect(curve.points).toHaveLength(1);
    expect(curve.points[0]).toMatchObject({ index: 1, c4: 1, c3: 0, c2: 0 });
  });

  it('空卡组 → 空曲线（UI 层显示空态文案）', () => {
    expect(buildPullCurve([], CARDS)).toEqual({ points: [], total: 0 });
  });

  it('同刻获得的并列时间戳保持稳定次序且累计正确', () => {
    const curve = buildPullCurve([inst('p', 'card-b', 42), inst('q', 'card-b', 42)], CARDS);
    expect(curve.total).toBe(2);
    expect(curve.points[0]).toMatchObject({ c3: 1 });
    expect(curve.points[1]).toMatchObject({ c3: 2 });
  });
});
