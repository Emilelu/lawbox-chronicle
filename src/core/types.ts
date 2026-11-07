/**
 * 法则箱庭异闻录 —— 核心类型契约
 * ---------------------------------------------------------------------------
 * 本文件是全项目唯一的共享类型源。所有模块（engine / data / store / view /
 * input）只允许 import 这里的类型，不得各自重新声明同名概念。
 *
 * 架构原则（对应仓库三大老项目的 bug 根源）：
 *  - 单一真相源：动态实体只存在于 entities 数组；网格地形（墙/终点）只存在于
 *    grid。任何「实体→占位」视图一律由 selector 现算，禁止手工维护第二份地图。
 *  - 纯函数：engine 层所有函数形如 (state, action) => newState，禁副作用。
 *  - 跨模块只传字符串 id，集成期由 core/schema.ts 的 zod 校验一致性。
 */

/* ============================= 基础几何与方向 ============================= */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** 语义方向（输入层归一化的产物，绝无 keyCode/字符字面量） */
export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIR_VECTORS: Readonly<Record<Dir, Vec2>> = Object.freeze({
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
});

/**
 * 斜向方向（「斜向推挤」法则专用；正交 Dir 之外的四个对角）。
 * 唯一定义在 core（谜题/输入/数据都只允许 import 这里），
 * engine/puzzle/grid.ts 对其再导出以兼容历史 import 点。
 */
export type DiagDir = 'upleft' | 'upright' | 'downleft' | 'downright';

export const DIAG_VECTORS: Readonly<Record<DiagDir, Vec2>> = Object.freeze({
  upleft: { x: -1, y: -1 },
  upright: { x: 1, y: -1 },
  downleft: { x: -1, y: 1 },
  downright: { x: 1, y: 1 },
});

/* ============================= 网格地形与实体 ============================= */

/**
 * 地形格值（静态层，关卡数据即此格式）。
 * 数字含义沿用 SanBPushChest mapGenerator.js 的图例，保证老数据零翻译成本：
 *   0 = 地板  1 = 障碍(墙)  2 = 玩家出生点（导入时转为实体，grid 中归 0）
 *   3 = 目标旗 4 = 箱子出生点（导入时转为实体，grid 中归 0）
 * 集成期扩图例（布阵推挤战的地形武器）：
 *   5 = 尖刺格（可通行地形；战斗布阵期推挤入尖刺按比例扣血，see engine/combat/shove.ts）
 * 敌人出生点不走图例：敌人需要与旗位等静态地形共存（如压在旗上的箱落目标），
 * 由 Level3D.enemySpawns 数据扩展声明（engine/puzzle/grid.ts 导入为实体）。
 */
export type TerrainCell = 0 | 1 | 2 | 3 | 4 | 5;

/** 尖刺格图例值（TerrainCell 5；战斗侧 HazardKind 'spike' 的数据来源） */
export const SPIKE_CELL = 5 as const;

export type Grid = readonly (readonly TerrainCell[])[];

/** 动态实体（单一真相源：位置只活在这里） */
export interface GridEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly x: number;
  readonly y: number;
  /** 推挤用：质量。0 = 不可被推动（immovable） */
  readonly mass: number;
  /** 是否可被推（箱子 true；玩家/建筑 false） */
  readonly pushable: boolean;
  /** combat 模块的免疫标记（免疫推挤，如重力法则生效的对象） */
  readonly shoveImmune?: boolean;
}

export type EntityKind = 'player' | 'chest' | 'npc' | 'enemy' | 'altar' | 'prop';

/* ============================= 共享推挤原语的结果 ========================== */

/** gridMove.resolvePush 的结果（puzzle 与 combat 引擎共用的契约） */
export type PushResult =
  | { readonly kind: 'blocked'; readonly reason: BlockReason }
  | { readonly kind: 'move'; readonly from: Vec2; readonly to: Vec2; readonly entities: readonly GridEntity[] }
  | {
      readonly kind: 'push';
      readonly from: Vec2;
      readonly to: Vec2;
      readonly moved: readonly GridEntity[];
      readonly entities: readonly GridEntity[];
    }
  | {
      readonly kind: 'chain';
      readonly moved: readonly GridEntity[];
      readonly entities: readonly GridEntity[];
    }
  | {
      readonly kind: 'fall';
      readonly fell: readonly GridEntity[];
      readonly moved: readonly GridEntity[];
      readonly entities: readonly GridEntity[];
    };

export type BlockReason = 'no-origin' | 'out-of-bounds' | 'wall' | 'immovable' | 'chain-limit';

