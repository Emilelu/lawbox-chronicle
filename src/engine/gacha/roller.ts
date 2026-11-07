/**
 * gacha-engine · roller —— 逐卡独立 roll（纯函数，可独立 vitest）。
 * ---------------------------------------------------------------------------
 * 原版 Lottery.java 的语义问题（本文件逐一根治）：
 *   - B3（Lottery.java:42）：整组十连共用一次 random 判定 4★/3★ 档，
 *     再由 hh 补张数——改为每张卡各自独立 roll 稀有度；
 *   - B2（Lottery.java:47/:53）：4★ 与 3★ 两档对同一个 random 判定且无
 *     else-if 链，random ≤ 0.06 时双档重叠触发——改为一次 next() 走互斥
 *     else-if 链（4★ → 3★ → 2★），概率和恒为 1；
 *   - B7（Lottery.java:60-67）：while 判满补 2★——正式池按稀有度 roll 出
 *     确切张数，无补张循环；
 *   - B4（Lottery.java:43-46）：「每 10 回提升」是全局每第 10 抽的对照档
 *     （怀旧池保留原语义并明示），正式池不沿用，十连末位强制 3★+ 作为
 *     独立规则写进池定义，两条语义不再混淆。
 *
 * roll 流程：每张卡先 roll 稀有度（4★ 6% / 3★ 26% / 2★ 68%，数据外置
 * pools.ts），再在该稀有度的条目内均匀 pick（B3：条目分布与概率解耦）。
 * 三层保底与碎片经济在 pity.ts：applyPity 修正稀有序列 → 定向位从未持有
 * 法则卡 pick → settleBatchCounters 结算计数器。
 * 全程只用注入的 Rng，同种子同结果。
 */

import type { CardDef, GachaConfig, GachaPull, GachaRates, Rarity } from '../../core/types';
import { stableUid, type Rng } from '../../core/rng';
import {
  applyPity,
  EMPTY_PITY_COUNTERS,
  settleBatchCounters,
  type PityConfig,
  type PityCounters,
  type PityTrigger,
} from './pity';

/* ================================ 池定义 ================================== */

/** 稀有度概率（三者之和必须为 1，validateGachaPool 校验） */
export interface RarityRates {
  readonly fourStar: number;
  readonly threeStar: number;
  readonly twoStar: number;
}

/**
 * 条目化卡池：先按稀有度 roll，再在对应条目数组内均匀 pick。
 * 数据外置于 src/data/gacha/pools.ts；引擎只认此形状。
 */
export interface GachaPoolDef {
  readonly id: string;
  readonly name: string;
  /** true = 怀旧对照池：只作概率展品，不产出可用卡 */
  readonly souvenir: boolean;
  readonly rarityRates: RarityRates;
  /** 正式池规则（fusionPlan）：十连第 10 抽强制 3★+ */
  readonly forceLastPullThreeStarOnTen: boolean;
  readonly pity: PityConfig;
  /** 星石定价（BT6：单抽 100 / 十连 900） */
  readonly pricing: { readonly single: number; readonly multi: number };
  readonly entries: Readonly<Record<Rarity, readonly CardDef[]>>;
}

/** 池合法性校验（概率和、条目非空、id 唯一、条目稀有度一致） */
export function validateGachaPool(pool: GachaPoolDef): readonly string[] {
  const issues: string[] = [];
  const { fourStar, threeStar, twoStar } = pool.rarityRates;
  for (const [label, value] of [
    ['fourStar', fourStar],
    ['threeStar', threeStar],
    ['twoStar', twoStar],
  ] as const) {
    if (value < 0 || value > 1) issues.push(`${label} 概率 ${value} 越界`);
  }
  if (Math.abs(fourStar + threeStar + twoStar - 1) > 1e-9) {
    issues.push(`概率和 ${fourStar + threeStar + twoStar} ≠ 1`);
  }
  const seen = new Set<string>();
  for (const rarity of [2, 3, 4] as const) {
    const entries = pool.entries[rarity];
    if (entries.length === 0) issues.push(`${rarity}★ 条目池为空`);
    for (const card of entries) {
      if (card.rarity !== rarity) issues.push(`卡 ${card.id} 稀有度 ${card.rarity} 出现在 ${rarity}★ 池`);
      if (seen.has(card.id)) issues.push(`重复条目：${card.id}`);
      seen.add(card.id);
    }
  }
  return issues;
}

/* ================================ 裸 roll ================================== */

/** 单次稀有度 roll：一次 next() + 互斥 else-if 链（B2 根治点） */
export function rollRare(rates: RarityRates, rng: Rng): Rarity {
  const r = rng.next();
  if (r < rates.fourStar) return 4;
  if (r < rates.fourStar + rates.threeStar) return 3;
  return 2;
}

