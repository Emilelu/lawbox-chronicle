/**
 * achievements —— 成就正典 + 伪系统消息彩蛋注册表（纯数据，零依赖）。
 * ---------------------------------------------------------------------------
 * 【原作成就文案】逐字搬自 KichikuAdventure（出处逐条标注在 lore 字段）：
 *   - EasterEgg.java:195 「恭喜获得成就：赤手空拳打败BOSS的男人」
 *   - EasterEgg.java:202 「恭喜获得成就：用一根爷爷祖传的的拐杖打败BOSS的男人」
 *   - EasterEgg.java:208 「恭喜获得成就：用㊙hotel打败BOSS的男人」
 *   - Game.java:1854   「恭喜获得成就：用一根爷爷祖传的的拐杖打败 BOSS 的X人。（草」
 * 【伪系统消息】原作用 System.out.println 冒充的系统输出（[System] ... /
 *   [警告] ... / GAME OVER / E N D）与 SanBPushChest 的彩蛋句，全部收录为
 *   注册表条目，逐条带原仓库行号出处 —— META 终端（KT1/KT6）与图鉴页直接
 *   消费本表，不再散落字符串。
 *
 * 本文件只描述「什么时候达成」与「文案是什么」；解锁状态与持久化归
 * src/archive/logbook.ts（zustand persist 分片）所有。
 */

/* ============================== 成就快照（对接点） ========================= */

/**
 * 成就判定输入快照 —— 由 src/archive/logbook.ts 从全局 store 与自身计数
 * 组装；其他模块若有新的判定素材，扩充本接口并让 logbook 补充组装逻辑。
 * 所有字段必须可从既有状态推导，不引入任何新的跨模块写接口。
 */
export interface AchievementSnapshot {
  readonly bossDefeated: boolean;
  /**
   * 历次击败 BOSS 时装备的武器 id（一次击杀一个条目；徒手击杀记 null）。
   * 允许多次击杀武器不同——「徒手」「拐杖」「㊙hotel」三条原作成就分别断言
   * 列表中存在对应条目。
   */
  readonly bossKillWeapons: readonly (string | null)[];
  readonly levelsCleared: number;
  /** 3 星（≤par 步数）通关数 */
  readonly threeStarClears: number;
  readonly totalPulls: number;
  readonly fourStarPulls: number;
  /** 图鉴内不同卡牌数（上限 = 卡池条目数） */
  readonly distinctCardsOwned: number;
  readonly enemiesDefeated: number;
  readonly planeShiftsUsed: number;
  /** 推箱撞墙次数（致敬原 SanBPushChest hitCount） */
  readonly pushBlockedCount: number;
  /** 已触发/确认过的彩蛋与伪系统消息 id（见 LORE_EVENT_IDS） */
  readonly loreEventsSeen: readonly string[];
  readonly weaponsObtained: readonly string[];
}

export interface AchievementDef {
  readonly id: string;
  /** 成就名（原作成就逐字保留原文，含「（草」） */
  readonly title: string;
  readonly description: string;
  /** 文案/条件的原作出处（文件:行）；新作成就标注「新增」并注明衔接点 */
  readonly lore: string;
  /** true = 图鉴中隐藏，解锁前显示为「??？」 */
  readonly secret?: boolean;
  /** 谓词必须全函数（不抛错、不依赖快照外状态） */
  readonly test: (snapshot: AchievementSnapshot) => boolean;
}

/* ================================ 成就表 ================================== */

