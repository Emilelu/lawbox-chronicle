/**
 * 事件解释器 —— 剧情状态机（story-weaver 模块核心）。
 * ---------------------------------------------------------------------------
 * 根治对象：KichikuAdventure Game.java:324-1866 的 printDialogue 巨型 if 链。
 * 原函数签名实测 20 个参数（Game.java:324-327）：
 *   printDialogue(x, y, you, guideAngel1..4, author, bag, weasum, hasCount,
 *                 caixukun, guolaoshi, dygg, ylzz, dagger, basketball,
 *                 miHotel, bigSword, gfsStick)
 * 本解释器把这 20 个参数全部数据化：
 *   - 坐标 x/y           → triggers.ts 的 TriggerRule.when（位置归触发表）
 *   - you/bag/weasum     → StoryRuntimeState.flags（脚本运行时草稿）+ 效果回写 store
 *   - guideAngel1..4/author/怪物们 → 剧本数据（src/data/story/*.ts）+ 字符串 id
 *   - 五把武器            → 效果 grantWeapon 只写字符串 id，由 store 查 weapons 表
 *
 * 状态机规则（K15「EasterEgg.main 穿透」的结构性根治）：
 *   - 节点之间只允许显式 next/分支边；不存在任何「顺序 fall-through」路径；
 *   - 非法动作（错误 phase 下的 advance/choose/submit）一律原地不动 + error，
 *     绝不崩溃、绝不 System.exit 式逃逸（K3/K5 同源教训）；
 *   - gate/battle 守卫链式跳转带深度上限，剧本环引用时安全停车。
 *
 * 纯函数约定：所有 API 形如 (输入) => { state, effects }，不修改入参，
 * 不依赖 Date.now/Math.random（演出随机归 store/rng），可在 vitest 直接断言。
 */

import type { Vec2 } from '../../core/types';

/* ================================ 剧本形状 ================================= */

/** 一句对白：speakerId 为说话者字符串 id（展示名由数据层 SPEAKERS 表映射） */
export interface StoryLine {
  readonly speakerId: string;
  readonly text: string;
}

/** 发卡来源（store 侧按来源决定入卡组/入图鉴的记账口径） */
export type StoryCardSource = 'angel-farewell' | 'law-gate' | 'story' | 'hidden-game';

/** 挑战层 id（越界四方向的高难内容；关卡数据由 world 侧提供，剧本侧只发指令） */
export type ChallengeLayerId = 'south-abyss' | 'east-endless' | 'west-end-wall';

/** 战斗调参：BOSS 护盾化与分身机制（K10：分身倍增封顶，杜绝 long 溢出） */
export interface BattleTuning {
  /** 每回合分身 ×2（Game.java:1828 shadow = shadow * 2 的机制化） */
  readonly shadowDoubleEachTurn?: boolean;
  /** 分身数上限（原版 long 翻倍无界 → 有界 64） */
  readonly shadowCap?: number;
  /** 弱点卡所在 flag：值为弱点卡 id（authorPuzzle 答案绑定） */
  readonly weaknessCardFlag?: string;
  /** 命中弱点卡时的伤害倍率 */
  readonly weaknessMultiplier?: number;
  /** 护盾值：未命中弱点时按此减伤（解谜前 BOSS 秒杀、解谜后护盾化的分界） */
  readonly shield?: number;
}

/** 节点进入时请求的演出（store 转发到 core/events/bus，解释器自身零副作用） */
export type StoryFxRequest =
  | { readonly fx: 'sfx'; readonly sfxId: string }
  | { readonly fx: 'bgmStop' }
  | { readonly fx: 'screenShake'; readonly intensity: number }
  | { readonly fx: 'bossTitle'; readonly enemyId: string; readonly title: string };

