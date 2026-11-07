/**
 * gacha-engine · pity —— 三层保底状态机 + 碎片兜底经济（纯函数，可独立 vitest）。
 * ---------------------------------------------------------------------------
 * 原版 Lottery.java 只有一层「事后转稀有度」的保底（:69-72），且保底只按
 * 稀有度随机挑卡、不保具体卡——关键法则卡存在软锁风险（本模块规格要点）。
 * 新实现为三层独立计数器，全部纯数据、可 JSON 持久化：
 *
 *   层1 稀有度·十连保底  —— 十连无 3★+ → 随机 1 张 2★ 升 3★（沿用
 *                           Lottery.java:69-72 的事后转语义）
 *   层2 稀有度·硬保底    —— 累计 hardFourStar（正式池 50）抽无 4★ → 本批必出 4★
 *   层3 法则·定向保底    —— 累计 lawDirected（正式池 40）抽未获得「未持有的
 *                           法则卡」→ 下一张稀有卡必从未持有法则卡中 roll
 *   兜底 碎片经济        —— 重复法则卡 ×1 → +dupeLawShards（正式池 20）碎片；
 *                           redeemCost（正式池 60）碎片直购任一未持有法则卡
 *
 * 三层计数器（pullsSinceFourStar / pullsSinceNewLaw）各自独立累计、互不复位；
 * 碎片余额 shards 随计数器一并持久化（zustand persist 经 PITY_STORAGE_KEY 对接，
 * 引擎侧只提供注入式 adapter，不碰浏览器 IO，保持纯度）。
 */

import { z } from 'zod';
import type { CardDef, GachaPull, Rarity } from '../../core/types';
import type { Rng } from '../../core/rng';

/* ================================ 计数器 ================================== */

/** 三层保底独立计数器 + 碎片余额（纯 JSON 可序列化，持久化单元） */
export interface PityCounters {
  /** 层2：累计多少抽没有出 4★（出 4★ 即清零） */
  readonly pullsSinceFourStar: number;
  /** 层3：累计多少抽没有获得「未持有的法则卡」（获得即清零） */
  readonly pullsSinceNewLaw: number;
  /** 碎片余额（重复法则卡累积，商店直购消耗） */
  readonly shards: number;
  /** 全局累计抽数（驱动怀旧池「每第 10 回」对照档与统计曲线） */
  readonly totalPulls: number;
}

export const EMPTY_PITY_COUNTERS: PityCounters = {
  pullsSinceFourStar: 0,
  pullsSinceNewLaw: 0,
  shards: 0,
  totalPulls: 0,
};

/** 保底参数（数据外置于 src/data/gacha/pools.ts，引擎只认形状） */
export interface PityConfig {
  /** 层1：十连无 3★+ → 转 1 张 3★（Lottery.java:69-72 语义） */
  readonly perTenPullThreeStar: boolean;
  /** 层2：累计无 4★ 达到该值 → 本批必出 4★（正式池 50） */
  readonly hardFourStar: number;
  /** 层3：累计无未持有法则卡达到该值 → 下张稀有卡定向（正式池 40；null=禁用） */
  readonly lawDirected: number | null;
  /** 兜底：每张重复法则卡转碎片数（正式池 20） */
  readonly dupeLawShards: number;
  /** 兜底：碎片直购一张未持有法则卡的售价（正式池 60） */
  readonly redeemCost: number;
}

/* ================================ 层1/层2/层3 修正 ========================= */

export type PityTrigger = 'per-ten' | 'hard-four-star';

export interface ApplyPityInput {
  /** 裸 roll 出的稀有序列（本函数不改入参，返回修正副本） */
  readonly rarities: readonly Rarity[];
  readonly times: 1 | 10;
  readonly counters: PityCounters;
  readonly config: PityConfig;
  readonly rng: Rng;
}

export interface ApplyPityResult {
  readonly rarities: readonly Rarity[];
  readonly triggers: readonly PityTrigger[];
  /** 层3 命中位：该位必须从未持有法则卡中 pick；null=本批无定向 */
  readonly directedIndex: number | null;
}

