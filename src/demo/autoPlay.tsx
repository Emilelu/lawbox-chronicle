/**
 * 自动演示（autoplay）—— 用内置求解器把主线关卡从头到尾自动打通。
 * ---------------------------------------------------------------------------
 * 打开方式：
 *   http://localhost:5173/?autoplay=1            // 默认速度
 *   http://localhost:5173/?autoplay=1&speed=2    // 2× 速度（0.5~5）
 *
 * 行为：
 *  1. 进入游戏后自动 startLevel 第一关；每关用 engine/puzzle/solver 的
 *     solveGeometry 求出「推」序列，再由 walkDirs 按玩家当前位置逐步重规划
 *     「走到发力位 → 推」，经 store.move 逐格驱动（剧情/战斗打断后能自愈）；
 *  2. 途中遇到剧情对话/选择/作者谜题输入自动推进（选择优先「送回」，
 *     谜题回答 5,5,1）；遭遇战自动装备武器并攻击；结算面板自动进下一关；
 *  3. 演示期使用"满武器 + 高攻高血"的临时角色，保证剧情战不打断观看；
 *     演示结束（或停止）后恢复进入演示前的玩家/抽卡/进度状态，不污染存档；
 *  4. 顶栏实时显示当前关卡与推数进度，可随时点「停止」（回到标题）；
 *  5. 失败自恢复（F2）：走位被挡即重规划不盲走；停滞 60s（看门狗）或推箱
 *     落空 → 本关重置重试（连败计数跨重试保留，上限 DEMO_MAX_LEVEL_RESETS）；
 *     超限且有下一关则跳关继续，无下一关才放弃 —— 永不无限重玩、不永久卡死；
 *  6. 步数预算（N2）：每关单次尝试的移动总数（巡游+走位+推）超过
 *     parSteps[1] + DEMO_STEP_BUDGET_MARGIN 即重开本关从 0 重计，结算步数
 *     不会因重试路径无限膨胀（重试次数由 levelRetryPlan 封顶）；
 *  7. 演示期间强制第三人称视角（经 CAM-1 viewStore，见 takeOverViewPreference），
 *     结束/停止/卸载时恢复进入演示前的 viewPreference，不污染视角偏好。
 *
 * 这是纯观赏模式：不激活任何法则卡（保证 solver 的标准推箱语义与实机一致）。
 */

import { useEffect, useRef, useState } from 'react';
import { useGameStore, visibleChoices, selectPuzzleState, HUB_LEVEL_ID, type GameStore } from '../core/store/gameStore';
import { useViewStore } from '../view/three/viewStore';
import { LEVELS } from '../data/levels';
import { WEAPONS } from '../data/weapons';
import { ALL_SCRIPTS } from '../data/storyScripts';
import { parseLevelGeometry, type LevelGeometry } from '../engine/puzzle/grid';
import { solveGeometry, walkDirs, type SolveStep } from '../engine/puzzle/solver';
import { PRECOMPUTED_SOLUTIONS } from '../data/levels/solutionSteps';
import { DIR_VECTORS, type Dir, type GameState, type Vec2 } from '../core/types';

/* ==================== 主线剧情巡游路线（per-level，STORY-5） ==================== */
/* STORY-5 触发分布：剧情点不再全堆主城（旧实现经 STORY_GRID_OFFSET(7,6) 把
   世界坐标映射进主城网格、且触发评估有 HUB 硬门），而是分散到各关：
   level-scoped 触发按「该关自身网格」的 (x, y) 求值，主城旧规则（羽毛 tile、
   越界彩蛋）保留世界坐标映射。巡游在每关推箱解路开始前完成，站点坐标 =
   对应关卡网格的地板格：
     L1 主城：天使①（radius 1）+ 羽毛①③④（tile 同/邻格）+ 东侧越界彩蛋；
       羽毛② hub(6,6) 是箱子出生点（原始格值 4），箱子推开后才能落格触发，
       由解路过程顺路覆盖，不设巡游站；
     L2/L3/L6：三小怪（radius 0，必须踩上触发格）；
     L4/L5/L10：天使②③④（radius 1）；
     L9：作者谜题（radius 1，需三小怪旗齐 —— 故作者关必须排在三怪关之后）；
     L11：影流之主投影（radius 1）；
     L12：王座咽喉 (6,4) —— BOSS 触发点 (6,5) 是 2×2 圣坛旗格不可站，
       (6,4) 距其曼哈顿 1，radius 3 内必触发；先触发 BOSS 三幕（此时作者旗
       已齐、持谜题之钥，走护盾战分支不进秒杀），再开始推箱解路。 */

