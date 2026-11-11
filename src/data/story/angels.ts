/**
 * 四导航天使 —— 同一事件模板 × 4 组台词（数据化重铸 + STORY-5 迁关分布）。
 * ---------------------------------------------------------------------------
 * 根治对象：Game.java:509-808 四段近乎逐字复制粘贴的 guideAngel1..4 分支
 * （各含 1 张 ASCII art + 同一套台词 + 同一套 bag.add/alive 置 false 逻辑）。
 * 此处收敛为一个模板工厂 makeAngelScript()，四位天使只声明差异参数：
 *   - 名称 / 所在关卡与网格坐标（原版出生地 Game.java:48-51 ①(1,0) ②(-1,0)
 *     ③(0,1) ④(0,-1) 作为「主城残留羽毛」保留，见 HUB_FEATHER_RULES）；
 *   - 台词顺序差异：①②为「难度→一步登天→越界劝告」，③④把「越界劝告」
 *     提前（Game.java:540-545 vs :711-716/:792-797 实测）—— 保真保留原版怪癖。
 * 行为对照（原版 → 新设计）：
 *   - bag.add(dagger)（Game.java:546 等）→ grantWeapon('weapon-dagger')，
 *     武器数值只引用 src/data/weapons.ts 的字符串 id；
 *   - 四姐妹 alive 全灭（Game.java:553-556 等）→ 旗标双写（评审⑤修法）：
 *     per-angel `story:angel-met-<seq>`（unlessFlag 用它，各关互不牵连）+
 *     全局 `story:angels-met`（语义=「至少遇见一位」，主城羽毛 requireFlag 不失效）；
 *   - 每位谢幕原地留「光羽」tile（requireFlag per-angel 旗），拾取置
 *     `story:feather-<seq>`；主城四姐妹出生地的「残留的羽毛」拾取同样置
 *     `story:feather-<seq>`（L12 彩蛋消费）；
 *   - 融合点新增：临别赠礼发放角色卡 card-chr-angel（编入卡组解锁对话分支）。
 */

import type { StoryLine, StoryScriptDef } from '../../engine/story/interpreter';
import type { TriggerRule } from '../../engine/story/triggers';

/* ============================== 说话者表 ================================== */

export const ANGEL_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  'npc-angel-1': '导航天使①',
  'npc-angel-2': '导航天使②',
  'npc-angel-3': '导航天使③',
  'npc-angel-4': '导航天使④',
  'system': '【系统】',
  'narration': '旁白',
});

/* ============================== 台词模板 ================================== */

/** 台词正文模板；speakerId 由工厂按天使编号落名（Game.java:539-552 原句） */
const SEGMENTS = {
  greet: (name: string): string =>
    `${name}：“你就是新来的冒险者？告诉你一点东西，这个游戏地图的范围是 x,y=±5”`,
  quadrants: (name: string): string =>
    `${name}：“同时，请自行脑补地图，本游戏难易度从小到大分别是第一、四、三、二象限！请好好探索每一个坐标！说不定会有什么神奇的事情发生呢...”`,
  boundary: (name: string): string =>
    `${name}：“听我一句劝，你最好不要跑出地图范围，否则到时候会很麻烦的~”`,
  oneStep: (name: string): string => `${name}：“一步登天的后果只有死路一条”`,
  gift: (name: string): string => `${name}：“总之，先收下这些吧！”`,
  sisters: (name: string): string =>
    `${name}：“另外告诉你，我在地图上还有三个好姐妹，但是这个该死的作者设定了，你遇到我们当中其中一个后，剩下的都会瞬间去世。”`,
  happy: (name: string): string => `${name}：“虽然遇到你的时间只有几秒不到，但是我真的很开心！”`,
  farewell: (name: string): string => `${name}：“我们永远在这里等着你，后会有期！”`,
} as const;

/** ①②的台词顺序（Game.java:540-545 / :626-631） */
const ORDER_A = ['greet', 'quadrants', 'oneStep', 'boundary', 'gift'] as const;
/** ③④的顺序：越界劝告提前（Game.java:711-716 / :792-797） */
const ORDER_B = ['greet', 'boundary', 'quadrants', 'oneStep', 'gift'] as const;

const CIRCLE = ['①', '②', '③', '④'] as const;

/* ============================== 模板工厂 ================================== */

export interface AngelParam {
  readonly seq: 1 | 2 | 3 | 4;
  readonly name: string;
  /** 关级作用域（STORY-5 分布）：天使只在对应关卡现身 */
  readonly levelId: string;
  /** 该关自身网格坐标（trigger when.x/y 直接消费；均已对 areas.ts 原始网格逐格验证为可站地板） */
  readonly x: number;
  readonly y: number;
  readonly order: readonly ('greet' | 'quadrants' | 'oneStep' | 'boundary' | 'gift')[];
}

