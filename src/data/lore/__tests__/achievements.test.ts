/**
 * achievements 单测 —— 原作成就文案保真 + 判定谓词 + 伪系统消息注册表。
 */

import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  CHEAT_CODE_EGGS,
  LORE_EVENT_IDS,
  PSEUDO_SYSTEM_MESSAGES,
  evaluateAchievements,
  formatSystemMessage,
  isLoreEventId,
  type AchievementSnapshot,
} from '../achievements';
import { isUiTextKey } from '../../i18n/uiText';

const EMPTY_SNAPSHOT: AchievementSnapshot = {
  bossDefeated: false,
  bossKillWeapons: [],
  levelsCleared: 0,
  threeStarClears: 0,
  totalPulls: 0,
  fourStarPulls: 0,
  distinctCardsOwned: 0,
  enemiesDefeated: 0,
  planeShiftsUsed: 0,
  pushBlockedCount: 0,
  loreEventsSeen: [],
  weaponsObtained: [],
};

describe('achievements —— 注册表完整性', () => {
  it('成就 id 唯一，字段齐备', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of ACHIEVEMENTS) {
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.lore.length).toBeGreaterThan(0);
      expect(def.lore).toMatch(/java|新增/);
    }
  });

  it('titleKey/descriptionKey 引用合法 uiText 键（R-6 展示层键控）', () => {
    for (const def of ACHIEVEMENTS) {
      expect(isUiTextKey(def.titleKey), `${def.id} titleKey 非法`).toBe(true);
      expect(isUiTextKey(def.descriptionKey), `${def.id} descriptionKey 非法`).toBe(true);
    }
  });

  it('三条原作隐藏关成就逐字保真（EasterEgg.java:195/202/208）', () => {
    const titles = ACHIEVEMENTS.map((a) => a.title);
    expect(titles).toContain('赤手空拳打败BOSS的男人');
    expect(titles).toContain('用一根爷爷祖传的的拐杖打败BOSS的男人');
    expect(titles).toContain('用㊙hotel打败BOSS的男人');
    // 原文「祖传的的」双「的」与「㊙hotel」小写都是原件错字/原样，不得「修复」
    const stick = ACHIEVEMENTS.find((a) => a.title.includes('爷爷祖传的的拐杖'));
    expect(stick?.lore).toContain('EasterEgg.java:202');
  });

  it('伪系统消息 id 唯一且逐条带出处', () => {
    const ids = PSEUDO_SYSTEM_MESSAGES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of PSEUDO_SYSTEM_MESSAGES) {
      expect(m.text.length).toBeGreaterThan(0);
      expect(m.source).toMatch(/\.java|\.js|\.ts/);
    }
  });

  it('作弊码注册表含 /kill--SetName 与 BABA（META 终端对接）', () => {
    const codes = CHEAT_CODE_EGGS.map((c) => c.code);
    expect(codes).toContain('/kill--SetName');
    expect(codes).toContain('BABA');
    expect(codes).toContain('/give--@p--赤手空拳');
  });
});

describe('evaluateAchievements —— 判定谓词', () => {
  it('空快照不解锁任何成就', () => {
    expect(evaluateAchievements(EMPTY_SNAPSHOT, new Set())).toEqual([]);
  });

  it('原作成就按击杀武器分别判定（徒手 / 拐杖 / ㊙Hotel）', () => {
    const fist = evaluateAchievements(
      { ...EMPTY_SNAPSHOT, bossKillWeapons: [null] },
      new Set(),
    );
    expect(fist).toContain('ach-eg-fist-boss');
    expect(fist).toContain('ach-boss-slayer');

    const stick = evaluateAchievements(
      { ...EMPTY_SNAPSHOT, bossKillWeapons: ['weapon-gfsStick', null] },
      new Set(),
    );
    expect(stick).toContain('ach-eg-stick-boss');
    expect(stick).toContain('ach-eg-fist-boss');

    const mihotel = evaluateAchievements(
      { ...EMPTY_SNAPSHOT, bossKillWeapons: ['weapon-mihotel'] },
      new Set(),
    );
    expect(mihotel).toContain('ach-eg-mihotel-boss');
    expect(mihotel).not.toContain('ach-eg-stick-boss');
  });

  it('进度型成就按阈值判定', () => {
    const s: AchievementSnapshot = {
      ...EMPTY_SNAPSHOT,
      levelsCleared: 3,
      threeStarClears: 1,
      pushBlockedCount: 20,
      planeShiftsUsed: 2,
      fourStarPulls: 1,
      distinctCardsOwned: 7,
    };
    const unlocked = evaluateAchievements(s, new Set());
    expect(unlocked).toContain('ach-first-clear');
    expect(unlocked).toContain('ach-perfect-par');
    expect(unlocked).toContain('ach-hardhead');
    expect(unlocked).toContain('ach-plane-walker');
    expect(unlocked).toContain('ach-kirakira-first4');
    expect(unlocked).toContain('ach-collector-half');
    expect(unlocked).not.toContain('ach-collector-full');
  });

  it('秘密成就只看 lore 事件见闻，且已解锁的不重复出现', () => {
    const seen = { ...EMPTY_SNAPSHOT, loreEventsSeen: ['cheat-kill--setname', 'cheat-baba'] };
    const first = evaluateAchievements(seen, new Set());
    expect(first).toContain('ach-cheat-setname');
    expect(first).toContain('ach-baba');

    const second = evaluateAchievements(seen, new Set(first));
    expect(second).not.toContain('ach-cheat-setname');
    expect(second).not.toContain('ach-baba');
  });
});

describe('formatSystemMessage —— 模板渲染（坏数据即抛错，不静默）', () => {
  it('模板占位符按 vars 渲染', () => {
    expect(formatSystemMessage('sys-detected-input', { input: 'w' })).toBe(
      '[System] Detected input content: w , continue...',
    );
    expect(formatSystemMessage('sanb-level-suspicion', { level: '1', count: '12' })).toBe(
      'Level 1 ...? 12',
    );
  });

  it('无占位符的消息可直接渲染', () => {
    expect(formatSystemMessage('sys-nothing-happened')).toBe('好像没啥发生(*^_^*)');
    expect(formatSystemMessage('sys-end')).toBe('E  N  D');
    expect(formatSystemMessage('sys-weapon-cleared')).toBe('[System] weaponList has been cleared.');
  });

  it('未知 id / 缺变量抛 RangeError（K11：不吞）', () => {
    expect(() => formatSystemMessage('sys-not-exists')).toThrow(RangeError);
    expect(() => formatSystemMessage('sys-detected-input')).toThrow(RangeError);
    expect(() => formatSystemMessage('sanb-level-suspicion', { level: '1' })).toThrow(RangeError);
  });
});

describe('lore 事件 id —— 注册表与作弊码联动', () => {
  it('cheat-kill--setname 与 cheat-baba 在注册表中且可校验', () => {
    expect(isLoreEventId('cheat-kill--setname')).toBe(true);
    expect(isLoreEventId('cheat-baba')).toBe(true);
    expect(isLoreEventId('sys-abandoned')).toBe(true);
    expect(isLoreEventId('not-a-lore-id')).toBe(false);
    expect(LORE_EVENT_IDS.length).toBe(
      PSEUDO_SYSTEM_MESSAGES.length +
        CHEAT_CODE_EGGS.filter((c) => c.code === '/kill--SetName' || c.code === 'BABA').length,
    );
  });
});
