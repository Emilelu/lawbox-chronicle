/**
 * 作者谜题 —— x-y=(D-1)-z（数据 + 求解器）。
 * ---------------------------------------------------------------------------
 * 源自 Game.java:475-508：作者位于 (-2,4)（Game.java:52），三只小怪全灭后出现
 * （Game.java:328-329 的显式前置），谜题见 Game.java:481，答案注释见 :482-488
 * （x=5,y=5,z=1 或 x=1,y=5,z=5 —— 尤拉公式 v+f-e=2 的变体，x/z 可互换）。
 *
 * 原版行为对照：
 *   - 答错 → System.exit(0)（Game.java:506-507）→ 改为「重试 + 阶梯提示」，
 *     永不退出（K5/K15 同源：终局与失败都不锁控制）；
 *   - 答对 → setAttack(0)（:495）+ bag.clear()（:497）+ 送爷爷的拐杖（:500），
 *     全部保留并语义化：
 *     · setEnemyAttack('enemy-ylzz', 0)  —— 解谜后 BOSS 攻击归零（护盾化战斗的前置）；
 *     · unequipWeapon                    —— 「代价」真实结算（K13：不谎报）；
 *     · grantWeapon('weapon-gfsStick')   —— 祖传拐杖 233；
 *   - 新设计（答案→BOSS 弱点绑定）：x 与 z 是可互换的一对，答案组选择
 *     「5,5,1 / 1,5,5」分别指向玩家卡池编号 5 / 1 的卡 —— 该卡成为
 *     BOSS 弱点卡（护盾战中对影流之主伤害 ×2）。卡池为空时回退到
 *     card-chr-author（「弱点由作者钦定」），保证绑定永远有解。
 */

import type {
  PuzzleSolver,
  PuzzleSolveContext,
  PuzzleSolveResult,
  StoryScriptDef,
} from '../../engine/story/interpreter';
import type { TriggerRule } from '../../engine/story/triggers';

/* ============================== 谜题常量 ================================== */

export const AUTHOR_PUZZLE_ID = 'puzzle-author-xyz';

/** 作者 NPC 字符串 id（与 src/data/story.ts 的 SPEAKERS 对齐） */
export const SPEAKER_AUTHOR = 'npc-author';
export const AUTHOR_PUZZLE_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  'npc-author': '作者',
  'system': '【系统】',
  'narration': '旁白',
});

/** Game.java:481 原题面 */
export const AUTHOR_PUZZLE_STATEMENT =
  '已知 x-y=(D-1)-z，求 x,y,z。（提示：有两组答案，回答出其中一组即可。）输入的格式示例：x,y,z';

/** 两组合法答案（Game.java:483-484 注释实测） */
export const AUTHOR_PUZZLE_ANSWERS = ['5,5,1', '1,5,5'] as const;
export type AuthorPuzzleAnswer = (typeof AUTHOR_PUZZLE_ANSWERS)[number];

/** 作者坐标（Game.java:52） */
export const AUTHOR_POS = { x: -2, y: 4 } as const;

/** 答对后 BOSS（影流之主）攻击被改写为 0（Game.java:495-496 保真） */
export const BOSS_ATTACK_AFTER_PUZZLE = 0;

/* ============================== 输入归一化 ================================ */

/**
 * 归一化玩家输入：去空白、全角逗号/顿号 → 半角、全角数字 → 半角。
 * 原版用 Scanner.next() + equals 严格比较（Game.java:489-491），
 * 全角逗号就判死 —— 这里宽容化，判定仍严格等于两组答案。
 */
