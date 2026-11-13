/**
 * statsCollector —— 抽卡历史 / 双池出货曲线 / 战斗日志的持久化统计。
 * ---------------------------------------------------------------------------
 * 数据来源两条线（BT9：原作抽卡记录即弃，BandoriLotteryEmulator 每轮
 * storedStars.clear() 什么也不留）：
 *  1. 事件总线（core/events/bus）：纯演出计数（撞墙/落座/暴击/光柱/位面）；
 *  2. 全局 store（core/store/gameStore）：权威数值 —— gacha.lastResult 换代
 *     即逐卡记录出货；combat.log 增量即战斗日志尾；phase 胜负切换即战斗
 *     结算记录。
 *
 * 「双池」契约：正式池（star-wish-altar）由本收集器自动记录；怀旧模拟池
 * （nostalgia-lottery，复刻 Lottery.java:40-46 的对照展品）由 gameStore
 * runNostalgiaGacha 经 recordPulls(POOL_NOSTALGIA, ...) 写入 —— 曲线函数
 * 按 poolId 自动分桶，无需改本文件。
 *
 * 持久化：独立 zustand persist 分片（key: lawbox-chronicle:stats:v1），
 * 与主存档、logbook 互不覆盖；清统计只清本分片。
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { bus } from '../core/events/bus';
import { useGameStore } from '../core/store/gameStore';
import type { CombatLogEntry, GachaPull, Rarity } from '../core/types';

/* ================================ 池标识 ================================== */

/** 正式池 id（与 data/gacha.ts GACHA_CONFIG.id 一致） */
export const POOL_OFFICIAL = 'star-wish-altar';
/** 怀旧模拟池 id（单一真相源在 data/gacha/pools.ts；此处再导出保持历史 import 点不变） */
export { POOL_NOSTALGIA } from '../data/gacha/pools';

/* ================================ 数据模型 ================================ */

export interface PullRecord {
  readonly uid: string;
  readonly cardId: string;
  readonly rarity: Rarity;
  readonly isNew: boolean;
  readonly poolId: string;
  /** 全局累计的第几抽（1 起，跨批次连续） */
  readonly pullIndex: number;
  readonly at: number;
}

export interface BattleRecord {
  readonly enemyId: string;
  readonly victory: boolean;
  readonly turns: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly at: number;
}

/** 带所属敌人的战斗日志条目（store 的 CombatLogEntry + enemyId 维度） */
export type TaggedCombatLogEntry = CombatLogEntry & { readonly enemyId: string };

export interface PoolTally {
  readonly pulls: number;
  readonly twoStar: number;
  readonly threeStar: number;
  readonly fourStar: number;
}

export interface StatsCounters {
  readonly pushBlocked: number;
  readonly goalBursts: number;
  readonly critShakes: number;
  readonly gachaBursts: number;
  readonly planeShifts: number;
}

export interface StatsState {
  readonly pullHistory: readonly PullRecord[];
  readonly battleHistory: readonly BattleRecord[];
  readonly combatLogTail: readonly TaggedCombatLogEntry[];
  readonly poolTallies: Readonly<Record<string, PoolTally>>;
  readonly counters: StatsCounters;
  /** 去重标记：上次已记录的 lastResult 指纹（跨刷新防重复记账） */
  readonly lastResultFingerprint: string | null;
  /** 已记录过的 combat.log 条目数（增量游标） */
  readonly combatLogCursor: number;
}

/* ============================== 容量与指纹 ================================ */

const MAX_PULL_HISTORY = 5000;
const MAX_BATTLE_HISTORY = 200;
const MAX_COMBAT_LOG_TAIL = 300;

export function emptyTally(): PoolTally {
  return { pulls: 0, twoStar: 0, threeStar: 0, fourStar: 0 };
}

/** lastResult 指纹：uid 串 + 批大小（uid 含全局抽序，天然防重放） */
export function resultFingerprint(pulls: readonly GachaPull[]): string {
  return `${pulls.length}#${pulls.map((p) => p.uid).join(',')}`;
}

/* ================================ Store =================================== */

interface StatsActions {
  recordPulls(poolId: string, pulls: readonly GachaPull[], startIndex: number, at?: number): void;
  recordBattle(record: BattleRecord): void;
  appendCombatLog(enemyId: string, entries: readonly CombatLogEntry[]): void;
  setCombatCursor(cursor: number): void;
  markResultRecorded(fingerprint: string): void;
  bumpCounters(delta: Partial<StatsCounters>): void;
  clearStats(): void;
}

export type StatsStore = StatsState & StatsActions;

