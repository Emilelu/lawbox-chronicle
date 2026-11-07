/**
 * BOSS 三幕 —— 未解谜秒杀演出 / 解谜后护盾化 BOSS 战 / 通关结局与成就。
 * ---------------------------------------------------------------------------
 * 源自 Game.java:1491-1861：
 *   - Game.java:1494 `if (author.isAlive())`：没解作者谜题就踩 (-5,5) →
 *     影流之主分身三个，attack×3 = 700,999,314 秒杀 + System.exit（:1601-1606）。
 *     新设计：秒杀改为「演出 + 可关闭终局 overlay」（S11：终局不锁控制），
 *     玩家被送回主地图继续探索，绝无 System.exit 式逃逸。
 *   - 解谜后：BOSS 攻击归零（:495-496），强制装备爷爷的拐杖（:1611-1612 的
 *     假选择改真选择 K12），分身数每回合 ×2（:1828，long 无界 → 上限 64，K10）。
 *     新设计：BOSS 护盾化 —— 常规攻击被护盾吸收，命中「弱点卡」（作者谜题
 *     答案绑定玩家卡池编号）时护盾击破、伤害 ×2。
 *   - 通关（:1841-1860）：灰飞烟灭 + 一封信 + 世界恢复光明 + 成就
 *     「用一根爷爷祖传的拐杖打败 BOSS 的人」+ 引导越界探索四方向（KT5）。
 *     新增：通关解锁 META 终端（真结局入口，见 hiddenGame.ts）。
 */

import type { BattleTuning, StoryScriptDef } from '../../engine/story/interpreter';
import type { TriggerRule } from '../../engine/story/triggers';

/* ============================== 常量与说话者 =============================== */

export const BOSS_POS = { x: -5, y: 5 } as const; // Game.java:58
export const BOSS_ENEMY_ID = 'enemy-ylzz'; // src/data/enemies.ts

/** Game.java:1602  attack = 233666438 × 3（秒杀演出播报数值，保真计算） */
export const BOSS_ORIGINAL_ATTACK = 233666438;
export const BOSS_SLAUGHTER_DAMAGE = BOSS_ORIGINAL_ATTACK * 3; // 700999314

/** 分身序列：Game.java:1828 每回合 ×2；上限 64（K10：封顶防溢出） */
export const BOSS_SHADOW_CAP = 64;
export function shadowCount(turn: number): number {
  const doubled = 2 ** Math.max(0, turn);
  return Math.min(doubled, BOSS_SHADOW_CAP);
}

/** 弱点命中倍率（authorPuzzle.resolveBossWeakness 的 multiplier 与此对齐） */
export const BOSS_WEAKNESS_MULTIPLIER = 2;

export const BOSS_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  'npc-ylzz': '影流之主',
  'npc-author': '作者',
  'system': '【系统】',
  'narration': '旁白',
});

/* ============================== 战斗调参 ================================== */

/**
 * 护盾化 BOSS 战调参（combat-engine 集成契约，K14 对齐后的真实接线版）：
 *   - shield 233：影流之主防御原值（Game.java:58 defense=233）转译为护盾，
 *     经 gameStore.launchBattle 真实传入引擎 config.enemyShield —— 常规攻击
 *     先扣护盾，护盾未破则 HP 不动；命中弱点（克星武器爷爷的拐杖）时护盾
 *     击破、伤害 ×2。
 *   - 弱点不再走「弱点卡」flag：档案层 ENEMY_COMBAT_PROFILES['enemy-ylzz']
 *     .weakness（weaponId weapon-gfsStick × damageMul 2 = BOSS_WEAKNESS_MULTIPLIER）
 *     已等效承载，声明的失真字段（weaknessCardFlag/weaknessMultiplier）删除。
 *   - shadowDoubleEachTurn + shadowCap 64：分身演出（每回合 BOSS 压制感 +1，
 *     但有界，杜绝 K10 的 long 无界翻倍）；由档案 initialClones + 阶段
 *     cloneDouble + 引擎 MAX_CLONES=64 承载。
 */
export const BOSS_BATTLE_TUNING: BattleTuning = {
  shield: 233,
  shadowDoubleEachTurn: true,
  shadowCap: BOSS_SHADOW_CAP,
};

/* ============================== 剧本三幕 ================================== */