function makeAngelScript(p: AngelParam): StoryScriptDef {
  const speakerId = `npc-angel-${p.seq}`;
  const said = (text: string): StoryLine => ({ speakerId, text });

  const bodyLines: readonly StoryLine[] = [
    { speakerId: 'system', text: `你遇到了一个 NPC，它是 ${p.name}` },
    ...p.order.map((seg) => said(SEGMENTS[seg](p.name))),
    // 临别赠礼（融合点）：角色卡（card-chr-angel-<seq>，四天使各一张）+ 匕首
    //（Game.java:546-548 播报文案保真）
    {
      speakerId,
      text: `${p.name}：“这一张卡，就当是我们存在过的证据。把它编入卡组，我们就在你身边。”`,
    },
    { speakerId: 'system', text: '获得新武器：匕首，攻击力：20' },
    { speakerId: 'system', text: `获得角色卡：${p.name}（临别赠礼）` },
    said(SEGMENTS.sisters(p.name)),
    said(SEGMENTS.happy(p.name)),
    said(SEGMENTS.farewell(p.name)),
    { speakerId: 'narration', text: `话音未落，${p.name} 瞬间消失了` },
    { speakerId: 'narration', text: '你的泪，拉了出来。' },
  ];

  return {
    id: `script-angel-${p.seq}`,
    title: `导航天使${CIRCLE[p.seq - 1]}的教学`,
    entryNodeId: `angel-${p.seq}-entry`,
    nodes: [
      {
        kind: 'dialogue',
        id: `angel-${p.seq}-entry`,
        // 旗标双写（评审⑤修法）：per-angel 旗锁本人触发（各关互不牵连），
        // 全局旗语义=「至少遇见一位」，主城残留羽毛的 requireFlag 靠它不失效
        onEnterEffects: [
          { kind: 'setFlag', key: `story:angel-met-${p.seq}`, value: true },
          { kind: 'setFlag', key: 'story:angels-met', value: `angel-${p.seq}` },
          { kind: 'grantWeapon', weaponId: 'weapon-dagger' },
          { kind: 'grantCard', cardId: `card-chr-angel-${p.seq}`, source: 'angel-farewell' },
          { kind: 'fx', request: { fx: 'sfx', sfxId: 'sfx-effect-2' } },
        ],
        lines: bodyLines,
        next: `angel-${p.seq}-vanish`,
      },
      {
        kind: 'ending',
        id: `angel-${p.seq}-vanish`,
        endingId: 'angel-farewell',
        closable: true,
        lines: [{ speakerId: 'system', text: `${p.name} 化作光点，飞向了地图的四个角落。` }],
      },
    ],
  };
}

/**
 * 四天使分布（STORY-5，坐标已对 areas.ts 逐格验证为原始网格 0 的可站地板）：
 * ①留主城 L1(8,6)（= 原版出生地 (1,0) 的重化网格）、②L4 星陨间奏 (7,4)、
 * ③L5 阶下回音 (7,3)、④L10 三阶圣所 (2,7)。
 */
export const ANGEL_PARAMS: readonly AngelParam[] = [
  { seq: 1, name: '导航天使①', levelId: 'level-sb-01', x: 8, y: 6, order: ORDER_A },
  { seq: 2, name: '导航天使②', levelId: 'level-sb-04', x: 7, y: 4, order: ORDER_A },
  { seq: 3, name: '导航天使③', levelId: 'level-lb-05', x: 7, y: 3, order: ORDER_B },
  { seq: 4, name: '导航天使④', levelId: 'level-lb-10', x: 2, y: 7, order: ORDER_B },
];

export const ANGEL_SCRIPTS: readonly StoryScriptDef[] = ANGEL_PARAMS.map(makeAngelScript);

/* ============================== 光羽脚本 ================================== */

/** 「光羽」拾取脚本工厂：谢幕原地留光羽 tile，拾取置 per-seq 羽毛旗（L12 彩蛋消费） */
function makeLightFeatherScript(p: AngelParam): StoryScriptDef {
  return {
    id: `script-angel-lightfeather-${p.seq}`,
    title: `${p.name}的光羽`,
    entryNodeId: `angel-lightfeather-${p.seq}-entry`,
    nodes: [
      {
        kind: 'dialogue',
        id: `angel-lightfeather-${p.seq}-entry`,
        onEnterEffects: [{ kind: 'setFlag', key: `story:feather-${p.seq}`, value: true }],
        lines: [
          {
            speakerId: 'narration',
            text: `${p.name} 消失的地方，留着一根微微发光的羽——「我们永远在这里等着你」，原来落在了这里。`,
          },
        ],
        next: `angel-lightfeather-${p.seq}-close`,
      },
      {
        kind: 'ending',
        id: `angel-lightfeather-${p.seq}-close`,
        endingId: `angel-lightfeather-${p.seq}`,
        closable: true,
        lines: [{ speakerId: 'system', text: '光羽化作星尘，轻轻落进了你的口袋。' }],
      },
    ],
  };
}