interface TourStop {
  readonly label: string;
  readonly target: Vec2;
  /** 到达后向该方向再走一步（用于越界彩蛋；不位移，触发 beyond 剧情） */
  readonly edgePush?: Dir;
  /**
   * 到站后先向该方向跨出一步再走回（同格 tile 触发专用）：羽毛类剧情是
   * tile 触发（半径 0，只在「落格」那一刻评估），与天使① 同格的羽毛①
   * 在天使剧情后原地不动不会触发，必须跨出再回踩制造落格动作。
   */
  readonly reEnter?: Dir;
}

/**
 * 各关剧情巡游路线（key = LEVELS 关卡 id；缺表的关无剧情点，直接进解路）。
 * 巡游步数为 walkDirs BFS 实测（单测逐关核算并钉值，见 autoPlay.test.ts），
 * 预算核算（巡游 + 从巡游终点起步的解路实走，对照 parSteps[1] 2☆ 阈值）：
 *   L1  巡游 54 + 解路 133 = 187 < 222（2☆ 硬指标达标）；
 *   L2  巡游 0（遭遇点被守卫占位跳过，见下注）+ 解路 131 = 131 < 236；
 *   L3 11 + 179 = 190 < 339；L4 10 + 41 = 51 < 92；
 *   L5 8 + 13 = 21（>17，见下注）；L6 4 + 16 = 20 < 33；
 *   L9 7 + 17 = 24 < 44；L10 7 + 56 = 63 < 92；L11 11 + 73 = 84 < 134；
 *   L12 8 + 73 = 81 < 135。
 * 例外一 L2：MECH-4 把「蔡徐坤守卫」实体放在遭遇点 (12,3) 同格堵东廊箱道，
 * 而该格四向皆不可推（上/下让路格是墙、左是箱、右推位是箱）——巡游推入
 * 不可行，站点按实机规则优雅跳过（planTourPushIn 单测钉死该负例）；遭遇
 * 触发依赖 STORY-5/MECH-4 的联动语义（触碰遭遇/regen 敌推），demo 完成性
 * 不受影响（解路不经过 (12,3)）。
 * 例外二 L5（阶下回音，par 最小的一关）：天使③被剧情分布放在关卡最东
 * (7,3)，而解路首发力位在西侧 (2,2)，巡游到访的往返成本 ≈12 步 → 全程
 * 21 步必落 1☆。这是 STORY-5 放置的结构性代价，任何巡游站位（r1 内）都
 * 无法避免；21 仍远小于运行时预算（17+30），不影响通关与跳关 —— 演示以
 * 「完整通关、无 skip」为准，星级只有 L1 被验收硬性钉在 2☆。
 */
export const LEVEL_TOURS: Record<string, readonly TourStop[]> = {
  [HUB_LEVEL_ID]: [
    { label: '导航天使①', target: { x: 8, y: 6 } },
    // 羽毛①与天使①同格 (8,6)：先跨出到 (8,7) 再回踩，制造 tile 落格（+2 步）
    { label: '残留的羽毛·①', target: { x: 8, y: 6 }, reEnter: 'down' },
    { label: '残留的羽毛·③', target: { x: 7, y: 7 } },
    { label: '残留的羽毛·④', target: { x: 7, y: 5 } },
    { label: '东侧彩蛋·神秘法阵', target: { x: 14, y: 10 }, edgePush: 'right' },
  ],
  // L2 蔡徐坤遭遇点 (12,3) 被 MECH-4 守卫实体同格占位且四向不可推：巡游
  // 推入不可行时按实机规则优雅跳过（planTourPushIn 负例），遭遇触发交给
  // STORY-5/MECH-4 联动语义；站点坐标保持 STORY-5 分布不动。
  'level-sb-02': [{ label: '蔡徐坤', target: { x: 12, y: 3 } }],
  'level-sb-03': [{ label: '郭老师', target: { x: 7, y: 5 } }],
  'level-sb-04': [{ label: '导航天使②', target: { x: 7, y: 4 } }],
  'level-lb-05': [{ label: '导航天使③', target: { x: 7, y: 3 } }],
  'level-lb-06': [{ label: '冬泳怪鸽', target: { x: 3, y: 3 } }],
  'level-lb-09': [{ label: '作者谜题', target: { x: 5, y: 4 } }],
  'level-lb-10': [{ label: '导航天使④', target: { x: 2, y: 7 } }],
  'level-lb-11': [{ label: '影流之主投影', target: { x: 6, y: 7 } }],
  'level-lb-12': [{ label: '王座咽喉', target: { x: 6, y: 4 } }],
};

