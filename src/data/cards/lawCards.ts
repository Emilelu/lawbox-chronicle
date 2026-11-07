/**
 * 法则卡表 —— 数据层唯一法则卡源。
 * ---------------------------------------------------------------------------
 * 硬约束（模块规格）：patch 字段必须是 core/lawRegistry.ts 已注册的合法补丁 id，
 * 集成期由 core/schema.ts validateWorld 的 cards 表校验拦截悬空引用
 * （schema.ts:284-288）。因此本表与 LAW_PATCH_IDS 一一对应：一个补丁恰好一张
 * 法则卡，不重复、不悬空，稀有度跟随 LAW_PATCHES[patch].rarity。
 *
 * 发行状态（集成期补完）：原 REQUESTED_LAW_PATCH_IDS 清单中的 8 个请求补丁
 * 已全部在 core/lawRegistry 注册并发卡 —— diagonal-push / chest-off-goal /
 * mirror-pull / phase-walk / chest-detonate / plane-eye / knockback-plus-2 /
 * explode-plus-1（每张卡的获取点见 pools.ts 注释与 levels/areas.ts 的
 * reward.lawCardId），清单已清空归档。
 */

import type { CardDef } from '../../core/types';
import { LAW_PATCHES, type LawPatchId } from '../../core/lawRegistry';

/** 法则卡：CardDef 的 law 特化，lawPatchId 在类型层就限定为注册表合法 id */
export type LawCardDef = CardDef & {
  readonly kind: 'law';
  readonly lawPatchId: LawPatchId;
};

/**
 * 请求 core/lawRegistry 扩注册的补丁 id（含期望语义，供对齐评审）。
 * 已全部发行并注册（见文件头说明），清单保留为空数组：
 * 后续如再发现「引擎有能力但无卡」的缺口，把 { id, intent } 追加到这里。
 */
export const REQUESTED_LAW_PATCH_IDS: readonly { readonly id: string; readonly intent: string }[] = [];

/* ================================ 4★ 法则卡 =============================== */

export const LAW_CARD_LIGHT_STEP: LawCardDef = {
  id: 'card-law-light-step',
  kind: 'law',
  name: '法则·轻步',
  rarity: 4,
  description: '步数消耗 ×0.5。步履不停，星辰退让。',
  lawPatchId: 'light-step',
};

export const LAW_CARD_GRAVITY_WELL: LawCardDef = {
  id: 'card-law-gravity-well',
  kind: 'law',
  name: '法则·重力井',
  rarity: 4,
  description: '允许把敌人推挤出界。坠落，也是一种审判。',
  lawPatchId: 'gravity-well',
};

export const LAW_CARD_PLANE_SHIFT: LawCardDef = {
  id: 'card-law-plane-shift',
  kind: 'law',
  name: '法则·位面通行',
  rarity: 4,
  description: '解锁 F 位面切换。世界的里侧向你敞开。',
  lawPatchId: 'plane-shift',
};

export const LAW_CARD_SECOND_CHANCE: LawCardDef = {
  id: 'card-law-second-chance',
  kind: 'law',
  name: '法则·再临',
  rarity: 4,
  description: '战败免死一次。故事拒绝在此画上句号。',
  lawPatchId: 'second-chance',
};

/* ================================ 3★ 法则卡 =============================== */

export const LAW_CARD_WIDER_PUSH: LawCardDef = {
  id: 'card-law-wider-push',
  kind: 'law',
  name: '法则·长臂',
  rarity: 3,
  description: '推挤距离 +1。指尖所及，即是法则边界。',
  lawPatchId: 'wider-push',
};

export const LAW_CARD_BERSERK: LawCardDef = {
  id: 'card-law-berserk',
  kind: 'law',
  name: '法则·狂化',
  rarity: 3,
  description: '玩家攻击 ×1.5。代价是舞蹈。',
  lawPatchId: 'berserk',
};

export const LAW_CARD_IRON_WILL: LawCardDef = {
  id: 'card-law-iron-will',
  kind: 'law',
  name: '法则·铁壁',
  rarity: 3,
  description: '敌方攻击 ×0.75。不动如山。',
  lawPatchId: 'iron-will',
};

/* ---- 集成期补完（原 REQUESTED_LAW_PATCH_IDS 缺口；core/lawRegistry 已扩注册
   diagonal-push / chest-off-goal / mirror-pull / phase-walk / chest-detonate /
   plane-eye / knockback-plus-2 / explode-plus-1 补丁，谜题引擎 move.ts 消费） ---- */

export const LAW_CARD_DIAGONAL_PUSH: LawCardDef = {
  id: 'card-law-diagonal-push',
  kind: 'law',
  name: '法则·斜向推挤',
  rarity: 3,
  description: '解锁对角线推箱，斜角也逃不出掌心。',
  lawPatchId: 'diagonal-push',
};

export const LAW_CARD_CHEST_OFF_GOAL: LawCardDef = {
  id: 'card-law-chest-off-goal',
  kind: 'law',
  name: '法则·箱可推离',
  rarity: 3,
  description: '就位的箱子也能被推下基座落差（平推离旗始终可行）。',
  lawPatchId: 'chest-off-goal',
};