export interface PushRules {
  /** 最长连锁推（防 O(∞) 与死角循环） */
  readonly maxChain: number;
  /** 被推实体越出地图边界时是否坠落（combat 推挤斩杀；puzzle 关卡通常 false） */
  readonly fallOffEdge: boolean;
}

/* ============================= 法则系统（lawRegistry 消费） ================= */

/** 法则生效后的世界规则集合（纯数据，可被 patch 级联修改） */
export interface RuleSet {
  readonly pushRange: number;
  readonly chestMass: number;
  readonly playerAttackMul: number;
  readonly enemyAttackMul: number;
  readonly moveCost: number;
  readonly fallFatal: boolean;
  readonly planeShiftEnabled: boolean;
  readonly secondChance: boolean;
  /* ---- 谜题侧扩展字段（集成期自 engine/puzzle/rules.ts 上提；patch 见
     lawRegistry 的 mirror-pull/diagonal-push/... 组，谜题引擎消费） ---- */
  /** 镜像拉箱：允许「后退拉箱」（玩家后退一格，箱子跟进到玩家原格） */
  readonly pullEnabled: boolean;
  /** 斜向推挤：允许沿对角线推箱（玩家进箱原格） */
  readonly diagonalPushEnabled: boolean;
  /** 箱可推离：允许把已就位（旗格上）的箱子推落基座落差 */
  readonly chestOffGoalEnabled: boolean;
  /** 相位穿行：解锁穿行（消耗充能穿过一格障碍） */
  readonly phaseWalkEnabled: boolean;
  /** 每段开局自带的穿行充能数 */
  readonly phaseWalkCharges: number;
  /** 箱落引爆：箱落时可引爆的次数（0 = 未解锁） */
  readonly detonationCharges: number;
  /** 击退格数：战斗布阵推挤的击退距离（combat 侧应用点） */
  readonly knockbackCells: number;
  /** 位面之眼：任意位置切位面（否则须站在位面锚点） */
  readonly planeEyeEnabled: boolean;
}

/* ============================= 关卡 / 段位 ================================ */

export interface LevelDef {
  readonly id: string;
  readonly area: AreaId;
  readonly name: string;
  readonly subtitle: string;
  /** 静态地形（0/1/3 + 出生点 2/4，导入实体后出生点格视为地板） */
  readonly grid: readonly (readonly TerrainCell[])[];
  /** 三星标准步数：≤par2→3星，≤par1→2星，否则1星 */
  readonly parSteps: readonly [number, number];
  readonly reward: { readonly starStones: number; readonly lawCardId?: string };
}

export type AreaId = 'main' | 'domain-1' | 'domain-2' | 'domain-3';

/* ============================= 战斗 ======================================= */

export interface EnemyDef {
  readonly id: string;
  readonly name: string;
  readonly maxHp: number;
  readonly attack: number;
  readonly defense: number;
  /** 原作地图坐标（Game.java 生成时的 atX/atY，仅作剧情引用） */
  readonly originPos: Vec2;
  readonly boss: boolean;
  readonly dropWeaponId?: string;
}

export interface WeaponDef {
  readonly id: string;
  readonly name: string;
  readonly attack: number;
  readonly description: string;
  readonly source: 'angel-gift' | 'monster-drop' | 'story-reward';
  /** 由哪只敌人掉落（source=monster-drop 时必填，schema 校验） */
  readonly droppedBy?: string;
}

export type CombatPhase = 'formation' | 'battle' | 'victory' | 'defeat';

export interface CombatState {
  readonly enemyId: string;
  readonly enemyHp: number;
  readonly enemyMaxHp: number;
  readonly phase: CombatPhase;
  readonly turn: number;
  /** 选中武器（布阵阶段点击选择，越界/不可达由 CombatPanel 校验拦截） */
  readonly equippedWeaponId: string | null;
  readonly log: readonly CombatLogEntry[];
}

export interface CombatLogEntry {
  readonly turn: number;
  readonly actor: 'player' | 'enemy';
  readonly text: string;
  readonly damage: number;
  readonly crit: boolean;
}

/* ============================= 抽卡 / 卡牌 ================================ */

export type Rarity = 2 | 3 | 4;

export interface GachaRates {
  readonly fourStar: number;
  readonly threeStar: number;
  /** twoStar = 1 - fourStar - threeStar */
}

