/**
 * 触发器 —— 坐标 → 事件表查询 + 关卡入口卡组校验。
 * ---------------------------------------------------------------------------
 * 职责（story-weaver 规格）：
 *  1. 坐标→事件表查询：把原版「printDialogue 里 if (x==.. && y==..)」的顺序
 *     穿透链（Game.java:328-1866）改为显式规则表；规则命中即返回，查完即停，
 *     查不到返回 null —— 没有任何「落不进任何分支」的隐式路径（K15）。
 *  2. 关卡入口卡组校验：主线法则门槛关卡若检测缺卡，触发补发对话 100% 必发
 *     （法则卡获取兜底，fusionPlan「硬门槛兜底」条目的落地）。
 *  3. 越界分类：阈值统一 ±7，与 KichikuAdventure Game.java 代码实测一致
 *     （Game.java:121 y>7 / :127 y<-7 / :134 x>7 / :139 x<-7；主地图 ±5 见 :91；
 *     README:30-33 写的 ±8 是 K14 文档失真，以代码为准）。
 *
 * 纯函数：输入规则表与上下文，输出命中规则或校验结论；零副作用。
 */

import type { StoryScriptDef } from './interpreter';

/* ============================== 越界几何 ================================== */

export type OutskirtsDir = 'north' | 'south' | 'east' | 'west';

/** 主地图半宽：Game.java:91 `x <= 5 && x >= -5 && y <= 5 && y >= -5` */
export const MAIN_MAP_HALF_EXTENT = 5;

/** 越界事件阈值：Game.java:121/127/134/139 实测 ±7（|6|~|7| 为缓冲警示带） */
export const OUTSKIRT_THRESHOLD = 7;

export type OutskirtsZone =
  | { readonly kind: 'inside' }
  | { readonly kind: 'buffer'; readonly dir: OutskirtsDir; readonly depth: number }
  | { readonly kind: 'beyond'; readonly dir: OutskirtsDir; readonly depth: number };

/**
 * 把任意坐标分类为：地图内 / 缓冲警示带（|6|~|7|）/ 越界事件区（≥|8|）。
 * 深度 = maxAbs - 5（缓冲带）或 maxAbs - 7（事件区）。
 * y 轴越界优先 —— 与原版判定顺序一致（y>7 在 Game.java:121，先于 x>7 的 :134）。
 */
export function classifyPosition(x: number, y: number): OutskirtsZone {
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (absX <= MAIN_MAP_HALF_EXTENT && absY <= MAIN_MAP_HALF_EXTENT) {
    return { kind: 'inside' };
  }
  if (absY > MAIN_MAP_HALF_EXTENT) {
    const dir: OutskirtsDir = y > 0 ? 'north' : 'south';
    return absY > OUTSKIRT_THRESHOLD
      ? { kind: 'beyond', dir, depth: absY - OUTSKIRT_THRESHOLD }
      : { kind: 'buffer', dir, depth: absY - MAIN_MAP_HALF_EXTENT };
  }
  const dir: OutskirtsDir = x > 0 ? 'east' : 'west';
  return absX > OUTSKIRT_THRESHOLD
    ? { kind: 'beyond', dir, depth: absX - OUTSKIRT_THRESHOLD }
    : { kind: 'buffer', dir, depth: absX - MAIN_MAP_HALF_EXTENT };
}

/* ============================== 触发规则表 ================================= */

export type TriggerWhen =
  | {
      readonly kind: 'npc';
      readonly x: number;
      readonly y: number;
      readonly radius?: number;
      /**
       * 关级作用域（STORY-5 分布）：声明时 x/y 是「该关自身网格」坐标，
       * 规则只在该关卡求值；缺省 = 主城枢纽旧规则，x/y 是世界坐标
       * （集成层经 gridToWorld 映射，向后兼容既有触发表）。
       */
      readonly levelId?: string;
    }
  | {
      readonly kind: 'tile';
      readonly x: number;
      readonly y: number;
      /** 关级作用域（语义同 npc）：声明时 x/y 为该关网格坐标，缺省 = 主城世界坐标 */
      readonly levelId?: string;
    }
  | { readonly kind: 'battle-end'; readonly enemyId: string }
  | { readonly kind: 'level-entry'; readonly levelId: string }
  | { readonly kind: 'outskirts'; readonly dir: OutskirtsDir; readonly zone: 'buffer' | 'beyond' };

