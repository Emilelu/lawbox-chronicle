/**
 * 角色卡表 —— 天使/怪物/BOSS/作者卡化后的数据层唯一角色卡源。
 * ---------------------------------------------------------------------------
 * BuffId 与数值范围归 core/lawRegistry.ts 所有（BUFF_IDS / BUFF_RANGES，
 * core/lawRegistry.ts:177-187），本表只声明 id + 数值，集成期由
 * core/schema.ts CardDefSchema 校验数值越界。
 * 卡化原型出处（KichikuAdventure/src/me/emilelu/KichikuAdventure/Game.java）：
 *   - 四天使：Game.java:48-51（导航天使①②③④，坐标 ±1 十字）
 *   - 作者：Game.java:52（"作者"，坐标 -2,4）
 *   - 三小怪：Game.java:55-57（蔡徐坤/郭老师/冬泳怪鸽）
 *   - BOSS：Game.java:58（影流之主，攻击 233666438 为原作彩蛋）
 * 卡面 buff 数值不照抄原作战斗数值（233666438 远超 Buff 注册范围，
 * 彩蛋原值保留在 enemies.ts 与卡面描述中），一律落在 BUFF_RANGES 内。
 *
 * 对话分支标记 dialogueTag：story-weaver 据此解锁对话分支（如携带
 * 导航天使卡时重遇天使事件走旧识分支）；通用 buff 卡无对话人格，不标记。
 */

import type { CardDef } from '../../core/types';
import { BUFF_RANGES, type BuffId } from '../../core/lawRegistry';

/** 角色卡：CardDef 的 character 特化，buffId 类型层限定 + 可选对话分支标记 */
export type CharacterCardDef = CardDef & {
  readonly kind: 'character';
  readonly buff: { readonly buffId: BuffId; readonly value: number };
  /** 对话分支标记（通用 buff 卡不带） */
  readonly dialogueTag?: CharacterDialogueTag;
};

export const CHARACTER_DIALOGUE_TAGS = [
  'angel-1',
  'angel-2',
  'angel-3',
  'angel-4',
  'author',
  'caixukun',
  'guolaoshi',
  'dygg',
  'ylzz',
] as const;

export type CharacterDialogueTag = (typeof CHARACTER_DIALOGUE_TAGS)[number];

/* ================================ 4★ 角色卡 =============================== */

export const CHARACTER_CARD_YLZZ: CharacterCardDef = {
  id: 'card-chr-ylzz',
  kind: 'character',
  name: '影流之主',
  rarity: 4,
  description: '“影流……之主！”——原作攻击彩蛋 233666438 的持有者，卡化为攻击大幅提升。',
  buff: { buffId: 'attackUp', value: 120 },
  dialogueTag: 'ylzz',
};

export const CHARACTER_CARD_AUTHOR: CharacterCardDef = {
  id: 'card-chr-author',
  kind: 'character',
  name: '作者',
  rarity: 4,
  description: '“假如你没有遇到我，你是永远都无法通关的！”——攻击大幅提升。',
  buff: { buffId: 'attackUp', value: 50 },
  dialogueTag: 'author',
};

/* ================================ 3★ 角色卡 =============================== */

export const CHARACTER_CARD_ANGEL_1: CharacterCardDef = {
  id: 'card-chr-angel-1',
  kind: 'character',
  name: '导航天使①',
  rarity: 3,
  description: '“这个游戏地图的范围是 x,y=±5”——生命上限提升。',
  buff: { buffId: 'hpUp', value: 60 },
  dialogueTag: 'angel-1',
};

export const CHARACTER_CARD_ANGEL_2: CharacterCardDef = {
  id: 'card-chr-angel-2',
  kind: 'character',
  name: '导航天使②',
  rarity: 3,
  description: '“一步登天的后果只有死路一条”——攻击提升。',
  buff: { buffId: 'attackUp', value: 15 },
  dialogueTag: 'angel-2',
};

export const CHARACTER_CARD_ANGEL_3: CharacterCardDef = {
  id: 'card-chr-angel-3',
  kind: 'character',
  name: '导航天使③',
  rarity: 3,
  description: '“请好好探索每一个坐标”——防御提升。',
  buff: { buffId: 'defenseUp', value: 10 },
  dialogueTag: 'angel-3',
};