/** 跨模块效果：解释器只产出，store 消费（对照 core/types.StoryEffect 的超集） */
export type StoryEffect =
  | { readonly kind: 'grantWeapon'; readonly weaponId: string }
  | { readonly kind: 'grantCard'; readonly cardId: string; readonly source: StoryCardSource }
  | { readonly kind: 'grantStarStones'; readonly amount: number }
  | { readonly kind: 'setFlag'; readonly key: string; readonly value: boolean | number | string }
  /** K13：真实清空（原版 EasterEgg.java:183-184 只 println「已清空」实际没清） */
  | { readonly kind: 'clearFlagsWithPrefix'; readonly prefix: string }
  /** 「代价」：真实卸下当前武器（Game.java:497 bag.clear() 的 reducer 语义） */
  | { readonly kind: 'unequipWeapon' }
  | { readonly kind: 'setEnemyAttack'; readonly enemyId: string; readonly value: number }
  | { readonly kind: 'startBattle'; readonly enemyId: string; readonly tuning: BattleTuning }
  | {
      readonly kind: 'showEnding';
      readonly endingId: string;
      /** S11：终局 overlay 必须可关闭、不锁控制 */
      readonly closable: boolean;
      readonly achievementId?: string;
      readonly unlocksMetaTerminal?: boolean;
    }
  | { readonly kind: 'teleport'; readonly x: number; readonly y: number }
  | { readonly kind: 'enterScript'; readonly scriptId: string; readonly entryNodeId?: string }
  | { readonly kind: 'exitScript'; readonly teleport?: Vec2 }
  | { readonly kind: 'enterChallengeLayer'; readonly layerId: ChallengeLayerId }
  | { readonly kind: 'openMetaTerminal' }
  | { readonly kind: 'showHint'; readonly text: string }
  | { readonly kind: 'fx'; readonly request: StoryFxRequest };

export interface DialogueNode {
  readonly kind: 'dialogue';
  readonly id: string;
  readonly lines: readonly StoryLine[];
  /** 读完最后一句后的去向；缺省 = 剧本结束（显式边，无穿透） */
  readonly next?: string;
  /** 进入节点立即结算的效果（发卡/发武器/设 flag 等） */
  readonly onEnterEffects?: readonly StoryEffect[];
  readonly fx?: readonly StoryFxRequest[];
}

export interface StoryChoice {
  readonly id: string;
  readonly label: string;
  readonly next: string;
  /** 需要的 flag（例如编入卡组的角色卡解锁对话分支） */
  readonly requireFlag?: string;
  /** 需要持有的卡（解释器把 grantCard 镜像为 flag `card:<id>`） */
  readonly requireCard?: string;
}

export interface ChoiceNode {
  readonly kind: 'choice';
  readonly id: string;
  readonly promptLines: readonly StoryLine[];
  readonly choices: readonly StoryChoice[];
  /** 选择不满足条件/不存在时的显式兜底分支（无匹配则原地等待，绝不穿透） */
  readonly defaultNext?: string;
  readonly onEnterEffects?: readonly StoryEffect[];
}

/** 谜题求解器契约：由数据层实现（authorPuzzle.ts / hiddenGame.ts），解释器调用 */
export interface PuzzleSolveContext {
  readonly flags: Readonly<Record<string, boolean | number | string>>;
  /** 本次谜题已重试次数（含本次之前） */
  readonly retries: number;
  /** 玩家持有的卡 id（来自 flags 镜像） */
  readonly ownedCardIds: readonly string[];
}

export interface PuzzleSolveResult {
  readonly ok: boolean;
  /** true = 答错即死（隐藏关岔路）；false = 留在原地重试 + 提示（作者谜题） */
  readonly fatal?: boolean;
  /** 重试提示文案（仅 fatal:false 时有意义） */
  readonly hint?: string;
  readonly effects?: readonly StoryEffect[];
  /** 终端类谜题的回显文本（K3：未知输入走回显，绝不当移动指令） */
  readonly echo?: string;
  /**
   * 多出口谜题的成功去向覆盖（如隐藏关三把命运武装对应三个胜利节点）。
   * 解释器会校验目标节点存在，悬空则回退节点自身的 successNext。
   */
  readonly successNext?: string;
}

export type PuzzleSolver = (raw: string, ctx: PuzzleSolveContext) => PuzzleSolveResult;

