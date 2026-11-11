/**
 * 作弊 / 终端命令表 —— 纯数据，唯一数据源。
 * ---------------------------------------------------------------------------
 * 三入口（键盘热键 / 面板点击 / META 终端）共用同一张表，谁都不许私开后门：
 *   - S9 根治：热键不再自带解锁判断，一律经 CheatRegistry 的 enabled() 谓词。
 *   - S10 根治：选关类作弊的解锁条件写成显式谓词数据「到达第 2 关」，
 *     与 UI 上的解锁提示同源，不再出现「热键能跳、选关不能跳」的分裂。
 * 本文件只放「声明」（id / 名称 / 入口 / 热键 / 解锁条件 / 用法），效果实现
 * 全部在 src/input/cheatRegistry.ts —— 数据与行为分离，本文件零依赖可单测。
 */

/** 作弊的三个触发入口（S9：三入口必须过同一道门） */
export type CheatEntrypoint = 'keyboard' | 'click' | 'terminal';

/**
 * 解锁条件（纯数据描述，registry 解释执行）。
 * 故意不放函数：数据层保持零依赖、可被 zod/单测直接断言。
 */
export type CheatUnlockCondition =
  | { readonly kind: 'always' }
  /** settings.cheatsEnabled === true（设置面板作弊开关 / 20 连点彩蛋点亮） */
  | { readonly kind: 'cheats-enabled' }
  /** S10 显式谓词：到达指定关卡（store 内 reached:<levelId> 旗标或正在进行） */
  | { readonly kind: 'reached-level'; readonly levelId: string }
  /** 通关全部主线关卡（META 终端解锁条件，真结局入口） */
  | { readonly kind: 'game-cleared' };

export interface CheatCommandDef {
  readonly id: string;
  /** 面板/帮助里的展示名 */
  readonly name: string;
  readonly description: string;
  /** cheat = 作弊面板条目；terminal = META 终端剧本指令 */
  readonly category: 'cheat' | 'terminal';
  /** 允许触发该条目的入口集合（之外的入口一律拒绝） */
  readonly entrypoints: readonly CheatEntrypoint[];
  /** 键盘入口绑定的 e.code（空串 = 无热键）。一律 e.code，禁止 e.keyCode 字面量 */
  readonly hotkey?: string;
  /** 依次全部满足才可执行 */
  readonly requires: readonly CheatUnlockCondition[];
  /** 终端用法示例（category=terminal 时必填） */
  readonly usage?: string;
}

/** 连点彩蛋阈值（原作 easterEgg.js:16 的 count == 20） */
export const EGG_TAP_THRESHOLD = 20;

/**
 * 连点 20 次彩蛋文案（原作 easterEgg.js:20 原句保真）。
 * 触发效果：点亮 settings.cheatsEnabled —— 即原作「这功能开了」的现代等价物。
 */
export const EGG_MESSAGE = '宁竟然如此地锲而不舍，那👴⑨⑧这功能开了⑧';

/** 连点超过 10 次时的进度致敬（原作 easterEgg.js:14-15 'Level N ...? count'） */
export const eggProgressMessage = (levelIndex: number, count: number): string =>
  `第 ${levelIndex + 1} 关 ...? ${count}`;

/** /give--@p-- 赤手空拳：放下武器的伪武器 id（原作 EasterEgg.java:73 的初始状态） */
export const BARE_HANDS_ID = 'bare-hands';

/** /kill-- 的剧本目标：跳过命名（原作 EasterEgg.java:83 的开幕雷击钥匙） */
export const KILL_TARGET_SETNAME = 'SetName';

/**
 * 原作 Java 类名 → 敌人 id 别名（EasterEgg.java:104 玩家实际输入 /kill--Caixukun）。
 * 目标解析顺序：别名 → 敌人 id → 敌人名。
 */
export const TERMINAL_KILL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  Caixukun: 'enemy-caixukun',
  DYGG: 'enemy-dygg',
  guolaoShi: 'enemy-guolaoshi',
  Boss: 'enemy-ylzz',
});