export function normalizePuzzleInput(raw: string): string {
  return raw
    .trim()
    .replace(/[，、｡]/g, ',')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* ============================ 弱点绑定（新设计） =========================== */

export interface BossWeakness {
  /** 弱点卡 id（玩家卡池编号 → 持有卡列表的第 n 张，1-based） */
  readonly cardId: string;
  /** 弱点命中倍率 */
  readonly multiplier: number;
  /** 解说（BOSS 战斗日志 / 规则手册用） */
  readonly label: string;
}

/** 卡池为空时的命运缺省：弱点由作者钦定 */
export const FALLBACK_WEAKNESS_CARD_ID = 'card-chr-author';

/**
 * 答案 → 弱点卡绑定。
 * '5,5,1' → 卡池编号 5（第 5 张持有卡）；'1,5,5' → 卡池编号 1（第 1 张）。
 * 持有数不足时按卡池循环取模（1-based），空池回退作者卡。
 */
export function resolveBossWeakness(answer: AuthorPuzzleAnswer, ownedCardIds: readonly string[]): BossWeakness {
  const slot = answer === '5,5,1' ? 5 : 1;
  if (ownedCardIds.length === 0) {
    return {
      cardId: FALLBACK_WEAKNESS_CARD_ID,
      multiplier: 2,
      label: `弱点绑定（缺省）：${FALLBACK_WEAKNESS_CARD_ID} —— 卡池空空如也，作者替你做了决定。`,
    };
  }
  const idx = (slot - 1) % ownedCardIds.length;
  const picked = ownedCardIds[idx];
  const cardId = picked !== undefined ? picked : FALLBACK_WEAKNESS_CARD_ID;
  return {
    cardId,
    multiplier: 2,
    label: `弱点绑定：卡池编号 ${slot} → ${cardId}（答案 ${answer} 的第 ${slot} 位）`,
  };
}

/* ============================== 阶梯提示 ================================== */

/** 答错提示阶梯（源自 Game.java:485-488 的注释逻辑，口语化改写） */
export function puzzleHint(retries: number): string {
  if (retries <= 0) {
    return '作者：“提示 1：这题和多面体有关——想想尤拉公式 v+f-e=2（顶点、面、棱）。”';
  }
  if (retries === 1) {
    return '作者：“提示 2：题目可没规定 x、y、z 各自代表什么——所以有一对字母是可以互换的。”';
  }
  return '作者：“提示 3：格式是 A,B,C，中间那位是 5。要不要试试……蒙一个？:)”';
}

/* ============================== 求解器 ==================================== */

/** 供解释器 env.solvers 注册：作者谜题求解器 */
export const AUTHOR_PUZZLE_SOLVER: PuzzleSolver = (
  raw: string,
  ctx: PuzzleSolveContext,
): PuzzleSolveResult => {
  const normalized = normalizePuzzleInput(raw);
  const hit = AUTHOR_PUZZLE_ANSWERS.find((ans) => normalizePuzzleInput(ans) === normalized);

  if (hit === undefined) {
    // 答错 → 重试 + 提示（绝不 System.exit；Game.java:506-507 的改写点）
    return {
      ok: false,
      fatal: false,
      hint: puzzleHint(ctx.retries),
      echo: `作者收到了你的答案：「${raw.trim()}」——但只是笑了笑。`,
    };
  }

  const weakness = resolveBossWeakness(hit, ctx.ownedCardIds);
  return {
    ok: true,
    effects: [
      { kind: 'setFlag', key: 'story:author-met', value: true },
      // 「钥匙」= 弱点绑定 + BOSS 攻击归零（Game.java:494-496 语义化）
      { kind: 'setFlag', key: 'story:key-boss', value: weakness.cardId },
      { kind: 'setFlag', key: 'story:boss-weakness-label', value: weakness.label },
      { kind: 'setEnemyAttack', enemyId: 'enemy-ylzz', value: BOSS_ATTACK_AFTER_PUZZLE },
      // 代价：真实清空（K13）——卸下当前武器；随后作者「形式上」补发祖传拐杖
      { kind: 'unequipWeapon' },
      { kind: 'grantWeapon', weaponId: 'weapon-gfsStick' },
      { kind: 'fx', request: { fx: 'sfx', sfxId: 'sfx-effect-16' } },
    ],
  };
};

/* ============================== 谜题剧本 ================================== */

/** 作者谜题剧本（触发规则见下方 AUTHOR_TRIGGER_RULES） */
export const AUTHOR_PUZZLE_SCRIPT: StoryScriptDef = {
  id: 'script-author-puzzle',
  title: '作者与三题谜',
  entryNodeId: 'author-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'author-entry',
      onEnterEffects: [{ kind: 'setFlag', key: 'story:author-encounter-started', value: true }],
      lines: [
        { speakerId: 'narration', text: '坐标 (-2,4)——一张躺椅凭空摆在荒野正中，作者翘着二郎腿。' },
        { speakerId: SPEAKER_AUTHOR, text: '哦吼！没想到你竟然遇到我了！不知道你是乱走还是认真探索了每一个坐标呢。' },
        { speakerId: SPEAKER_AUTHOR, text: '既然你遇到了我，说明你离通关已经不远了。顺便说一下，假如你没有遇到我，你是永远都无法通关的！' },
        { speakerId: SPEAKER_AUTHOR, text: '听好了！——' },
        { speakerId: 'system', text: AUTHOR_PUZZLE_STATEMENT },
      ],
      next: 'author-puzzle',
    },
    {
      kind: 'puzzle',
      id: 'author-puzzle',
      puzzleId: AUTHOR_PUZZLE_ID,
      promptLines: [
        { speakerId: 'system', text: '请输入答案（格式：x,y,z）。答错不会结束游戏——可以一直重试。' },
      ],
      successNext: 'author-success',
      failNext: 'author-retry',
    },
    {
      // fatal 分支本谜题不会走到（求解器 fatal 恒 false）；保留显式节点防空边
      kind: 'dialogue',
      id: 'author-retry',
      lines: [{ speakerId: SPEAKER_AUTHOR, text: '再想想？我可是很诚信的人，提示都给你备好了。' }],
      next: 'author-puzzle',
    },
    {
      kind: 'dialogue',
      id: 'author-success',
      lines: [
        { speakerId: SPEAKER_AUTHOR, text: '什么！你竟然答对了！不过应该是蒙的或者百度来的吧 :)' },
        { speakerId: SPEAKER_AUTHOR, text: '其实我也完全不懂这题是什么鬼，这题是出自....禁止事项' },
        { speakerId: SPEAKER_AUTHOR, text: '我是一个诚信的人，“钥匙”已经给你了，你也付出了代价。不过问题不大，快去打 BOSS 吧！' },
        { speakerId: 'system', text: '[System] Monster 影流之主’s attack has been set to 0.' },
        { speakerId: 'system', text: '[System] 冒险者的武器已被真实卸下（代价结算）。' },
        { speakerId: SPEAKER_AUTHOR, text: '等等！形式上还是给你一个好东西吧，这是我祖传的武器，希望对你有用23333~' },
        { speakerId: 'system', text: '获得新武器：爷爷的拐杖，攻击力：233' },
        { speakerId: SPEAKER_AUTHOR, text: '不多说了，拜拜~ 有缘再会 :)' },
      ],
      next: 'author-close',
    },
    {
      kind: 'ending',
      id: 'author-close',
      endingId: 'author-puzzle-solved',
      closable: true,
      lines: [
        { speakerId: 'system', text: '「钥匙」到手——影流之主的弱点已被答案绑定。快去 (-5,5) 吧。' },
      ],
    },
  ],
};