export const LAW_CARD_MIRROR_PULL: LawCardDef = {
  id: 'card-law-mirror-pull',
  kind: 'law',
  name: '法则·镜像拉箱',
  rarity: 4,
  description: '解锁 Shift+方向 拉箱：箱子如镜像随行，退后即拉近。',
  lawPatchId: 'mirror-pull',
};

export const LAW_CARD_PHASE_WALK: LawCardDef = {
  id: 'card-law-phase-walk',
  kind: 'law',
  name: '法则·相位穿行',
  rarity: 4,
  description: '解锁 C 键穿行：消耗 1 充能，沿原方向穿过一格障碍。',
  lawPatchId: 'phase-walk',
};

export const LAW_CARD_CHEST_DETONATE: LawCardDef = {
  id: 'card-law-chest-detonate',
  kind: 'law',
  name: '法则·箱落引爆',
  rarity: 4,
  description: '箱落时可引爆一次，清除落点四邻的可破坏实体。',
  lawPatchId: 'chest-detonate',
};

export const LAW_CARD_PLANE_EYE: LawCardDef = {
  id: 'card-law-plane-eye',
  kind: 'law',
  name: '法则·位面之眼',
  rarity: 4,
  description: '阴阳两面尽收眼底：任意位置皆可按 F 切换位面。',
  lawPatchId: 'plane-eye',
};

export const LAW_CARD_KNOCKBACK_PLUS_2: LawCardDef = {
  id: 'card-law-knockback-plus-2',
  kind: 'law',
  name: '法则·击退+2',
  rarity: 3,
  description: '布阵推挤的击退格数 +2，怪物方块飞得更远。',
  lawPatchId: 'knockback-plus-2',
};

export const LAW_CARD_EXPLODE_PLUS_1: LawCardDef = {
  id: 'card-law-explode-plus-1',
  kind: 'law',
  name: '法则·爆炸+1',
  rarity: 3,
  description: '箱落引爆次数 +1，连环爆破撕裂战场。',
  lawPatchId: 'explode-plus-1',
};

/* ================================ 2★ 法则卡 =============================== */

export const LAW_CARD_FEATHER_CHEST: LawCardDef = {
  id: 'card-law-feather-chest',
  kind: 'law',
  name: '法则·羽箱',
  rarity: 2,
  description: '箱子质量 -1。轻若鸿毛，一推即走。',
  lawPatchId: 'feather-chest',
};

export const LAW_CARD_LEAD_CHEST: LawCardDef = {
  id: 'card-law-lead-chest',
  kind: 'law',
  name: '法则·铅箱',
  rarity: 2,
  description: '箱子质量 +1。沉如铅封，推挤更痛。',
  lawPatchId: 'lead-chest',
};

/** 全部法则卡（顺序：4★ → 3★ → 2★；与 LAW_PATCHES 注册顺序对齐。
 *  注意：pools.ts 的既有条目按下标取前 11 张，新增卡只允许追加在尾部） */
export const LAW_CARDS: readonly LawCardDef[] = [
  LAW_CARD_LIGHT_STEP,
  LAW_CARD_GRAVITY_WELL,
  LAW_CARD_PLANE_SHIFT,
  LAW_CARD_SECOND_CHANCE,
  LAW_CARD_WIDER_PUSH,
  LAW_CARD_BERSERK,
  LAW_CARD_IRON_WILL,
  LAW_CARD_FEATHER_CHEST,
  LAW_CARD_LEAD_CHEST,
  LAW_CARD_DIAGONAL_PUSH,
  LAW_CARD_CHEST_OFF_GOAL,
  LAW_CARD_MIRROR_PULL,
  LAW_CARD_PHASE_WALK,
  LAW_CARD_CHEST_DETONATE,
  LAW_CARD_PLANE_EYE,
  LAW_CARD_KNOCKBACK_PLUS_2,
  LAW_CARD_EXPLODE_PLUS_1,
];

export function findLawCard(cardId: string): LawCardDef | undefined {
  return LAW_CARDS.find((c) => c.id === cardId);
}

/**
 * 发行前自检（纯函数）：每张法则卡的 lawPatchId 都已注册、
 * 稀有度与注册表一致、无重复 id。集成期 validateWorld 只查 id 存在性，
 * 这里补上「一补丁一卡」与「稀有度一致」两条更强的约束。
 */
export function auditLawCards(): readonly string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const card of LAW_CARDS) {
    if (seen.has(card.id)) issues.push(`重复 id：${card.id}`);
    seen.add(card.id);
    const patch = LAW_PATCHES[card.lawPatchId];
    if (patch === undefined) {
      issues.push(`补丁 ${card.lawPatchId} 未在 lawRegistry 注册`);
      continue;
    }
    if (patch.rarity !== card.rarity) {
      issues.push(`${card.id} 稀有度 ${card.rarity} 与注册表 ${patch.rarity} 不一致`);
    }
  }
  for (const patchId of Object.keys(LAW_PATCHES)) {
    if (!seen.has(`card-law-${patchId}`)) {
      issues.push(`注册表补丁 ${patchId} 缺少对应法则卡`);
    }
  }
  return issues;
}
