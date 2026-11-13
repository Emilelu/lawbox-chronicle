/**
 * 四方向越界 —— 主地图之外的整个世界（KT5：前作合并只完成一半的补全）。
 * ---------------------------------------------------------------------------
 * 原版越界处理（Game.java，阈值实测 ±7，README 写 ±8 属 K14 文档失真）：
 *   - Game.java:121-126  y >  7 → 掉入时空裂缝 → EasterEgg.main（隐藏关）
 *   - Game.java:127-133  y < -7 → 光速坠落 → 血肉模糊 → System.exit
 *   - Game.java:134-138  x >  7 → 神秘法阵 → 传送 (-5,3)
 *   - Game.java:139-281  x < -7 → 巨幅 ASCII + "E  N  D" ×5 → System.exit
 *   - Game.java:282-284  |6|~|7| 缓冲带 → 警告「继续越界可能会发生无法预估的情况」
 * 新设计（事件表显式定义，无穿透，越界阈值统一 ±7）：
 *   - 北 = 隐藏关（hiddenGame.ts 完整剧本）；
 *   - 东 = 无尽回廊（程序生成关卡入口，生成后必经内置 BFS 求解器校验）；
 *   - 南 / 西 = 高难挑战层（原版即死/直接退出的内容反转为可挑战内容）；
 *   - 缓冲带 |6|~|7| 保留原版警示文案。
 * A3-1 接线：三个挑战层的「进入」分支经中转对话节点的 onEnterEffects 显式
 * 发射 {kind:'enterChallengeLayer', layerId}（解释器产出 → gameStore 挂账，
 * 结束ending 后无声返回主城的死内容自此接通）。R-2 起 store 侧把入层延迟到
 * 剧本收尾（closeStoryRuntime）：中转节点与收尾 ending 完整演出后才生成挑战
 * 层并 beginLevel 接管画面，生成失败（toast 提示）时玩家留在原地可重试，
 * ending 节点保留为显式图终点（结构校验需要），文案按「收尾后自动入层」
 * 口径书写。
 */

import type { ChallengeLayerId, StoryScriptDef } from '../../engine/story/interpreter';
import type { OutskirtsDir, TriggerRule } from '../../engine/story/triggers';

/* ============================== 说话者表 ================================== */

export const OUTSKIRT_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  'system': '【系统】',
  'narration': '旁白',
  'meta': '[META]',
  'npc-author': '作者',
});

/* ============================== 挑战层元数据 =============================== */

/** 挑战层关卡数据由 world 侧生成/提供，剧本侧只声明元数据与入口效果 */
export interface ChallengeLayerMeta {
  readonly layerId: ChallengeLayerId;
  readonly name: string;
  readonly subtitle: string;
  /** 数据出处（原版行为 → 反转说明，供规则手册导出） */
  readonly origin: string;
  /** 建议通关主线后再来（仅提示，不做硬门槛） */
  readonly recommendedAfterClear: boolean;
}

export const OUTSKIRT_CHALLENGE_LAYERS: Readonly<Record<ChallengeLayerId, ChallengeLayerMeta>> =
  Object.freeze({
    'south-abyss': {
      layerId: 'south-abyss',
      name: '深渊坠道',
      subtitle: '南侧挑战层 —— 坠落即入场，底层藏着星石矿脉',
      origin: 'Game.java:127-133 原为 y<-7 即死悬崖（摔死 + System.exit），反转为高难挑战层入口。',
      recommendedAfterClear: true,
    },
    'east-endless': {
      layerId: 'east-endless',
      name: '无尽回廊',
      subtitle: '东侧挑战层 —— 程序生成关卡，逐层 BFS 校验可解',
      origin: 'Game.java:134-137 原为 x>7 神秘法阵传送到 (-5,3)，升格为无尽回廊入口；退出时保留原版落点。',
      recommendedAfterClear: true,
    },
    'west-end-wall': {
      layerId: 'west-end-wall',
      name: 'E N D 之壁',
      subtitle: '西侧挑战层 —— 墙上的 E N D 不是结局，是关底',
      origin: 'Game.java:139-281 原为 x<-7 巨幅 ASCII + "E  N  D"×5 + System.exit，反转为高难挑战层入口。',
      recommendedAfterClear: true,
    },
  });