export const useStatsStore = create<StatsStore>()(
  persist(
    (set) => ({
      pullHistory: [],
      battleHistory: [],
      combatLogTail: [],
      poolTallies: {},
      counters: { pushBlocked: 0, goalBursts: 0, critShakes: 0, gachaBursts: 0, planeShifts: 0 },
      lastResultFingerprint: null,
      combatLogCursor: 0,

      recordPulls(poolId, pulls, startIndex, at = Date.now()) {
        set((state) => {
          if (pulls.length === 0) return state;
          const previous = state.poolTallies[poolId] ?? emptyTally();
          let twoStar = previous.twoStar;
          let threeStar = previous.threeStar;
          let fourStar = previous.fourStar;
          for (const p of pulls) {
            if (p.rarity === 4) fourStar += 1;
            else if (p.rarity === 3) threeStar += 1;
            else twoStar += 1;
          }
          const records: readonly PullRecord[] = pulls.map((p, i) => ({
            uid: p.uid,
            cardId: p.cardId,
            rarity: p.rarity,
            isNew: p.isNew,
            poolId,
            pullIndex: startIndex + i + 1,
            at,
          }));
          const merged = [...state.pullHistory, ...records];
          const trimmed = merged.length > MAX_PULL_HISTORY ? merged.slice(merged.length - MAX_PULL_HISTORY) : merged;
          return {
            pullHistory: trimmed,
            poolTallies: {
              ...state.poolTallies,
              [poolId]: { pulls: previous.pulls + pulls.length, twoStar, threeStar, fourStar },
            },
          };
        });
      },

      recordBattle(record) {
        set((state) => {
          const merged = [...state.battleHistory, record];
          return {
            battleHistory: merged.length > MAX_BATTLE_HISTORY ? merged.slice(merged.length - MAX_BATTLE_HISTORY) : merged,
          };
        });
      },

      appendCombatLog(enemyId, entries) {
        if (entries.length === 0) return;
        set((state) => {
          const tagged: readonly TaggedCombatLogEntry[] = entries.map((e) => ({ ...e, enemyId }));
          const merged = [...state.combatLogTail, ...tagged];
          return {
            combatLogTail:
              merged.length > MAX_COMBAT_LOG_TAIL ? merged.slice(merged.length - MAX_COMBAT_LOG_TAIL) : merged,
          };
        });
      },

      setCombatCursor(cursor) {
        set({ combatLogCursor: cursor });
      },

      markResultRecorded(fingerprint) {
        set({ lastResultFingerprint: fingerprint });
      },

      bumpCounters(delta) {
        set((state) => ({
          counters: {
            pushBlocked: state.counters.pushBlocked + (delta.pushBlocked ?? 0),
            goalBursts: state.counters.goalBursts + (delta.goalBursts ?? 0),
            critShakes: state.counters.critShakes + (delta.critShakes ?? 0),
            gachaBursts: state.counters.gachaBursts + (delta.gachaBursts ?? 0),
            planeShifts: state.counters.planeShifts + (delta.planeShifts ?? 0),
          },
        }));
      },

      clearStats() {
        set({
          pullHistory: [],
          battleHistory: [],
          combatLogTail: [],
          poolTallies: {},
          counters: { pushBlocked: 0, goalBursts: 0, critShakes: 0, gachaBursts: 0, planeShifts: 0 },
          lastResultFingerprint: null,
          combatLogCursor: 0,
        });
      },
    }),
    {
      name: 'lawbox-chronicle:stats:v1',
      // B4-6：v2 —— combatLogCursor 退出持久化契约。它是「本会话已消费的
      // combat.log 条目数」的游标（会话态），而战斗会话态（combat/battle）不落
      // 盘：战斗中刷新则 cursor=N 残留、combat 清零，下一场战斗开场 system×N
      // 条日志被游标跳过、永久丢失。v1 旧档里已写入的 cursor 由 migrate 剥离，
      // 读档后游标一律从 0 起算（与「战斗关闭归零」同一生命周期）。
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // 只持久化数据字段；动作函数与会话态游标（combatLogCursor）不落盘
      partialize: (state) => ({
        pullHistory: state.pullHistory,
        battleHistory: state.battleHistory,
        combatLogTail: state.combatLogTail,
        poolTallies: state.poolTallies,
        counters: state.counters,
        lastResultFingerprint: state.lastResultFingerprint,
      }),
      migrate: (persisted) => {
        const { combatLogCursor: droppedCursor, ...rest } = (persisted ?? {}) as Partial<StatsState>;
        void droppedCursor;
        return rest;
      },
    },
  ),
);

/* ============================ 曲线（纯函数） ============================== */

export interface PoolCurve {
  readonly poolId: string;
  readonly pulls: number;
  readonly twoStar: number;
  readonly threeStar: number;
  readonly fourStar: number;
  /** 实测 4★ 出货率（0 抽时为 null，不伪造 0%） */
  readonly fourStarRate: number | null;
  readonly threeStarPlusRate: number | null;
}