/** 对裸稀有序列做层1/层2 修正并计算层3 定向位（纯函数） */
export function applyPity(input: ApplyPityInput): ApplyPityResult {
  const { times, counters, config, rng } = input;
  const arr: Rarity[] = [...input.rarities];
  const triggers: PityTrigger[] = [];

  // ---- 层2：硬保底 4★（优先于层1：4★ 更稀有，且升 4★ 后层1 自动失效） ----
  if (counters.pullsSinceFourStar >= config.hardFourStar && !arr.includes(4)) {
    // 升级源：优先 2★，无 2★ 则牺牲 3★（十连全 3★+ 且无 4★ 的罕见情况）
    const source = indicesOf(arr, 2).length > 0 ? indicesOf(arr, 2) : indicesOf(arr, 3);
    if (source.length > 0) {
      arr[rng.pick(source)] = 4;
      triggers.push('hard-four-star');
    }
  }

  // ---- 层1：十连无 3★+ → 随机 1 张 2★ 升 3★（Lottery.java:69-72） ----
  if (times === 10 && config.perTenPullThreeStar && !arr.some((r) => r >= 3)) {
    const source = indicesOf(arr, 2);
    if (source.length > 0) {
      arr[rng.pick(source)] = 3;
      triggers.push('per-ten');
    }
  }

  // ---- 层3：法则定向保底 —— 下一张稀有卡必从未持有法则卡中 pick ----
  // 计数器达到阈值后不急于本批结算：批内出现稀有卡才定向，否则继续累积
  //（等层2 的强制 4★ 或自然稀有卡到来，语义见模块规格「下一次稀有卡」）。
  let directedIndex: number | null = null;
  if (config.lawDirected !== null && counters.pullsSinceNewLaw >= config.lawDirected) {
    const idx = arr.findIndex((r) => r >= 3);
    if (idx >= 0) directedIndex = idx;
  }

  return { rarities: arr, triggers, directedIndex };
}

function indicesOf(arr: readonly Rarity[], target: Rarity): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === target) out.push(i);
  }
  return out;
}

/* ================================ 批后结算 ================================= */

export interface SettleBatchInput {
  readonly counters: PityCounters;
  readonly times: 1 | 10;
  /** 定向修正与 pick 之后的最终批结果 */
  readonly pulls: readonly GachaPull[];
  readonly config: PityConfig;
  /** 卡 id → 定义（判定 kind=law 与碎片结算） */
  readonly cardLookup: ReadonlyMap<string, CardDef>;
}

export interface SettleBatchResult {
  readonly counters: PityCounters;
  readonly shardsGained: number;
}

/**
 * 批后结算：三个独立计数器各自更新 + 碎片累积。
 *  - pullsSinceFourStar：批内（最终）有 4★ → 清零，否则 +times；
 *  - pullsSinceNewLaw：批内产出过「未持有的法则卡」（含定向与自然出货）→ 清零，否则 +times；
 *  - shards：每张重复（!isNew）法则卡 +dupeLawShards。
 */
export function settleBatchCounters(input: SettleBatchInput): SettleBatchResult {
  const { counters, times, pulls, config, cardLookup } = input;

  let shardsGained = 0;
  let gotNewLaw = false;
  for (const pull of pulls) {
    const def = cardLookup.get(pull.cardId);
    if (def !== undefined && def.kind === 'law') {
      if (pull.isNew) gotNewLaw = true;
      else shardsGained += config.dupeLawShards;
    }
  }
  const gotFourStar = pulls.some((p) => p.rarity === 4);

  return {
    counters: {
      pullsSinceFourStar: gotFourStar ? 0 : counters.pullsSinceFourStar + times,
      pullsSinceNewLaw: gotNewLaw ? 0 : counters.pullsSinceNewLaw + times,
      shards: counters.shards + shardsGained,
      totalPulls: counters.totalPulls + times,
    },
    shardsGained,
  };
}

/* ============================== 碎片商店直购 =============================== */

export interface RedeemLawCardArgs {
  readonly counters: PityCounters;
  readonly cardId: string;
  readonly ownedCardIds: ReadonlySet<string>;
  /** 全部可兑换的法则卡定义（数据层传入 pools 的法则条目） */
  readonly lawCards: readonly CardDef[];
  readonly redeemCost: number;
}

export type RedeemLawCardResult =
  | { readonly ok: true; readonly counters: PityCounters; readonly cardId: string }
  | { readonly ok: false; readonly error: string };

/**
 * 祭坛商店：60 碎片直购任一未持有法则卡（兜底层，防关键法则卡软锁）。
 * 只结算碎片与合法性，卡的入包/激活由 store 完成（引擎无副作用）。
 */