export interface PuzzleNode {
  readonly kind: 'puzzle';
  readonly id: string;
  /** 关联数据层求解器 id（env.solvers 查表） */
  readonly puzzleId: string;
  readonly promptLines: readonly StoryLine[];
  readonly successNext: string;
  /** fatal 失败去向；非 fatal 失败留在本节点重试（Game.java:506-507 的 System.exit 改写） */
  readonly failNext: string;
  readonly onEnterEffects?: readonly StoryEffect[];
}

export interface BattleNode {
  readonly kind: 'battle';
  readonly id: string;
  readonly enemyId: string;
  readonly tuning: BattleTuning;
  /** 守卫：flag 缺失 → 直接跳 failNext（原版 Game.java:1494 未解谜秒杀分支的显式化） */
  readonly guard?: { readonly flag: string; readonly failNext: string };
  readonly winNext: string;
  readonly loseNext?: string;
  readonly fx?: readonly StoryFxRequest[];
}

/** 门锁节点：按 flag/持卡判定开与锁，两条去向都显式给出 */
export interface GateNode {
  readonly kind: 'gate';
  readonly id: string;
  readonly requireFlags?: readonly string[];
  readonly requireCards?: readonly string[];
  readonly openNext: string;
  readonly lockedNext: string;
}

export interface EndingNode {
  readonly kind: 'ending';
  readonly id: string;
  readonly endingId: string;
  readonly lines: readonly StoryLine[];
  readonly achievementId?: string;
  readonly unlocksMetaTerminal?: boolean;
  readonly closable: boolean;
}

export type StoryNode =
  | DialogueNode
  | ChoiceNode
  | PuzzleNode
  | BattleNode
  | GateNode
  | EndingNode;

export interface StoryScriptDef {
  readonly id: string;
  readonly title: string;
  readonly entryNodeId: string;
  readonly nodes: readonly StoryNode[];
}

/* ============================== 运行时状态 ================================= */

export type StoryRuntimePhase =
  | 'idle'
  | 'dialogue'
  | 'awaiting-choice'
  | 'awaiting-input'
  | 'awaiting-battle'
  | 'finished';

export interface StoryRuntimeState {
  readonly scriptId: string | null;
  readonly nodeId: string | null;
  readonly lineIndex: number;
  readonly phase: StoryRuntimePhase;
  /** 当前谜题重试计数（进入新谜题清零） */
  readonly retries: number;
  /**
   * 脚本运行时草稿 flag（含 `card:<id>` 持卡镜像）。
   * 单一真相源仍是 store；这里是剧本内推进所需的最小镜像。
   */
  readonly flags: Readonly<Record<string, boolean | number | string>>;
  readonly visitedNodeIds: readonly string[];
}

export const IDLE_STORY_RUNTIME: StoryRuntimeState = Object.freeze({
  scriptId: null,
  nodeId: null,
  lineIndex: 0,
  phase: 'idle',
  retries: 0,
  flags: Object.freeze({}),
  visitedNodeIds: Object.freeze([]),
});

/** 一步推演的结果：新状态 + 待 store 执行的效果（+ 可选错误说明） */
export interface StoryStep {
  readonly state: StoryRuntimeState;
  readonly effects: readonly StoryEffect[];
  readonly error?: string;
}

/** 环境注入：谜题求解器注册表（数据层实现，引擎不 import 数据） */
export interface StoryEnv {
  readonly solvers?: Readonly<Record<string, PuzzleSolver>>;
}

/* ============================== 内部小工具 ================================= */

const MAX_CHAIN_DEPTH = 16;

function flagSatisfied(
  flags: Readonly<Record<string, boolean | number | string>>,
  key: string,
): boolean {
  const v = flags[key];
  return v !== undefined && v !== false && v !== 0 && v !== '';
}

function cardFlagKey(cardId: string): string {
  return `card:${cardId}`;
}

function ownedCardsOf(flags: Readonly<Record<string, boolean | number | string>>): readonly string[] {
  return Object.keys(flags)
    .filter((k) => k.startsWith('card:') && flagSatisfied(flags, k))
    .map((k) => k.slice('card:'.length));
}

