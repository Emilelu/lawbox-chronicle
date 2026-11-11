/**
 * 剧情事件表 ——【archive · 骨架期旧表，STORY-5 起不再参与运行时触发】。
 * ---------------------------------------------------------------------------
 * 本表是骨架期的剧情数据源；story-weaver 集成后，运行时触发一律走
 * src/data/storyScripts.ts 的 ALL_TRIGGER_RULES + ALL_SCRIPTS（STORY-5 起
 * 触发按 levelId 分关求值，坐标语义见 triggers.ts 的 positionalRuleLevelId）。
 * 旧表保留原因：core/schema.ts 的数据表交叉校验仍以 storyEvents 为输入分片
 * （data/index.ts 装配），且对白文案是 Game.java printDialogue 的第一手搬运
 * 存档（Game.java:475-503 作者问答、Game.java:539-556 导航天使①教学）——
 * 表内 pos 坐标是原版主地图语义，不代表运行时触发位置。
 */

import type { StoryEventDef } from '../core/types';

export const SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  'npc-angel-1': '导航天使①',
  'npc-angel-2': '导航天使②',
  'npc-angel-3': '导航天使③',
  'npc-angel-4': '导航天使④',
  'npc-author': '作者',
  'system': '【系统】',
});

export const STORY_EVENTS: readonly StoryEventDef[] = [
  {
    id: 'ev-angel-tutorial',
    area: 'main',
    title: '四位导航天使的告别',
    trigger: 'npc',
    pos: { x: 1, y: 0 },
    lines: [
      { speakerId: 'system', text: '你遇到了一个 NPC，它是 导航天使①' },
      { speakerId: 'npc-angel-1', text: '你就是新来的冒险者？告诉你一点东西，这个游戏地图的范围是 x,y=±5' },
      { speakerId: 'npc-angel-1', text: '同时，请自行脑补地图，本游戏难易度从小到大分别是第一、四、三、二象限！请好好探索每一个坐标！说不定会有什么神奇的事情发生呢...' },
      { speakerId: 'npc-angel-1', text: '一步登天的后果只有死路一条' },
      { speakerId: 'npc-angel-1', text: '听我一句劝，你最好不要跑出地图范围，否则到时候会很麻烦的~' },
      { speakerId: 'npc-angel-1', text: '总之，先收下这些吧！' },
      { speakerId: 'system', text: '获得新武器：匕首，攻击力：20' },
      { speakerId: 'npc-angel-1', text: '另外告诉你，我在地图上还有三个好姐妹，但是这个该死的作者设定了，你遇到我们当中其中一个后，剩下的都会瞬间去世。' },
      { speakerId: 'npc-angel-1', text: '虽然遇到你的时间只有几秒不到，但是我真的很开心！' },
      { speakerId: 'npc-angel-1', text: '我们永远在这里等着你，后会有期！' },
      { speakerId: 'system', text: '话音未落，导航天使① 瞬间消失了' },
    ],
    effects: [{ kind: 'grantWeapon', weaponId: 'weapon-dagger' }],
  },
  {
    id: 'ev-author-quiz',
    area: 'main',
    title: '作者与三题谜',
    trigger: 'npc',
    pos: { x: -2, y: 4 },
    relatedEnemyIds: ['enemy-caixukun', 'enemy-guolaoshi', 'enemy-dygg', 'enemy-ylzz'],
    lines: [
      { speakerId: 'npc-author', text: '哦吼！没想到你竟然遇到我了！不知道你是乱走还是认真探索了每一个坐标呢。' },
      { speakerId: 'npc-author', text: '既然你遇到了我，说明你离通关已经不远了。顺便说一下，假如你没有遇到我，你是永远都无法通关的！' },
      { speakerId: 'npc-author', text: '截止目前，你已经打败了 3/4 的怪物！恭喜你！' },
      { speakerId: 'npc-author', text: '听好了！——已知 x-y=(D-1)-z，求 x,y,z。（提示：有两组答案，回答出其中一组即可。）' },
      { speakerId: 'npc-author', text: '什么！你竟然答对了！不过应该是蒙的或者百度来的吧 :)' },
      { speakerId: 'npc-author', text: '其实我也完全不懂这题是什么鬼，这题是出自....禁止事项' },
      { speakerId: 'npc-author', text: '我是一个诚信的人，“钥匙”已经给你了，你也付出了代价。不过问题不大，快去打 BOSS 吧！' },
      { speakerId: 'system', text: '[System] Monster 影流之主\u2019s attack has been set to 0.' },
      { speakerId: 'npc-author', text: '等等！形式上还是给你一个好东西吧，这是我祖传的武器，希望对你有用23333~' },
      { speakerId: 'system', text: '获得新武器：爷爷的拐杖，攻击力：233' },
      { speakerId: 'npc-author', text: '不多说了，拜拜~ 有缘再会 :)' },
    ],
    effects: [
      { kind: 'setEnemyAttack', enemyId: 'enemy-ylzz', value: 0 },
      { kind: 'grantWeapon', weaponId: 'weapon-gfsStick' },
    ],
  },
  {
    id: 'ev-battle-tip-block',
    area: 'main',
    title: '关于“格挡”的真相',
    trigger: 'battle-end',
    relatedEnemyIds: ['enemy-caixukun'],
    lines: [
      { speakerId: 'system', text: '小贴士：本游戏的“格挡”与其字面意思略有差异——在新法则之下，格挡即减免：伤害下限为 1，防御不再造成任何“回血”。' },
    ],
    effects: [],
  },
];
