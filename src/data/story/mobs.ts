/**
 * 三小怪遭遇战 —— 剧本化战斗（集成期新增）。
 * ---------------------------------------------------------------------------
 * 原版三怪（蔡徐坤/郭老师/冬泳怪鸽）在 Game.java 主地图坐标上直接开打；
 * 本文件把它们接进 story-weaver 解释器的统一战斗流：
 *   entry 对白 → battle 节点（combat-engine startBattle 结算）→
 *   胜利：置 story:defeated:<id>（作者谜题的前置三旗，见 authorPuzzle.DEFEAT_FLAGS）
 *        + 掉落武器 + 星石（grantStarStones）→ ending（closable，S11）；
 *   失败：可关闭的败北 ending（绝无 System.exit）。
 * 触发规则（MOB_TRIGGER_RULES）与天使/作者/BOSS 同表注册，坐标为
 * KichikuAdventure 主地图语义（集成层经 STORY_GRID_OFFSET 映射进箱庭网格）。
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
  /** 遭遇台词（原版 printDialogue 的「你遇到了一个怪物！」句式保真） */
  readonly taunt: string;
  readonly victoryNote: string;
}

const MOB_PARAMS: readonly MobParam[] = [
  {
    enemyId: 'enemy-caixukun',
    taunt: '只因你实在是太美，must 的！——蔡徐坤拦在了你的面前。',
    victoryNote: '小贴士：本游戏的“格挡”与其字面意思略有差异——在新法则之下，格挡即减免：伤害下限为 1，防御不再造成任何“回血”。（原 ev-battle-tip-block）',
  },
  {
    enemyId: 'enemy-guolaoshi',
    taunt: '耶斯莫拉！郭老师占领了这条走廊，集美们把门焊死了！',
    victoryNote: '迷吼tiao（外观酷似猕猴桃的炸弹）掉在了地上——它可以“多次使用”，这次是真的。',
  },
  {
    enemyId: 'enemy-dygg',
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
          { speakerId: 'system', text: '你被击倒了……（可关闭，回去休整后再来；「再临」法则在此特别有效）' },
        ],
      },
    ],
  };
}

export const MOB_SCRIPTS: readonly StoryScriptDef[] = MOB_PARAMS.map(makeMobScript);

/* ============================== 触发规则 ================================== */

/** 三怪触发：原版主地图坐标（enemies.ts originPos，Game.java:55-65），NPC 语义。
 *  once:false + unlessFlag(击败旗) —— 战败/逃跑可再来（once 会把逃兵永久锁在门外，
 *  进而锁死作者谜题的三前置旗）；胜利置旗后不再触发。 */
export const MOB_TRIGGER_RULES: readonly TriggerRule[] = MOB_PARAMS.map((p) => {
  const enemy = findEnemy(p.enemyId);
  const seq = p.enemyId.replace('enemy-', '');
  return {
    id: `trigger-mob-${seq}`,
    scriptId: `script-mob-${seq}`,
    when: {
      kind: 'npc',
      x: enemy?.originPos.x ?? 0,
      y: enemy?.originPos.y ?? 0,
      radius: 0,
    },
    once: false,
    unlessFlag: `story:defeated:${p.enemyId}`,
  } as const;
});