export interface RollRaritiesArgs {
  readonly totalPullsBefore: number;
  /** Lottery.java:43-46 的对照档（怀旧池/兼容层专用；正式池不传） */
  readonly everyNthBoost?: GachaRates;
  readonly everyNthEvery?: number;
  /** 已持有卡 id 集（isNew 判定用；rollPoolBatch 直调时传入，缺省视为全新） */
  readonly ownedCardIds?: ReadonlySet<string>;
}

export interface RollRaritiesOutcome {
  readonly rarities: readonly Rarity[];
  /** 本批是否命中「全局每第 N 抽」对照档（B4：明示为全局计数而非十连内序号） */
  readonly boostedTenPull: boolean;
}

/** 逐卡独立 roll 稀有度（含正式池十连末位强制 3★+ 规则） */
export function rollRarities(pool: GachaPoolDef, rng: Rng, args: RollRaritiesArgs, times: 1 | 10): RollRaritiesOutcome {
  assertBatchSize(times);
  const ratesFor = (cardIndex: number): RarityRates => {
    const boost = args.everyNthBoost;
    if (boost !== undefined && args.everyNthEvery !== undefined) {
      const nth = args.totalPullsBefore + cardIndex + 1;
      if (nth % args.everyNthEvery === 0) {
        return {
          fourStar: boost.fourStar,
          threeStar: boost.threeStar,
          twoStar: 1 - boost.fourStar - boost.threeStar,
        };
      }
    }
    return pool.rarityRates;
  };

  const rarities: Rarity[] = [];
  let boostedTenPull = false;
  for (let i = 0; i < times; i++) {
    if (args.everyNthBoost !== undefined && args.everyNthEvery !== undefined) {
      if ((args.totalPullsBefore + i + 1) % args.everyNthEvery === 0) boostedTenPull = true;
    }
    const rolled = rollRare(ratesFor(i), rng);
    const isLastOfTen = times === 10 && i === times - 1;
    rarities.push(pool.forceLastPullThreeStarOnTen && isLastOfTen && rolled < 3 ? 3 : rolled);
  }
  return { rarities, boostedTenPull };
}

/** 按稀有度在条目内均匀 pick（B3 根治点；条目池为空显式抛错而非静默 fallback） */
export function pickCardForRarity(pool: GachaPoolDef, rarity: Rarity, rng: Rng): CardDef {
  const entries = pool.entries[rarity];
  if (entries.length === 0) throw new RangeError(`卡池 ${pool.id} 的 ${rarity}★ 条目为空`);
  const card = rng.pick(entries);
  return card;
}

export interface PoolRollOutcome {
  readonly pulls: readonly GachaPull[];
  readonly boostedTenPull: boolean;
  readonly hasFourStar: boolean;
  readonly hasRare: boolean;
}

/** 裸 roll 一批（不含保底修正；保底统一走 performGacha/applyPity） */
export function rollPoolBatch(
  pool: GachaPoolDef,
  rng: Rng,
  args: RollRaritiesArgs,
  times: 1 | 10,
): PoolRollOutcome {
  assertBatchSize(times);
  assertPoolValid(pool);
  const { rarities, boostedTenPull } = rollRarities(pool, rng, args, times);
  const pulls: GachaPull[] = rarities.map((rarity, i) => {
    const card = pickCardForRarity(pool, rarity, rng);
    return {
      uid: stableUid('pull', rng, args.totalPullsBefore + i + 1),
      cardId: card.id,
      rarity,
      isNew: !args.ownedCardIds?.has(card.id),
    };
  });
  return {
    pulls,
    boostedTenPull,
    hasFourStar: pulls.some((p) => p.rarity === 4),
    hasRare: pulls.some((p) => p.rarity >= 3),
  };
}

/* ============================== 完整抽卡流程 =============================== */

export interface PerformGachaArgs {
  readonly pool: GachaPoolDef;
  readonly rng: Rng;
  readonly counters: PityCounters;
  readonly ownedCardIds: ReadonlySet<string>;
  readonly times: 1 | 10;
  /** Lottery 对照档（怀旧/兼容链路；正式池不传） */
  readonly everyNthBoost?: GachaRates;
  readonly everyNthEvery?: number;
}

export interface PerformGachaResult {
  readonly pulls: readonly GachaPull[];
  readonly boostedTenPull: boolean;
  /** 层1/层2 触发记录（层3 以 directedCardIndex 表达） */
  readonly triggers: readonly PityTrigger[];
  /** 层3 定向命中的批内下标；null=本批未定向 */
  readonly directedCardIndex: number | null;
  /** 三层独立计数器批后值（直接持久化） */
  readonly countersAfter: PityCounters;
  readonly shardsGained: number;
}

