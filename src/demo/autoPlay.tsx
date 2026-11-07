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
 *  4. 顶栏实时显示当前关卡与推数进度，可随时点「停止」（回到标题）。
 *
 * 这是纯观赏模式：不激活任何法则卡（保证 solver 的标准推箱语义与实机一致）。
 */

import { useEffect, useRef, useState } from 'react';
import { useGameStore, visibleChoices, selectPuzzleState, type GameStore } from '../core/store/gameStore';
import { LEVELS } from '../data/levels';
import { WEAPONS } from '../data/weapons';
import { ALL_SCRIPTS } from '../data/storyScripts';
import { parseLevelGeometry, type LevelGeometry } from '../engine/puzzle/grid';
import { solveGeometry, walkDirs, type SolveStep } from '../engine/puzzle/solver';
import type { Dir, GameState } from '../core/types';

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
    let dialogueTick = 0;

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
      if (resets > 4) {
        finish(`本关自动推进失败：${levelId ?? '未知关卡'}`);
        return;
      }
      legDirs = [];
      pushStep = null;
      s.replaySegment(); // 回到关卡初始状态，下一 tick 重新求解
      levelId = null;
    };

    const initLevel = (id: string): void => {
      levelId = id;
      lastProgress = Date.now();
      geometry = null;
      steps = [];
      stepIndex = 0;
      legDirs = [];
      pushStep = null;
      resets = 0;
      waiting = 0;
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
      const solved = solveGeometry(geometry);
      if (!solved.solvable || solved.steps.length === 0) {
        finish(`求解失败：${level.name}${solved.error !== undefined ? `（${solved.error}）` : ''}`);
        return;
      }
      steps = solved.steps;
      lastProgress = Date.now(); // 求解可能耗时数十秒，不计入「卡住」判定
      setStatus(`${level.name} · 0/${steps.length} 推`);
    };

    /* --------------------------- 各阶段驱动器 ----------------------------- */
    const driveDialogue = (s: GameStore): void => {
      const runtime = s.storyRuntime;
      if (runtime.phase === 'awaiting-choice') {
        const choices = visibleChoices(ALL_SCRIPTS, runtime);
        // 外域选择优先「送回」——留在主线，不跳进程序生成的无尽回廊
        const back = choices.find((c) => c.label.includes('送回') || c.label.includes('回到') || c.label.includes('返回'));
        const pick = back ?? choices[0];
        if (pick !== undefined) {
          s.chooseStory(pick.id);
          lastProgress = Date.now();
          return;
        }
      }
      if (runtime.phase === 'awaiting-input') {
        // 作者谜题：提交原作答案之一
        s.submitStoryInput('5,5,1');
        lastProgress = Date.now();
        return;
      }
      dialogueTick += 1;
      if (dialogueTick % 3 === 0) s.advanceDialogue();
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

      // 1) 先走位到发力位
      if (legDirs.length > 0) {
        const dir = legDirs[0];
        if (dir === undefined) return;
        legDirs = legDirs.slice(1);
        const before = s.segment?.steps ?? -1;
        s.move(dir);
        if ((useGameStore.getState().segment?.steps ?? -1) !== before) lastProgress = Date.now();
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
      if (now - lastProgress > 60_000) {
        finish(`演示卡住（阶段 ${s.phase}）`);
        return;
      }
      // 对话/战斗打断后，当前这一步的剩余走位作废，回到 playing 时按位置重规划
      const phaseChanged = s.phase !== lastPhase;
      lastPhase = s.phase;
      if (phaseChanged && s.phase === 'playing') {
        legDirs = [];
        pushStep = null;
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
        top: 10,
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