export interface AutoPlayConfig {
  readonly enabled: boolean;
  /** 演示速度倍率（0.5~5） */
  readonly speed: number;
}

/* 与 solver.walkPath 内部的 DIR_ORDER 同序（未导出，此处复刻；改动须同步） */
const TOUR_DIR_ORDER: readonly Dir[] = ['up', 'down', 'left', 'right'];

/**
 * 「推入到站」规划（纯函数）：剧情遭遇点被可推实体占位时（MECH-4 把蔡徐坤
 * 守卫放在与遭遇点同格的东廊箱道上），walkDirs 无法直达 —— 从四方向找
 * 「走到推位 → 推进一步 → 玩家落站」的方案：
 *   推位 stand = target 反向邻格（须可达），实体让路落点 beyond = target
 *   沿推方向的邻格（须在界内且是无人占的可走格）。玩家在推位 s.move(pushDir)
 *   即推进实体并落到 target，触发剧情遭遇。
 * target 本身是墙/不可推占位（祭坛等）时返回 null；调用方退化为跳过站点。
 */
export function planTourPushIn(
  geometry: LevelGeometry,
  blockedPoints: readonly Vec2[],
  player: Vec2,
  target: Vec2,
  targetPushable: boolean,
): { readonly walkTo: Vec2; readonly pushDir: Dir } | null {
  if (!targetPushable) return null;
  const targetTerrain = geometry.terrain[target.y]?.[target.x];
  if (targetTerrain === undefined || targetTerrain === 1) return null; // 墙/界外不可落站
  const blocked = new Set(blockedPoints.map((p) => `${p.x},${p.y}`));
  const standable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= geometry.width || y >= geometry.height) return false;
    if (blocked.has(`${x},${y}`)) return false;
    const t = geometry.terrain[y]?.[x];
    return t !== undefined && t !== 1;
  };
  for (const dir of TOUR_DIR_ORDER) {
    const v = DIR_VECTORS[dir];
    const stand = { x: target.x - v.x, y: target.y - v.y }; // 推位（玩家先走到这）
    const beyond = { x: target.x + v.x, y: target.y + v.y }; // 实体让路落点
    if (!standable(stand.x, stand.y)) continue;
    if (!standable(beyond.x, beyond.y)) continue;
    if (stand.x === player.x && stand.y === player.y) return { walkTo: stand, pushDir: dir };
    const walk = walkDirs(geometry, player, blockedPoints, stand);
    if (!walk.ok) continue;
    return { walkTo: stand, pushDir: dir };
  }
  return null;
}

/** 解析 URL 参数（纯函数，单测可直接喂 query 字符串） */
export function readAutoPlayConfig(search: string): AutoPlayConfig {
  const params = new URLSearchParams(search);
  const raw = Number(params.get('speed') ?? '1');
  return {
    enabled: params.get('autoplay') === '1',
    speed: Number.isFinite(raw) ? Math.min(5, Math.max(0.5, raw)) : 1,
  };
}

/* ------------------------- 重试节拍（F2 根治参数） ------------------------ */

/** 演示停滞看门狗：超过该毫秒数无任何可判定进展 → 本关重置重试 */
export const DEMO_STALL_MS = 60_000;
/** 同一关连续重置上限：超过即判定本关无法自动通关（跳关或放弃） */
export const DEMO_MAX_LEVEL_RESETS = 4;

export type LevelRetryPlan = 'reset' | 'skip' | 'giveup';

/**
 * 连败决策（纯函数，F2）：同一关自动重置不超过上限 → 原地重试；超过上限
 * 且主线还有下一关 → 跳关恢复（演示不永久卡死、不无限循环）；没有下一关
 * → 有界放弃。此前 resetLevel 的 resets>4 判断是死代码 —— resetLevel 把
 * levelId 置空后下一拍 initLevel 总会把 resets 清零，上限永远到不了，
 * 演示会无限「重玩-失败」循环。
 */
export function levelRetryPlan(resets: number, hasNextLevel: boolean): LevelRetryPlan {
  if (resets <= DEMO_MAX_LEVEL_RESETS) return 'reset';
  return hasNextLevel ? 'skip' : 'giveup';
}

/* --------------------------- 步数预算（N2） ------------------------------ */