export const BOSS_ACTS_SCRIPT: StoryScriptDef = {
  id: 'script-boss-acts',
  title: '影流之主',
  entryNodeId: 'boss-meet',
  nodes: [
    /* ---------- 第一幕：照面 ---------- */
    {
      kind: 'dialogue',
      id: 'boss-meet',
      lines: [
        { speakerId: 'system', text: '你遇到了一个怪物！它叫 影流之主' },
        { speakerId: 'narration', text: '坐标 (-5,5)——地图的角落。空气沉得像凝固的墨。' },
      ],
      next: 'boss-guard',
    },
    /* ---------- 守卫：作者谜题的「钥匙」= 显式门锁（Game.java:1494 显式化） ---------- */
    {
      kind: 'gate',
      id: 'boss-guard',
      requireFlags: ['story:key-boss'],
      openNext: 'boss-battle-launch',
      lockedNext: 'boss-slaughter',
    },
    /* ---------- 第二幕A：未解谜秒杀（演出化，可关闭，不锁控制） ---------- */
    {
      kind: 'dialogue',
      id: 'boss-slaughter',
      fx: [
        { fx: 'screenShake', intensity: 1 },
        { fx: 'sfx', sfxId: 'sfx-effect-13' },
      ],
      lines: [
        { speakerId: 'narration', text: '你正打算做决定的时候，影流之主分身成了三个！并且朝你冲了过来！' },
        { speakerId: 'system', text: `你受到了 ${BOSS_SLAUGHTER_DAMAGE} 点伤害！你被秒杀了！` },
        { speakerId: 'narration', text: '你好像没有探索完全部内容就来螳臂当车了呢...' },
        { speakerId: 'npc-ylzz', text: '连“钥匙”都没有就敢踏进这里？回去把该见的人都见一遍吧。' },
      ],
      next: 'boss-slaughter-end',
    },
    {
      kind: 'ending',
      id: 'boss-slaughter-end',
      endingId: 'boss-slaughter',
      closable: true, // S11：终局 overlay 可关闭，返回主地图，绝不锁死
      lines: [{ speakerId: 'system', text: 'GAME OVER ——（可关闭，继续探索；谜题之钥在作者手里）' }],
    },
    /* ---------- 第二幕B：解谜后护盾化 BOSS 战 ---------- */
    {
      kind: 'dialogue',
      id: 'boss-battle-launch',
      fx: [
        { fx: 'bossTitle', enemyId: BOSS_ENEMY_ID, title: '影 流 之 主' },
        { fx: 'sfx', sfxId: 'sfx-effect-15' },
      ],
      lines: [
        { speakerId: 'npc-ylzz', text: '……攻击被设定成 0？好啊，那就用别的办法玩。' },
        { speakerId: 'system', text: '影流之主展开了「分身护盾」（233）：常规攻击被护盾吸收；命中弱点（克星武器·爷爷的拐杖）时护盾击破、伤害 ×2。' },
        { speakerId: 'system', text: '（选择武器布阵——这一次，选项是真的。）' },
      ],
      next: 'boss-battle',
    },
    {
      kind: 'battle',
      id: 'boss-battle',
      enemyId: BOSS_ENEMY_ID,
      tuning: BOSS_BATTLE_TUNING,
      winNext: 'boss-letter',
      loseNext: 'boss-defeat',
    },
    {
      kind: 'ending',
      id: 'boss-defeat',
      endingId: 'boss-defeat',
      closable: true,
      lines: [
        { speakerId: 'system', text: '你被分身淹没……（可关闭，重整旗鼓再来；再临法则在此特别有效）' },
      ],
    },
    /* ---------- 第三幕：一封信与世界恢复光明（Game.java:1841-1860） ---------- */
    {
      kind: 'dialogue',
      id: 'boss-letter',
      onEnterEffects: [
        { kind: 'setFlag', key: 'story:boss-defeated', value: true },
        { kind: 'fx', request: { fx: 'sfx', sfxId: 'sfx-effect-10' } },
      ],
      lines: [
        { speakerId: 'system', text: '影流之主 被打败了！' },
        { speakerId: 'narration', text: '影流之主 灰飞烟灭了！' },
        { speakerId: 'narration', text: '影流之主 掉落了一封信，你捡了起来，并准备打开时，天旋地转！' },
        { speakerId: 'narration', text: '这里是一个无法用言语描述的空间。' },
        { speakerId: 'npc-author', text: '没想到吧，你竟然还会在这种地方见到我~' },
        { speakerId: 'npc-author', text: '我在设计这款屑作之初，就没打算在开头阐明详细内容，现在你通关了，自然而然地可以知道了。' },
        { speakerId: 'narration', text: '在遥远的鬼畜大陆，每一个鬼畜素材对象都在这里快乐的生活着。' },
        { speakerId: 'narration', text: '但是有一天，谜之森林外出现了令人叹为观止的一幕——天空正在逐渐被黑暗所侵蚀着！' },
        { speakerId: 'narration', text: '就在这时，有一名年轻勇敢的冒险家，他决定只身一人，拯救鬼畜大陆。他的名字叫——你。' },
        { speakerId: 'narration', text: '你历经千辛万苦，终于打败了谜之森林里的所有怪物。' },
        { speakerId: 'narration', text: '转眼间，世界恢复了光明！你凯旋了，成为了鬼畜大陆永远传世的神话！' },
      ],
      next: 'boss-epilogue',
    },
    {
      kind: 'ending',
      id: 'boss-epilogue',
      endingId: 'world-saved',
      closable: true, // S11：终局画面可关闭，菜单永可用
      achievementId: 'ach-cane-boss',
      unlocksMetaTerminal: true,
      lines: [
        { speakerId: 'system', text: '恭喜获得成就：用一根爷爷祖传的拐杖打败 BOSS 的人。（草' },
        { speakerId: 'system', text: 'META 终端已解锁——世界的另一侧，有什么在等待被输入。' },
        { speakerId: 'npc-author', text: '现在你将会被传送回地图，但是地图上已经没有任何怪物以及 NPC 了。' },
        { speakerId: 'npc-author', text: '你只有三种选择：1.在地图上漫无目的地游荡 2.合上游戏 3.探索地图范围之外（四个方向有不同的彩蛋）' },
      ],
    },
  ],
};

/* ============================== 触发规则 ================================== */

export const BOSS_TRIGGER_RULES: readonly TriggerRule[] = [
  {
    id: 'trigger-boss-ylzz',
    scriptId: 'script-boss-acts',
    when: { kind: 'npc', x: BOSS_POS.x, y: BOSS_POS.y, radius: 1 },
    // 影流之主只此一次；胜负两条路都通向显式节点（Game.java:1863-1865 的
    // 「好像没啥发生」兜底由 once + seenEventIds 承担）
    once: true,
  },
];