/* ============================== 缓冲带警示 ================================= */

/** Game.java:282-284 原版警示文案（保真） */
export const BUFFER_WARNING_LINES: readonly { readonly speakerId: string; readonly text: string }[] = [
  { speakerId: 'system', text: '警告：你正在试图越界！继续越界可能会发生无法预估的情况！' },
  { speakerId: 'system', text: '由于越界，现在显示的坐标不一定在地图范围内！' },
];

export const OUTSKIRT_BUFFER_SCRIPT: StoryScriptDef = {
  id: 'script-outskirt-buffer',
  title: '越界警示',
  entryNodeId: 'outskirt-buffer-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'outskirt-buffer-entry',
      fx: [{ fx: 'sfx', sfxId: 'sfx-effect-3' }],
      lines: BUFFER_WARNING_LINES,
      next: 'outskirt-buffer-close',
    },
    {
      kind: 'ending',
      id: 'outskirt-buffer-close',
      endingId: 'outskirt-buffer-warned',
      closable: true,
      lines: [
        { speakerId: 'narration', text: '脚下的大地变得半透明——再往前，就是地图的「外面」了。' },
      ],
    },
  ],
};

/* ============================== 北：时空裂缝 → 隐藏关 ====================== */

export const OUTSKIRT_NORTH_SCRIPT: StoryScriptDef = {
  id: 'script-outskirt-north',
  title: '时空裂缝',
  entryNodeId: 'outskirt-north-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'outskirt-north-entry',
      onEnterEffects: [{ kind: 'setFlag', key: 'outskirt:north-crack-seen', value: true }],
      // Game.java:122-124 用 for 循环把这句话打了 5 遍——保真为一句 + 演出注记
      lines: [
        { speakerId: 'system', text: '你掉入了时空裂缝！！！！！！！！' },
        { speakerId: 'narration', text: '（这句话原作打了整整五遍。天空像被撕开的纸，裂缝的另一头传来 BGM 骤停的死寂。）' },
        { speakerId: 'meta', text: '检测到未完成的世界：This game is abandoned. 是否进入？' },
      ],
      next: 'outskirt-north-choice',
    },
    {
      kind: 'choice',
      id: 'outskirt-north-choice',
      promptLines: [{ speakerId: 'narration', text: '裂缝在吸你进去。' }],
      choices: [
        { id: 'enter', label: '进入被遗弃的前作（隐藏关）', next: 'outskirt-north-jump' },
      ],
      defaultNext: 'outskirt-north-stay',
    },
    {
      kind: 'dialogue',
      id: 'outskirt-north-jump',
      lines: [{ speakerId: 'system', text: '你被 SOME UNKNOWN REASONS 传送走了。' }],
      next: 'outskirt-north-go',
    },
    {
      kind: 'ending',
      id: 'outskirt-north-go',
      endingId: 'outskirt-north-transit',
      closable: true,
      lines: [{ speakerId: 'meta', text: '（关闭此窗口后，隐藏关「EasterEgg」的剧本将自动开演。）' }],
    },
    {
      kind: 'dialogue',
      id: 'outskirt-north-stay',
      lines: [{ speakerId: 'narration', text: '你扒住裂缝边缘，退了回来。风从「外面」吹上来，带着旧版本的灰尘。' }],
      next: 'outskirt-north-back',
    },
    {
      kind: 'ending',
      id: 'outskirt-north-back',
      endingId: 'outskirt-north-retreat',
      closable: true,
      lines: [{ speakerId: 'system', text: '裂缝仍在原地等你。它有的是时间。' }],
    },
  ],
};

/* ============================== 南：深渊坠道 ============================== */