/**
 * 演示步数预算余量：2☆ 阈值之上的容忍度。实测干净全程 ≈ 巡游 54 步 +
 * 解路 133 步（初醒箱庭 ≈ 187 ≤ par[1] 222，见 LEVEL_TOURS 预算核算），
 * 余量只需吸收重规划/被打断的少量绕行（实测噪声 ~3 步）；取 30 让预算仍
 * 覆盖巡游路线的合理漂移（例如巡游站点增减十几步），同时把真正病态的尝试
 * （反复被挡/久等重置）挡在 2☆ 阈值 + 30 之内。
 */
export const DEMO_STEP_BUDGET_MARGIN = 30;

/**
 * 演示单次尝试的步数预算（纯函数，N2）：按关卡 2☆ 阈值（parSteps[1]）加
 * 少量余量。结算星级读的是 puzzle.steps（本次尝试从 0 累计的全部移动），
 * demo 此前对重试路径（被挡重规划、结算久等重置、对话/战斗打断后重走）
 * 无任何约束，步数只增不减；预算超限即重开本关 —— replaySegment 会重建
 * PuzzleState（steps 归 0），重试次数由 levelRetryPlan 封顶，因此整关的
 * 总步数有界，不会无限累计。无标定数据的关卡（未来会话关）不设预算。
 */
export function demoStepBudget(parSteps: readonly [number, number] | undefined): number {
  if (parSteps === undefined) return Number.POSITIVE_INFINITY;
  return parSteps[1] + DEMO_STEP_BUDGET_MARGIN;
}

/** 演示角色：满武器 + 高攻高血（只在演示期间存在，结束后恢复原状态） */
export function demoPlayer(): GameState['player'] {
  const ids = WEAPONS.map((w) => w.id);
  return {
    name: 'AUTO DEMO',
    maxHp: 9999,
    hp: 9999,
    baseAttack: 9999,
    defense: 999,
    weaponId: ids[0] ?? null,
    weapons: ids,
  };
}

/**
 * 视角接管（CAM-1 viewStore，只消费其 get/set API）：演示开始强制第三人称
 * ——自动演示是观赏模式，巡游/解路/结算统一按第三人称演出，也不受
 * viewPreference 相关相机分档的干扰；结束（完成/停止/卸载）时恢复进入
 * 演示前的 viewPreference。返回恢复函数（幂等：完成、停止、卸载多条退出
 * 路径都会调 restore，重复写回同一前值无副作用）。
 */
export function takeOverViewPreference(): () => void {
  const saved = useViewStore.getState().viewPreference;
  useViewStore.getState().setViewPreference('third');
  return () => {
    useViewStore.getState().setViewPreference(saved);
  };
}