/** /give-- 的武器别名 → 武器 id（EasterEgg.java:204 的 ㊙Hotel 即 迷吼tiao） */
export const TERMINAL_GIVE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  '赤手空拳': BARE_HANDS_ID,
  '㊙Hotel': 'weapon-mihotel',
});

/** 星石补给量（与开局赠礼一致，够一次十连找零） */
export const CHEAT_GRANT_STAR_STONES = 1600;

export const CHEAT_COMMANDS: readonly CheatCommandDef[] = [
  {
    id: 'cheat-level-next',
    name: '选关 · 下一关',
    description: '直接开始下一关（S10：需已到达第 2 关）',
    category: 'cheat',
    entrypoints: ['keyboard', 'click'],
    hotkey: 'BracketRight',
    requires: [{ kind: 'cheats-enabled' }, { kind: 'reached-level', levelId: 'level-sb-02' }],
  },
  {
    id: 'cheat-level-prev',
    name: '选关 · 上一关',
    description: '回到上一关重新开始',
    category: 'cheat',
    entrypoints: ['keyboard', 'click'],
    hotkey: 'BracketLeft',
    requires: [{ kind: 'cheats-enabled' }],
  },
  {
    id: 'cheat-remove-chest',
    name: '箱消',
    description: '随机消除场上一个箱子（原作 K 键 cheat2）',
    category: 'cheat',
    entrypoints: ['keyboard', 'click'],
    hotkey: 'KeyK',
    requires: [{ kind: 'cheats-enabled' }],
  },
  {
    id: 'cheat-skin-next',
    name: '皮肤轮换',
    description: '轮换冒险者皮肤；连点 20 次触发彩蛋',
    category: 'cheat',
    entrypoints: ['keyboard', 'click'],
    hotkey: 'KeyR',
    requires: [{ kind: 'always' }],
  },
  {
    id: 'cheat-wall-shuffle',
    name: '墙皮重掷',
    description: '按需重掷一次阴面 14 张墙皮（S18：无定时器）',
    category: 'cheat',
    entrypoints: ['keyboard', 'click'],
    // KeyV 让位给「第一/第三人称视角切换」（useKeyActions KeyBinding kind:'view'），
    // 墙皮重掷改绑 KeyG（KeyG/KeyT 全仓无其他占用，HOTKEY_CHEATS 由本表派生）
    hotkey: 'KeyG',
    requires: [{ kind: 'cheats-enabled' }],
  },
  {
    id: 'cheat-full-heal',
    name: '回满 HP',
    description: '生命值回满',
    category: 'cheat',
    entrypoints: ['click', 'terminal'],
    requires: [{ kind: 'cheats-enabled' }],
  },
  {
    id: 'cheat-grant-stones',
    name: '星石补给',
    description: `星石 +${CHEAT_GRANT_STAR_STONES}`,
    category: 'cheat',
    entrypoints: ['click', 'terminal'],
    requires: [{ kind: 'cheats-enabled' }],
  },
  {
    id: 'term-kill',
    name: '/kill--',
    description: '剧本处刑：SetName 跳过命名，或按 id / 名字 / 别名击杀敌人',
    category: 'terminal',
    entrypoints: ['terminal'],
    requires: [{ kind: 'game-cleared' }],
    usage: '/kill--SetName',
  },
  {
    id: 'term-give',
    name: '/give--@p--',
    description: '按名字向 @p 发放武器（赤手空拳 = 放下武器）',
    category: 'terminal',
    entrypoints: ['terminal'],
    requires: [{ kind: 'game-cleared' }],
    usage: '/give--@p--爷爷的拐杖',
  },
  {
    id: 'term-baba',
    name: 'BABA',
    description: '对着天空大喊，唤醒主角光环（一次性）',
    category: 'terminal',
    entrypoints: ['terminal'],
    requires: [{ kind: 'game-cleared' }],
    usage: 'BABA',
  },
];
