/**
 * logbook —— 成就 / 图鉴 / 进度存档（独立 zustand persist 分片）。
 * ---------------------------------------------------------------------------
 * 分片策略：主存档（gameStore 的 lawbox-chronicle:v1）存「当下进行时」；
 * 本分片（lawbox-chronicle:logbook:v1）存「曾经发生过」——成就解锁时刻、
 * 图鉴首获、关卡最佳纪录、BOSS 击杀史、彩蛋见闻。跨周目不清空：主存档
 * resetSave 后图鉴与成就仍在（收藏语义），设置面板的「清空档案」才清本片。
 *
 * 成就判定：状态镜像 → buildAchievementSnapshot()（纯函数）→
 * evaluateAchievements()（data/lore/achievements.ts，纯函数）→ 新解锁写入
 * 本分片并广播 toast/音效。判定完全声明式，坏档/外挂数据只会让谓词不满足，
 * 不会让收集器崩溃。
 *
 * toast 约定（对接点）：成就解锁广播 {type:'ui/toast', messageKey:
 * 'lore:ach:<成就id>'}，UI 层经 resolveAchievementToast() 解析原文案 ——
 * i18n 缺键时回落 key 本身，绝不静默吞掉。
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { bus } from '../core/events/bus';
import { useGameStore } from '../core/store/gameStore';
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  isLoreEventId,
  type AchievementDef,
  type AchievementSnapshot,
} from '../data/lore/achievements';
import { CARDS } from '../data/gacha';
import { findEnemy } from '../data';
import { SFX } from '../audio/sfxTable';
import { POOL_OFFICIAL, useStatsStore, type StatsState } from './statsCollector';

/* ================================ 数据模型 ================================ */

export interface CodexCardEntry {
  readonly cardId: string;
  readonly firstSeenAt: number;
  readonly obtainedCount: number;
}

export interface ClearedLevelEntry {
  readonly levelId: string;
  readonly clears: number;
  readonly bestStars: 1 | 2 | 3;
  readonly bestSteps: number;
  readonly lastClearedAt: number;
}

export interface BossKillRecord {
  readonly enemyId: string;
  /** 击杀那一刻装备的武器 id；徒手为 null */
  readonly weaponId: string | null;
  readonly at: number;
}

export interface LogbookState {
  /** 成就 id → 解锁时刻（ms） */
  readonly achievements: Readonly<Record<string, number>>;
  readonly codexCards: Readonly<Record<string, CodexCardEntry>>;
  /** 首获顺序的武器 id 列表 */
  readonly weaponsObtained: readonly string[];
  readonly enemyDefeats: Readonly<Record<string, number>>;
  readonly clearedLevels: Readonly<Record<string, ClearedLevelEntry>>;
  readonly bossKills: readonly BossKillRecord[];
  /** 彩蛋/伪系统消息 id → 触发次数 */
  readonly loreEventsSeen: Readonly<Record<string, number>>;
}

/* ================================ Store =================================== */

interface LogbookActions {
  recordCardObtained(cardId: string, at?: number): void;
  recordWeaponObtained(weaponId: string): void;
  recordEnemyDefeated(enemyId: string): void;
  recordLevelCleared(levelId: string, stars: 1 | 2 | 3, steps: number, at?: number): void;
  recordBossKill(enemyId: string, weaponId: string | null, at?: number): void;
  recordLoreEvent(id: string): void;
  unlockAchievement(id: string, at?: number): void;
  clearLogbook(): void;
}

export type LogbookStore = LogbookState & LogbookActions;

const initialLogbookState: LogbookState = {
  achievements: {},
  codexCards: {},
  weaponsObtained: [],
  enemyDefeats: {},
  clearedLevels: {},
  bossKills: [],
  loreEventsSeen: {},
};

