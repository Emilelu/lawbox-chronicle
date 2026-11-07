/**
 * 抽卡池配置 —— 概率与定价的唯一数据源（概率外置）。
 * ---------------------------------------------------------------------------
 * 正式池「法则箱庭池」：逐卡独立 roll，稀有度 4★ 6% / 3★ 26% / 2★ 68%，
 * 条目按稀有度分池均匀 pick；三层保底（50 抽硬保底 / 十连 3★ 转 / 法则
 * 定向 40 抽）与碎片兜底（重复法则卡 20 碎片、60 碎片直购）参数全部在此
 * 声明，引擎（roller/pity）只认形状不认数值。
 *
 * 怀旧模拟池：BandoriLotteryEmulator Lottery.java:40-46 原参数原样保留
 * （0.06 / 0.2605 / 每第 10 回 0.3 / 0.5），作概率对照展品，不产出可用卡；
 * 原版行为复刻见 engine/gacha/roller.ts 的 simulateNostalgiaRound。
 *
 * 星石经济（BT6）：星石由战斗/解谜/剧情产出，单抽 100、十连 900。
 */

import type { GachaConfig } from '../../core/types';
import type { GachaPoolDef, NostalgiaParams } from '../../engine/gacha/roller';
import { validateGachaPool } from '../../engine/gacha/roller';
import {
  LAW_CARDS,
  LAW_CARD_CHEST_DETONATE,
  LAW_CARD_EXPLODE_PLUS_1,
  LAW_CARD_KNOCKBACK_PLUS_2,
  LAW_CARD_MIRROR_PULL,
  LAW_CARD_PHASE_WALK,
  LAW_CARD_PLANE_EYE,
} from '../cards/lawCards';
import { CHARACTER_CARDS } from '../cards/characterCards';

/* ============================== 全量卡表聚合 =============================== */

/** 卡表聚合出口（供 data/index.ts 装配 WorldTables.cards，替代骨架 gacha.ts 的 CARDS） */
export const ALL_GACHA_CARDS: readonly ((typeof LAW_CARDS)[number] | (typeof CHARACTER_CARDS)[number])[] = [
  ...LAW_CARDS,
  ...CHARACTER_CARDS,
];

/* ============================== 正式池：法则箱庭池 ========================= */

/**
 * 正式池条目（与 lawRegistry 的注册补丁对齐）：
 *   4★ 池 10 条 = 法则卡 8（轻步/重力井/位面通行/再临/镜像拉箱/相位穿行/
 *                 箱落引爆/位面之眼）+ 角色卡 2（影流之主/作者）
 *   3★ 池 12 条 = 法则卡 7（长臂/狂化/铁壁/斜向推挤/箱可推离/击退+2/爆炸+1）
 *                 + 角色卡 5（四天使/冬泳怪鸽）
 *   2★ 池 6 条 = 法则卡 2（羽箱/铅箱）+ 角色卡 2（蔡徐坤/郭老师）+ 通用 buff 2
 * 设计规格「3★ 池 10 条」已按 core/lawRegistry 扩注册后的 17 张法则卡全量
 * 发行（一补丁一卡）扩容：原规格写于谜题补丁仅 5 个的时期，扩容后概率档
 * （6%/26%/68%）与保底参数不变。
 *
 * 新增 6 张卡的获取点（抽卡之外的兜底，防关键法则软锁，BT6 同源）：
 *   镜像拉箱 → level-lb-06 通关奖励；相位穿行 → level-lb-08；
 *   箱落引爆 → level-lb-10；位面之眼 → level-lb-09；
 *   击退+2 → level-lb-11；爆炸+1 → level-lb-12（均见 levels/areas.ts）。
 */
