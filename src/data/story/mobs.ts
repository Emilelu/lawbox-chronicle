/**
 * 三小怪遭遇战 —— 剧本化战斗（集成期新增 + STORY-5 迁关分布）。
 * ---------------------------------------------------------------------------
 * 原版三怪（蔡徐坤/郭老师/冬泳怪鸽）在 Game.java 主地图坐标上直接开打；
 * 本文件把它们接进 story-weaver 解释器的统一战斗流：
 *   entry 对白 → battle 节点（combat-engine startBattle 结算）→
 *   胜利：置 story:defeated:<id>（作者谜题的前置三旗，见 authorPuzzle.DEFEAT_FLAGS）
 *        + 掉落武器 + 星石（grantStarStones）→ ending（closable，S11）；
 *   失败：可关闭的败北 ending（绝无 System.exit）。
 * 触发规则（MOB_TRIGGER_RULES）与天使/作者/BOSS 同表注册。STORY-5 分布：
 * 三怪迁出主城分散到 L2/L3/L6（遭遇坐标声明在本文件 MOB_PARAMS，为对应关卡
 * 自身网格坐标且逐格验证为原始网格 0）；enemies.ts 的 originPos 自此只作
 * 图鉴字段（原版 Game.java:55-65 出处存档），不再派生触发坐标。
 */

import type { StoryScriptDef } from '../../engine/story/interpreter';
import type { TriggerRule } from '../../engine/story/triggers';
import { findEnemy } from '../enemies';

/* ============================== 说话者表 ================================== */

export const MOB_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  'system': '【系统】',
  'narration': '旁白',
  'npc-caixukun': '蔡徐坤',
  'npc-guolaoshi': '郭老师',
  'npc-dygg': '冬泳怪鸽',
});

/* ============================== 遭遇战奖励 ================================ */

/** 战胜星石（星石经济 BT6：小怪产出，量级低于关卡奖励） */
export const MOB_REWARD_STONES = 300;

/* ============================== 剧本工厂 ================================== */

interface MobParam {
  readonly enemyId: string;
  /** 关级作用域（STORY-5 分布）：遭遇发生在对应关卡 */
  readonly levelId: string;
  /** 该关自身网格坐标（已对 areas.ts 原始网格逐格验证为 0=可站地板） */
  readonly x: number;
  readonly y: number;
  /**
   * 遭遇触发半径（曼哈顿距离，语义同 TriggerRule npc radius）：缺省 0 = 踩上
   * 即遭遇。仅当遭遇格被实体占位、踩格不可达时才声明更大半径（见下表蔡徐坤）。
   */
  readonly triggerRadius?: number;
  /** 遭遇台词（原版 printDialogue 的「你遇到了一个怪物！」句式保真） */
  readonly taunt: string;
  readonly victoryNote: string;
}

/**
 * 三怪分布（STORY-5，坐标已对 areas.ts 逐格验证）：
 * 蔡徐坤 L2 双廊回环 (12,3) / 郭老师 L3 碎星十字 (7,5)（暗夜关中遭遇）/ 冬泳怪鸽 L6 双石门 (3,3)。
 * HP 递增（28→98→149）与关卡曲线同向；不再派生自 enemies.originPos（图鉴字段）。
 * N1 修法：蔡徐坤 triggerRadius 1（邻格即遭遇）。(12,3) 虽是可站地板，但被
 * MECH-4 守卫实体同格占位，且四向单步推入均不可行（北上落位 (12,2) 是墙、
 * 南下发力位 (12,2) 是墙、西移落位 (11,3) 是箱子出生点、东移发力位 (11,3)
 * 是箱子）——radius 0 意味着必须先完成「(11,2) 下推箱让位 → (11,3) 东推
 * 守卫」的两步非显然推箱才能落格触发，自然接近路径（出生点 (13,1) 南行至
 * (13,3)）永远打不到。radius 1 让「走到守卫邻格」即遭遇，与触发器 npc
 * 交互语义（走到 NPC 相邻格）一致；预计算解路推东廊箱（发力位 (11,4)）必经
 * 东廊走廊，遭遇在解路途中顺路触发，自动演示因此不再缺这段剧情。
 */