export const CHARACTER_CARD_ANGEL_4: CharacterCardDef = {
  id: 'card-chr-angel-4',
  kind: 'character',
  name: '导航天使④',
  rarity: 3,
  description: '“我们永远在这里等着你，后会有期！”——每回合回复 HP。',
  buff: { buffId: 'regenerate', value: 5 },
  dialogueTag: 'angel-4',
};

export const CHARACTER_CARD_DYGG: CharacterCardDef = {
  id: 'card-chr-dygg',
  kind: 'character',
  name: '冬泳怪鸽',
  rarity: 3,
  description: '“奥利给！”——生命上限提升。',
  buff: { buffId: 'hpUp', value: 80 },
  dialogueTag: 'dygg',
};

/* ================================ 2★ 角色卡 =============================== */

export const CHARACTER_CARD_CAIXUKUN: CharacterCardDef = {
  id: 'card-chr-caixukun',
  kind: 'character',
  name: '蔡徐坤',
  rarity: 2,
  description: '唱、跳、rap、篮球。攻击小幅提升。',
  buff: { buffId: 'attackUp', value: 12 },
  dialogueTag: 'caixukun',
};

export const CHARACTER_CARD_GUOLAOSHI: CharacterCardDef = {
  id: 'card-chr-guolaoshi',
  kind: 'character',
  name: '郭老师',
  rarity: 2,
  description: '耶斯莫拉！防御小幅提升。',
  buff: { buffId: 'defenseUp', value: 8 },
  dialogueTag: 'guolaoshi',
};

/* ------------------------ 2★ 通用 buff 卡（无对话人格） ------------------------ */

export const CHARACTER_CARD_STARDUST_MEDAL: CharacterCardDef = {
  id: 'card-buff-stardust-medal',
  kind: 'character',
  name: '星屑徽章',
  rarity: 2,
  description: '祭坛散落的纪念徽章。攻击小幅提升。',
  buff: { buffId: 'attackUp', value: 8 },
};

export const CHARACTER_CARD_STARLIGHT_CHARM: CharacterCardDef = {
  id: 'card-buff-starlight-charm',
  kind: 'character',
  name: '星光护符',
  rarity: 2,
  description: '折出微光的旧护符。防御小幅提升。',
  buff: { buffId: 'defenseUp', value: 6 },
};

/** 全部角色卡（顺序：4★ → 3★ → 2★） */
export const CHARACTER_CARDS: readonly CharacterCardDef[] = [
  CHARACTER_CARD_YLZZ,
  CHARACTER_CARD_AUTHOR,
  CHARACTER_CARD_ANGEL_1,
  CHARACTER_CARD_ANGEL_2,
  CHARACTER_CARD_ANGEL_3,
  CHARACTER_CARD_ANGEL_4,
  CHARACTER_CARD_DYGG,
  CHARACTER_CARD_CAIXUKUN,
  CHARACTER_CARD_GUOLAOSHI,
  CHARACTER_CARD_STARDUST_MEDAL,
  CHARACTER_CARD_STARLIGHT_CHARM,
];

export function findCharacterCard(cardId: string): CharacterCardDef | undefined {
  return CHARACTER_CARDS.find((c) => c.id === cardId);
}

/**
 * 发行前自检（纯函数）：id 唯一、buff 数值在注册表范围内、
 * dialogueTag 合法、通用 buff 卡不带对话人格。
 */
export function auditCharacterCards(): readonly string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const card of CHARACTER_CARDS) {
    if (seen.has(card.id)) issues.push(`重复 id：${card.id}`);
    seen.add(card.id);
    const range = BUFF_RANGES[card.buff.buffId];
    if (range === undefined) {
      issues.push(`${card.id} 的 BuffId ${card.buff.buffId} 未注册`);
    } else if (card.buff.value < range.min || card.buff.value > range.max) {
      issues.push(`${card.id} 的 ${card.buff.buffId} 数值 ${card.buff.value} 超出 [${range.min}, ${range.max}]`);
    }
    if (card.dialogueTag !== undefined && !(CHARACTER_DIALOGUE_TAGS as readonly string[]).includes(card.dialogueTag)) {
      issues.push(`${card.id} 的对话分支标记 ${card.dialogueTag} 非法`);
    }
    if (card.dialogueTag === undefined && !card.id.startsWith('card-buff-')) {
      issues.push(`${card.id} 是角色卡却缺少对话分支标记`);
    }
  }
  return issues;
}