export const FORMAL_POOL: GachaPoolDef = {
  id: 'formal-lawbox',
  name: '法则箱庭池',
  souvenir: false,
  rarityRates: { fourStar: 0.06, threeStar: 0.26, twoStar: 0.68 },
  // fusionPlan 正式池规则：十连第 10 抽强制 3★+
  forceLastPullThreeStarOnTen: true,
  pity: {
    perTenPullThreeStar: true, // 层1：十连无 3★+ → 转 1 张 3★（Lottery.java:69-72 语义）
    hardFourStar: 50, // 层2：累计 50 抽无 4★ → 本批必出 4★
    lawDirected: 40, // 层3：累计 40 抽未获未持有法则卡 → 下一张稀有卡定向
    dupeLawShards: 20, // 兜底：重复法则卡 → +20 碎片
    redeemCost: 60, // 兜底：60 碎片直购任一未持有法则卡
  },
  pricing: { single: 100, multi: 900 }, // BT6：单抽 100 / 十连 900
  entries: {
    4: [
      LAW_CARDS[0]!, // 法则·轻步
      LAW_CARDS[1]!, // 法则·重力井
      LAW_CARDS[2]!, // 法则·位面通行
      LAW_CARDS[3]!, // 法则·再临
      LAW_CARD_MIRROR_PULL, // 法则·镜像拉箱（集成期补完）
      LAW_CARD_PHASE_WALK, // 法则·相位穿行（集成期补完）
      LAW_CARD_CHEST_DETONATE, // 法则·箱落引爆（集成期补完）
      LAW_CARD_PLANE_EYE, // 法则·位面之眼（集成期补完）
      CHARACTER_CARDS[0]!, // 影流之主
      CHARACTER_CARDS[1]!, // 作者
    ],
    3: [
      LAW_CARDS[4]!, // 法则·长臂
      LAW_CARDS[5]!, // 法则·狂化
      LAW_CARDS[6]!, // 法则·铁壁
      LAW_CARDS[9]!, // 法则·斜向推挤（集成期补完）
      LAW_CARDS[10]!, // 法则·箱可推离（集成期补完）
      LAW_CARD_KNOCKBACK_PLUS_2, // 法则·击退+2（集成期补完）
      LAW_CARD_EXPLODE_PLUS_1, // 法则·爆炸+1（集成期补完）
      CHARACTER_CARDS[2]!, // 导航天使①
      CHARACTER_CARDS[3]!, // 导航天使②
      CHARACTER_CARDS[4]!, // 导航天使③
      CHARACTER_CARDS[5]!, // 导航天使④
      CHARACTER_CARDS[6]!, // 冬泳怪鸽
    ],
    2: [
      LAW_CARDS[7]!, // 法则·羽箱
      LAW_CARDS[8]!, // 法则·铅箱
      CHARACTER_CARDS[7]!, // 蔡徐坤
      CHARACTER_CARDS[8]!, // 郭老师
      CHARACTER_CARDS[9]!, // 星屑徽章（通用 buff）
      CHARACTER_CARDS[10]!, // 星光护符（通用 buff）
    ],
  },
};

/* ============================ 怀旧模拟池（对照展品） ======================== */

/** Lottery.java:40-46 原值，原样保留作对照，一个数字都不改 */
export const NOSTALGIA_PARAMS: NostalgiaParams = {
  fourStar: 0.06, // Lottery.java:40
  threeStar: 0.2605, // Lottery.java:41
  boostEvery: 10, // Lottery.java:43 timed%10==0
  boostFourStar: 0.3, // Lottery.java:44
  boostThreeStar: 0.5, // Lottery.java:45
};

/**
 * 怀旧模拟池 id —— 单一真相源（R5）。
 * 统计写入/查询（statsCollector.recordPulls / poolCurve / cumulativeFourStarCurve）
 * 与展示（NOSTALGIA_POOL_INFO.id）共用此常量，任何按 id 查曲线的代码都不会拿到空数据。
 */
export const POOL_NOSTALGIA = 'nostalgia-lottery';

export const NOSTALGIA_POOL_INFO = {
  id: POOL_NOSTALGIA,
  name: '怀旧模拟池',
  souvenir: true,
  source: 'BandoriLotteryEmulator Lottery.java:40-46',
  note: '原版概率与行为对照展品：单 roll 十连、双档重叠、每第 10 回提升均原样复刻，不产出可用卡；出货实测曲线见图鉴页。',
} as const;

/* ======================== core GachaConfig 形状适配 ======================== */