export function redeemLawCard(args: RedeemLawCardArgs): RedeemLawCardResult {
  const { counters, cardId, ownedCardIds, lawCards, redeemCost } = args;
  if (!Number.isInteger(redeemCost) || redeemCost < 0) {
    return { ok: false, error: `直购售价非法：${redeemCost}` };
  }
  const card = lawCards.find((c) => c.id === cardId);
  if (card === undefined) return { ok: false, error: `法则卡 ${cardId} 不存在` };
  if (card.kind !== 'law') return { ok: false, error: `「${card.name}」不是法则卡，不能碎片兑换` };
  if (ownedCardIds.has(card.id)) return { ok: false, error: `已持有「${card.name}」，不能重复兑换` };
  if (counters.shards < redeemCost) {
    return { ok: false, error: `碎片不足：需要 ${redeemCost}，当前 ${counters.shards}` };
  }
  return {
    ok: true,
    counters: { ...counters, shards: counters.shards - redeemCost },
    cardId,
  };
}

/* ============================== UI 进度条派生 ============================== */

/** 三层保底进度（图鉴/抽卡页进度条直接消费；B4：把保底进度明示给玩家） */
export interface PityProgress {
  readonly fourStarCount: number;
  readonly fourStarThreshold: number;
  readonly fourStarRatio: number;
  readonly lawDirectedCount: number;
  readonly lawDirectedThreshold: number | null;
  readonly lawDirectedRatio: number | null;
  readonly shards: number;
}

export function pityProgress(counters: PityCounters, config: PityConfig): PityProgress {
  const fourStarRatio = clamp01(counters.pullsSinceFourStar / Math.max(1, config.hardFourStar));
  const lawDirectedRatio =
    config.lawDirected === null ? null : clamp01(counters.pullsSinceNewLaw / Math.max(1, config.lawDirected));
  return {
    fourStarCount: counters.pullsSinceFourStar,
    fourStarThreshold: config.hardFourStar,
    fourStarRatio,
    lawDirectedCount: counters.pullsSinceNewLaw,
    lawDirectedThreshold: config.lawDirected,
    lawDirectedRatio,
    shards: counters.shards,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/* ================================ 持久化 ================================== */

const PITY_COUNTERS_SCHEMA = z.object({
  pullsSinceFourStar: z.number().int().min(0),
  pullsSinceNewLaw: z.number().int().min(0),
  shards: z.number().int().min(0),
  totalPulls: z.number().int().min(0),
});

/** 存储适配器：引擎不碰浏览器 IO，由调用方注入（localStorage / 内存 / 测试桩） */
export interface PityStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PITY_STORAGE_KEY = 'lawbox-chronicle:pity:v1';

const PITY_SAVE_VERSION = 1;

/** 序列化为带版本号的 JSON（坏档检测依据版本 + zod 形状双重校验） */
export function encodePityCounters(counters: PityCounters): string {
  return JSON.stringify({ version: PITY_SAVE_VERSION, counters });
}

/** 反序列化：任何形状/版本异常一律回退到空计数器（坏档不炸存档） */
export function decodePityCounters(raw: string): PityCounters {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_PITY_COUNTERS;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_PITY_COUNTERS;
  const wrap = parsed as { readonly version?: unknown; readonly counters?: unknown };
  if (wrap.version !== PITY_SAVE_VERSION || typeof wrap.counters !== 'object' || wrap.counters === null) {
    return EMPTY_PITY_COUNTERS;
  }
  const result = PITY_COUNTERS_SCHEMA.safeParse(wrap.counters);
  return result.success ? result.data : EMPTY_PITY_COUNTERS;
}

export function savePityCounters(adapter: PityStorageAdapter, counters: PityCounters): void {
  adapter.setItem(PITY_STORAGE_KEY, encodePityCounters(counters));
}

export function loadPityCounters(adapter: PityStorageAdapter): PityCounters {
  const raw = adapter.getItem(PITY_STORAGE_KEY);
  return raw === null ? EMPTY_PITY_COUNTERS : decodePityCounters(raw);
}

/** 测试与会话内存实现 */
export function createMemoryPityAdapter(): PityStorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

/** 浏览器默认实现：惰性访问 localStorage（SSR/测试无 window 时安全降级为内存） */
export function createBrowserPityAdapter(): PityStorageAdapter {
  if (typeof window === 'undefined' || window.localStorage === undefined) return createMemoryPityAdapter();
  return window.localStorage;
}