/**
 * 完整抽卡：裸 roll → 层1/层2 稀有度修正 → 逐卡 pick（定向位从未持有
 * 法则卡中 pick）→ 层3/碎片计数器结算。纯函数：状态经 counters 进出。
 *
 * 定向 pick 收敛：只从「未持有 ∧ 卡面稀有度 === 本抽档位」的法则卡中
 * 均匀 pick，保证 GachaPull.rarity 与卡面稀有度一致；同档候选为空则本批
 * 不定向（计数器继续累积，不吞层2 的 4★ 保底档位）。
 */
export function performGacha(args: PerformGachaArgs): PerformGachaResult {
  const { pool, rng, counters, ownedCardIds, times } = args;
  assertBatchSize(times);
  assertPoolValid(pool);

  const rolled = rollRarities(pool, rng, { totalPullsBefore: counters.totalPulls, everyNthBoost: args.everyNthBoost, everyNthEvery: args.everyNthEvery }, times);
  const pityApplied = applyPity({
    rarities: rolled.rarities,
    times,
    counters,
    config: pool.pity,
    rng,
  });

  const cardLookup = buildCardLookup(pool);
  // 同批去重：本批已抽到的卡也计入「已持有」——同一十连重复出同一张卡时，
  // 第二张应显示重复并结算碎片，而不是两张都标 NEW（B 修复）
  const ownedInBatch = new Set<string>(ownedCardIds);
  const pullPairs = pityApplied.rarities.map((slotRarity, i) => {
    let card: CardDef;
    let directedHit = false;
    if (i === pityApplied.directedIndex) {
      // 层3 定向：只从「未持有 ∧ 卡面稀有度 === 本抽档位」的法则卡中均匀 pick
      const candidates = [...pool.entries[4], ...pool.entries[3], ...pool.entries[2]].filter(
        (c) => c.kind === 'law' && c.rarity === slotRarity && !ownedInBatch.has(c.id),
      );
      if (candidates.length > 0) {
        card = rng.pick(candidates);
        directedHit = true;
      } else {
        card = pickCardForRarity(pool, slotRarity, rng);
      }
    } else {
      card = pickCardForRarity(pool, slotRarity, rng);
    }
    const isNew = !ownedInBatch.has(card.id);
    ownedInBatch.add(card.id);
    const pull: GachaPull = {
      uid: stableUid('pull', rng, counters.totalPulls + i + 1),
      cardId: card.id,
      rarity: slotRarity,
      isNew,
    };
    return { pull, directedHit };
  });
  const pulls: readonly GachaPull[] = pullPairs.map((p) => p.pull);

  const settled = settleBatchCounters({
    counters,
    times,
    pulls,
    config: pool.pity,
    cardLookup,
  });

  const directedIndex =
    pityApplied.directedIndex !== null && pullPairs[pityApplied.directedIndex]?.directedHit === true
      ? pityApplied.directedIndex
      : null;

  return {
    pulls,
    boostedTenPull: rolled.boostedTenPull,
    triggers: pityApplied.triggers,
    directedCardIndex: directedIndex,
    countersAfter: settled.counters,
    shardsGained: settled.shardsGained,
  };
}

function buildCardLookup(pool: GachaPoolDef): ReadonlyMap<string, CardDef> {
  const map = new Map<string, CardDef>();
  for (const rarity of [2, 3, 4] as const) {
    for (const card of pool.entries[rarity]) map.set(card.id, card);
  }
  return map;
}

/* ============================ 骨架兼容层 ================================== */

/**
 * 骨架 gameStore.rollGacha（src/core/store/gameStore.ts:449）的旧签名适配：
 * 平铺 CardDef[] + GachaConfig → 条目池 + PityConfig，内部走 performGacha。
 * 差异说明：旧 GachaConfig 的 bonusThreeStarOnPity（层3 额外升 3★）已被
 * 新规格的「法则定向保底」取代，本层不复刻；法则定向在本层禁用（lawDirected:
 * null），集成期切换 FORMAL_POOL + performGacha 后启用。
 */
export interface RollBatchArgs {
  readonly config: GachaConfig;
  readonly rng: Rng;
  readonly totalPullsBefore: number;
  readonly pullsSinceFourStar: number;
  readonly ownedCardIds: ReadonlySet<string>;
  readonly pool: readonly CardDef[];
}

export interface RollBatchOutcome {
  readonly pulls: readonly GachaPull[];
  readonly boostedTenPull: boolean;
  readonly pityTriggered: 'none' | 'per-ten' | 'hard-four-star';
  readonly pullsSinceFourStarAfter: number;
  readonly shardsGained: number;
}

