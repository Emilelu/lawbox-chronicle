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
 *     超限且有下一关则跳关继续，无下一关才放弃 —— 永不无限重玩、不永久卡死。
 *
 * 这是纯观赏模式：不激活任何法则卡（保证 solver 的标准推箱语义与实机一致）。
 */

import { useEffect, useRef, useState } from 'react';
import { useGameStore, visibleChoices, selectPuzzleState, HUB_LEVEL_ID, type GameStore } from '../core/store/gameStore';
import { LEVELS } from '../data/levels';
import { WEAPONS } from '../data/weapons';
import { ALL_SCRIPTS } from '../data/storyScripts';
import { parseLevelGeometry, type LevelGeometry } from '../engine/puzzle/grid';
import { solveGeometry, walkDirs, type SolveStep } from '../engine/puzzle/solver';
import { PRECOMPUTED_SOLUTIONS } from '../data/levels/solutionSteps';
import type { Dir, GameState, Vec2 } from '../core/types';

/* ===================== 主线剧情巡游路线（主城枢纽） ====================== */
/* 网格坐标 = 世界坐标 + STORY_GRID_OFFSET(7,6)。按主线顺序拜访：
   天使（radius 1）→ 姐妹羽毛（tile）→ 三小怪（radius 0 需踩点）→
   作者谜题（作者格是墙，radius 1 站相邻格）→ BOSS（radius 1）→
   东侧边界彩蛋（向边界外推一步触发“神秘法阵”，对话选送回）。 */

interface TourStop {
  readonly label: string;
  readonly target: Vec2;
  /** 到达后向该方向再走一步（用于越界彩蛋；不位移，触发 beyond 剧情） */
  readonly edgePush?: Dir;
}

const HUB_TOUR: readonly TourStop[] = [
  { label: '导航天使①', target: { x: 8, y: 6 } },
  { label: '残留的羽毛·③', target: { x: 7, y: 7 } },
  { label: '残留的羽毛·④', target: { x: 7, y: 5 } },
  { label: '残留的羽毛·①', target: { x: 8, y: 6 } },
  { label: '蔡徐坤', target: { x: 11, y: 8 } },
  { label: '郭老师', target: { x: 10, y: 3 } },
  { label: '冬泳怪鸽', target: { x: 3, y: 2 } },
  { label: '作者谜题', target: { x: 4, y: 10 } },
  { label: '影流之主 BOSS', target: { x: 2, y: 11 } },
  { label: '东侧彩蛋·神秘法阵', target: { x: 14, y: 10 }, edgePush: 'right' },
];

export interface AutoPlayConfig {
  readonly enabled: boolean;
  /** 演示速度倍率（0.5~5） */
  readonly speed: number;
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

    const restore = (): void => {
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
    /** 主城剧情巡游进度 */
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
      tourDone = id !== HUB_LEVEL_ID;
      const level = LEVELS.find((l) => l.id === id);
      if (level === undefined) {
        finish(`演示结束：会话关卡 ${id} 无法自动求解`);
        return;
      }
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

    /** 主城剧情巡游：按 HUB_TOUR 顺序走到每个剧情点并停留（返回 true 表示本 tick 已处理） */
    const driveTour = (
      s: GameStore,
      entities: readonly { readonly kind: string; readonly x: number; readonly y: number }[],
      player: { readonly x: number; readonly y: number },
    ): boolean => {
      const stop = HUB_TOUR[tourIndex];
      if (stop === undefined) {
        tourDone = true;
        legDirs = [];
        pushStep = null;
        return true;
      }
      if (player.x !== stop.target.x || player.y !== stop.target.y) {
        if (legDirs.length === 0) {
          if (geometry === null) return false;
          const blocked = entities.filter((e) => e.kind !== 'player').map((e) => ({ x: e.x, y: e.y }));
          const walk = walkDirs(geometry, { x: player.x, y: player.y }, blocked, stop.target);
          if (!walk.ok) {
            tourIndex += 1; // 走不到的站点跳过（如被箱子占位）
            return true;
          }
          legDirs = [...walk.dirs];
          setStatus(`剧情巡游 ${tourIndex + 1}/${HUB_TOUR.length}：${stop.label}`);
        }
        const dir = legDirs[0];
        if (dir === undefined) return true;
        legDirs = legDirs.slice(1);
        s.move(dir);
        lastProgress = Date.now();
        return true;
      }
      // 到站：边缘彩蛋再向界外推一步（触发 beyond 剧情，不位移）
      if (stop.edgePush !== undefined) s.move(stop.edgePush);
      tourIndex += 1;
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

      // 主城：先走完整条剧情线（天使/羽毛/小怪/作者/BOSS/彩蛋），再开始推箱
      if (!tourDone && segment.levelId === HUB_LEVEL_ID) {
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