export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([
  {
    id: 'ach-eg-fist-boss',
    title: '赤手空拳打败BOSS的男人',
    description: '不装备任何武器击败影流之主。原作隐藏关的真结局路线。',
    lore: 'KichikuAdventure EasterEgg.java:195',
    secret: true,
    test: (s) => s.bossKillWeapons.some((w) => w === null),
  },
  {
    id: 'ach-eg-stick-boss',
    title: '用一根爷爷祖传的的拐杖打败BOSS的男人',
    description: '装备爷爷的拐杖（weapon-gfsStick）击败影流之主。',
    lore: 'KichikuAdventure EasterEgg.java:202 / Game.java:1854（原句多一个「（草」）',
    test: (s) => s.bossKillWeapons.some((w) => w === 'weapon-gfsStick'),
  },
  {
    id: 'ach-eg-mihotel-boss',
    title: '用㊙hotel打败BOSS的男人',
    description: '装备迷吼tiao（原作名㊙Hotel）击败影流之主。爆炸，也是一种审判。',
    lore: 'KichikuAdventure EasterEgg.java:208',
    test: (s) => s.bossKillWeapons.some((w) => w === 'weapon-mihotel'),
  },
  {
    id: 'ach-boss-slayer',
    title: '影流之主 灰飞烟灭了',
    description: '击败 BOSS。掉落的那封信，记得打开。',
    lore: 'KichikuAdventure Game.java:1844-1846',
    test: (s) => s.bossKillWeapons.length >= 1,
  },
  {
    id: 'ach-first-clear',
    title: '石板归位',
    description: '第一次把所有箱子推上旗位，完成一段关卡。',
    lore: '新增（衔接 SanBPushChest 的推箱通关流）',
    test: (s) => s.levelsCleared >= 1,
  },
  {
    id: 'ach-perfect-par',
    title: '一步不多，一步不少',
    description: '以 3 星评价（≤par 步数）完成任意关卡。',
    lore: '新增（对应 core/formula.ts starRating 的 par 语义）',
    test: (s) => s.threeStarClears >= 1,
  },
  {
    id: 'ach-hardhead',
    title: '撞墙二十次，穿墙术(?)已开启',
    description: '累计撞墙 20 次。原作的「穿墙术」是一句 console.log；新作的相位穿行是真的。',
    lore: '新增（原出处 SanBPushChest service.js:53-55，原空壳彩蛋，S17）',
    test: (s) => s.pushBlockedCount >= 20,
  },
  {
    id: 'ach-plane-walker',
    title: '表里世界的访客',
    description: '首次切换阴阳位面。世界的里侧向你敞开。',
    lore: '新增（升格自 SanBPushChest README:26「可由用户控制的障碍物定时变换」）',
    test: (s) => s.planeShiftsUsed >= 1,
  },
  {
    id: 'ach-kirakira-first4',
    title: '★KiraKira~★DokiDoki~★',
    description: '第一次抽出 4★。',
    lore: 'BandoriLotteryEmulator Lottery.java:26（原宣传语）',
    test: (s) => s.fourStarPulls >= 1,
  },
  {
    id: 'ach-collector-half',
    title: '星愿收藏家',
    description: '图鉴收录 7 张不同卡牌。',
    lore: '新增（卡池共 14 条，见 data/gacha.ts）',
    test: (s) => s.distinctCardsOwned >= 7,
  },
  {
    id: 'ach-collector-full',
    title: '卡池于是有了形状',
    description: '图鉴收录全部 14 张卡牌。星石从此不再是无限的。',
    lore: '新增（对照 Lottery.java:25「当前的星石数：∞」）',
    test: (s) => s.distinctCardsOwned >= 14,
  },
  {
    id: 'ach-cheat-setname',
    title: 'Module "SetName" is Skipped.',
    description: '在 META 终端输入 /kill--SetName，跳过了不该跳过的东西。',
    lore: 'KichikuAdventure EasterEgg.java:83-90（开 幕 雷 击）',
    secret: true,
    test: (s) => s.loreEventsSeen.includes('cheat-kill--setname'),
  },
  {
    id: 'ach-baba',
    title: '对着天空大喊——BABA',
    description: '在宝箱前喊出 DNA 里刻着的最后四个元素。',
    lore: 'KichikuAdventure EasterEgg.java:115-171',
    secret: true,
    test: (s) => s.loreEventsSeen.includes('cheat-baba'),
  },
]);

/**
 * 纯函数：给定快照与已解锁集合，返回「本次新解锁」的成就 id 列表。
 * 谓词全部为全函数，异常即数据 bug，不在此处吞掉（K11 教训）。
 */
export function evaluateAchievements(
  snapshot: AchievementSnapshot,
  unlockedIds: ReadonlySet<string>,
): readonly string[] {
  const fresh: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (unlockedIds.has(def.id)) continue;
    if (def.test(snapshot)) fresh.push(def.id);
  }
  return fresh;
}

