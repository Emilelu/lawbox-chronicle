/**
 * gacha-engine 单测 —— 逐卡 roll / 三层保底 / 碎片经济 / 持久化 / 怀旧对照。
 * ---------------------------------------------------------------------------
 * 全部用 core/rng 的种子流（同种子同结果），统计断言走大样本宽容区间。
 * 覆盖的规避项：
 *   B2 双档概率重叠 → rollRare 互斥 else-if 链 + 长程频率收敛
 *   B3 十连单 roll   → 逐卡独立 roll + 条目均匀 pick
 *   B4 「每 10 回提升」误解 → 正式池无对照档、十连末位强制 3★+ 独立规则、
 *                            怀旧池全局每第 10 抽语义单独复刻并明示
 *   B7 while 判满    → 稀有度 roll 出确切张数（怀旧复刻用有界 while）
 *   B8 输入未校验    → 批次/概率/条目池全部显式断言抛错
 */

import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '../../../core/rng';
import { LAW_PATCH_IDS } from '../../../core/lawRegistry';
import { validateWorld, type WorldTables } from '../../../core/schema';
import {
  nostalgiaRatesForRound,
  performGacha,
  rollBatch,
  rollPoolBatch,
  rollRare,
  rollRarities,
  simulateNostalgiaRound,
  validateGachaPool,
  type GachaPoolDef,
} from '../roller';
import {
  createBrowserPityAdapter,
  createMemoryPityAdapter,
  decodePityCounters,
  EMPTY_PITY_COUNTERS,
  encodePityCounters,
  loadPityCounters,
  pityProgress,
  redeemLawCard,
  savePityCounters,
  settleBatchCounters,
  applyPity,
  PITY_STORAGE_KEY,
} from '../pity';
import { ALL_GACHA_CARDS, auditPools, FORMAL_GACHA_CONFIG, FORMAL_POOL, gachaCost, NOSTALGIA_PARAMS } from '../../../data/gacha/pools';
import { auditLawCards, LAW_CARDS } from '../../../data/cards/lawCards';
import { auditCharacterCards, CHARACTER_CARDS } from '../../../data/cards/characterCards';
import { CARDS, GACHA_CONFIG } from '../../../data/gacha';
import { AUDIO_MANIFEST } from '../../../data/audio';

/** 全卡 id → 定义（结算/兑换用） */
const CARD_LOOKUP = new Map(ALL_GACHA_CARDS.map((c) => [c.id, c] as const));

/** 关闭「十连末位强制 3★+」的正式池派生（用于复现层1 的事后转语义） */
const LEGACY_STYLE_POOL: GachaPoolDef = { ...FORMAL_POOL, forceLastPullThreeStarOnTen: false };

/** 固定值假 Rng（怀旧复刻的确定性验证用） */
function fakeRng(nextValue: number, intValue: number): Rng {
  return {
    seedLabel: `fake:${nextValue}:${intValue}`,
    next: () => nextValue,
    int: () => intValue,
    chance: () => nextValue < 0.5,
    pick: (items) => {
      const item = items[0];
      if (item === undefined) throw new RangeError('fakeRng.pick: 空数组');
      return item;
    },
    fork: () => fakeRng(nextValue, intValue),
  };
}

/* ============================== 池数据自检 ================================= */

