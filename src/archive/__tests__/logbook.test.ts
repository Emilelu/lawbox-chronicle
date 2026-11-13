/**
 * logbook / statsCollector 单测 —— 分片记账、快照组装、双池曲线、自动收集器。
 * logbook 与 stats 模块加载时会自动安装收集器（订阅 bus + gameStore），
 * 本文件借此顺带验证「bus 计数」与「rollGacha → 抽卡历史」两条自动链路。
 * B4-3：ghost 卡（卡池外）的读档清洗与收集器容错回归。
 * B4-6：combatLogCursor 退出持久化契约（v2 迁移剥离）回归。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events/bus';
import { useGameStore } from '../../core/store/gameStore';
import { POOL_NOSTALGIA, POOL_OFFICIAL, cumulativeFourStarCurve, poolCurve, resultFingerprint, useStatsStore, type StatsState } from '../statsCollector';
import { NOSTALGIA_POOL_INFO } from '../../data/gacha/pools';
import {
  achievementProgress,
  achievementToastKey,
  buildAchievementSnapshot,
  isAchievementUnlocked,
  resolveAchievementToast,
  useLogbookStore,
  type LogbookState,
} from '../logbook';
import type { GachaPull } from '../../core/types';

const emptyLogbook: LogbookState = {
  achievements: {},
  codexCards: {},
  weaponsObtained: [],
  enemyDefeats: {},
  clearedLevels: {},
  bossKills: [],
  loreEventsSeen: {},
};

const emptyStats: StatsState = {
  pullHistory: [],
  battleHistory: [],
  combatLogTail: [],
  poolTallies: {},
  counters: { pushBlocked: 0, goalBursts: 0, critShakes: 0, gachaBursts: 0, planeShifts: 0 },
  lastResultFingerprint: null,
  combatLogCursor: 0,
};

function fakePulls(seed: number, rarities: readonly (2 | 3 | 4)[]): readonly GachaPull[] {
  return rarities.map((rarity, i) => ({
    uid: `pull-${seed}-${i}`,
    cardId: rarity === 4 ? 'card-chr-author' : rarity === 3 ? 'card-chr-angel-1' : 'card-chr-caixukun',
    rarity,
    isNew: i === 0,
  }));
}

beforeEach(() => {
  useLogbookStore.getState().clearLogbook();
  useStatsStore.getState().clearStats();
});

describe('怀旧池 id 单一真相源（R5）', () => {
  it('展示 id 与统计写入/查询 id 一致（任何按 id 查曲线的代码不会拿到空数据）', () => {
    expect(NOSTALGIA_POOL_INFO.id).toBe(POOL_NOSTALGIA);
  });

  it('按展示 id 查曲线能命中 POOL_NOSTALGIA 写入的分桶（不拿空数据）', () => {
    useStatsStore.getState().recordPulls(POOL_NOSTALGIA, fakePulls(3, [3, 4]), 0);
    const curve = poolCurve(useStatsStore.getState(), NOSTALGIA_POOL_INFO.id);
    expect(curve.pulls).toBe(2);
    expect(curve.fourStar).toBe(1);
    expect(curve.threeStar).toBe(1);
  });
});

describe('logbook 分片 —— 关卡最佳纪录', () => {
  it('首次通关入册；再次通关只更新次数与更优值', () => {
    const s = useLogbookStore.getState();
    s.recordLevelCleared('level-1', 2, 30, 1000);
    s.recordLevelCleared('level-1', 3, 20, 2000);
    s.recordLevelCleared('level-1', 1, 99, 3000);
    const entry = useLogbookStore.getState().clearedLevels['level-1'];
    expect(entry).toBeDefined();
    expect(entry?.clears).toBe(3);
    expect(entry?.bestStars).toBe(3);
    expect(entry?.bestSteps).toBe(20);
    expect(entry?.lastClearedAt).toBe(3000);
  });

  it('不同关卡各自记账', () => {
    useLogbookStore.getState().recordLevelCleared('level-1', 1, 50);
    useLogbookStore.getState().recordLevelCleared('level-2', 3, 10);
    expect(Object.keys(useLogbookStore.getState().clearedLevels).length).toBe(2);
  });
});

describe('logbook 分片 —— 图鉴/敌人/武器/彩蛋', () => {
  it('卡牌首获时间与获得次数分开记', () => {
    const s = useLogbookStore.getState();
    s.recordCardObtained('card-chr-angel-1', 100);
    s.recordCardObtained('card-chr-angel-1', 200);
    const entry = useLogbookStore.getState().codexCards['card-chr-angel-1'];
    expect(entry?.firstSeenAt).toBe(100);
    expect(entry?.obtainedCount).toBe(2);
  });

  it('未知卡牌 id 抛 RangeError（坏数据不静默入库）', () => {
    expect(() => useLogbookStore.getState().recordCardObtained('card-ghost')).toThrow(RangeError);
  });

  it('敌人击杀计数；未知敌人抛错；BOSS 击杀史只记 boss', () => {
    const s = useLogbookStore.getState();
    s.recordEnemyDefeated('enemy-caixukun');
    s.recordEnemyDefeated('enemy-caixukun');
    expect(useLogbookStore.getState().enemyDefeats['enemy-caixukun']).toBe(2);
    expect(() => s.recordEnemyDefeated('enemy-ghost')).toThrow(RangeError);

    s.recordBossKill('enemy-caixukun', 'weapon-basketball'); // 小怪：忽略
    s.recordBossKill('enemy-ylzz', null); // 徒手击杀 BOSS
    const kills = useLogbookStore.getState().bossKills;
    expect(kills.length).toBe(1);
    expect(kills[0]?.enemyId).toBe('enemy-ylzz');
    expect(kills[0]?.weaponId).toBeNull();
  });

  it('武器首获按顺序去重', () => {
    const s = useLogbookStore.getState();
    s.recordWeaponObtained('weapon-dagger');
    s.recordWeaponObtained('weapon-dagger');
    s.recordWeaponObtained('weapon-gfsStick');
    expect(useLogbookStore.getState().weaponsObtained).toEqual(['weapon-dagger', 'weapon-gfsStick']);
  });

  it('彩蛋事件计数；未知 id 抛错', () => {
    const s = useLogbookStore.getState();
    s.recordLoreEvent('sanb-hardhead-20');
    s.recordLoreEvent('sanb-hardhead-20');
    expect(useLogbookStore.getState().loreEventsSeen['sanb-hardhead-20']).toBe(2);
    expect(() => s.recordLoreEvent('fake-easter-egg')).toThrow(RangeError);
  });

  it('成就解锁：入册 + toast key 可反查；未知成就抛错；重复解锁幂等', () => {
    const s = useLogbookStore.getState();
    s.unlockAchievement('ach-first-clear', 1234);
    expect(useLogbookStore.getState().achievements['ach-first-clear']).toBe(1234);
    const key = achievementToastKey('ach-first-clear');
    expect(key).toBe('lore:ach:ach-first-clear');
    expect(resolveAchievementToast(key)?.title).toBe('石板归位');
    expect(resolveAchievementToast('toast.gachaPlaceholder')).toBeUndefined();

    s.unlockAchievement('ach-first-clear', 9999); // 幂等：时刻不变
    expect(useLogbookStore.getState().achievements['ach-first-clear']).toBe(1234);
    expect(() => s.unlockAchievement('ach-ghost')).toThrow(RangeError);
    expect(isAchievementUnlocked(useLogbookStore.getState(), 'ach-first-clear')).toBe(true);
  });

  it('persist 分片键独立落盘（与主存档/统计互不覆盖）', () => {
    useLogbookStore.getState().recordWeaponObtained('weapon-dagger');
    const raw = localStorage.getItem('lawbox-chronicle:logbook:v1');
    expect(raw).not.toBeNull();
    expect(raw).toContain('weapon-dagger');
  });
});

describe('buildAchievementSnapshot —— 快照组装（纯函数）', () => {
  it('汇总两个分片的判定素材', () => {
    const logbook: LogbookState = {
      ...emptyLogbook,
      clearedLevels: {
        'level-1': { levelId: 'level-1', clears: 1, bestStars: 3, bestSteps: 10, lastClearedAt: 1 },
        'level-2': { levelId: 'level-2', clears: 2, bestStars: 2, bestSteps: 40, lastClearedAt: 2 },
      },
      codexCards: {
        'card-chr-angel-1': { cardId: 'card-chr-angel-1', firstSeenAt: 1, obtainedCount: 2 },
        'card-chr-author': { cardId: 'card-chr-author', firstSeenAt: 2, obtainedCount: 1 },
      },
      enemyDefeats: { 'enemy-caixukun': 2, 'enemy-guolaoshi': 1 },
      bossKills: [{ enemyId: 'enemy-ylzz', weaponId: 'weapon-gfsStick', at: 3 }],
      weaponsObtained: ['weapon-dagger', 'weapon-gfsStick'],
      loreEventsSeen: { 'sys-abandoned': 1 },
    };
    const stats: StatsState = {
      ...emptyStats,
      poolTallies: { [POOL_OFFICIAL]: { pulls: 50, twoStar: 40, threeStar: 8, fourStar: 2 } },
      counters: { ...emptyStats.counters, planeShifts: 3, pushBlocked: 25 },
    };
    const snapshot = buildAchievementSnapshot(logbook, stats);
    expect(snapshot.levelsCleared).toBe(2);
    expect(snapshot.threeStarClears).toBe(1);
    expect(snapshot.distinctCardsOwned).toBe(2);
    expect(snapshot.enemiesDefeated).toBe(3);
    expect(snapshot.bossDefeated).toBe(true);
    expect(snapshot.bossKillWeapons).toEqual(['weapon-gfsStick']);
    expect(snapshot.totalPulls).toBe(50);
    expect(snapshot.fourStarPulls).toBe(2);
    expect(snapshot.planeShiftsUsed).toBe(3);
    expect(snapshot.pushBlockedCount).toBe(25);
    expect(snapshot.loreEventsSeen).toEqual(['sys-abandoned']);
  });

  it('成就进度与全解锁判定', () => {
    useLogbookStore.getState().unlockAchievement('ach-boss-slayer');
    const progress = achievementProgress(useLogbookStore.getState());
    expect(progress.unlockedCount).toBe(1);
    expect(progress.total).toBeGreaterThan(10);
    expect(progress.unlockedIds).toEqual(['ach-boss-slayer']);
  });
});

describe('statsCollector —— 池曲线（纯函数）', () => {
  it('0 抽时率值为 null（不伪造 0%）', () => {
    const curve = poolCurve(emptyStats, POOL_OFFICIAL);
    expect(curve.pulls).toBe(0);
    expect(curve.fourStarRate).toBeNull();
    expect(curve.threeStarPlusRate).toBeNull();
  });

  it('按 poolId 分桶统计，双池互不污染', () => {
    const s = useStatsStore.getState();
    s.recordPulls(POOL_OFFICIAL, fakePulls(1, [4, 3, 2, 2]), 0);
    s.recordPulls(POOL_NOSTALGIA, fakePulls(2, [2, 2]), 100);
    const official = poolCurve(useStatsStore.getState(), POOL_OFFICIAL);
    const nostalgia = poolCurve(useStatsStore.getState(), POOL_NOSTALGIA);
    expect(official.pulls).toBe(4);
    expect(official.fourStar).toBe(1);
    expect(official.threeStar).toBe(1);
    expect(official.twoStar).toBe(2);
    expect(official.fourStarRate).toBeCloseTo(0.25);
    expect(official.threeStarPlusRate).toBeCloseTo(0.5);
    expect(nostalgia.pulls).toBe(2);
    expect(nostalgia.fourStar).toBe(0);
  });

  it('累计 4★ 曲线逐抽累加且只统计指定池', () => {
    const s = useStatsStore.getState();
    s.recordPulls(POOL_OFFICIAL, fakePulls(1, [2, 4]), 0);
    s.recordPulls(POOL_NOSTALGIA, fakePulls(2, [4, 4]), 10);
    const curve = cumulativeFourStarCurve(useStatsStore.getState(), POOL_OFFICIAL);
    expect(curve.length).toBe(2);
    expect(curve[0]?.pulls).toBe(1);
    expect(curve[0]?.fourStarRate).toBe(0);
    expect(curve[1]?.pulls).toBe(2);
    expect(curve[1]?.fourStarRate).toBeCloseTo(0.5);
  });

  it('resultFingerprint 确定性（跨刷新防重复记账）', () => {
    const a = fakePulls(1, [2, 3]);
    expect(resultFingerprint(a)).toBe(resultFingerprint(fakePulls(1, [2, 3])));
    expect(resultFingerprint(a)).not.toBe(resultFingerprint(a.slice(0, 1)));
  });
});

describe('自动收集器 —— bus 计数与 rollGacha 全链路', () => {
  it('bus 演出事件计入统计（收集器随模块加载自动安装）', () => {
    bus.publish({ type: 'anim/blocked', reason: 'wall' });
    bus.publish({ type: 'anim/blocked', reason: 'immovable' });
    bus.publish({ type: 'fx/planeShift' });
    const counters = useStatsStore.getState().counters;
    expect(counters.pushBlocked).toBeGreaterThanOrEqual(2);
    expect(counters.planeShifts).toBeGreaterThanOrEqual(1);
  });

  it('rollGacha 十连 → 正式池抽卡历史 10 条（BT9：记录不再即弃）', () => {
    const before = useGameStore.getState();
    expect(before.gacha.starStones).toBeGreaterThanOrEqual(900);
    useGameStore.getState().rollGacha(10);
    const stats = useStatsStore.getState();
    expect(stats.pullHistory.length).toBe(10);
    const tally = stats.poolTallies[POOL_OFFICIAL];
    expect(tally?.pulls).toBe(10);
    expect(stats.lastResultFingerprint).not.toBeNull();
    // 与主 store 的累计抽数一致
    expect(useGameStore.getState().gacha.totalPulls).toBe(10);
    // logbook 收集器同步镜像图鉴
    expect(Object.keys(useLogbookStore.getState().codexCards).length).toBeGreaterThan(0);
  });
});

describe('B4-3 —— ghost 卡（卡池外）读档清洗与收集器容错', () => {
  const GHOST = 'card-ghost-removed-in-vNext';

  it('主档读档 merge 按 CARDS 白名单清洗 gacha.owned：ghost 卡不进内存', async () => {
    useGameStore.getState().resetSave();
    // 模拟坏档：持久化分片里混入 ghost 卡（版本删卡 / 手改存档）
    const raw = JSON.parse(localStorage.getItem('lawbox-chronicle:v1') ?? '{}') as {
      state?: Record<string, unknown>;
    };
    const gacha = (raw.state?.gacha ?? {}) as { owned?: unknown };
    gacha.owned = [
      { uid: 'ok-1', cardId: 'card-chr-angel-1', obtainedAt: 1 },
      { uid: 'ghost-1', cardId: GHOST, obtainedAt: 2 },
    ];
    raw.state = { ...raw.state, gacha };
    localStorage.setItem('lawbox-chronicle:v1', JSON.stringify(raw));
    await useGameStore.persist.rehydrate();
    const owned = useGameStore.getState().gacha.owned;
    expect(owned.some((o) => o.cardId === GHOST)).toBe(false);
    expect(owned.some((o) => o.cardId === 'card-chr-angel-1')).toBe(true);
  });

  it('收集器订阅链对 ghost 卡容错：不抛断链，合法卡照常入册，成就重评仍执行', () => {
    useGameStore.getState().resetSave();
    useLogbookStore.getState().clearLogbook();
    // 直接经 setState 灌入 ghost 卡（绕过 merge 的最坏情况：外挂数据/运行期篡改）
    useGameStore.setState({
      gacha: {
        ...useGameStore.getState().gacha,
        owned: [
          { uid: 'ghost-1', cardId: GHOST, obtainedAt: 1 },
          { uid: 'ok-1', cardId: 'card-chr-angel-1', obtainedAt: 2 },
        ],
      },
    });
    // 订阅回调同步执行完毕且不抛 Uncaught：ghost 卡被跳过，合法卡入册
    const codex = useLogbookStore.getState().codexCards;
    expect(codex[GHOST]).toBeUndefined();
    expect(codex['card-chr-angel-1']?.obtainedCount).toBe(1);
  });
});

describe('B4-6 —— combatLogCursor 退出持久化（会话态游标，v2 迁移剥离）', () => {
  it('partialize 不含 combatLogCursor（战斗中刷新不再残留游标）', () => {
    useStatsStore.getState().setCombatCursor(7);
    const persisted = useStatsStore.persist.getOptions().partialize?.(useStatsStore.getState()) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('combatLogCursor');
    expect(persisted).toHaveProperty('combatLogTail');
    expect(persisted).toHaveProperty('poolTallies');
  });

  it('migrate（v1 → v2）剥离旧档遗留的 combatLogCursor，其余字段原样保留', () => {
    const legacyV1 = {
      pullHistory: [],
      battleHistory: [],
      combatLogTail: [{ actor: 'player', damage: 6, crit: false, turn: 1 }],
      poolTallies: {},
      counters: { pushBlocked: 3, goalBursts: 0, critShakes: 0, gachaBursts: 0, planeShifts: 1 },
      lastResultFingerprint: '1#uid-x',
      combatLogCursor: 4,
    };
    const migrated = useStatsStore.persist.getOptions().migrate?.(legacyV1, 1) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('combatLogCursor');
    expect(migrated.lastResultFingerprint).toBe('1#uid-x');
    expect(migrated.combatLogTail).toEqual(legacyV1.combatLogTail);
  });

  it('persist 版本号升至 2（旧档升级触发 migrate 剥离）', () => {
    expect(useStatsStore.persist.getOptions().version).toBe(2);
  });
});