export const ANGEL_LIGHTFEATHER_SCRIPTS: readonly StoryScriptDef[] = ANGEL_PARAMS.map(makeLightFeatherScript);

/* ============================ 主城残留羽毛 ================================ */

/** 主城「残留的羽毛」tile 出处（Game.java:48-51 四姐妹出生地的世界坐标） */
export const HUB_FEATHER_PARAMS: readonly { readonly seq: 1 | 2 | 3 | 4; readonly x: number; readonly y: number }[] = [
  { seq: 1, x: 1, y: 0 }, // 重化网格 (8,6)：与天使①/光羽① 同格
  { seq: 2, x: -1, y: 0 }, // 重化网格 hub(6,6)：原始格值 4=箱子出生点（既有行为），
  // 箱移开后 tile 才可落格触发 —— 新坐标断言对本格豁免（评审⑨）
  { seq: 3, x: 0, y: 1 }, // 重化网格 (7,7)
  { seq: 4, x: 0, y: -1 }, // 重化网格 (7,5)
];

/** 主城「残留的羽毛」per-seq 拾取脚本（原版只把 alive 置 false，世界不留痕迹） */
export const ANGEL_HUB_FEATHER_SCRIPTS: readonly StoryScriptDef[] = HUB_FEATHER_PARAMS.map(
  (f): StoryScriptDef => ({
    id: `script-angel-feather-${f.seq}`,
    title: '残留的羽毛',
    entryNodeId: `angel-feather-${f.seq}-entry`,
    nodes: [
      {
        kind: 'dialogue',
        id: `angel-feather-${f.seq}-entry`,
        // 主城羽毛拾取同样置 per-seq 羽毛旗（评审⑤：光羽/主城羽毛拾取脚本统一语义）
        onEnterEffects: [{ kind: 'setFlag', key: `story:feather-${f.seq}`, value: true }],
        lines: [
          { speakerId: 'narration', text: '地上只剩一根发着微光的羽毛。' },
          {
            speakerId: 'narration',
            text: '你想起那句「我们永远在这里等着你」——她们没有说谎，只是以另一种方式等着。',
          },
        ],
        next: `angel-feather-${f.seq}-close`,
      },
      {
        kind: 'ending',
        id: `angel-feather-${f.seq}-close`,
        endingId: 'angel-feather',
        closable: true,
        lines: [{ speakerId: 'system', text: '羽毛化作星尘，轻轻落进了你的口袋。' }],
      },
    ],
  }),
);

/* ============================ 天使触发规则 ================================ */
/**
 * 触发锁（评审⑤修法）：
 *  - 天使 npc 规则 unlessFlag = per-angel 旗（story:angel-met-<seq>）：见过本人
 *    后她的规则永不复触发；四位各居一关（levelId 不同），互不牵连；
 *  - 光羽 tile requireFlag = per-angel 旗（谢幕原地留光羽）；
 *  - 主城残留羽毛 requireFlag = 全局旗 story:angels-met（「至少遇见一位」），
 *    坐标保持原版世界坐标（主城旧规则，集成层经 gridToWorld 映射）。
 * 规则表顺序即优先级：npc → 光羽 → 主城羽毛（同格时光羽先命中）。
 */

export const ANGEL_TRIGGER_RULES: readonly TriggerRule[] = [
  ...ANGEL_PARAMS.map((p): TriggerRule => ({
    id: `trigger-angel-${p.seq}`,
    scriptId: `script-angel-${p.seq}`,
    when: { kind: 'npc', x: p.x, y: p.y, radius: 1, levelId: p.levelId },
    unlessFlag: `story:angel-met-${p.seq}`,
  })),
  ...ANGEL_PARAMS.map((p): TriggerRule => ({
    id: `trigger-angel-${p.seq}-lightfeather`,
    scriptId: `script-angel-lightfeather-${p.seq}`,
    when: { kind: 'tile', x: p.x, y: p.y, levelId: p.levelId },
    requireFlag: `story:angel-met-${p.seq}`,
  })),
  ...HUB_FEATHER_PARAMS.map((f): TriggerRule => ({
    id: `trigger-angel-${f.seq}-feather`,
    scriptId: `script-angel-feather-${f.seq}`,
    when: { kind: 'tile', x: f.x, y: f.y },
    requireFlag: 'story:angels-met',
  })),
];
