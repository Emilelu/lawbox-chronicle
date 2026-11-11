/**
 * BOSS 三幕 —— 未解谜秒杀演出 / 解谜后护盾化 BOSS 战 / 通关结局与成就。
 * ---------------------------------------------------------------------------
 * 源自 Game.java:1491-1861（STORY-5 迁关：BOSS 居 L12 星陨王座，王座厅即终关）：
 *   - Game.java:1494 `if (author.isAlive())`：没解作者谜题就闯王座厅 →
 *     影流之主分身三个，attack×3 = 700,999,314 秒杀 + System.exit（:1601-1606）。
 *     新设计：秒杀改为「演出 + 可关闭终局 overlay」（S11：终局不锁控制），
 *     玩家留在王座厅继续探索（once:false 可重复触发，持钥后再入走真战斗），
 *     绝无 System.exit 式逃逸。
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

/**
 * BOSS 坐标（STORY-5 迁关：L12 星陨王座 (6,5) —— 2×2 圣坛旗格「王座」的一角，
 * 原始格值 3=旗格不可站，npc 触发无需玩家可站；原版出处 Game.java:58 (-5,5)
 * 存档于注释）。
 * radius 3 的依据（本 ask node BFS 实测）：禁走 (6,4) 从出生点仍 98 格可达 ——
 * tile(6,4) 非必经咽喉；而完成本关最后一次推箱必然站在王座邻格，goal 4-邻格
 * 全集到 (6,5) 曼哈顿距离最大 = 3 且全部可站，出生点 (1,1) 距离 9 不误触 ——
 * r3 触发是通关的必然前置（绕路通关不可能）。
 */
export const BOSS_POS = { levelId: 'level-lb-12', x: 6, y: 5 } as const;
export const BOSS_TRIGGER_RADIUS = 3;
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
        { speakerId: 'narration', text: '星陨王座的大厅尽头——王座上的影子缓缓站起。空气沉得像凝固的墨。' },
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

/* ==================== 前置演出：残影（L10）与投影（L11） ==================== */

/**
 * L10 三阶圣所「影之残影」：圣所里残存的一缕分身气息（once）——
 * 顺序谜题的第二课：先见残影，再见投影，最后才在王座见到本体。
 */
export const SHADOW_ECHO_SCRIPT: StoryScriptDef = {
  id: 'script-shadow-echo',
  title: '影之残影',
  entryNodeId: 'shadow-echo-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'shadow-echo-entry',
      fx: [{ fx: 'sfx', sfxId: 'sfx-effect-13' }],
      lines: [
        { speakerId: 'narration', text: '圣所的台阶上凝着一缕黑雾——它有轮廓，却没有脸。' },
        { speakerId: 'npc-ylzz', text: '……影子记得主人的形状。你在收集什么？羽毛？钥匙？' },
        { speakerId: 'narration', text: '话没说完，残影就像被风吹散的墨一样消失了。' },
        { speakerId: 'narration', text: '（有谁在更深处看着你。越往前行，空气越沉。）' },
      ],
      next: 'shadow-echo-close',
    },
    {
      kind: 'ending',
      id: 'shadow-echo-close',
      endingId: 'shadow-echo',
      closable: true,
      lines: [{ speakerId: 'system', text: '（残影消散了。前方还有一重更深的影子在等你。）' }],
    },
  ],
};

/** L10 影之残影触发：npc (7,1) r1（once），坐标已对 areas.ts 验证为原始网格 0 */
export const SHADOW_ECHO_TRIGGER: TriggerRule = {
  id: 'trigger-shadow-echo',
  scriptId: 'script-shadow-echo',
  when: { kind: 'npc', x: 7, y: 1, radius: 1, levelId: 'level-lb-10' },
  once: true,
};

/** L11 合宇之厅「影流之主投影」：终厅前的最后警告（once） */
export const SHADOW_PROJECTION_SCRIPT: StoryScriptDef = {
  id: 'script-shadow-projection',
  title: '影流之主的投影',
  entryNodeId: 'shadow-projection-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'shadow-projection-entry',
      fx: [{ fx: 'screenShake', intensity: 0.4 }],
      lines: [
        { speakerId: 'narration', text: '大厅中央的星阶上，一个巨大的人影凭空投影成形——不是分身，是「预告」。' },
        { speakerId: 'npc-ylzz', text: '最后一关的门槛前，先给你一句忠告：没拿到「钥匙」的话，就别踏进王座厅。' },
        { speakerId: 'npc-ylzz', text: '分身成了三个的滋味，你已经尝过一次了。想再尝一次吗？' },
        { speakerId: 'narration', text: '投影碎成点点黑星，散落在四箱归一的星阶之间。' },
      ],
      next: 'shadow-projection-close',
    },
    {
      kind: 'ending',
      id: 'shadow-projection-close',
      endingId: 'shadow-projection',
      closable: true,
      lines: [{ speakerId: 'system', text: '（投影消失了。王座厅就在下一关——带好你的「钥匙」。）' }],
    },
  ],
};

/** L11 影流之主投影触发：npc (6,7) r1（once），坐标已对 areas.ts 验证为原始网格 0 */
export const SHADOW_PROJECTION_TRIGGER: TriggerRule = {
  id: 'trigger-shadow-projection',
  scriptId: 'script-shadow-projection',
  when: { kind: 'npc', x: 6, y: 7, radius: 1, levelId: 'level-lb-11' },
  once: true,
};

/* ============================== 触发规则 ================================== */

export const BOSS_TRIGGER_RULES: readonly TriggerRule[] = [
  {
    id: 'trigger-boss-ylzz',
    scriptId: 'script-boss-acts',
    when: {
      kind: 'npc',
      x: BOSS_POS.x,
      y: BOSS_POS.y,
      radius: BOSS_TRIGGER_RADIUS,
      levelId: BOSS_POS.levelId,
    },
    // once:false + unlessFlag('story:boss-defeated')（击败旗只在信结局 boss-letter
    // 置位）：未解谜的秒杀演出可重复触发（短、可关闭，S11）——顺带修复既有
    // once:true 在「先 BOSS 后作者」顺序下被 seenEventIds 永久封印的软锁隐患；
    // 解谜持钥后再入王座厅即走护盾战真分支。
    once: false,
    unlessFlag: 'story:boss-defeated',
  },
];