/** 某一池的实测出货统计（图鉴页「概率实测」的数据源） */
export function poolCurve(state: StatsState, poolId: string): PoolCurve {
  const tally = state.poolTallies[poolId] ?? emptyTally();
  return {
    poolId,
    pulls: tally.pulls,
    twoStar: tally.twoStar,
    threeStar: tally.threeStar,
    fourStar: tally.fourStar,
    fourStarRate: tally.pulls > 0 ? tally.fourStar / tally.pulls : null,
    threeStarPlusRate: tally.pulls > 0 ? (tally.threeStar + tally.fourStar) / tally.pulls : null,
  };
}

export interface CurvePoint {
  /** 累计抽数 */
  readonly pulls: number;
  /** 截至该抽数的累计 4★ 率 */
  readonly fourStarRate: number;
}

/**
 * 累计出货曲线：按时间序逐抽累加 4★ 计数，产出折线图数据点。
 * 只统计指定池；历史记录被容量裁剪时，曲线从可考的最早一抽开始。
 */
export function cumulativeFourStarCurve(state: StatsState, poolId: string): readonly CurvePoint[] {
  let pulls = 0;
  let fourStars = 0;
  const points: CurvePoint[] = [];
  for (const record of state.pullHistory) {
    if (record.poolId !== poolId) continue;
    pulls += 1;
    if (record.rarity === 4) fourStars += 1;
    points.push({ pulls, fourStarRate: fourStars / pulls });
  }
  return points;
}

/* ============================ 自动收集器 ================================== */

let unsubscribeCollector: (() => void) | null = null;

/**
 * 安装收集器（幂等）：订阅 bus 计数演出事件、订阅 store 记录权威数据。
 * 返回卸载函数。模块加载时自动安装（见文件底部），测试可手动卸载隔离。
 */
export function installStatsCollector(): () => void {
  if (unsubscribeCollector !== null) return unsubscribeCollector;

  const offBus = bus.subscribe((event) => {
    switch (event.type) {
      case 'anim/blocked':
        useStatsStore.getState().bumpCounters({ pushBlocked: 1 });
        break;
      case 'anim/goalBurst':
        useStatsStore.getState().bumpCounters({ goalBursts: 1 });
        break;
      case 'anim/screenShake':
        useStatsStore.getState().bumpCounters({ critShakes: 1 });
        break;
      case 'anim/gachaBurst':
        useStatsStore.getState().bumpCounters({ gachaBursts: 1 });
        break;
      case 'fx/planeShift':
        useStatsStore.getState().bumpCounters({ planeShifts: 1 });
        break;
      default:
        break;
    }
  });

  const offStore = useGameStore.subscribe((state, prev) => {
    const stats = useStatsStore.getState();

    // ---- 抽卡：lastResult 换代即整批记录（指纹去重，防刷新重放） ----
    const result = state.gacha.lastResult;
    if (result !== null && result !== prev.gacha.lastResult) {
      const fingerprint = resultFingerprint(result.pulls);
      if (stats.lastResultFingerprint !== fingerprint) {
        const startIndex = state.gacha.totalPulls - result.pulls.length;
        stats.recordPulls(POOL_OFFICIAL, result.pulls, Math.max(0, startIndex));
        stats.markResultRecorded(fingerprint);
      }
    }

    // ---- 战斗：日志增量 + 胜负结算 ----
    const combat = state.combat;
    const prevCombat = prev.combat;
    if (combat !== null) {
      const cursor = stats.combatLogCursor;
      if (combat.log.length > cursor) {
        stats.appendCombatLog(combat.enemyId, combat.log.slice(cursor));
        stats.setCombatCursor(combat.log.length);
      }
      if (prevCombat !== null && prevCombat.phase !== combat.phase) {
        if (combat.phase === 'victory' || combat.phase === 'defeat') {
          let damageDealt = 0;
          let damageTaken = 0;
          for (const entry of combat.log) {
            if (entry.actor === 'player') damageDealt += entry.damage;
            else damageTaken += entry.damage;
          }
          stats.recordBattle({
            enemyId: combat.enemyId,
            victory: combat.phase === 'victory',
            turns: combat.turn,
            damageDealt,
            damageTaken,
            at: Date.now(),
          });
        }
      }
    } else if (prevCombat !== null) {
      stats.setCombatCursor(0); // 战斗面板关闭，日志游标归零
    }
  });

  const off = (): void => {
    offBus();
    offStore();
    unsubscribeCollector = null;
  };
  unsubscribeCollector = off;
  return off;
}

/* 模块加载即安装：统计不依赖任何视图挂载点，随包加载即开始记录。
   卸载走 installStatsCollector 的返回值（此前零引用的 uninstallStatsCollector
   导出已删，A4-8 死代码清理；测试隔离用返回的 off 函数即可）。 */
installStatsCollector();