export const OUTSKIRT_SOUTH_SCRIPT: StoryScriptDef = {
  id: 'script-outskirt-south',
  title: '深渊坠道',
  entryNodeId: 'outskirt-south-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'outskirt-south-entry',
      fx: [
        { fx: 'screenShake', intensity: 0.8 },
        { fx: 'sfx', sfxId: 'sfx-effect-13' },
      ],
      lines: [
        { speakerId: 'narration', text: '你前行的时候，脚下突然一空——' },
        { speakerId: 'system', text: '你以光速往下掉落！' },
        { speakerId: 'narration', text: '风声在耳边烧起来。原作里，到这里就是「现场血肉模糊」——但这次，' },
        { speakerId: 'meta', text: '法则在你触底前的最后一刻接住了你：坠落被改写为入场券。' },
        { speakerId: 'narration', text: '欢迎来到挑战层「深渊坠道」。这里没有回头路，底层藏着星石矿脉。' },
      ],
      next: 'outskirt-south-choice',
    },
    {
      kind: 'choice',
      id: 'outskirt-south-choice',
      promptLines: [{ speakerId: 'narration', text: '坠落还在继续。' }],
      choices: [
        { id: 'accept', label: '接受挑战：进入「深渊坠道」（高难）', next: 'outskirt-south-transit' },
        { id: 'climb', label: '攀住岩壁，爬回缓冲带', next: 'outskirt-south-retreat' },
      ],
      defaultNext: 'outskirt-south-transit',
    },
    {
      // A3-1/R-2：进入效果在节点进入时发射（解释器产出 → gameStore 挂账），
      // 但 store 侧把它延迟到剧本收尾才入层 —— 本节点与下方收尾 ending 完整
      // 演出后，closeStoryRuntime 才执行 enterChallengeLayer（生成挑战层并
      // beginLevel）。生成失败（toast 提示）时玩家留在原地，再次坠落即可重试。
      kind: 'dialogue',
      id: 'outskirt-south-transit',
      onEnterEffects: [{ kind: 'enterChallengeLayer', layerId: 'south-abyss' }],
      lines: [
        { speakerId: 'narration', text: '坠道在你脚下继续向下延展——岩层一块块亮起，像是有人在深处点灯。' },
        { speakerId: 'meta', text: '（深渊坠道由世界实时生成并经内置求解器校验可解。收尾对白演完即自动入层；若生成中断，你会留在原地，再次坠落即可重试。）' },
      ],
      next: 'outskirt-south-enter',
    },
    {
      kind: 'ending',
      id: 'outskirt-south-enter',
      endingId: 'outskirt-south-enter',
      closable: true,
      lines: [{ speakerId: 'meta', text: '（关闭此窗口后，「深渊坠道」挑战层将自动生成并开启。若生成中断，你会留在原地——再次坠入裂缝即可重试。）' }],
    },
    {
      kind: 'ending',
      id: 'outskirt-south-retreat',
      endingId: 'outskirt-south-retreat',
      closable: true,
      lines: [{ speakerId: 'system', text: '你爬回了缓冲带。掌心全是血，但命是自己的。' }],
    },
  ],
};

/* ============================== 东：神秘法阵 → 无尽回廊 ==================== */

/** 原版落点：Game.java:136-137 x=-5, y=3 */
export const EAST_LANDING_POS = { x: -5, y: 3 } as const;