export function AutoPlayLayer() {
  const [config] = useState<AutoPlayConfig>(() =>
    readAutoPlayConfig(typeof window === 'undefined' ? '' : window.location.search),
  );
  const [status, setStatus] = useState('准备自动通关…');
  const [finished, setFinished] = useState(false);
  const [stopped, setStopped] = useState(false);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!config.enabled) return;

    /* ------------------------- 备份：不污染玩家存档 ------------------------- */
    const initial = useGameStore.getState();
    const backup = {
      player: initial.player,
      activeLaws: initial.gacha.activeLaws,
      gacha: initial.gacha,
      pity: initial.pity,
      story: initial.story,
      storyRuntime: initial.storyRuntime,
    };
    useGameStore.setState({
      player: demoPlayer(),
      gacha: { ...initial.gacha, activeLaws: [] }, // 不激活法则卡，保持 solver 标准语义
    });

    // 演示期强制第三人称视角（CAM-1 viewStore），结束/停止/卸载恢复前值
    const restoreView = takeOverViewPreference();

    const restore = (): void => {
      restoreView(); // viewPreference 恢复进入演示前的值（不污染偏好）
      const s = useGameStore.getState();
      useGameStore.setState({
        player: backup.player,
        gacha: {
          ...s.gacha,
          activeLaws: backup.activeLaws,
          owned: backup.gacha.owned,
          starStones: backup.gacha.starStones,
        },
        pity: backup.pity,
        story: backup.story,
        storyRuntime: backup.storyRuntime,
      });
    };

    /* --------------------------- 演示运行状态 ----------------------------- */
    let timer: number | undefined;
    let lastProgress = Date.now();
    let lastPhase: GameState['phase'] = 'title';
    let levelId: string | null = null;
    let geometry: LevelGeometry | null = null;
    let steps: readonly SolveStep[] = [];
    let stepIndex = 0;
    /** 当前这一步的走位队列（到发力位为止）；空则下一步规划 */
    let legDirs: Dir[] = [];
    /** 走位完成后待执行的推 */
    let pushStep: SolveStep | null = null;
    let resets = 0;
    let waiting = 0;
    /** 走位连续被挡计数（F2：被挡不再盲走，连续走不动即判规划失效） */
    let legBlocked = 0;
    /** 上次初始化的关卡 id：换关才清零 resets，同关重试保留连败计数（F2） */
    let initializedLevelId: string | null = null;
    /** 本关步数预算（N2）：单次尝试的移动总数上限，超限重开本关从 0 重计 */
    let stepBudget = Number.POSITIVE_INFINITY;
    /** 当前巡游站是否已执行「跨出回踩」（防重复跨出的死循环） */
    let tourReEntered = false;
    /** 推入到站：走位到推位后待执行的推方向（null = 无推入规划） */
    let tourPushIn: Dir | null = null;
    /** 本关剧情巡游进度（per-level 巡游表） */
    let tourIndex = 0;
    let tourDone = false;
    /** 对话节奏（每行约 1 秒，选项停留 0.9 秒再选） */
    let lastDialogueAt = Date.now();
    let choiceNodeId: string | null = null;

    const stopAll = (): void => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    const finish = (message: string): void => {
      stopAll();
      setFinished(true);
      setStatus(message);
      restore();
    };

    const nextLevelAfter = (currentId: string): { id: string; name: string } | undefined => {
      const index = LEVELS.findIndex((l) => l.id === currentId);
      const next = index >= 0 ? LEVELS[index + 1] : undefined;
      return next === undefined ? undefined : { id: next.id, name: next.name };
    };

    const resetLevel = (s: GameStore): void => {
      resets += 1;
      const next = nextLevelAfter(levelId ?? '');
      const plan = levelRetryPlan(resets, next !== undefined);
      const clearPlan = (): void => {
        legDirs = [];
        pushStep = null;
        tourPushIn = null;
        waiting = 0;
        legBlocked = 0;
      };
      if (plan === 'skip' && next !== undefined) {
        // 连败超限：跳过本关继续演示（失败可恢复，不永久卡死 —— F2）
        clearPlan();
        levelId = null;
        lastProgress = Date.now();
        setStatus(`本关自动推进失败，跳过 → ${next.name}`);
        s.startLevel(next.id);
        return;
      }
      if (plan === 'giveup' || (plan === 'skip' && next === undefined)) {
        finish(`本关自动推进失败：${levelId ?? '未知关卡'}`);
        return;
      }
      clearPlan();
      s.replaySegment(); // 回到关卡初始状态，下一 tick 重新求解
      // levelId 置空 → 下一 tick initLevel 重新求解；resets 故意不清零：
      // 连败计数跨重试保留，levelRetryPlan 才有真实的退出条件（F2）
      levelId = null;
    };

    const initLevel = (id: string): void => {
      if (initializedLevelId !== id) {
        initializedLevelId = id; // 换关才清连败计数；同关重试保留（F2）
        resets = 0;
      }
      levelId = id;
      lastProgress = Date.now();
      geometry = null;
      steps = [];
      stepIndex = 0;
      legDirs = [];
      pushStep = null;
      legBlocked = 0;
      waiting = 0;
      tourIndex = 0;
      tourReEntered = false;
      tourPushIn = null;
      // 剧情巡游按关查表（STORY-5 分布）：无巡游表的关直接进解路
      tourDone = LEVEL_TOURS[id] === undefined;
      const level = LEVELS.find((l) => l.id === id);
      if (level === undefined) {
        finish(`演示结束：会话关卡 ${id} 无法自动求解`);
        return;
      }
      // 步数预算按关卡标定重算（N2）：换关/重开都从满预算开始
      stepBudget = demoStepBudget(level.parSteps);
      setStatus(`求解中：${level.name}`);
      const parsed = parseLevelGeometry(level);
      if (!parsed.ok) {
        finish(`关卡解析失败：${parsed.error}`);
        return;
      }
      geometry = parsed.geometry;
      // 预计算解路：运行时零求解，关卡切换不再卡顿（高难关现场求解可达数十秒）
      const precomputed = PRECOMPUTED_SOLUTIONS[id];
      if (precomputed !== undefined && precomputed.length > 0) {
        steps = precomputed;
        lastProgress = Date.now();
        setStatus(`${level.name} · 0/${steps.length} 推`);
        return;
      }
      // 兜底：未预计算的关卡（未来新增）现场求解，可能耗时
      const solved = solveGeometry(geometry);
      if (!solved.solvable || solved.steps.length === 0) {
        finish(`求解失败：${level.name}${solved.error !== undefined ? `（${solved.error}）` : ''}`);
        return;
      }
      steps = solved.steps;
      lastProgress = Date.now();
      setStatus(`${level.name} · 0/${steps.length} 推`);
    };

    /* --------------------------- 各阶段驱动器 ----------------------------- */
    const driveDialogue = (s: GameStore): void => {
      const runtime = s.storyRuntime;
      const now = Date.now();
      if (runtime.phase === 'awaiting-choice') {
        // 选项先展示一会儿再选，避免剧情一闪而过
        if (choiceNodeId !== runtime.nodeId) {
          choiceNodeId = runtime.nodeId;
          lastDialogueAt = now;
          return;
        }
        if (now - lastDialogueAt < 900) return;
        const choices = visibleChoices(ALL_SCRIPTS, runtime);
        // 外域选择优先「送回」——留在主线，不跳进程序生成的无尽回廊
        const back = choices.find((c) => c.label.includes('送回') || c.label.includes('回到') || c.label.includes('返回'));
        const pick = back ?? choices[0];
        if (pick !== undefined) {
          s.chooseStory(pick.id);
          lastProgress = now;
        }
        return;
      }
      choiceNodeId = null;
      if (runtime.phase === 'awaiting-input') {
        // 作者谜题：提交原作答案之一
        s.submitStoryInput('5,5,1');
        lastProgress = now;
        return;
      }
      // 每行停留约 1 秒，剧情可读（不受 speed 影响）
      if (now - lastDialogueAt < 1000) return;
      lastDialogueAt = now;
      const beforeNode = runtime.nodeId;
      const beforeLine = runtime.lineIndex;
      s.advanceDialogue();
      // 剧情真实翻页才算进展（F2）：长对话不再误触停滞看门狗；
      // advanceDialogue 无效（卡死节点）时不刷新，仍由看门狗重试兜底
      const after = useGameStore.getState().storyRuntime;
      if (after.nodeId !== beforeNode || after.lineIndex !== beforeLine) lastProgress = now;
    };

    const driveCombat = (s: GameStore): void => {
      const combat = s.combat;
      if (combat === null) {
        s.closeOverlay();
        return;
      }
      if (combat.phase === 'formation') {
        const weaponId = s.player.weaponId ?? s.player.weapons?.[0];
        if (weaponId !== undefined && weaponId !== null) s.selectWeapon(weaponId);
        s.dispatch({ type: 'toggleFormation' });
        return;
      }
      s.combatAct('attack');
    };

    /** 本关剧情巡游：按 LEVEL_TOURS[levelId] 顺序走到每个剧情点并停留（返回 true 表示本 tick 已处理） */
    const driveTour = (
      s: GameStore,
      entities: readonly {
        readonly kind: string;
        readonly x: number;
        readonly y: number;
        readonly pushable?: boolean;
      }[],
      player: { readonly x: number; readonly y: number },
    ): boolean => {
      const tour = (levelId !== null ? LEVEL_TOURS[levelId] : undefined) ?? [];
      const stop = tour[tourIndex];
      if (stop === undefined) {
        tourDone = true;
        legDirs = [];
        pushStep = null;
        return true;
      }
      if (player.x !== stop.target.x || player.y !== stop.target.y) {
        if (legDirs.length === 0 && tourPushIn !== null) {
          // 已走到推位：推进一步，实体让路、玩家落站（触发遭遇剧情）
          const dir = tourPushIn;
          tourPushIn = null;
          s.move(dir);
          lastProgress = Date.now();
          return true;
        }
        if (legDirs.length === 0) {
          if (geometry === null) return false;
          const blocked = entities.filter((e) => e.kind !== 'player').map((e) => ({ x: e.x, y: e.y }));
          const walk = walkDirs(geometry, { x: player.x, y: player.y }, blocked, stop.target);
          if (!walk.ok) {
            // 站点被可推实体占位（如 MECH-4 守卫与遭遇点同格）：规划「推入到站」；
            // 规划不出（不可推/围死）才跳过站点（剧情断链由看门狗重试兜底）
            const occupant = entities.find(
              (e) => e.x === stop.target.x && e.y === stop.target.y && e.kind !== 'player',
            );
            // 只有「可推实体」（箱子/敌人）占位才可推入；祭坛等建筑（pushable
            // false）与无占位的围死站点都不可推入
            const pushable = occupant?.pushable === true;
            const pushIn = planTourPushIn(
              geometry,
              blocked,
              { x: player.x, y: player.y },
              stop.target,
              pushable,
            );
            const approach =
              pushIn === null
                ? undefined
                : walkDirs(geometry, { x: player.x, y: player.y }, blocked, pushIn.walkTo);
            if (pushIn === null || approach === undefined || !approach.ok) {
              tourIndex += 1; // 走不到也推不进的站点跳过（如被多实体围死）
              tourReEntered = false;
              tourPushIn = null;
              return true;
            }
            legDirs = [...approach.dirs];
            tourPushIn = pushIn.pushDir;
            setStatus(`剧情巡游 ${tourIndex + 1}/${tour.length}：${stop.label}`);
          } else {
            legDirs = [...walk.dirs];
            setStatus(`剧情巡游 ${tourIndex + 1}/${tour.length}：${stop.label}`);
          }
        }
        const dir = legDirs[0];
        if (dir === undefined) return true;
        legDirs = legDirs.slice(1);
        s.move(dir);
        lastProgress = Date.now();
        return true;
      }
      // 到站：同格 tile 触发（羽毛①）先跨出一步再走回，制造落格动作；
      // 只试一次，跨出失败（被挡/不可走）也照常放行，退化为普通到站
      if (stop.reEnter !== undefined && !tourReEntered) {
        tourReEntered = true;
        s.move(stop.reEnter);
        lastProgress = Date.now();
        return true;
      }
      // 到站：边缘彩蛋再向界外推一步（触发 beyond 剧情，不位移）
      if (stop.edgePush !== undefined) s.move(stop.edgePush);
      tourIndex += 1;
      tourReEntered = false;
      lastProgress = Date.now();
      return true;
    };

    const drivePuzzle = (s: GameStore): void => {
      const segment = s.segment;
      if (segment === null) return;

      if (segment.levelId !== levelId) {
        initLevel(segment.levelId);
        return;
      }

      const puzzle = selectPuzzleState(s);
      if (puzzle === null || geometry === null) {
        resetLevel(s);
        return;
      }
      const player = puzzle.entities.find((e) => e.kind === 'player');
      if (player === undefined) {
        resetLevel(s);
        return;
      }

      // 步数预算（N2）：巡游/走位/推的每次成功移动都累计 puzzle.steps，而
      // 结算星级直接读它 —— 重试路径（被挡重规划、久等重置、对话/战斗打断
      // 后重走）没有预算时会让步数无限膨胀。超限即重开本关：replaySegment
      // 重建 PuzzleState 使 steps 归 0，重试次数由 levelRetryPlan 封顶。
      if (segment.steps >= stepBudget) {
        resetLevel(s);
        return;
      }

      // 本关有剧情巡游表（STORY-5 分布）：先走完剧情线，再开始推箱
      if (!tourDone) {
        if (driveTour(s, puzzle.entities, player)) return;
      }

      // 1) 先走位到发力位（F2：被挡不盲走 —— 消费掉被挡的走位会让玩家与
      //    规划脱节，后续推全部落空；改为作废剩余走位按当前位置重规划）
      if (legDirs.length > 0) {
        const dir = legDirs[0];
        if (dir === undefined) {
          legDirs = [];
          return;
        }
        legDirs = legDirs.slice(1);
        const before = s.segment?.steps ?? -1;
        s.move(dir);
        if ((useGameStore.getState().segment?.steps ?? -1) !== before) {
          lastProgress = Date.now();
          legBlocked = 0;
          return;
        }
        // 走位被挡（规划后的实体位形已变）：连续 2 次仍走不动 → 本步规划失效，重置本关
        legBlocked += 1;
        legDirs = [];
        if (legBlocked > 2) resetLevel(s);
        return;
      }

      // 2) 再推
      if (pushStep !== null) {
        const step = pushStep;
        const target = puzzle.entities.find(
          (e) => e.x === step.from.x && e.y === step.from.y && (e.kind === 'chest' || e.kind === 'enemy'),
        );
        if (target === undefined) {
          resetLevel(s);
          return;
        }
        const before = s.segment?.steps ?? -1;
        s.move(step.dir);
        if ((useGameStore.getState().segment?.steps ?? -1) === before) {
          resetLevel(s);
          return;
        }
        pushStep = null;
        stepIndex += 1;
        legBlocked = 0;
        lastProgress = Date.now();
        setStatus(`${LEVELS.find((l) => l.id === levelId)?.name ?? levelId} · ${stepIndex}/${steps.length} 推`);
        return;
      }

      // 3) 解路走完 → 等结算；久等未结算则重置重试
      if (stepIndex >= steps.length) {
        waiting += 1;
        if (waiting > 30) resetLevel(s);
        return;
      }

      // 4) 按当前位置规划下一步的走位（剧情/战斗后自愈）
      const step = steps[stepIndex];
      if (step === undefined) return;
      const blocked = puzzle.entities
        .filter((e) => e.kind !== 'player')
        .map((e) => ({ x: e.x, y: e.y }));
      const walk = walkDirs(geometry, { x: player.x, y: player.y }, blocked, step.stand);
      if (!walk.ok) {
        resetLevel(s);
        return;
      }
      legDirs = [...walk.dirs];
      pushStep = step;
    };

    /* ------------------------------ 主循环 -------------------------------- */
    const tick = (): void => {
      // 后台标签页：浏览器把 setInterval 节流到 ≥1s 甚至更慢，tick 频率不代表
      // 演示停滞——刷新看门狗基准并跳过本 tick，回到前台后自然继续
      if (typeof document !== 'undefined' && document.hidden) {
        lastProgress = Date.now();
        return;
      }
      const s = useGameStore.getState();
      const now = Date.now();
      if (now - lastProgress > DEMO_STALL_MS) {
        // 停滞看门狗（F2）：不再「60s 无进展即永久放弃」，改为重置本关重试；
        // resets 预算（levelRetryPlan）兜底，连败超限才跳关/放弃
        lastProgress = now;
        resetLevel(s);
        return;
      }
      // 对话/战斗打断后，当前这一步的剩余走位作废，回到 playing 时按位置重规划
      const phaseChanged = s.phase !== lastPhase;
      lastPhase = s.phase;
      if (phaseChanged && s.phase === 'playing') {
        legDirs = [];
        pushStep = null;
        tourPushIn = null; // 巡游走位同样作废，回 playing 后按当前位置重规划
      }
      if (phaseChanged && s.phase === 'dialogue') {
        lastDialogueAt = now; // 进入对话先展示 1 秒再翻页
      }

      switch (s.phase) {
        case 'title':
          s.startLevel(LEVELS[0]?.id ?? '');
          lastProgress = now;
          return;
        case 'gacha':
          s.closeOverlay();
          return;
        case 'dialogue':
          driveDialogue(s);
          return;
        case 'combat':
          driveCombat(s);
          return;
        case 'result': {
          const resultLevelId = s.result?.levelId;
          if (resultLevelId === undefined) {
            s.closeOverlay();
            return;
          }
          const next = nextLevelAfter(resultLevelId);
          if (next === undefined) {
            finish('🎉 主线全部关卡自动通关完成');
            return;
          }
          s.startLevel(next.id);
          lastProgress = now;
          return;
        }
        case 'playing':
          drivePuzzle(s);
          return;
      }
    };

    timer = window.setInterval(tick, Math.round(160 / config.speed));

    const stopDemo = (): void => {
      stopAll();
      restore();
      useGameStore.getState().backToTitle();
    };
    stopRef.current = stopDemo;

    const onUnload = (): void => {
      stopAll();
      restore();
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      stopAll();
      window.removeEventListener('beforeunload', onUnload);
      restore();
    };
  }, [config.enabled, config.speed]);

  if (!config.enabled || stopped) return null;

  return (
    <div
      style={{
        position: 'fixed',
        // L5 根治：顶栏原来与 HUD 左上组同处 top≈12 一带，窄视口（<~900px）
        // 居中定位会压住星石胶囊/撤销/重玩的可点击区。下移到 HUD 顶行
        // （top 12 + 高约 58 ≈ 70px）之下，演示模式与 HUD 互不遮挡。
        top: 72,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 14px',
        borderRadius: 999,
        border: '1px solid rgba(124,92,255,0.55)',
        background: 'rgba(10,14,30,0.82)',
        color: 'var(--text-primary)',
        fontSize: 12.5,
        letterSpacing: '0.06em',
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--neon-cyan)' }}>AUTO DEMO</span>
      <span>{finished ? status : `${status} · 速度 ×${config.speed}`}</span>
      {!finished && (
        <button
          className="chip"
          style={{ cursor: 'pointer', padding: '2px 10px' }}
          onClick={() => {
            setStopped(true);
            stopRef.current();
          }}
        >
          停止
        </button>
      )}
    </div>
  );
}