/* ========================== 伪系统消息彩蛋注册表 =========================== */

export type LoreGame = 'kichiku' | 'sanb' | 'bandori';

export interface PseudoSystemMessage {
  readonly id: string;
  readonly game: LoreGame;
  /** 原文（含 {var} 占位符的为模板，经 formatSystemMessage 渲染） */
  readonly text: string;
  /** 原仓库出处（文件:行） */
  readonly source: string;
  /** 补充说明（如 base64 的解码结果） */
  readonly note?: string;
}

/** 原作「伪系统消息」与彩蛋句正典 —— 逐字保留，含错字与宽空格 */
export const PSEUDO_SYSTEM_MESSAGES: readonly PseudoSystemMessage[] = Object.freeze([
  {
    id: 'sys-abandoned',
    game: 'kichiku',
    text: 'This game is abandoned. But you was teleported to here by SOME UNKNOWN REASONS.',
    source: 'KichikuAdventure EasterEgg.java:75',
  },
  {
    id: 'sys-setname-skipped',
    game: 'kichiku',
    text: "Module 'SetName' is Skipped.",
    source: 'KichikuAdventure EasterEgg.java:89',
  },
  {
    id: 'sys-default-name',
    game: 'kichiku',
    text: '[警告] 由于玩家名未定义，因此将使用缺省值：狗蛋',
    source: 'KichikuAdventure EasterEgg.java:90',
  },
  {
    id: 'sys-caixukun-killed',
    game: 'kichiku',
    text: '蔡徐坤 被 System 杀死了！',
    source: 'KichikuAdventure EasterEgg.java:106',
  },
  {
    id: 'sys-secret-note',
    game: 'kichiku',
    text: '勇敢的冒险者啊，若想抵达胜利，牢记以下秘籍：↓↓↑↑→←→←ABAB(Reversed)',
    source: 'KichikuAdventure EasterEgg.java:115',
  },
  {
    id: 'sys-boss-laugh',
    game: 'kichiku',
    text: '影流之主：哈哈哈哈哈哈哈哈哈哈哈哈哈，你以为你能打败我？？做梦！',
    source: 'KichikuAdventure EasterEgg.java:186',
  },
  {
    id: 'sys-weapon-cleared',
    game: 'kichiku',
    text: '[System] weaponList has been cleared.',
    source: 'KichikuAdventure EasterEgg.java:184（背包被清空却谎称结算完毕，K13）',
  },
  {
    id: 'sys-god-message',
    game: 'kichiku',
    text: 'VXNlJTIwc29tZSUyMGluc3RydWN0aW9ucyUyMHRvJTIwc2F2ZSUyMHlvdS4=/fromgod',
    source: 'KichikuAdventure EasterEgg.java:188',
    note: 'URL-safe base64，解码为「Use some instructions to save you.」',
  },
  {
    id: 'sys-exception',
    game: 'kichiku',
    text: '[System] An exception has been occurred.',
    source: 'KichikuAdventure EasterEgg.java:275',
  },
  {
    id: 'sys-restoring',
    game: 'kichiku',
    text: '[System] Restoring default config...',
    source: 'KichikuAdventure EasterEgg.java:276',
  },
  {
    id: 'sys-detected-input',
    game: 'kichiku',
    text: '[System] Detected input content: {input} , continue...',
    source: 'KichikuAdventure EasterEgg.java:277-278',
  },
  {
    id: 'sys-nothing-happened',
    game: 'kichiku',
    text: '好像没啥发生(*^_^*)',
    source: 'KichikuAdventure EasterEgg.java:271 / Game.java:1867',
  },
  {
    id: 'sys-end',
    game: 'kichiku',
    text: 'E  N  D',
    source: 'KichikuAdventure EasterEgg.java:280（胜利之后仍被乱码杀死——新作反转为真结局）',
  },
  {
    id: 'sys-attack-set',
    game: 'kichiku',
    text: "[System] Monster 影流之主\u2019s attack has been set to 0.",
    source: 'KichikuAdventure Game.java（作者谜题奖励，story.ts 已引用）',
  },
  {
    id: 'sanb-hardhead-20',
    game: 'sanb',
    text: '宁竟然如此地锲而不舍，那👴⑨⑧这功能开了⑧',
    source: 'SanBPushChest libs/js/easterEgg.js:19（连点 20 次解锁角色切换）',
  },
  {
    id: 'sanb-level-suspicion',
    game: 'sanb',
    text: 'Level {level} ...? {count}',
    source: 'SanBPushChest libs/js/easterEgg.js:13-14（连点超过 10 次的疑问句）',
  },
  {
    id: 'sanb-cross-wall',
    game: 'sanb',
    text: '穿墙术已开启',
    source: 'SanBPushChest libs/js/service.js:55（console.log 空壳彩蛋，S17/ST1）',
  },
  {
    id: 'bandori-stones-infinity',
    game: 'bandori',
    text: '当前的星石数：∞',
    source: 'BandoriLotteryEmulator Lottery.java:25（BT6：新作改为真实星石经济）',
  },
  {
    id: 'bandori-kirakira',
    game: 'bandori',
    text: '要来几回★KiraKira~★DokiDoki~★的十连抽呢！？',
    source: 'BandoriLotteryEmulator Lottery.java:26',
  },
]);