function withFlags(
  flags: Readonly<Record<string, boolean | number | string>>,
  effects: readonly StoryEffect[],
): Readonly<Record<string, boolean | number | string>> {
  let next = flags;
  for (const eff of effects) {
    if (eff.kind === 'setFlag') {
      next = { ...next, [eff.key]: eff.value };
    } else if (eff.kind === 'grantCard') {
      next = { ...next, [cardFlagKey(eff.cardId)]: true };
    } else if (eff.kind === 'clearFlagsWithPrefix') {
      const cleared: Record<string, boolean | number | string> = {};
      for (const [k, v] of Object.entries(next)) {
        if (!k.startsWith(eff.prefix)) cleared[k] = v;
      }
      next = cleared;
    }
  }
  return next;
}

function findScript(scripts: readonly StoryScriptDef[], scriptId: string): StoryScriptDef | undefined {
  return scripts.find((s) => s.id === scriptId);
}

function findNode(script: StoryScriptDef, nodeId: string): StoryNode | undefined {
  return script.nodes.find((n) => n.id === nodeId);
}

function visited(nodeId: string, runtime: StoryRuntimeState): readonly string[] {
  return runtime.visitedNodeIds.includes(nodeId)
    ? runtime.visitedNodeIds
    : [...runtime.visitedNodeIds, nodeId];
}

/* ================================ 核心推进 ================================= */

/**
 * 进入一个节点（含 gate/battle 守卫的链式展开，深度封顶防环）。
 * 私有函数：对外只暴露 start/advance/choose/submit/battleResult 五个动作。
 */
function enterNode(
  scripts: readonly StoryScriptDef[],
  script: StoryScriptDef,
  nodeId: string,
  runtime: StoryRuntimeState,
  env: StoryEnv,
  depth: number,
): StoryStep {
  if (depth > MAX_CHAIN_DEPTH) {
    return {
      state: { ...runtime, phase: 'finished', nodeId, visitedNodeIds: visited(nodeId, runtime) },
      effects: [],
      error: `剧本 ${script.id} 节点链深度超过 ${MAX_CHAIN_DEPTH}（疑似环引用），已安全停车：${nodeId}`,
    };
  }
  const node = findNode(script, nodeId);
  if (node === undefined) {
    // 悬空边：安全停车而非穿透（对照 K15 的 else 穿透路径）
    return {
      state: { ...runtime, phase: 'finished', nodeId, visitedNodeIds: visited(nodeId, runtime) },
      effects: [],
      error: `剧本 ${script.id} 缺少节点 ${nodeId}（悬空边），已安全停车`,
    };
  }

  const marked: StoryRuntimeState = { ...runtime, scriptId: script.id, nodeId, visitedNodeIds: visited(nodeId, runtime) };

  switch (node.kind) {
    case 'dialogue': {
      const onEnter = node.onEnterEffects ?? [];
      const fxEffects = (node.fx ?? []).map((request) => ({ kind: 'fx', request }) as StoryEffect);
      return {
        state: { ...marked, phase: 'dialogue', lineIndex: 0, flags: withFlags(marked.flags, onEnter), retries: 0 },
        effects: [...onEnter, ...fxEffects],
      };
    }
    case 'choice': {
      const onEnter = node.onEnterEffects ?? [];
      return {
        state: { ...marked, phase: 'awaiting-choice', lineIndex: 0, flags: withFlags(marked.flags, onEnter), retries: 0 },
        effects: onEnter,
      };
    }
    case 'puzzle': {
      const onEnter = node.onEnterEffects ?? [];
      return {
        state: { ...marked, phase: 'awaiting-input', lineIndex: 0, flags: withFlags(marked.flags, onEnter), retries: 0 },
        effects: onEnter,
      };
    }
    case 'gate': {
      const ok =
        (node.requireFlags ?? []).every((f) => flagSatisfied(marked.flags, f)) &&
        (node.requireCards ?? []).every((c) => flagSatisfied(marked.flags, cardFlagKey(c)));
      return enterNode(scripts, script, ok ? node.openNext : node.lockedNext, marked, env, depth + 1);
    }
    case 'battle': {
      if (node.guard !== undefined && !flagSatisfied(marked.flags, node.guard.flag)) {
        // 守卫失败（未解谜秒杀分支）：跳演出节点，绝不发 startBattle
        return enterNode(scripts, script, node.guard.failNext, marked, env, depth + 1);
      }
      const fxEffects = (node.fx ?? []).map((request) => ({ kind: 'fx', request }) as StoryEffect);
      const startBattle: StoryEffect = { kind: 'startBattle', enemyId: node.enemyId, tuning: node.tuning };
      return {
        state: { ...marked, phase: 'awaiting-battle', lineIndex: 0, retries: 0 },
        effects: [startBattle, ...fxEffects],
      };
    }
    case 'ending': {
      const ending: StoryEffect = {
        kind: 'showEnding',
        endingId: node.endingId,
        closable: node.closable,
        ...(node.achievementId !== undefined ? { achievementId: node.achievementId } : {}),
        ...(node.unlocksMetaTerminal !== undefined ? { unlocksMetaTerminal: node.unlocksMetaTerminal } : {}),
      };
      return {
        state: { ...marked, phase: 'finished', lineIndex: 0, retries: 0 },
        effects: [ending],
      };
    }
  }
}

