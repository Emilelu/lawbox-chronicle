/**
 * 帷幕界面层 · ArchivePanel 纯逻辑单测。
 * ---------------------------------------------------------------------------
 * 覆盖：codexRows（图鉴首获/次数与排序）、achievementRows（secret 遮罩）、
 * latestPulls（最新在前 + limit）、poolComparison（复用 statsCollector 曲线）、
 * pullLabel（怀旧展品/正式卡标签）、curvePolyline（SVG 点串）。
 */

import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CardDef } from '../../../core/types';
import type { PullRecord, StatsState } from '../../../archive/statsCollector';
import { useGameStore } from '../../../core/store/gameStore';
import { CARDS as ALL_CARDS } from '../../../data/gacha';
import { tUi } from '../../../data/i18n/uiText';
import {
  ArchivePanel,
  achievementRows,
  codexRows,
  curvePolyline,
  formatAt,
  latestPulls,
  poolComparison,
  pullLabel,
  useArchivePanelStore,
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

  it('locale 键控（A4-5 收尾）：en 下怀旧展品标名不再是中文；缺省 zh-Hans 兼容两参调用', () => {
    const nostalgia3: PullRecord = {
      uid: 'n2',
      cardId: 'nostalgia-star-three',
      rarity: 3,
      isNew: false,
      poolId: 'nostalgia-lottery',
      pullIndex: 2,
      at: 2,
    };
    expect(pullLabel(nostalgia3, CARDS, 'en')).toBe('Nostalgia exhibit · 3★');
    expect(pullLabel(nostalgia3, CARDS, 'en')).not.toMatch(/怀旧/);
    expect(pullLabel(nostalgia3, CARDS)).toBe('怀旧展品·3★');
  });

  it('C4：正式卡标签经 uiText.cardName 按语种解析（en 下不再显示数据层中文卡名）', () => {
    const record: PullRecord = {
      uid: 'o2',
      cardId: 'card-chr-caixukun',
      rarity: 2,
      isNew: false,
      poolId: 'star-wish-altar',
      pullIndex: 2,
      at: 2,
    };
    expect(pullLabel(record, ALL_CARDS, 'zh-Hans')).toBe('蔡徐坤');
    expect(pullLabel(record, ALL_CARDS, 'en')).toBe('Cai Xukun');
    expect(pullLabel(record, ALL_CARDS, 'en')).not.toMatch(/蔡徐坤/);
  });
});

describe('formatAt · 时间戳按语种格式化（C3 回归防线）', () => {
  /** 正午 UTC 固定时刻：极端时区也不会翻转「年/日 AM-PM」两类断言 */
  const AT = Date.UTC(2026, 10, 14, 6, 14, 0);

  it('zh-Hans 为 24 小时制年先行格式（不含 AM/PM 标记）——修复前是 en-US 12 小时制', () => {
    const zh = formatAt(AT, 'zh-Hans');
    expect(zh).toContain('2026');
    expect(zh).not.toMatch(/AM|PM/);
    expect(zh).not.toBe(formatAt(AT, 'en'));
  });

  it('en 保留 12 小时制 AM/PM 格式（非中文语种行为不回退）', () => {
    const en = formatAt(AT, 'en');
    expect(en).toMatch(/AM|PM/);
    expect(en).toContain('2026');
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

/* ==================== 页签文案渲染（N-1 回归防线） ==================== */

/**
 * N-1：页签循环曾直接渲染 tabLabel 的键名字符串（漏包 tUi），全语种把
 * 'archive.tab.curves' 等键名原文画到页面上。此处挂载真组件断言：按钮文本
 * 必须等于 tUi 取值，键名原文绝不可出现——键表补得再全、渲染漏包 tUi 的
 * 同类回归在此被拦下。渲染方式与 panelExclusion.test.tsx 同款（react-dom
 * createRoot + act，仓库未引入 @testing-library）；本文件是 .ts，用
 * createElement 代替 JSX。
 */
describe('ArchivePanel 页签文案渲染（N-1 回归防线）', () => {
  const TAB_KEYS = ['tab.codex', 'archive.tab.achievements', 'archive.tab.curves', 'archive.tab.history'] as const;

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  function mountPanel(): { host: HTMLElement; root: Root } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(ArchivePanel));
    });
    act(() => {
      useArchivePanelStore.getState().toggle();
    });
    return { host, root };
  }

  function tabTexts(host: HTMLElement): string[] {
    return [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');
  }

  it('zh-Hans：页签按钮渲染 tUi 文案，键名原文不出现', () => {
    const { host, root } = mountPanel();
    try {
      const texts = tabTexts(host);
      for (const key of TAB_KEYS) {
        expect(texts).toContain(tUi('zh-Hans', key));
        expect(texts).not.toContain(key);
      }
    } finally {
      act(() => root.unmount());
      host.remove();
      useArchivePanelStore.getState().close();
    }
  });

  it('en：setLocale 后页签随语种切换，仍是文案而非键名（不污染存档数据，仅切语言并还原）', () => {
    const { host, root } = mountPanel();
    try {
      act(() => {
        useGameStore.getState().setLocale('en');
      });
      const texts = tabTexts(host);
      for (const key of TAB_KEYS) {
        expect(texts).toContain(tUi('en', key));
        expect(texts).not.toContain(key);
      }
    } finally {
      act(() => root.unmount());
      host.remove();
      useGameStore.getState().setLocale('zh-Hans');
      useArchivePanelStore.getState().close();
    }
  });
});