export const OUTSKIRT_EAST_SCRIPT: StoryScriptDef = {
  id: 'script-outskirt-east',
  title: '神秘法阵',
  entryNodeId: 'outskirt-east-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'outskirt-east-entry',
      fx: [{ fx: 'sfx', sfxId: 'sfx-effect-14' }],
      lines: [
        { speakerId: 'system', text: '你掉入了神秘法阵，传送到了地图的 (??,??)...无法获取...' },
        { speakerId: 'narration', text: '原作里，法阵会把你扔回 (-5,3)。但这次，法阵深处有一条越走越长的回廊在亮。' },
        { speakerId: 'meta', text: '无尽回廊：每层关卡由世界实时生成，生成后必经内置 BFS 求解器校验可解，并记录最短推数。' },
      ],
      next: 'outskirt-east-choice',
    },
    {
      kind: 'choice',
      id: 'outskirt-east-choice',
      promptLines: [{ speakerId: 'narration', text: '回廊的第 N+1 层在等你。' }],
      choices: [
        { id: 'enter', label: '深入「无尽回廊」（程序生成 · 高难）', next: 'outskirt-east-transit' },
        { id: 'leave', label: '让法阵送你回 (-5,3)', next: 'outskirt-east-leave' },
      ],
      defaultNext: 'outskirt-east-transit',
    },
    {
      // A3-1/R-2：进入效果在节点进入时发射（解释器产出 → gameStore 挂账），
      // 但 store 侧把它延迟到剧本收尾才入层 —— 本节点与下方收尾 ending 完整
      // 演出后，closeStoryRuntime 才执行 enterChallengeLayer（生成回廊层并
      // beginLevel）。生成失败（toast 提示）时玩家留在原地，再次触发即可重试。
      kind: 'dialogue',
      id: 'outskirt-east-transit',
      onEnterEffects: [{ kind: 'enterChallengeLayer', layerId: 'east-endless' }],
      lines: [
        { speakerId: 'narration', text: '法阵深处，回廊的砖石正一块块拼合——下一层亮起来了。' },
        { speakerId: 'meta', text: '（无尽回廊由世界实时生成并经内置求解器校验可解，通关后展示最短推数。收尾对白演完即自动入层；若生成中断，你会留在原地，再次触发法阵即可重试。）' },
      ],
      next: 'outskirt-east-enter',
    },
    {
      kind: 'ending',
      id: 'outskirt-east-enter',
      endingId: 'outskirt-east-enter',
      closable: true,
      lines: [{ speakerId: 'meta', text: '（关闭此窗口后，「无尽回廊」下一层将自动生成并开启。若生成中断，你会留在原地——再次触发法阵即可重试。）' }],
    },
    {
      kind: 'dialogue',
      id: 'outskirt-east-leave',
      // B3-1：兑现「让法阵送你回 (-5,3)」的承诺 —— 台词不再是空头支票，
      // 本节点进入即发射 teleport（世界坐标经 applyStoryEffects 的 worldToGrid
      // 落格）。落点网格 (2,9) 已在 areas.ts 开为可站地板（B3-1 同批），
      // 传送后玩家真实立于原版落点并可走回主城；EAST_LANDING_POS 由此接线，
      // 不再是只有测试引用的死常量。
      onEnterEffects: [{ kind: 'teleport', x: EAST_LANDING_POS.x, y: EAST_LANDING_POS.y }],
      lines: [
        { speakerId: 'system', text: '法阵运转——你被送回了地图的 (-5,3)。（原版落点，保真）' },
      ],
      next: 'outskirt-east-back',
    },
    {
      kind: 'ending',
      id: 'outskirt-east-back',
      endingId: 'outskirt-east-retreat',
      closable: true,
      lines: [{ speakerId: 'system', text: '你回到了熟悉的荒野。法阵的光在你身后熄灭。' }],
    },
  ],
};

/* ============================== 西：E N D 之壁 ============================ */