/* ============================== 触发规则 ================================== */

/**
 * 作者前置：三只小怪全部被击败（Game.java:328-329 的显式化 ——
 * !caixukun.isAlive() && !guolaoshi.isAlive() && !dygg.isAlive()）。
 * 战胜依次置 flag 'story:defeated:<id>'，requireFlags 要求三者齐备。
 */
export const DEFEAT_FLAGS = ['story:defeated:enemy-caixukun', 'story:defeated:enemy-guolaoshi', 'story:defeated:enemy-dygg'] as const;

export const AUTHOR_TRIGGER_RULES: readonly TriggerRule[] = [
  {
    id: 'trigger-author-quiz',
    scriptId: 'script-author-puzzle',
    when: { kind: 'npc', x: AUTHOR_POS.x, y: AUTHOR_POS.y, radius: 1 },
    requireFlags: [...DEFEAT_FLAGS],
    once: true,
  },
  {
    id: 'trigger-author-hint',
    scriptId: 'script-author-hint',
    when: { kind: 'tile', x: AUTHOR_POS.x, y: AUTHOR_POS.y },
    // 剧情已开场/已解谜后不再打扰（unless 任一即封锁）
    unlessFlags: ['story:author-encounter-started', 'story:author-met'],
    once: false,
  },
];

/**
 * 附加剧本：三怪前置未完成时踩到作者坐标的「沉默的躺椅」提示事件，
 * 替代原版「条件不满足 → 啥都不发生」的静默分支（Game.java:1864）。
 */
export const AUTHOR_HINT_SCRIPT: StoryScriptDef = {
  id: 'script-author-hint',
  title: '沉默的躺椅',
  entryNodeId: 'author-hint-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'author-hint-entry',
      lines: [
        { speakerId: 'narration', text: '一张躺椅凭空摆在荒野正中，但作者还没露面。' },
        { speakerId: 'narration', text: '椅背上贴着字条：“把地图上另外三位‘名人’都打发了再来。——作者”' },
      ],
      next: 'author-hint-close',
    },
    {
      kind: 'ending',
      id: 'author-hint-close',
      endingId: 'author-hint',
      closable: true,
      lines: [{ speakerId: 'system', text: '提示已记录：击败蔡徐坤、郭老师、冬泳怪鸽后，作者才会现身。' }],
    },
  ],
};