/* ============================ 原作作弊码（META 终端用） ==================== */

export interface CheatCodeEgg {
  /** 原样输入的作弊码（大小写/全半角敏感，照抄原作） */
  readonly code: string;
  readonly source: string;
  readonly effect: string;
}

export const CHEAT_CODE_EGGS: readonly CheatCodeEgg[] = Object.freeze([
  {
    code: '/kill--SetName',
    source: 'EasterEgg.java:83',
    effect: '跳过建号（开 幕 雷 击）；对应 lore 事件 id：cheat-kill--setname',
  },
  {
    code: '/kill--Caixukun',
    source: 'EasterEgg.java:104',
    effect: '系统直接击杀蔡徐坤，掉落爷爷的拐杖',
  },
  {
    code: '/give--@p--赤手空拳',
    source: 'EasterEgg.java:191',
    effect: '终局真结局分支之一（拒绝剧本）',
  },
  {
    code: '/give--@p--爷爷的拐杖',
    source: 'EasterEgg.java:197',
    effect: '终局真结局分支之二',
  },
  {
    code: '/give--@p--㊙Hotel',
    source: 'EasterEgg.java:204',
    effect: '终局真结局分支之三',
  },
  {
    code: 'BABA',
    source: 'EasterEgg.java:170',
    effect: '对天空大喊进入隐藏关；对应 lore 事件 id：cheat-baba',
  },
]);

/* ================================ 渲染与校验 ============================== */

/**
 * 渲染伪系统消息模板：把 {var} 占位符替换为 vars[var]。
 * 未知 id / 缺少占位符变量直接抛错 —— 注册表数据坏了就该在调用点炸出来，
 * 不做静默兜底（K11 教训）。
 */
export function formatSystemMessage(id: string, vars: Readonly<Record<string, string>> = {}): string {
  const entry = PSEUDO_SYSTEM_MESSAGES.find((m) => m.id === id);
  if (entry === undefined) throw new RangeError(`formatSystemMessage: 未知伪系统消息 id「${id}」`);
  return entry.text.replace(/\{(\w+)\}/g, (_whole, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new RangeError(`formatSystemMessage: 「${id}」缺少变量 ${key}`);
    return value;
  });
}

/** lore 事件 id 全集：伪系统消息 + 作弊码触发标记（logbook.recordLoreEvent 校验用） */
export const LORE_EVENT_IDS: readonly string[] = Object.freeze([
  ...PSEUDO_SYSTEM_MESSAGES.map((m) => m.id),
  ...CHEAT_CODE_EGGS.flatMap((c) =>
    c.code === '/kill--SetName' ? ['cheat-kill--setname'] : c.code === 'BABA' ? ['cheat-baba'] : [],
  ),
]);

export function isLoreEventId(id: string): boolean {
  return LORE_EVENT_IDS.includes(id);
}