export const OUTSKIRT_WEST_SCRIPT: StoryScriptDef = {
  id: 'script-outskirt-west',
  title: 'E N D 之壁',
  entryNodeId: 'outskirt-west-entry',
  nodes: [
    {
      kind: 'dialogue',
      id: 'outskirt-west-entry',
      fx: [{ fx: 'screenShake', intensity: 0.5 }],
      lines: [
        { speakerId: 'narration', text: '你毫无征兆地失去了意识，当你再次醒来的时候……' },
        { speakerId: 'narration', text: '一面望不到边际的巨墙立在眼前。墙上反复浮现两个词：E N D、E N D、E N D。' },
        { speakerId: 'narration', text: '原作里，走到这里的人会被打印五遍 E N D，然后被强制退出游戏。' },
        { speakerId: 'meta', text: '但现在，墙的下方有一条裂缝——那是「E N D 之壁」挑战层的入口。墙上的 E N D 不是结局，是关底。' },
      ],
      next: 'outskirt-west-choice',
    },
    {
      kind: 'choice',
      id: 'outskirt-west-choice',
      promptLines: [{ speakerId: 'narration', text: '墙在等一个不肯认「END」的人。' }],
      choices: [
        { id: 'challenge', label: '挑战「E N D 之壁」（高难）', next: 'outskirt-west-transit' },
        { id: 'retreat', label: '后退，回到缓冲带', next: 'outskirt-west-retreat' },
      ],
      defaultNext: 'outskirt-west-transit',
    },
    {
      // A3-1/R-2：进入效果在节点进入时发射（解释器产出 → gameStore 挂账），
      // 但 store 侧把它延迟到剧本收尾才入层 —— 本节点与下方收尾 ending 完整
      // 演出后，closeStoryRuntime 才执行 enterChallengeLayer（生成挑战层并
      // beginLevel）。生成失败（toast 提示）时玩家留在原地，再次触墙即可重试。
      kind: 'dialogue',
      id: 'outskirt-west-transit',
      onEnterEffects: [{ kind: 'enterChallengeLayer', layerId: 'west-end-wall' }],
      lines: [
        { speakerId: 'narration', text: '墙下的裂缝缓缓拓宽，E N D 的字样沉入裂缝深处——关底在下面等你。' },
        { speakerId: 'meta', text: '（E N D 之壁由世界实时生成并经内置求解器校验可解。收尾对白演完即自动入层；若生成中断，你会留在原地，再次触墙即可重试。）' },
      ],
      next: 'outskirt-west-enter',
    },
    {
      kind: 'ending',
      id: 'outskirt-west-enter',
      endingId: 'outskirt-west-enter',
      closable: true,
      lines: [{ speakerId: 'meta', text: '（关闭此窗口后，「E N D 之壁」挑战层将自动生成并开启。若生成中断，你会留在原地——再次走向巨墙即可重试。）' }],
    },
    {
      kind: 'ending',
      id: 'outskirt-west-retreat',
      endingId: 'outskirt-west-retreat',
      closable: true,
      lines: [{ speakerId: 'system', text: '墙上的 E N D 在你身后轻轻闪烁，像一行没有删掉的旧代码。' }],
    },
  ],
};

/* ============================== 触发规则 ================================== */

const DIRS: readonly OutskirtsDir[] = ['north', 'south', 'east', 'west'];

const BUFFER_SCRIPT_BY_DIR: Readonly<Record<OutskirtsDir, string>> = Object.freeze({
  north: 'script-outskirt-buffer',
  south: 'script-outskirt-buffer',
  east: 'script-outskirt-buffer',
  west: 'script-outskirt-buffer',
});

const BEYOND_SCRIPT_BY_DIR: Readonly<Record<OutskirtsDir, string>> = Object.freeze({
  north: 'script-outskirt-north',
  south: 'script-outskirt-south',
  east: 'script-outskirt-east',
  west: 'script-outskirt-west',
});

/**
 * 越界规则表（顺序即优先级；y 轴方向在前，对齐原版判定顺序）。
 * 调用约定：store 在坐标变化时先经 classifyPosition + isOutskirtsTransition
 * 做边沿过滤，再交 queryTrigger —— 保证「继续往深处走」不会重复开演。
 */
export const OUTSKIRT_TRIGGER_RULES: readonly TriggerRule[] = [
  ...DIRS.map((dir): TriggerRule => ({
    id: `trigger-outskirt-buffer-${dir}`,
    scriptId: BUFFER_SCRIPT_BY_DIR[dir],
    when: { kind: 'outskirts', dir, zone: 'buffer' },
    once: true, // 警示每个方向只演一次（原版则每次越界都刷屏）
  })),
  ...DIRS.map((dir): TriggerRule => ({
    id: `trigger-outskirt-beyond-${dir}`,
    scriptId: BEYOND_SCRIPT_BY_DIR[dir],
    when: { kind: 'outskirts', dir, zone: 'beyond' },
    once: false, // 边沿触发（isOutskirtsTransition 过滤），可反复进入
  })),
];

/** 本模块全部剧本（集成期与 angels/authorPuzzle/bossActs/hiddenGame 一并注册） */
export const OUTSKIRT_SCRIPTS: readonly StoryScriptDef[] = [
  OUTSKIRT_BUFFER_SCRIPT,
  OUTSKIRT_NORTH_SCRIPT,
  OUTSKIRT_SOUTH_SCRIPT,
  OUTSKIRT_EAST_SCRIPT,
  OUTSKIRT_WEST_SCRIPT,
];