export const useLogbookStore = create<LogbookStore>()(
  persist(
    (set, get) => ({
      ...initialLogbookState,

      recordCardObtained(cardId, at = Date.now()) {
        if (!CARDS.some((c) => c.id === cardId)) {
          throw new RangeError(`logbook: 未知卡牌 id「${cardId}」（不在 data/gacha.ts 卡池中）`);
        }
        set((state) => {
          const existing = state.codexCards[cardId];
          return {
            codexCards: {
              ...state.codexCards,
              [cardId]: existing === undefined
                ? { cardId, firstSeenAt: at, obtainedCount: 1 }
                : { ...existing, obtainedCount: existing.obtainedCount + 1 },
            },
          };
        });
      },

      recordWeaponObtained(weaponId) {
        set((state) =>
          state.weaponsObtained.includes(weaponId) ? state : { weaponsObtained: [...state.weaponsObtained, weaponId] },
        );
      },

      recordEnemyDefeated(enemyId) {
        if (findEnemy(enemyId) === undefined) {
          throw new RangeError(`logbook: 未知敌人 id「${enemyId}」（不在 data/enemies.ts 中）`);
        }
        set((state) => ({
          enemyDefeats: { ...state.enemyDefeats, [enemyId]: (state.enemyDefeats[enemyId] ?? 0) + 1 },
        }));
      },

      recordLevelCleared(levelId, stars, steps, at = Date.now()) {
        set((state) => {
          const existing = state.clearedLevels[levelId];
          const next: ClearedLevelEntry = existing === undefined
            ? { levelId, clears: 1, bestStars: stars, bestSteps: steps, lastClearedAt: at }
            : {
                levelId,
                clears: existing.clears + 1,
                bestStars: Math.max(existing.bestStars, stars) as 1 | 2 | 3,
                bestSteps: Math.min(existing.bestSteps, steps),
                lastClearedAt: at,
              };
          return { clearedLevels: { ...state.clearedLevels, [levelId]: next } };
        });
      },

      recordBossKill(enemyId, weaponId, at = Date.now()) {
        const enemy = findEnemy(enemyId);
        if (enemy === undefined) {
          throw new RangeError(`logbook: 未知敌人 id「${enemyId}」`);
        }
        if (!enemy.boss) return; // 只记 BOSS 击杀史（小怪走 enemyDefeats）
        set((state) => ({ bossKills: [...state.bossKills, { enemyId, weaponId, at }] }));
      },

      recordLoreEvent(id) {
        if (!isLoreEventId(id)) {
          throw new RangeError(`logbook: 未知彩蛋/伪系统消息 id「${id}」（见 data/lore/achievements.ts 注册表）`);
        }
        set((state) => ({
          loreEventsSeen: { ...state.loreEventsSeen, [id]: (state.loreEventsSeen[id] ?? 0) + 1 },
        }));
      },

      unlockAchievement(id, at = Date.now()) {
        const def = ACHIEVEMENTS.find((a) => a.id === id);
        if (def === undefined) {
          throw new RangeError(`logbook: 未知成就 id「${id}」`);
        }
        if (get().achievements[id] !== undefined) return;
        set((state) => ({ achievements: { ...state.achievements, [id]: at } }));
        // 解锁演出：欢庆音 + toast（UI 用 resolveAchievementToast 解析文案）
        bus.publish({ type: 'sfx/play', sfxId: SFX.levelComplete });
        bus.publish({ type: 'ui/toast', messageKey: achievementToastKey(id) });
        console.info(`[logbook] 成就解锁：${def.title}`);
      },

      clearLogbook() {
        set({ ...initialLogbookState });
      },
    }),
    {
      name: 'lawbox-chronicle:logbook:v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        achievements: state.achievements,
        codexCards: state.codexCards,
        weaponsObtained: state.weaponsObtained,
        enemyDefeats: state.enemyDefeats,
        clearedLevels: state.clearedLevels,
        bossKills: state.bossKills,
        loreEventsSeen: state.loreEventsSeen,
      }),
    },
  ),
);

/* ============================ 快照组装（纯函数） =========================== */

/**
 * 把 logbook 分片 + stats 分片组装为成就判定快照。
 * 纯函数：只读两个分片，不触碰全局 store —— vitest 直接喂假分片即可测。
 */
export function buildAchievementSnapshot(logbook: LogbookState, stats: StatsState): AchievementSnapshot {
  let threeStarClears = 0;
  let enemiesDefeated = 0;
  for (const entry of Object.values(logbook.clearedLevels)) {
    if (entry.bestStars === 3) threeStarClears += 1;
  }
  for (const defeats of Object.values(logbook.enemyDefeats)) enemiesDefeated += defeats;
  const officialTally = stats.poolTallies[POOL_OFFICIAL];

  return {
    bossDefeated: logbook.bossKills.length > 0,
    bossKillWeapons: logbook.bossKills.map((k) => k.weaponId),
    levelsCleared: Object.keys(logbook.clearedLevels).length,
    threeStarClears,
    totalPulls: officialTally?.pulls ?? 0,
    fourStarPulls: officialTally?.fourStar ?? 0,
    distinctCardsOwned: Object.keys(logbook.codexCards).length,
    enemiesDefeated,
    planeShiftsUsed: stats.counters.planeShifts,
    pushBlockedCount: stats.counters.pushBlocked,
    loreEventsSeen: Object.keys(logbook.loreEventsSeen),
    weaponsObtained: logbook.weaponsObtained,
  };
}