/** 进入剧本（从入口节点开始）。scriptId 不存在 → 原地返回 error（无崩溃）。 */
export function startStory(
  scripts: readonly StoryScriptDef[],
  scriptId: string,
  runtime: StoryRuntimeState = IDLE_STORY_RUNTIME,
  entryNodeId?: string,
): StoryStep {
  const script = findScript(scripts, scriptId);
  if (script === undefined) {
    return { state: runtime, effects: [], error: `未知剧本 id：${scriptId}` };
  }
  return enterNode(scripts, script, entryNodeId ?? script.entryNodeId, runtime, {}, 1);
}

/** 推进当前节点（对话下一句 / 读完跳 next / 剧本结束回世界） */
export function advanceStory(
  scripts: readonly StoryScriptDef[],
  runtime: StoryRuntimeState,
): StoryStep {
  if (runtime.scriptId === null || runtime.nodeId === null) {
    return { state: runtime, effects: [], error: '没有进行中的剧本' };
  }
  const script = findScript(scripts, runtime.scriptId);
  if (script === undefined) {
    return { state: runtime, effects: [], error: `剧本 ${runtime.scriptId} 不存在` };
  }
  const node = findNode(script, runtime.nodeId);
  if (node === undefined) {
    return { state: runtime, effects: [], error: `节点 ${runtime.nodeId} 不存在` };
  }

  if (node.kind === 'dialogue') {
    const nextIndex = runtime.lineIndex + 1;
    if (nextIndex < node.lines.length) {
      return { state: { ...runtime, lineIndex: nextIndex }, effects: [] };
    }
    if (node.next === undefined) {
      return {
        state: { ...runtime, phase: 'finished' },
        effects: [{ kind: 'exitScript' }],
      };
    }
    return enterNode(scripts, script, node.next, runtime, {}, 1);
  }

  if (node.kind === 'ending') {
    return { state: runtime, effects: [], error: '结局节点无可推进内容' };
  }

  // choice/puzzle/battle 等待玩家输入的动作，advance 一律不动（无穿透）
  return {
    state: runtime,
    effects: [],
    error: `节点 ${node.id}（${node.kind}）在等待玩家输入，advance 无效`,
  };
}