export interface TriggerRule {
  readonly id: string;
  /** 命中后启动的剧本 id（src/data/story/*.ts） */
  readonly scriptId: string;
  readonly when: TriggerWhen;
  /** 默认 true：seenEventIds 里出现过就不再触发 */
  readonly once?: boolean;
  /** 必须已有该 flag 才触发（如「通关后开放」） */
  readonly requireFlag?: string;
  /** 必须全部已有这些 flag 才触发（如作者前置：三只小怪全灭） */
  readonly requireFlags?: readonly string[];
  /** 必须没有该 flag 才触发（如天使姐妹锁：遇到一位，其余瞬间去世） */
  readonly unlessFlag?: string;
  /** 任一 flag 已存在则不触发（如作者提示事件： encounter 已开始/已解谜） */
  readonly unlessFlags?: readonly string[];
}

export interface TriggerContext {
  readonly x: number;
  readonly y: number;
  readonly flags: Readonly<Record<string, boolean | number | string>>;
  readonly seenEventIds: readonly string[];
  /** battle-end 类查询用：刚结算的敌人 id */
  readonly lastBattleEnemyId?: string;
  /** level-entry 类查询用：正要进入的关卡 id */
  readonly enteringLevelId?: string;
}

function flagOn(
  flags: Readonly<Record<string, boolean | number | string>>,
  key: string,
): boolean {
  const v = flags[key];
  return v !== undefined && v !== false && v !== 0 && v !== '';
}

function ruleMatches(rule: TriggerRule, ctx: TriggerContext): boolean {
  if (rule.once !== false && ctx.seenEventIds.includes(rule.id)) return false;
  if (rule.requireFlag !== undefined && !flagOn(ctx.flags, rule.requireFlag)) return false;
  if (rule.requireFlags !== undefined && !rule.requireFlags.every((f) => flagOn(ctx.flags, f))) return false;
  if (rule.unlessFlag !== undefined && flagOn(ctx.flags, rule.unlessFlag)) return false;
  if (rule.unlessFlags !== undefined && rule.unlessFlags.some((f) => flagOn(ctx.flags, f))) return false;

  switch (rule.when.kind) {
    case 'npc': {
      const radius = rule.when.radius ?? 1;
      return Math.abs(rule.when.x - ctx.x) + Math.abs(rule.when.y - ctx.y) <= radius;
    }
    case 'tile':
      return rule.when.x === ctx.x && rule.when.y === ctx.y;
    case 'battle-end':
      return ctx.lastBattleEnemyId !== undefined && ctx.lastBattleEnemyId === rule.when.enemyId;
    case 'level-entry':
      return ctx.enteringLevelId !== undefined && ctx.enteringLevelId === rule.when.levelId;
    case 'outskirts': {
      const zone = classifyPosition(ctx.x, ctx.y);
      return zone.kind === rule.when.zone && zone.dir === rule.when.dir;
    }
  }
}

/**
 * 顺序查询规则表，返回第一条命中的规则；无命中返回 null。
 * 规则表顺序即优先级（数据显式定义，无隐式穿透）。
 */
export function queryTrigger(rules: readonly TriggerRule[], ctx: TriggerContext): TriggerRule | null {
  for (const rule of rules) {
    if (ruleMatches(rule, ctx)) return rule;
  }
  return null;
}

/**
 * 越界事件的边沿触发判定：仅当「从别的区跨入目标区」的那一刻为 true。
 * 玩家在越界区内继续移动时不会重复触发（store 在坐标变化时先算
 * prev/curr 两个 OutskirtsZone，再调用本函数过滤，最后 queryTrigger）。
 */
export function isOutskirtsTransition(
  prev: OutskirtsZone,
  curr: OutskirtsZone,
  dir: OutskirtsDir,
  zone: 'buffer' | 'beyond',
): boolean {
  const entered = curr.kind === zone && curr.dir === dir;
  const wasThere = prev.kind === zone && prev.dir === dir;
  return entered && !wasThere;
}