export function rollBatch(args: RollBatchArgs, times: 1 | 10): RollBatchOutcome {
  assertBatchSize(times);
  const byRarity: Record<Rarity, CardDef[]> = { 2: [], 3: [], 4: [] };
  for (const card of args.pool) byRarity[card.rarity].push(card);
  const { fourStar, threeStar } = args.config.baseRates;
  const pool: GachaPoolDef = {
    id: `legacy-${args.config.id}`,
    name: args.config.id,
    souvenir: false,
    rarityRates: { fourStar, threeStar, twoStar: 1 - fourStar - threeStar },
    forceLastPullThreeStarOnTen: false,
    pity: {
      perTenPullThreeStar: args.config.pity.perTenPullThreeStar,
      hardFourStar: args.config.pity.hardFourStar,
      lawDirected: null,
      dupeLawShards: 0,
      redeemCost: 0,
    },
    pricing: { single: args.config.costPerPull, multi: args.config.costPerPull * times },
    entries: byRarity,
  };
  const result = performGacha({
    pool,
    rng: args.rng,
    counters: {
      ...EMPTY_PITY_COUNTERS,
      pullsSinceFourStar: args.pullsSinceFourStar,
      totalPulls: args.totalPullsBefore,
    },
    ownedCardIds: args.ownedCardIds,
    times,
    everyNthBoost: args.config.everyNthBoost.rates,
    everyNthEvery: args.config.everyNthBoost.every,
  });
  return {
    pulls: result.pulls,
    boostedTenPull: result.boostedTenPull,
    pityTriggered: result.triggers.includes('hard-four-star')
      ? 'hard-four-star'
      : result.triggers.includes('per-ten')
        ? 'per-ten'
        : 'none',
    pullsSinceFourStarAfter: result.countersAfter.pullsSinceFourStar,
    shardsGained: result.shardsGained,
  };
}

/* ============================ 怀旧池对照模拟 =============================== */

/**
 * 怀旧模拟池参数（BandoriLotteryEmulator Lottery.java:40-46 原值，对照展品）：
 *   :40-41 基础 four=0.06 / three=0.2605
 *   :43-46 timed%10==0 时 four=0.3 / three=0.5
 * 历史行为在 simulateNostalgiaRound 中原样复刻（含 B2/B3/B7），只用于
 * 图鉴页概率对照曲线，不产出可用卡。
 */
export interface NostalgiaParams {
  readonly fourStar: number;
  readonly threeStar: number;
  readonly boostEvery: number;
  readonly boostFourStar: number;
  readonly boostThreeStar: number;
}

export interface NostalgiaRates {
  readonly fourStar: number;
  readonly threeStar: number;
  readonly boosted: boolean;
}

/** 第 roundIndex 回（0 起）命中的概率档；Lottery 的 timed 从 1 起（:31） */
export function nostalgiaRatesForRound(params: NostalgiaParams, roundIndex: number): NostalgiaRates {
  const boosted = (roundIndex + 1) % params.boostEvery === 0;
  return boosted
    ? { fourStar: params.boostFourStar, threeStar: params.boostThreeStar, boosted }
    : { fourStar: params.fourStar, threeStar: params.threeStar, boosted: false };
}

export type NostalgiaStar = 'four' | 'three' | 'two';

/**
 * 复刻 Lottery.java 一回（十张）的产出，仅供概率对照：
 *  - :42 单次 random 决定整回 4★/3★ 档（B3 历史行为）；
 *  - :47/:53 两档对同一 random 判定且无 else-if，random≤0.06 双档重叠（B2）；
 *    原版的 contains 去重条件在本回初恒为假（storedStars 已 clear），行为等价省略；
 *  - :60-67 while 判满补 2★（B7，此处用有界 while(<10) 等价复刻）；
 *  - :69-72 十连无 3★+ → 随机一张升 3★。
 */
export function simulateNostalgiaRound(params: NostalgiaParams, rng: Rng, roundIndex: number): readonly NostalgiaStar[] {
  const rates = nostalgiaRatesForRound(params, roundIndex);
  const stars: NostalgiaStar[] = [];
  const random = rng.next();
  if (random <= rates.fourStar) {
    const count = rng.int(1, 2);
    for (let k = 0; k < count; k++) stars.push('four');
  }
  if (random <= rates.threeStar) {
    const count = rng.int(1, 3);
    for (let k = 0; k < count; k++) stars.push('three');
  }
  while (stars.length < 10) stars.push('two');
  if (!stars.includes('three') && !stars.includes('four')) {
    const toChange = rng.int(0, stars.length - 1);
    stars[toChange] = 'three';
  }
  return stars;
}

/* ================================ 内部断言 ================================= */

function assertBatchSize(times: 1 | 10): void {
  if (times !== 1 && times !== 10) throw new RangeError(`批次只允许单抽(1)或十连(10)，收到 ${times}`);
}

function assertPoolValid(pool: GachaPoolDef): void {
  const issues = validateGachaPool(pool);
  if (issues.length > 0) throw new Error(`卡池 ${pool.id} 非法：${issues.join('；')}`);
}