/** 在 choice 节点做一个选择（含 requireFlag/requireCard 校验） */
export function chooseStory(
  scripts: readonly StoryScriptDef[],
  runtime: StoryRuntimeState,
  choiceId: string,
): StoryStep {
  if (runtime.phase !== 'awaiting-choice' || runtime.scriptId === null || runtime.nodeId === null) {
    return { state: runtime, effects: [], error: '当前不在等待选择' };
  }
  const script = findScript(scripts, runtime.scriptId);
  const node = script !== undefined ? findNode(script, runtime.nodeId) : undefined;
  if (script === undefined || node === undefined || node.kind !== 'choice') {
    return { state: runtime, effects: [], error: '当前节点不是选择节点' };
  }

  const choice = node.choices.find((c) => c.id === choiceId);
  if (choice === undefined) {
    if (node.defaultNext !== undefined) {
      return enterNode(scripts, script, node.defaultNext, runtime, {}, 1);
    }
    return { state: runtime, effects: [], error: `未知选项：${choiceId}` };
  }
  const flagOk = choice.requireFlag === undefined || flagSatisfied(runtime.flags, choice.requireFlag);
  const cardOk = choice.requireCard === undefined || flagSatisfied(runtime.flags, cardFlagKey(choice.requireCard));
  if (!flagOk || !cardOk) {
    // 条件不满足 → 显式兜底分支，绝不静默穿透
    if (node.defaultNext !== undefined) {
      return enterNode(scripts, script, node.defaultNext, runtime, {}, 1);
    }
    return { state: runtime, effects: [], error: `选项 ${choiceId} 的条件不满足（flag/卡）` };
  }
  return enterNode(scripts, script, choice.next, runtime, {}, 1);
}

/** 提交文本输入（谜题答案 / 作弊码 / 终端指令） */
export function submitStoryInput(
  scripts: readonly StoryScriptDef[],
  runtime: StoryRuntimeState,
  raw: string,
  env: StoryEnv = {},
): StoryStep {
  if (runtime.phase !== 'awaiting-input' || runtime.scriptId === null || runtime.nodeId === null) {
    return { state: runtime, effects: [], error: '当前不在等待输入' };
  }
  const script = findScript(scripts, runtime.scriptId);
  const node = script !== undefined ? findNode(script, runtime.nodeId) : undefined;
  if (script === undefined || node === undefined || node.kind !== 'puzzle') {
    return { state: runtime, effects: [], error: '当前节点不是谜题节点' };
  }

  const solver = env.solvers?.[node.puzzleId];
  if (solver === undefined) {
    // 求解器缺位：按「非致命失败 + 通用提示」处理（绝不 exit、绝不穿透）
    return {
      state: { ...runtime, retries: runtime.retries + 1 },
      effects: [{ kind: 'showHint', text: '（谜题求解器未注册，请重试或检查数据层注册表）' }],
      error: `谜题 ${node.puzzleId} 的求解器未注册`,
    };
  }

  const result = solver(raw, {
    flags: runtime.flags,
    retries: runtime.retries,
    ownedCardIds: ownedCardsOf(runtime.flags),
  });
  const solvedEffects = result.effects ?? [];
  const flagsAfter = withFlags(runtime.flags, solvedEffects);

  if (result.ok) {
    // 多出口覆盖：求解器可指定成功去向，但目标必须真实存在（防悬空边）
    const target =
      result.successNext !== undefined && findNode(script, result.successNext) !== undefined
        ? result.successNext
        : node.successNext;
    const stepped = enterNode(scripts, script, target, { ...runtime, flags: flagsAfter }, env, 1);
    return { state: stepped.state, effects: [...solvedEffects, ...stepped.effects] };
  }

  const echoed = result.echo !== undefined ? { kind: 'showHint', text: result.echo } as StoryEffect : undefined;
  const hintEffect = result.hint !== undefined ? ({ kind: 'showHint', text: result.hint } as StoryEffect) : undefined;
  const failEffects = [echoed, hintEffect].filter((e): e is StoryEffect => e !== undefined);

  if (result.fatal === true) {
    const stepped = enterNode(scripts, script, node.failNext, { ...runtime, flags: flagsAfter }, env, 1);
    return { state: stepped.state, effects: [...solvedEffects, ...failEffects, ...stepped.effects] };
  }
  // 非致命失败：留在本节点重试（Game.java:506-507 System.exit(0) 的改写点）
  return {
    state: { ...runtime, flags: flagsAfter, retries: runtime.retries + 1 },
    effects: [...solvedEffects, ...failEffects],
  };
}