export interface GachaConfig {
  readonly id: string;
  readonly name: string;
  /** Lottery.java:40-41 的基础概率 */
  readonly baseRates: GachaRates;
  /** Lottery.java:43-46 的每 10 抽概率上调 */
  readonly everyNthBoost: { readonly every: number; readonly rates: GachaRates };
  /** 三层保底配置（见 src/engine/gacha/roller.ts 注释） */
  readonly pity: {
    /** 层1（原版）：单次十连无 3★+ → 随机 1 张升 3★ */
    readonly perTenPullThreeStar: boolean;
    /** 层2（新）：累计无 4★ 抽数达到此值 → 必出 4★ */
    readonly hardFourStar: number;
    /** 层3（新）：十连中若触发层1，本十连保底额外 +1 张 3★ */
    readonly bonusThreeStarOnPity: boolean;
  };
  readonly costPerPull: number;
}

export type CardKind = 'law' | 'character';

export interface CardDef {
  readonly id: string;
  readonly kind: CardKind;
  readonly name: string;
  readonly rarity: Rarity;
  readonly description: string;
  /** kind=law 时必填：指向 lawRegistry 的补丁 id（schema 校验引用一致性） */
  readonly lawPatchId?: string;
  /** kind=character 时必填：BuffId（lawRegistry 校验数值范围） */
  readonly buff?: { readonly buffId: string; readonly value: number };
}

export interface CardInstance {
  readonly uid: string;
  readonly cardId: string;
  readonly obtainedAt: number;
}

export interface GachaPull {
  readonly uid: string;
  readonly cardId: string;
  readonly rarity: Rarity;
  readonly isNew: boolean;
}

export interface GachaPullResult {
  readonly pulls: readonly GachaPull[];
  readonly boostedTenPull: boolean;
  readonly pityTriggered: 'none' | 'per-ten' | 'hard-four-star';
}

/* ============================= 剧情 / 对话 ================================ */

export interface DialogueLine {
  readonly speakerId: string;
  readonly text: string;
}

export type StoryEffect =
  | { readonly kind: 'grantWeapon'; readonly weaponId: string }
  | { readonly kind: 'setEnemyAttack'; readonly enemyId: string; readonly value: number }
  | { readonly kind: 'grantStarStones'; readonly amount: number }
  | { readonly kind: 'unlockPlaneShift' };

export interface StoryEventDef {
  readonly id: string;
  readonly area: AreaId;
  readonly title: string;
  readonly lines: readonly DialogueLine[];
  /** 触发类型：走到 NPC 格 / 踩到机关 / 战斗胜利 */
  readonly trigger: 'npc' | 'tile' | 'battle-end';
  /** trigger=npc/tile 时的位置 */
  readonly pos?: Vec2;
  readonly effects: readonly StoryEffect[];
  /** 剧情引用的敌人 id（集成期校验存在性） */
  readonly relatedEnemyIds?: readonly string[];
}

/* ============================= 多语言 / 音频 ============================== */

/** 原 SanBPushChest 的 7 语种（英、汉简、汉繁、日、俄、德、法） */
export const LOCALES = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ru', 'de', 'fr'] as const;
export type LocaleId = (typeof LOCALES)[number];

export type I18nKey = string;

export interface BgmDef {
  readonly id: string;
  readonly title: string;
  /** 相对 src/assets/audio/ 的路径 */
  readonly file: string;
  readonly source: string;
  /** true = 可直接播放；false = 资产是 .mid 等待转换（浏览器不可播） */
  readonly playable: boolean;
}

export interface SfxDef {
  readonly id: string;
  readonly file: string;
  readonly source: string;
}

export interface AudioManifest {
  readonly bgm: readonly BgmDef[];
  readonly sfx: readonly SfxDef[];
}

/* ============================= 输入（语义 Action） ======================== */

/** 输入层归一化产物：一切输入最终变成这里的某个成员进 store */
export type GameAction =
  | { readonly type: 'move'; readonly dir: Dir }
  | { readonly type: 'shove'; readonly dir: Dir }
  | { readonly type: 'pull'; readonly dir: Dir }
  | { readonly type: 'diagonal'; readonly diag: DiagDir }
  /** 相位穿行：dir 缺省 = 沿最近一次移动方向（C 键约定，store 侧推断） */
  | { readonly type: 'phase'; readonly dir?: Dir }
  | { readonly type: 'undo' }
  | { readonly type: 'replaySegment' }
  | { readonly type: 'interact'; readonly targetId?: string }
  | { readonly type: 'shiftPlane' }
  | { readonly type: 'toggleFormation' }
  | { readonly type: 'selectWeapon'; readonly weaponId: string }
  | { readonly type: 'combatAct'; readonly act: 'attack' | 'defend' | 'item' | 'flee' }
  | { readonly type: 'rollGacha'; readonly times: 1 | 10 }
  | { readonly type: 'applyLawCard'; readonly uid: string }
  | { readonly type: 'advanceDialogue' }
  | { readonly type: 'skipDialogue' }
  | { readonly type: 'chooseStory'; readonly choiceId: string }
  | { readonly type: 'submitStoryInput'; readonly text: string }
  | { readonly type: 'setLocale'; readonly locale: LocaleId }
  | { readonly type: 'setVolume'; readonly channel: 'master' | 'bgm' | 'sfx'; readonly value: number }
  | { readonly type: 'toggleMute' }
  | { readonly type: 'openPanel'; readonly panel: PanelId }
  | { readonly type: 'closeOverlay' };