/**
 * 交互（E 键）专用：只查玩家曼哈顿距离 ≤1 的 npc 规则。
 * 对齐原版「走到 NPC 相邻格按交互」的手感，同时保底距离 0（踩上）。
 */
export function findInteractableRule(
  rules: readonly TriggerRule[],
  ctx: TriggerContext,
): TriggerRule | null {
  const interactable = rules.filter((r) => r.when.kind === 'npc');
  return queryTrigger(interactable, ctx);
}

/**
 * 位置类规则（npc/tile）的关级作用域判别（STORY-5 分布）：
 * 规则声明 levelId 时，其 x/y 是「该关自身网格」坐标，只应在对应关卡求值；
 * 缺省 = 主城枢纽旧规则，x/y 是世界坐标（集成层经 gridToWorld 映射，向后兼容）。
 * 非位置类（battle-end/level-entry/outskirts）恒返回 undefined —— 无关级作用域，
 * 由调用方按各自语义处理（outskirts 由 store 保持 HUB-only）。
 */
export function positionalRuleLevelId(rule: TriggerRule): string | undefined {
  return rule.when.kind === 'npc' || rule.when.kind === 'tile' ? rule.when.levelId : undefined;
}

/* =========================== 关卡入口卡组校验 ============================== */

/** 主线法则门槛：进入该关卡必须持有的法则卡（缺卡 → 补发对话 100% 必发） */
export interface LawGateDef {
  readonly levelId: string;
  readonly requiredCardIds: readonly string[];
  /** 缺卡时 100% 触发的补发剧本 id（GATE_MAKEUP_SCRIPTS 内） */
  readonly makeUpScriptId: string;
  /** 数据出处备注（K14：说明为何这道门槛存在，供规则手册导出） */
  readonly note: string;
}

export const LAW_GATES: readonly LawGateDef[] = [
  {
    levelId: 'level-sb-02',
    requiredCardIds: ['card-law-feather-chest'],
    makeUpScriptId: 'script-gate-feather-chest',
    note: 'level-sb-01 通关奖励即羽箱法则（src/data/levels.ts:36）；直接选关进入时若缺卡，入口补发，保证「抽不到卡也不软锁」。',
  },
  {
    levelId: 'level-sb-03',
    requiredCardIds: ['card-law-wider-push'],
    makeUpScriptId: 'script-gate-wider-push',
    note: 'level-sb-03 的长廊十字依赖推程 +1 才有解（solver 校验前置）；该卡同时是本关通关奖励，入口缺卡必补发。',
  },
  {
    // STORY-5（评审③修法）：sb-04 是 sb-03 十字回廊的四星变体关（同款长廊布局，
    // areas.ts 数据同构），同样依赖推程 +1 才有解；补发剧本复用 script-gate-wider-push
    //（零新剧本），levelGuide 的 gateHint 由本条目自动消费。
    levelId: 'level-sb-04',
    requiredCardIds: ['card-law-wider-push'],
    makeUpScriptId: 'script-gate-wider-push',
    note: 'level-sb-04（星陨间奏）是 sb-03 长廊十字的变体关：布局同构、同样依赖推程 +1 才有解，本关无卡奖励（纯星石），直接选关进入时缺卡即入口补发（复用 script-gate-wider-push，零新剧本）。',
  },
];

export type LevelEntryCheck =
  | { readonly ok: true; readonly levelId: string }
  | {
      readonly ok: false;
      readonly levelId: string;
      readonly missingCardIds: readonly string[];
      readonly makeUpScriptId: string;
    };

/**
 * 关卡入口卡组校验：缺卡 → 返回补发剧本 id（调用方 100% 启动该剧本）。
 * 这就是「法则卡获取兜底」的判定点：抽卡保底负责概率层，
 * 本函数负责逻辑层 —— 两者叠加后主线零软锁。
 */