const MOB_PARAMS: readonly MobParam[] = [
  {
    enemyId: 'enemy-caixukun',
    levelId: 'level-sb-02',
    x: 12,
    y: 3,
    // 遭遇格被 MECH-4 守卫同格占位（areas.ts enemySpawns (12,3)），踩格触发
    // 不可自然达成：radius 1 = 走到守卫邻格（(13,3)/(12,4)/(11,3)）即遭遇。
    triggerRadius: 1,
    taunt: '只因你实在是太美，must 的！——蔡徐坤拦在了你的面前。',
    victoryNote: '小贴士：本游戏的“格挡”与其字面意思略有差异——在新法则之下，格挡即减免：伤害下限为 1，防御不再造成任何“回血”。（原 ev-battle-tip-block）',
  },
  {
    enemyId: 'enemy-guolaoshi',
    levelId: 'level-sb-03',
    x: 7,
    y: 5,
    taunt: '耶斯莫拉！郭老师占领了这条走廊，集美们把门焊死了！',
    victoryNote: '迷吼tiao（外观酷似猕猴桃的炸弹）掉在了地上——它可以“多次使用”，这次是真的。',
  },
  {
    enemyId: 'enemy-dygg',
    levelId: 'level-lb-06',
    x: 3,
    y: 3,
    taunt: '奥利给！！冬泳怪鸽从寒潭里站了起来，正面对决！',
    victoryNote: '巨剑太重了，但你还是把它背了起来。没有困难的工作，只有勇敢的冒险者！',
  },
];

function makeMobScript(p: MobParam): StoryScriptDef {
  const enemy = findEnemy(p.enemyId);
  const name = enemy?.name ?? p.enemyId;
  const seq = p.enemyId.replace('enemy-', '');
  const mobSpeaker = `npc-${seq}`;
  return {
    id: `script-mob-${seq}`,
    title: `遭遇战：${name}`,
    entryNodeId: `mob-${seq}-entry`,
    nodes: [
      {
        kind: 'dialogue',
        id: `mob-${seq}-entry`,
        fx: [{ fx: 'sfx', sfxId: 'sfx-effect-13' }],
        lines: [
          { speakerId: 'system', text: `你遇到了一个怪物！它叫 ${name}` },
          { speakerId: mobSpeaker, text: p.taunt },
        ],
        next: `mob-${seq}-battle`,
      },
      {
        kind: 'battle',
        id: `mob-${seq}-battle`,
        enemyId: p.enemyId,
        tuning: {}, // 单阶段普通怪：档案在 ENEMY_COMBAT_PROFILES，无附加调参
        winNext: `mob-${seq}-win`,
        loseNext: `mob-${seq}-lose`,
      },
      {
        kind: 'dialogue',
        id: `mob-${seq}-win`,
        onEnterEffects: [
          { kind: 'setFlag', key: `story:defeated:${p.enemyId}`, value: true },
          { kind: 'grantStarStones', amount: MOB_REWARD_STONES },
          { kind: 'fx', request: { fx: 'sfx', sfxId: 'sfx-effect-10' } },
        ],
        lines: [
          { speakerId: 'system', text: `${name} 被打败了！` },
          { speakerId: 'system', text: `获得 ${MOB_REWARD_STONES} 星石。` },
          ...(enemy?.dropWeaponId !== undefined
            ? [{ speakerId: 'system', text: `${name} 掉落了武器！（已放入背包，可在布阵阶段选择）` }]
            : []),
          { speakerId: 'narration', text: p.victoryNote },
        ],
        next: `mob-${seq}-close`,
      },
      {
        kind: 'ending',
        id: `mob-${seq}-close`,
        endingId: `mob-${seq}-defeated`,
        closable: true,
        lines: [{ speakerId: 'system', text: `${name} 化作了星尘。地图上又少了一个拦路的人。` }],
      },
      {
        kind: 'ending',
        id: `mob-${seq}-lose`,
        endingId: `mob-${seq}-defeat`,
        closable: true,
        lines: [
          { speakerId: 'system', text: '你被击倒了……（可关闭，昏睡一觉醒已回满 HP——「休整」在败北结算时自动完成；「再临」法则在此特别有效）' },
        ],
      },
    ],
  };
}

export const MOB_SCRIPTS: readonly StoryScriptDef[] = MOB_PARAMS.map(makeMobScript);

/* ============================== 触发规则 ================================== */

/** 三怪触发：level-scoped 网格坐标（STORY-5 分布，坐标声明在 MOB_PARAMS），
 *  NPC 语义 radius 0 = 踩上即遭遇（郭老师/冬泳怪鸽所在格无实体占位，自然可达）；
 *  蔡徐坤 radius 1 = 邻格即遭遇（N1：遭遇格被 MECH-4 守卫同格占位且四向单步
 *  推入不可行，r0 只能靠两步非显然推箱前置触发——半径声明在 MOB_PARAMS.triggerRadius）。
 *  once:false + unlessFlag(击败旗) —— 战败/逃跑可再来（once 会把逃兵永久锁在门外，
 *  进而锁死作者谜题的三前置旗）；胜利置旗后不再触发。 */
export const MOB_TRIGGER_RULES: readonly TriggerRule[] = MOB_PARAMS.map((p) => {
  const seq = p.enemyId.replace('enemy-', '');
  return {
    id: `trigger-mob-${seq}`,
    scriptId: `script-mob-${seq}`,
    when: {
      kind: 'npc',
      x: p.x,
      y: p.y,
      radius: p.triggerRadius ?? 0,
      levelId: p.levelId,
    },
    once: false,
    unlessFlag: `story:defeated:${p.enemyId}`,
  } as const;
});