export type PanelId = 'deck' | 'gacha' | 'settings' | 'rulebook' | 'none';

/* ============================= 全局状态（store 唯一形状） ================== */

export type Phase = 'title' | 'playing' | 'dialogue' | 'combat' | 'gacha' | 'result';

/** 一次推箱动作前的时间切片，供 undo 恢复 */
export interface SegmentSnapshot {
  readonly entities: readonly GridEntity[];
  readonly steps: number;
}

export interface SegmentState {
  readonly levelId: string;
  readonly entities: readonly GridEntity[];
  /** 已推进的历史（不含当前），undo 直接弹出 */
  readonly history: readonly SegmentSnapshot[];
  readonly steps: number;
  /** 法则位面是否已切换（F 键） */
  readonly planeShifted: boolean;
}

export interface PlayerState {
  readonly name: string;
  readonly maxHp: number;
  readonly hp: number;
  readonly baseAttack: number;
  readonly defense: number;
  readonly weaponId: string | null;
  /** 背包里的武器（def id 列表；战斗布阵阶段可真实选择 —— K12/K13） */
  readonly weapons?: readonly string[];
}

export interface SettingsState {
  readonly masterVolume: number;
  readonly bgmVolume: number;
  readonly sfxVolume: number;
  readonly muted: boolean;
  readonly cheatsEnabled: boolean;
  readonly touchControls: boolean;
}

export interface GachaState {
  readonly starStones: number;
  readonly totalPulls: number;
  readonly pullsSinceFourStar: number;
  readonly owned: readonly CardInstance[];
  readonly activeLaws: readonly string[];
  readonly lastResult: GachaPullResult | null;
}

export interface StoryState {
  readonly activeEventId: string | null;
  readonly lineIndex: number;
  readonly seenEventIds: readonly string[];
  /** 旗标值含字符串（如弱点卡绑定 story:key-boss=card id） */
  readonly flags: Readonly<Record<string, boolean | number | string>>;
}

export interface GameState {
  readonly phase: Phase;
  readonly locale: LocaleId;
  /** 当前打开的面板（状态字段名与 openPanel 动作刻意区分） */
  readonly activePanel: PanelId;
  readonly settings: SettingsState;
  readonly player: PlayerState;
  readonly segment: SegmentState | null;
  readonly ruleSet: RuleSet;
  readonly gacha: GachaState;
  readonly combat: CombatState | null;
  readonly story: StoryState;
  /** 终局 overlay 可关闭不锁控制（根治 S11） */
  readonly result: { readonly levelId: string; readonly stars: 1 | 2 | 3; readonly steps: number } | null;
  /* ---- 集成期新增（四引擎接线） ----
     puzzle/battle/combat/segment 是读写关系明确的「引擎真相 → 投影视图」：
     写只发生引擎状态（puzzle/battle）上，segment/combat 每次随之重算投影，
     视图与旧 import 点零改动（单一真相源纪律不破）。 */
  /** 谜题引擎状态（puzzle-engine 纯函数持有；segment 是它的投影） */
  readonly puzzle: unknown | null;
  /** 战斗引擎状态（combat-engine BattleState；combat 是它的 core 投影） */
  readonly battle: unknown | null;
  /** gacha 三层保底计数器（pullsSinceNewLaw/shards/totalPulls，持久化） */
  readonly pity: { readonly pullsSinceFourStar: number; readonly pullsSinceNewLaw: number; readonly shards: number; readonly totalPulls: number };
  /** 剧情解释器运行时（story-weaver；持久化，剧本中断可续） */
  readonly storyRuntime: {
    readonly scriptId: string | null;
    readonly nodeId: string | null;
    readonly lineIndex: number;
    readonly phase: 'idle' | 'dialogue' | 'awaiting-choice' | 'awaiting-input' | 'awaiting-battle' | 'finished';
    readonly retries: number;
    readonly flags: Readonly<Record<string, boolean | number | string>>;
    readonly visitedNodeIds: readonly string[];
  };
}