export function checkLevelEntryDeck(levelId: string, ownedCardIds: readonly string[]): LevelEntryCheck {
  const gate = LAW_GATES.find((g) => g.levelId === levelId);
  if (gate === undefined) return { ok: true, levelId };
  const owned = new Set(ownedCardIds);
  const missing = gate.requiredCardIds.filter((id) => !owned.has(id));
  if (missing.length === 0) return { ok: true, levelId };
  return { ok: false, levelId, missingCardIds: missing, makeUpScriptId: gate.makeUpScriptId };
}

/* ========================== 门槛补发剧本（内联配置） ======================= */
/**
 * 补发对话 100% 必发：效果层 grantCard 不走概率（对照抽卡三层保底），
 * 语义为「世界法则把欠你的那张卡补给你」。卡 id 与 src/data/gacha.ts 对齐。
 * 说明：这两段剧本是触发系统的内联配置（与 LAW_GATES 表一一对应、体积极小），
 * 放在同一文件保证「门槛表 ↔ 补发剧本」永不脱钩；集成期把 GATE_MAKEUP_SCRIPTS
 * 与 src/data/story/*.ts 的剧本一并注册进解释器即可。
 */

const SPEAKER_SYSTEM = 'system';
const SPEAKER_ALTAR = 'npc-star-altar';

export const GATE_MAKEUP_SPEAKERS: Readonly<Record<string, string>> = Object.freeze({
  [SPEAKER_SYSTEM]: '【系统】',
  [SPEAKER_ALTAR]: '星愿祭坛',
});

export const GATE_MAKEUP_SCRIPTS: readonly StoryScriptDef[] = [
  {
    id: 'script-gate-feather-chest',
    title: '法则门槛：羽箱补发',
    entryNodeId: 'gate-fc-entry',
    nodes: [
      {
        kind: 'dialogue',
        id: 'gate-fc-entry',
        onEnterEffects: [
          { kind: 'setFlag', key: 'gate:made-up:card-law-feather-chest', value: true },
          { kind: 'grantCard', cardId: 'card-law-feather-chest', source: 'law-gate' },
        ],
        lines: [
          { speakerId: SPEAKER_ALTAR, text: '……感应到你的卡组缺少「法则·羽箱」，而前方的回廊必须由它托起。' },
          { speakerId: SPEAKER_ALTAR, text: '别担心，法则不会为难走到这里的人 —— 这张卡，100% 补发给你。' },
          { speakerId: SPEAKER_SYSTEM, text: '获得法则卡：法则·羽箱（入口补发 · 必发）。可在卡组中激活。' },
        ],
        next: 'gate-fc-close',
      },
      {
        kind: 'ending',
        id: 'gate-fc-close',
        endingId: 'gate-make-up-done',
        closable: true,
        lines: [{ speakerId: SPEAKER_SYSTEM, text: '补发完成，回廊的大门在你身后合拢。' }],
      },
    ],
  },
  {
    id: 'script-gate-wider-push',
    title: '法则门槛：长臂补发',
    entryNodeId: 'gate-wp-entry',
    nodes: [
      {
        kind: 'dialogue',
        id: 'gate-wp-entry',
        onEnterEffects: [
          { kind: 'setFlag', key: 'gate:made-up:card-law-wider-push', value: true },
          { kind: 'grantCard', cardId: 'card-law-wider-push', source: 'law-gate' },
        ],
        lines: [
          { speakerId: SPEAKER_ALTAR, text: '碎星十字的长廊比手臂更长。检测到你还没有「法则·长臂」——' },
          { speakerId: SPEAKER_ALTAR, text: '现在有了。主线法则门槛，一律必发，绝无例外。' },
          { speakerId: SPEAKER_SYSTEM, text: '获得法则卡：法则·长臂（入口补发 · 必发）。请在卡组中激活后再推箱。' },
        ],
        next: 'gate-wp-close',
      },
      {
        kind: 'ending',
        id: 'gate-wp-close',
        endingId: 'gate-make-up-done',
        closable: true,
        lines: [{ speakerId: SPEAKER_SYSTEM, text: '长臂入卡，十字回廊在你面前缓缓展开。' }],
      },
    ],
  },
];