/* ============================ toast 解析（对接点） ========================= */

export const ACHIEVEMENT_TOAST_PREFIX = 'lore:ach:';

export function achievementToastKey(achievementId: string): string {
  return `${ACHIEVEMENT_TOAST_PREFIX}${achievementId}`;
}

/** UI 层把 toast messageKey 反查为成就定义（带前缀才归本模块管） */
export function resolveAchievementToast(messageKey: string): AchievementDef | undefined {
  if (!messageKey.startsWith(ACHIEVEMENT_TOAST_PREFIX)) return undefined;
  const id = messageKey.slice(ACHIEVEMENT_TOAST_PREFIX.length);
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/* ============================== 查询辅助 ================================== */

export function isAchievementUnlocked(state: LogbookState, achievementId: string): boolean {
  return state.achievements[achievementId] !== undefined;
}

export interface AchievementProgress {
  readonly unlockedCount: number;
  readonly total: number;
  readonly unlockedIds: readonly string[];
}

export function achievementProgress(state: LogbookState): AchievementProgress {
  const unlockedIds = ACHIEVEMENTS.filter((a) => state.achievements[a.id] !== undefined).map((a) => a.id);
  return { unlockedCount: unlockedIds.length, total: ACHIEVEMENTS.length, unlockedIds };
}

/* ============================ 自动收集器 ================================== */

let unsubscribeLogbook: (() => void) | null = null;
let lastResultRef: unknown = null;

/**
 * 安装 logbook 收集器（幂等）：订阅全局 store，把「发生过的事」镜像进本
 * 分片，并每次变更后重评成就。模块加载时自动安装，测试可手动卸载隔离。
 */
export function installLogbookCollector(): () => void {
  if (unsubscribeLogbook !== null) return unsubscribeLogbook;

  const off = useGameStore.subscribe((state, prev) => {
    const logbook = useLogbookStore.getState();

    // ---- 图鉴：卡牌持有清单变化 → 全量重算首获/次数 ----
    if (state.gacha.owned !== prev.gacha.owned) {
      const counts = new Map<string, number>();
      for (const instance of state.gacha.owned) {
        counts.set(instance.cardId, (counts.get(instance.cardId) ?? 0) + 1);
      }
      for (const [cardId, count] of counts) {
        const known = logbook.codexCards[cardId];
        if (known === undefined) {
          logbook.recordCardObtained(cardId);
          for (let i = 1; i < count; i++) logbook.recordCardObtained(cardId);
        } else if (count > known.obtainedCount) {
          for (let i = known.obtainedCount; i < count; i++) logbook.recordCardObtained(cardId);
        }
      }
    }

    // ---- 武器：首次持有即入册 ----
    if (state.player.weaponId !== null && !logbook.weaponsObtained.includes(state.player.weaponId)) {
      logbook.recordWeaponObtained(state.player.weaponId);
    }

    // ---- 关卡结算：result 对象换代即记（undo/replay 不会重放同对象） ----
    if (state.result !== null && state.result !== lastResultRef) {
      lastResultRef = state.result;
      logbook.recordLevelCleared(state.result.levelId, state.result.stars, state.result.steps);
    } else if (state.result === null) {
      lastResultRef = null;
    }

    // ---- 战斗：胜负镜像 ----
    const combat = state.combat;
    const prevCombat = prev.combat;
    if (combat !== null && prevCombat !== null && combat.phase !== prevCombat.phase) {
      if (combat.phase === 'victory') {
        logbook.recordEnemyDefeated(combat.enemyId);
        logbook.recordBossKill(combat.enemyId, state.player.weaponId);
      }
    }

    // ---- 成就重评：新解锁逐条入册 ----
    const snapshot = buildAchievementSnapshot(useLogbookStore.getState(), useStatsStore.getState());
    const unlocked = new Set(Object.keys(useLogbookStore.getState().achievements));
    for (const id of evaluateAchievements(snapshot, unlocked)) {
      useLogbookStore.getState().unlockAchievement(id);
    }
  });

  unsubscribeLogbook = off;
  return off;
}

/* 模块加载即安装：档案不依赖视图挂载点，随包加载即开始记录。
   卸载走 installLogbookCollector 的返回值（此前零引用的 uninstallLogbookCollector
   导出已删，A4-8 死代码清理；测试隔离用返回的 off 函数即可）。 */
installLogbookCollector();