/** 战斗结果回填（store 战斗引擎结算后调用） */
export function resolveBattleResult(
  scripts: readonly StoryScriptDef[],
  runtime: StoryRuntimeState,
  win: boolean,
): StoryStep {
  if (runtime.phase !== 'awaiting-battle' || runtime.scriptId === null || runtime.nodeId === null) {
    return { state: runtime, effects: [], error: '当前没有等待结算的战斗' };
  }
  const script = findScript(scripts, runtime.scriptId);
  const node = script !== undefined ? findNode(script, runtime.nodeId) : undefined;
  if (script === undefined || node === undefined || node.kind !== 'battle') {
    return { state: runtime, effects: [], error: '当前节点不是战斗节点' };
  }
  if (win) {
    return enterNode(scripts, script, node.winNext, runtime, {}, 1);
  }
  if (node.loseNext !== undefined) {
    return enterNode(scripts, script, node.loseNext, runtime, {}, 1);
  }
  return { state: { ...runtime, phase: 'finished' }, effects: [{ kind: 'exitScript' }] };
}

/** 便捷查询：当前应显示的对白行（视图层按 lineIndex 取） */
export function currentLines(
  scripts: readonly StoryScriptDef[],
  runtime: StoryRuntimeState,
): readonly StoryLine[] {
  if (runtime.scriptId === null || runtime.nodeId === null) return [];
  const script = findScript(scripts, runtime.scriptId);
  const node = script !== undefined ? findNode(script, runtime.nodeId) : undefined;
  if (node === undefined) return [];
  if (node.kind === 'dialogue') return node.lines;
  if (node.kind === 'choice' || node.kind === 'puzzle') return node.promptLines;
  if (node.kind === 'ending') return node.lines;
  return [];
}

/** 便捷查询：choice 节点当前可选分支（视图渲染选项按钮；含条件不满足过滤） */
export function visibleChoices(
  scripts: readonly StoryScriptDef[],
  runtime: StoryRuntimeState,
): readonly StoryChoice[] {
  if (runtime.phase !== 'awaiting-choice' || runtime.scriptId === null || runtime.nodeId === null) return [];
  const script = findScript(scripts, runtime.scriptId);
  const node = script !== undefined ? findNode(script, runtime.nodeId) : undefined;
  if (node === undefined || node.kind !== 'choice') return [];
  return node.choices.filter(
    (c) =>
      (c.requireFlag === undefined || flagSatisfied(runtime.flags, c.requireFlag)) &&
      (c.requireCard === undefined || flagSatisfied(runtime.flags, cardFlagKey(c.requireCard))),
  );
}

/** 静态体检（集成期 vitest 用）：剧本内不许有悬空边/缺入口，等同 K15 断言 */
export function validateScript(script: StoryScriptDef): readonly string[] {
  const issues: string[] = [];
  const nodeIds = new Set(script.nodes.map((n) => n.id));
  if (!nodeIds.has(script.entryNodeId)) {
    issues.push(`剧本 ${script.id} 的入口节点 ${script.entryNodeId} 不存在`);
  }
  for (const node of script.nodes) {
    const edges: readonly string[] =
      node.kind === 'dialogue'
        ? node.next !== undefined
          ? [node.next]
          : []
        : node.kind === 'choice'
          ? [...node.choices.map((c) => c.next), ...(node.defaultNext !== undefined ? [node.defaultNext] : [])]
          : node.kind === 'puzzle'
            ? [node.successNext, node.failNext]
            : node.kind === 'battle'
              ? [node.winNext, node.loseNext ?? '', node.guard !== undefined ? node.guard.failNext : '']
              : node.kind === 'gate'
                ? [node.openNext, node.lockedNext]
                : [];
    for (const edge of edges) {
      if (edge !== '' && !nodeIds.has(edge)) {
        issues.push(`剧本 ${script.id} 节点 ${node.id} 悬空边 → ${edge}`);
      }
    }
  }
  return issues;
}