/**
 * 正式池的 core GachaConfig 形状（供 WorldTables.gachaConfig 与
 * selectCanAfford 等骨架消费点；数值与 FORMAL_POOL 严格同源对齐）：
 *  - everyNthBoost 在正式池不启用，占位 rates 全零以满足 schema 的 every>=2；
 *  - bonusThreeStarOnPity 由层3「法则定向保底」取代，恒 false。
 */
export const FORMAL_GACHA_CONFIG: GachaConfig = {
  id: 'star-wish-altar',
  name: '星愿祭坛·法则箱庭池',
  baseRates: { fourStar: FORMAL_POOL.rarityRates.fourStar, threeStar: FORMAL_POOL.rarityRates.threeStar },
  everyNthBoost: { every: 10, rates: { fourStar: 0, threeStar: 0 } },
  pity: {
    perTenPullThreeStar: FORMAL_POOL.pity.perTenPullThreeStar,
    hardFourStar: FORMAL_POOL.pity.hardFourStar,
    bonusThreeStarOnPity: false,
  },
  costPerPull: FORMAL_POOL.pricing.single,
};

/** 星石定价查询（B8：非法批次显式抛错） */
export function gachaCost(times: 1 | 10): number {
  if (times === 1) return FORMAL_POOL.pricing.single;
  if (times === 10) return FORMAL_POOL.pricing.multi;
  throw new RangeError(`抽卡批次只允许 1 或 10，收到 ${times as number}`);
}

/* ============================== 概率页明示（B4） =========================== */

/** 图鉴/抽卡页的「概率公布」文案：把保底进度与对照档语义向玩家明示 */
export const RATE_DISCLOSURE = {
  formal: {
    poolName: FORMAL_POOL.name,
    lines: [
      '4★：6%　3★：26%　2★：68%（每张卡独立判定）',
      '保底一：十连第 10 抽必为 3★ 或以上；若整十连无 3★+，随机 1 张升为 3★',
      '保底二：累计 50 抽未出 4★，下一批必出 4★（抽卡页进度条实时可视）',
      '保底三：累计 40 抽未获得未持有的法则卡，下一张稀有卡必为未持有的法则卡',
      '碎片兜底：重复法则卡每张转 20 碎片；60 碎片可在祭坛商店直购任一未持有法则卡',
      '定价：单抽 100 星石，十连 900 星石（9 折）',
    ],
  },
  nostalgia: {
    poolName: NOSTALGIA_POOL_INFO.name,
    lines: [
      '原版参数对照：4★ 6% / 3★ 26.05%，每第 10 回提升为 4★ 30% / 3★ 50%',
      '历史行为原样复刻（整组单 roll、双档重叠、每第 10 回全局计数），仅供概率对照',
      '怀旧池不产出可用卡，出货数据进入图鉴页实测曲线',
    ],
  },
} as const;

/* ================================ 池自检 ================================== */

/** 池数据发行前自检（测试与启动断言消费）：结构合法 + 原版参数保真 */
export function auditPools(): readonly string[] {
  const issues: string[] = [...validateGachaPool(FORMAL_POOL)];
  if (NOSTALGIA_PARAMS.boostEvery < 1) issues.push('怀旧池 boostEvery 必须 ≥ 1');
  // Lottery.java:40-46 原值保真（对照展品的生命线）
  if (NOSTALGIA_PARAMS.fourStar !== 0.06) issues.push('怀旧池 4★ 基础概率偏离原值 0.06');
  if (NOSTALGIA_PARAMS.threeStar !== 0.2605) issues.push('怀旧池 3★ 基础概率偏离原值 0.2605');
  if (NOSTALGIA_PARAMS.boostFourStar !== 0.3) issues.push('怀旧池每 10 回 4★ 档偏离原值 0.3');
  if (NOSTALGIA_PARAMS.boostThreeStar !== 0.5) issues.push('怀旧池每 10 回 3★ 档偏离原值 0.5');
  if (FORMAL_POOL.pricing.single !== 100 || FORMAL_POOL.pricing.multi !== 900) {
    issues.push('定价偏离规格（单抽 100 / 十连 900）');
  }
  return issues;
}