describe('池数据发行自检', () => {
  it('正式池结构合法、怀旧池参数保真、定价符合规格', () => {
    expect(auditPools()).toEqual([]);
  });

  it('法则卡与 lawRegistry 一补丁一卡且稀有度一致', () => {
    expect(auditLawCards()).toEqual([]);
    expect(LAW_CARDS).toHaveLength(LAW_PATCH_IDS.length);
  });

  it('角色卡 buff 数值全部在注册表范围内', () => {
    expect(auditCharacterCards()).toEqual([]);
    expect(CHARACTER_CARDS.length).toBeGreaterThan(0);
  });

  it('正式池条目分布：4★ 10 条 / 3★ 12 条 / 2★ 6 条，稀有度与卡面一致（17 张法则卡全量发行后的扩容分布）', () => {
    expect(FORMAL_POOL.entries[4]).toHaveLength(10);
    expect(FORMAL_POOL.entries[3]).toHaveLength(12);
    expect(FORMAL_POOL.entries[2]).toHaveLength(6);
    expect(validateGachaPool(FORMAL_POOL)).toEqual([]);
  });

  it('正式池概率：4★ 6% / 3★ 26% / 2★ 68%（规格值）', () => {
    expect(FORMAL_POOL.rarityRates).toEqual({ fourStar: 0.06, threeStar: 0.26, twoStar: 0.68 });
  });

  it('集成期校验：全部卡通过 core/schema 的 zod 与跨表引用校验', () => {
    const tables: WorldTables = {
      levels: [],
      enemies: [],
      weapons: [],
      gachaConfig: FORMAL_GACHA_CONFIG,
      cards: ALL_GACHA_CARDS,
      storyEvents: [],
      audio: AUDIO_MANIFEST,
    };
    const result = validateWorld(tables);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

/* ============================ 逐卡独立 roll（B3） =========================== */

describe('roller 逐卡独立 roll（B3 根治）', () => {
  it('十连恰好 10 张、单抽恰好 1 张，uid 互不重复', () => {
    const ten = performGacha({ pool: FORMAL_POOL, rng: createRng('ten'), counters: EMPTY_PITY_COUNTERS, ownedCardIds: new Set(), times: 10 });
    expect(ten.pulls).toHaveLength(10);
    expect(new Set(ten.pulls.map((p) => p.uid)).size).toBe(10);
    const one = performGacha({ pool: FORMAL_POOL, rng: createRng('one'), counters: EMPTY_PITY_COUNTERS, ownedCardIds: new Set(), times: 1 });
    expect(one.pulls).toHaveLength(1);
  });

  it('同种子同结果（含计数器批后值），不同种子不同', () => {
    const a = performGacha({ pool: FORMAL_POOL, rng: createRng('same'), counters: EMPTY_PITY_COUNTERS, ownedCardIds: new Set(), times: 10 });
    const b = performGacha({ pool: FORMAL_POOL, rng: createRng('same'), counters: EMPTY_PITY_COUNTERS, ownedCardIds: new Set(), times: 10 });
    expect(a.pulls).toEqual(b.pulls);
    expect(a.countersAfter).toEqual(b.countersAfter);
    const c = performGacha({ pool: FORMAL_POOL, rng: createRng('other'), counters: EMPTY_PITY_COUNTERS, ownedCardIds: new Set(), times: 10 });
    expect(c.pulls.map((p) => p.uid)).not.toEqual(a.pulls.map((p) => p.uid));
  });

  it('长程频率收敛到 6% / 26% / 68%（2.4 万张裸 roll，无保底干扰）', () => {
    const rounds = 24000;
    let four = 0;
    let three = 0;
    for (let i = 0; i < rounds; i++) {
      const out = rollPoolBatch(FORMAL_POOL, createRng(`freq-${i}`), { totalPullsBefore: i }, 1);
      const rarity = out.pulls[0]?.rarity;
      if (rarity === 4) four++;
      else if (rarity === 3) three++;
    }
    const total = rounds;
    expect(four / total).toBeGreaterThan(0.045);
    expect(four / total).toBeLessThan(0.075);
    expect(three / total).toBeGreaterThan(0.245);
    expect(three / total).toBeLessThan(0.275);
    const twoRate = 1 - four / total - three / total;
    expect(twoRate).toBeGreaterThan(0.665);
    expect(twoRate).toBeLessThan(0.695);
  });

  it('rollRare 单次判定恰好落一档（互斥链，B2 根治点）', () => {
    for (let i = 0; i < 1000; i++) {
      const rarity = rollRare(FORMAL_POOL.rarityRates, createRng(`rare-${i}`));
      expect([2, 3, 4]).toContain(rarity);
    }
  });

  it('4★ 池 10 条目均匀出货（每条占比 ≈ 1/10）', () => {
    const counts = new Map<string, number>();
    let fourTotal = 0;
    const rounds = 24000;
    for (let i = 0; i < rounds; i++) {
      const out = rollPoolBatch(FORMAL_POOL, createRng(`uniform-${i}`), { totalPullsBefore: i }, 1);
      const pull = out.pulls[0];
      if (pull !== undefined && pull.rarity === 4) {
        fourTotal++;
        counts.set(pull.cardId, (counts.get(pull.cardId) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(10);
    for (const n of counts.values()) {
      const share = n / fourTotal;
      expect(share).toBeGreaterThan(1 / 10 - 0.04);
      expect(share).toBeLessThan(1 / 10 + 0.04);
    }
  });

  it('正式池十连第 10 抽必为 3★+（fusionPlan 规则，与 B4 的「每 10 回」语义解耦）', () => {
    for (let i = 0; i < 2000; i++) {
      const out = performGacha({ pool: FORMAL_POOL, rng: createRng(`last-${i}`), counters: EMPTY_PITY_COUNTERS, ownedCardIds: new Set(), times: 10 });
      const last = out.pulls[9];
      expect(last).toBeDefined();
      expect(last?.rarity).toBeGreaterThanOrEqual(3);
    }
  });

  it('正式池不启用 Lottery 对照档：全局第 10 抽无概率跳档', () => {
    // totalPullsBefore=9 → 本批首张是全局第 10 抽；裸 roll 概率仍为 6%/26%/68%
    for (let i = 0; i < 500; i++) {
      const out = rollPoolBatch(FORMAL_POOL, createRng(`no-boost-${i}`), { totalPullsBefore: 9 }, 1);
      const rarity = out.pulls[0]?.rarity;
      expect([2, 3, 4]).toContain(rarity);
      expect(out.boostedTenPull).toBe(false);
    }
  });
});

/* ============================== 三层保底 ================================== */

describe('pity 三层独立计数器', () => {
  it('层2：累计 50 抽无 4★ → 本批必出 4★ 并清零（任意种子）', () => {
    for (const seed of ['hard-1', 'hard-2', 'hard-3']) {
      const counters = { ...EMPTY_PITY_COUNTERS, pullsSinceFourStar: 50 };
      const out = performGacha({ pool: FORMAL_POOL, rng: createRng(seed), counters, ownedCardIds: new Set(), times: 1 });
      expect(out.pulls[0]?.rarity).toBe(4);
      expect(out.countersAfter.pullsSinceFourStar).toBe(0);
      expect(out.triggers).toContain('hard-four-star');
    }
  });

  it('层2：49 抽时不强制（选裸 roll 非 4★ 的种子对照）', () => {
    let seed = '';
    for (let i = 0; i < 1000; i++) {
      if (rollRare(FORMAL_POOL.rarityRates, createRng(`edge-${i}`)) !== 4) {
        seed = `edge-${i}`;
        break;
      }
    }
    expect(seed).not.toBe('');
    const counters = { ...EMPTY_PITY_COUNTERS, pullsSinceFourStar: 49 };
    const out = performGacha({ pool: FORMAL_POOL, rng: createRng(seed), counters, ownedCardIds: new Set(), times: 1 });
    expect(out.pulls[0]?.rarity).not.toBe(4);
    expect(out.countersAfter.pullsSinceFourStar).toBe(50);
    expect(out.triggers).not.toContain('hard-four-star');
  });

  it('层2 优先于层1：硬保底升 4★ 后，十连必有 3★+，层1 不再触发', () => {
    for (let i = 0; i < 200; i++) {
      const counters = { ...EMPTY_PITY_COUNTERS, pullsSinceFourStar: 50 };
      const out = performGacha({ pool: FORMAL_POOL, rng: createRng(`prio-${i}`), counters, ownedCardIds: new Set(), times: 10 });
      if (out.triggers.includes('hard-four-star')) {
        expect(out.pulls.some((p) => p.rarity === 4)).toBe(true);
        expect(out.triggers).not.toContain('per-ten');
        return;
      }
    }
    throw new Error('200 个种子内未触发层2（概率假设有误）');
  });

  it('层1（Lottery.java:69-72 语义）：十连全 2★ → 事后转恰好 1 张 3★', () => {
    for (let seed = 0; seed < 20000; seed++) {
      const label = `per-ten-scan-${seed}`;
      const bare = rollRarities(LEGACY_STYLE_POOL, createRng(label), { totalPullsBefore: 1 }, 10);
      if (bare.rarities.some((r) => r >= 3)) continue;
      const out = performGacha({
        pool: LEGACY_STYLE_POOL,
        rng: createRng(label),
        counters: { ...EMPTY_PITY_COUNTERS, totalPulls: 1 },
        ownedCardIds: new Set(),
        times: 10,
      });
      expect(out.triggers).toContain('per-ten');
      expect(out.pulls.filter((p) => p.rarity === 3)).toHaveLength(1);
      expect(out.pulls.filter((p) => p.rarity === 2)).toHaveLength(9);
      return;
    }
    throw new Error('2 万种子内未找到全 2★ 十连（概率假设有误）');
  });

  it('层1 纯函数面：applyPity 对全 2★ 十连升一张 3★，对含 3★ 的十连不动', () => {
    const allTwo = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] as const;
    const fixed = applyPity({ rarities: [...allTwo], times: 10, counters: EMPTY_PITY_COUNTERS, config: FORMAL_POOL.pity, rng: createRng('ap-1') });
    expect(fixed.rarities.filter((r) => r === 3)).toHaveLength(1);
    expect(fixed.triggers).toEqual(['per-ten']);
    const hasRare = applyPity({
      rarities: [2, 3, 2, 2, 2, 2, 2, 2, 2, 2],
      times: 10,
      counters: EMPTY_PITY_COUNTERS,
      config: FORMAL_POOL.pity,
      rng: createRng('ap-2'),
    });
    expect(hasRare.rarities).toEqual([2, 3, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(hasRare.triggers).toEqual([]);
  });

  it('层3：40 抽未获未持有法则卡 → 批内稀有卡定向为未持有法则卡并清零', () => {
    for (let seed = 0; seed < 5000; seed++) {
      const label = `direct-${seed}`;
      const bare = rollRarities(FORMAL_POOL, createRng(label), { totalPullsBefore: 40 }, 10);
      if (!bare.rarities.some((r) => r >= 3)) continue;
      const counters = { ...EMPTY_PITY_COUNTERS, pullsSinceNewLaw: 40, totalPulls: 40 };
      const out = performGacha({ pool: FORMAL_POOL, rng: createRng(label), counters, ownedCardIds: new Set(), times: 10 });
      const index = out.directedCardIndex;
      expect(index).not.toBeNull();
      const directed = out.pulls[index!];
      expect(directed?.isNew).toBe(true);
      const def = CARD_LOOKUP.get(directed?.cardId ?? '');
      expect(def?.kind).toBe('law');
      expect(def?.rarity).toBe(directed?.rarity);
      expect(out.countersAfter.pullsSinceNewLaw).toBe(0);
      return;
    }
    throw new Error('5000 种子内未找到含稀有卡的十连（概率假设有误）');
  });

  it('层3：39 抽时不定向；计数器随未持有法则卡产出清零', () => {
    for (let seed = 0; seed < 3000; seed++) {
      const label = `direct-39-${seed}`;
      const bare = rollRarities(FORMAL_POOL, createRng(label), { totalPullsBefore: 39 }, 10);
      if (!bare.rarities.some((r) => r >= 3)) continue;
      const counters = { ...EMPTY_PITY_COUNTERS, pullsSinceNewLaw: 39, totalPulls: 39 };
      const out = performGacha({ pool: FORMAL_POOL, rng: createRng(label), counters, ownedCardIds: new Set(), times: 10 });
      expect(out.directedCardIndex).toBeNull();
      // 自然出了未持有法则卡也清零（保底达成）
      const gotNewLaw = out.pulls.some((p) => p.isNew && CARD_LOOKUP.get(p.cardId)?.kind === 'law');
      expect(out.countersAfter.pullsSinceNewLaw).toBe(gotNewLaw ? 0 : 49);
      return;
    }
    throw new Error('3000 种子内未找到含稀有卡的十连（概率假设有误）');
  });

  it('层3：批内无稀有卡则不定向、计数器继续累积（单抽全 2★ 场景）', () => {
    // 注意：十连场景层1 会先转出一张 3★，那张「稀有卡」本身就会被层3 定向；
    // 只有单抽（层1 不参与）且 roll 出 2★ 时，才真正没有稀有卡可定向。
    const fixed = applyPity({
      rarities: [2],
      times: 1,
      counters: { ...EMPTY_PITY_COUNTERS, pullsSinceNewLaw: 40 },
      config: FORMAL_POOL.pity,
      rng: createRng('direct-none'),
    });
    expect(fixed.directedIndex).toBeNull();
    // 对照：层1 转出的 3★ 同样构成「稀有卡」，会被层3 定向（两保底联动）
    const ten = applyPity({
      rarities: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      times: 10,
      counters: { ...EMPTY_PITY_COUNTERS, pullsSinceNewLaw: 40 },
      config: FORMAL_POOL.pity,
      rng: createRng('direct-ten'),
    });
    expect(ten.directedIndex).not.toBeNull();
    expect(ten.rarities[ten.directedIndex!]).toBe(3);
  });

  it('层3：全部法则卡已持有时定向失效', () => {
    const ownedAllLaws = new Set(LAW_CARDS.map((c) => c.id));
    for (let seed = 0; seed < 3000; seed++) {
      const label = `direct-owned-${seed}`;
      const bare = rollRarities(FORMAL_POOL, createRng(label), { totalPullsBefore: 40 }, 10);
      if (!bare.rarities.some((r) => r >= 3)) continue;
      const counters = { ...EMPTY_PITY_COUNTERS, pullsSinceNewLaw: 40, totalPulls: 40 };
      const out = performGacha({ pool: FORMAL_POOL, rng: createRng(label), counters, ownedCardIds: ownedAllLaws, times: 10 });
      expect(out.directedCardIndex).toBeNull();
      return;
    }
    throw new Error('3000 种子内未找到含稀有卡的十连（概率假设有误）');
  });

  it('三层联动：50 抽无 4★ + 40 抽无法则 → 层2 强制的 4★ 成为定向稀有卡', () => {
    for (let seed = 0; seed < 5000; seed++) {
      const label = `chain-${seed}`;
      const bare = rollRarities(FORMAL_POOL, createRng(label), { totalPullsBefore: 90 }, 10);
      if (bare.rarities.includes(4)) continue; // 需要裸 roll 无 4★ 才触发层2
      const counters = { ...EMPTY_PITY_COUNTERS, pullsSinceFourStar: 50, pullsSinceNewLaw: 40, totalPulls: 90 };
      const out = performGacha({ pool: FORMAL_POOL, rng: createRng(label), counters, ownedCardIds: new Set(), times: 10 });
      expect(out.pulls.some((p) => p.rarity === 4)).toBe(true);
      expect(out.countersAfter.pullsSinceFourStar).toBe(0);
      expect(out.countersAfter.pullsSinceNewLaw).toBe(0);
      const index = out.directedCardIndex;
      if (index !== null) {
        const directed = out.pulls[index];
        const def = CARD_LOOKUP.get(directed?.cardId ?? '');
        expect(def?.kind).toBe('law');
        expect(directed?.isNew).toBe(true);
      }
      return;
    }
    throw new Error('5000 种子内未找到裸 roll 无 4★ 的十连（概率假设有误）');
  });

  it('保底进度派生（UI 进度条）：比率 clamp 到 [0,1]', () => {
    const progress = pityProgress({ pullsSinceFourStar: 50, pullsSinceNewLaw: 40, shards: 80, totalPulls: 90 }, FORMAL_POOL.pity);
    expect(progress.fourStarRatio).toBe(1);
    expect(progress.lawDirectedRatio).toBe(1);
    expect(progress.shards).toBe(80);
    const over = pityProgress({ ...EMPTY_PITY_COUNTERS, pullsSinceFourStar: 99 }, FORMAL_POOL.pity);
    expect(over.fourStarRatio).toBe(1);
    expect(over.lawDirectedThreshold).toBe(40);
  });
});

/* ============================== 碎片兜底经济 ================================ */

describe('碎片兜底：重复法则卡转 20 碎片 + 60 碎片直购', () => {
  it('结算：重复法则卡 +20/张，重复角色卡与新增卡不加', () => {
    const settled = settleBatchCounters({
      counters: { pullsSinceFourStar: 7, pullsSinceNewLaw: 33, shards: 5, totalPulls: 100 },
      times: 10,
      pulls: [
        { uid: 'a', cardId: 'card-law-light-step', rarity: 4, isNew: false },
        { uid: 'b', cardId: 'card-chr-ylzz', rarity: 4, isNew: false },
        { uid: 'c', cardId: 'card-law-wider-push', rarity: 3, isNew: true },
        { uid: 'd', cardId: 'card-law-berserk', rarity: 3, isNew: false },
        { uid: 'e', cardId: 'card-chr-dygg', rarity: 3, isNew: true },
      ],
      config: FORMAL_POOL.pity,
      cardLookup: CARD_LOOKUP,
    });
    expect(settled.shardsGained).toBe(40); // 两张重复法则卡
    expect(settled.counters.shards).toBe(45);
    expect(settled.counters.pullsSinceFourStar).toBe(0); // 批内有 4★
    expect(settled.counters.pullsSinceNewLaw).toBe(0); // 新法则卡出货
    expect(settled.counters.totalPulls).toBe(110);
  });

  it('结算：无 4★ / 无法则卡时计数器独立累加', () => {
    const settled = settleBatchCounters({
      counters: { pullsSinceFourStar: 10, pullsSinceNewLaw: 5, shards: 0, totalPulls: 20 },
      times: 10,
      pulls: [{ uid: 'x', cardId: 'card-chr-caixukun', rarity: 2, isNew: false }],
      config: FORMAL_POOL.pity,
      cardLookup: CARD_LOOKUP,
    });
    expect(settled.counters.pullsSinceFourStar).toBe(20);
    expect(settled.counters.pullsSinceNewLaw).toBe(15);
    expect(settled.counters.shards).toBe(0); // 重复的是角色卡
  });

  it('端到端：已持有全部法则卡的玩家抽卡只从重复法则卡获得碎片', () => {
    const owned = new Set(LAW_CARDS.map((c) => c.id));
    let totalShards = 0;
    for (let i = 0; i < 300; i++) {
      const out = performGacha({
        pool: FORMAL_POOL,
        rng: createRng(`shard-${i}`),
        counters: { ...EMPTY_PITY_COUNTERS, shards: totalShards, totalPulls: i * 10 },
        ownedCardIds: owned,
        times: 10,
      });
      totalShards = out.countersAfter.shards;
    }
    expect(totalShards).toBeGreaterThan(0);
    expect(totalShards % FORMAL_POOL.pity.dupeLawShards).toBe(0);
  });

  it('直购：60 碎片换未持有法则卡；碎片不足/已持有/非法则卡/未知 id 均拒绝', () => {
    const counters = { ...EMPTY_PITY_COUNTERS, shards: 60 };
    const ok = redeemLawCard({ counters, cardId: 'card-law-plane-shift', ownedCardIds: new Set(), lawCards: [...LAW_CARDS], redeemCost: FORMAL_POOL.pity.redeemCost });
    expect(ok).toEqual({ ok: true, counters: { ...counters, shards: 0 }, cardId: 'card-law-plane-shift' });

    expect(redeemLawCard({ counters: { ...counters, shards: 59 }, cardId: 'card-law-plane-shift', ownedCardIds: new Set(), lawCards: [...LAW_CARDS], redeemCost: 60 }).ok).toBe(false);
    expect(
      redeemLawCard({ counters, cardId: 'card-law-plane-shift', ownedCardIds: new Set(['card-law-plane-shift']), lawCards: [...LAW_CARDS], redeemCost: 60 }).ok,
    ).toBe(false);
    expect(redeemLawCard({ counters, cardId: 'card-chr-ylzz', ownedCardIds: new Set(), lawCards: [...LAW_CARDS], redeemCost: 60 }).ok).toBe(false);
    expect(redeemLawCard({ counters, cardId: 'card-law-not-exist', ownedCardIds: new Set(), lawCards: [...LAW_CARDS], redeemCost: 60 }).ok).toBe(false);
  });
});

/* ================================ 持久化 ================================== */

describe('保底计数器持久化', () => {
  const counters = { pullsSinceFourStar: 23, pullsSinceNewLaw: 11, shards: 40, totalPulls: 234 };

  it('编码/解码 roundtrip', () => {
    expect(decodePityCounters(encodePityCounters(counters))).toEqual(counters);
  });

  it('坏档回退：非 JSON / 版本不符 / 字段缺失 / 负数 / 非整数 → 空计数器', () => {
    expect(decodePityCounters('not-json{')).toEqual(EMPTY_PITY_COUNTERS);
    expect(decodePityCounters(JSON.stringify({ version: 99, counters }))).toEqual(EMPTY_PITY_COUNTERS);
    expect(decodePityCounters(JSON.stringify({ version: 1 }))).toEqual(EMPTY_PITY_COUNTERS);
    expect(decodePityCounters(JSON.stringify({ version: 1, counters: { ...counters, shards: -1 } }))).toEqual(EMPTY_PITY_COUNTERS);
    expect(decodePityCounters(JSON.stringify({ version: 1, counters: { ...counters, totalPulls: 1.5 } }))).toEqual(EMPTY_PITY_COUNTERS);
    expect(decodePityCounters('null')).toEqual(EMPTY_PITY_COUNTERS);
  });

  it('内存 adapter 存取 roundtrip；未写入时返回空计数器', () => {
    const adapter = createMemoryPityAdapter();
    expect(loadPityCounters(adapter)).toEqual(EMPTY_PITY_COUNTERS);
    savePityCounters(adapter, counters);
    expect(loadPityCounters(adapter)).toEqual(counters);
  });

  it('浏览器 adapter（jsdom localStorage）存取 roundtrip', () => {
    const adapter = createBrowserPityAdapter();
    savePityCounters(adapter, counters);
    expect(adapter.getItem(PITY_STORAGE_KEY)).not.toBeNull();
    expect(loadPityCounters(adapter)).toEqual(counters);
    savePityCounters(adapter, EMPTY_PITY_COUNTERS);
    expect(loadPityCounters(adapter)).toEqual(EMPTY_PITY_COUNTERS);
  });
});

/* ============================ 怀旧池对照展品 ================================ */

describe('怀旧模拟池：Lottery.java 原参数对照', () => {
  it('参数原样保真（0.06 / 0.2605 / 每 10 回 0.3 / 0.5）', () => {
    expect(NOSTALGIA_PARAMS).toEqual({ fourStar: 0.06, threeStar: 0.2605, boostEvery: 10, boostFourStar: 0.3, boostThreeStar: 0.5 });
  });

  it('档位切换：全局第 10/20 回（roundIndex 9/19）命中强化档，其余为基础档', () => {
    expect(nostalgiaRatesForRound(NOSTALGIA_PARAMS, 0)).toEqual({ fourStar: 0.06, threeStar: 0.2605, boosted: false });
    expect(nostalgiaRatesForRound(NOSTALGIA_PARAMS, 8)).toEqual({ fourStar: 0.06, threeStar: 0.2605, boosted: false });
    expect(nostalgiaRatesForRound(NOSTALGIA_PARAMS, 9)).toEqual({ fourStar: 0.3, threeStar: 0.5, boosted: true });
    expect(nostalgiaRatesForRound(NOSTALGIA_PARAMS, 10)).toEqual({ fourStar: 0.06, threeStar: 0.2605, boosted: false });
    expect(nostalgiaRatesForRound(NOSTALGIA_PARAMS, 19)).toEqual({ fourStar: 0.3, threeStar: 0.5, boosted: true });
  });

  it('确定性复刻：random=0.2 时基础档只出 3★，第 10 回双档重叠出 4★+3★（B2/B4 展品）', () => {
    const baseRound = simulateNostalgiaRound(NOSTALGIA_PARAMS, fakeRng(0.2, 1), 0);
    expect(baseRound).toEqual(['three', 'two', 'two', 'two', 'two', 'two', 'two', 'two', 'two', 'two']);
    const boostRound = simulateNostalgiaRound(NOSTALGIA_PARAMS, fakeRng(0.2, 1), 9);
    // 0.2 ≤ 0.3 命中 4★ 且 0.2 ≤ 0.5 命中 3★ —— 原版无 else-if 的双档重叠行为
    expect(boostRound).toEqual(['four', 'three', 'two', 'two', 'two', 'two', 'two', 'two', 'two', 'two']);
  });

  it('确定性复刻：random=0.05 时基础档双档同时触发（1 张 4★ + 1 张 3★）', () => {
    const round = simulateNostalgiaRound(NOSTALGIA_PARAMS, fakeRng(0.05, 1), 0);
    expect(round).toEqual(['four', 'three', 'two', 'two', 'two', 'two', 'two', 'two', 'two', 'two']);
  });

  it('每回恒产出 10 张（B7 复刻用有界 while）', () => {
    for (let i = 0; i < 500; i++) {
      expect(simulateNostalgiaRound(NOSTALGIA_PARAMS, createRng(`nostalgia-${i}`), i)).toHaveLength(10);
    }
  });
});

/* ============================== 兼容层与定价 ================================ */

describe('骨架兼容层与星石定价', () => {
  it('rollBatch 旧签名工作：十连 10 张 + 每 10 抽对照档命中（totalPullsBefore=9）', () => {
    const out = rollBatch(
      { config: GACHA_CONFIG, rng: createRng('compat'), totalPullsBefore: 9, pullsSinceFourStar: 0, ownedCardIds: new Set(), pool: CARDS },
      10,
    );
    expect(out.pulls).toHaveLength(10);
    expect(out.boostedTenPull).toBe(true);
    expect(['none', 'per-ten', 'hard-four-star']).toContain(out.pityTriggered);
  });

  it('兼容层沿用旧硬保底（GACHA_CONFIG.pity.hardFourStar=90）：批内无 4★ 时强制补出', () => {
    let triggered = false;
    for (let seed = 0; seed < 200; seed++) {
      const out = rollBatch(
        { config: GACHA_CONFIG, rng: createRng(`compat-hard-${seed}`), totalPullsBefore: 80, pullsSinceFourStar: 90, ownedCardIds: new Set(), pool: CARDS },
        10,
      );
      if (out.pityTriggered !== 'hard-four-star') continue; // 裸 roll 已出 4★ 时保底正确地不重复触发
      triggered = true;
      expect(out.pulls.some((p) => p.rarity === 4)).toBe(true);
      expect(out.pullsSinceFourStarAfter).toBe(0);
      break;
    }
    expect(triggered).toBe(true);
  });

  it('定价：单抽 100 / 十连 900；非法批次显式抛错（B8）', () => {
    expect(gachaCost(1)).toBe(100);
    expect(gachaCost(10)).toBe(900);
    expect(() => gachaCost(5 as 1 | 10)).toThrow(RangeError);
  });

  it('非法批次/非法池显式抛错（B8）', () => {
    expect(() =>
      performGacha({ pool: FORMAL_POOL, rng: createRng('x'), counters: EMPTY_PITY_COUNTERS, ownedCardIds: new Set(), times: 5 as 1 | 10 }),
    ).toThrow(RangeError);
    const broken: GachaPoolDef = { ...FORMAL_POOL, rarityRates: { fourStar: 0.5, threeStar: 0.5, twoStar: 0.5 } };
    expect(() => rollPoolBatch(broken, createRng('y'), { totalPullsBefore: 0 }, 1)).toThrow(/概率和/);
    const emptyPool: GachaPoolDef = { ...FORMAL_POOL, entries: { 2: [], 3: [], 4: [] } };
    expect(validateGachaPool(emptyPool).length).toBeGreaterThan(0);
    expect(validateGachaPool(FORMAL_POOL)).toEqual([]);
  });
});

/* ===================== 同批重复卡去重（B 修复） ===================== */

describe('同一十连重复卡：第二张标重复并结算碎片', () => {
  it('同批内第二次抽到同一张卡时 isNew=false', () => {
    // 每档只留 1 个条目：十连必然重复出同一张卡，无需依赖随机分布
    const first = (r: 2 | 3 | 4) => {
      const entry = FORMAL_POOL.entries[r][0];
      if (entry === undefined) throw new Error(`rarity ${r} 条目为空`);
      return entry;
    };
    const tiny: GachaPoolDef = {
      ...FORMAL_POOL,
      forceLastPullThreeStarOnTen: false,
      entries: { 2: [first(2)], 3: [first(3)], 4: [first(4)] },
    };
    const result = performGacha({
      pool: tiny,
      rng: createRng('dupe-batch'),
      counters: EMPTY_PITY_COUNTERS,
      ownedCardIds: new Set(),
      times: 10,
    });
    expect(result.pulls).toHaveLength(10);
    const seen = new Set<string>();
    for (const pull of result.pulls) {
      if (seen.has(pull.cardId)) {
        expect(pull.isNew, `${pull.cardId} 同批第二次出现应为重复`).toBe(false);
      } else {
        expect(pull.isNew, `${pull.cardId} 首次出现应为 NEW`).toBe(true);
      }
      seen.add(pull.cardId);
    }
    // tiny 池每档唯一一条均为法则卡：同批重复必结算 20 碎片/张
    const duplicates = result.pulls.filter((pull) => !pull.isNew).length;
    expect(result.shardsGained).toBe(duplicates * FORMAL_POOL.pity.dupeLawShards);
    expect(result.shardsGained).toBeGreaterThan(0);
  });
});
